"""인식 파이프라인 (T057, UC1·UC12 · FR-057~059 · BR-ENG-02·06 · D-18).

순서: (자리 얻기) → 구조 확인(불통과면 엔진을 부르지 않고 no_structure 대체) → 설정 순서대로 엔진(성공하면 멈춤)
      → (정간보) 변환은 어댑터 안(extra.yulmyeong_ratio·jg_convert_ms) → 음표 없음 → 타당성(불신이면 distrust 대체).
기록: processing_job · engine_attempt · validity_check_item · stage_timing(structure·jg_convert·validity)
      API 요청이면 queue 단계도. 웹 요청은 같은 request_no 로 다시 불릴 수 있다(종류 바꾸기, FR-058) → 모두 다시 써도 되게.
업로드 검사와 요청 행 만들기는 부르는 쪽(router·연주 작업)이 한다.

2026-09-29 황송해 결정(여러 쪽 — UC1 A9 · BR-ENG-08 · BR-FBK-08 · SD_01 1.5a · 1.12a):
- 한 요청 = 악보 한 곡. 쪽(사진 한 장 또는 PDF 한 쪽)마다 구조 확인 → 엔진 → 타당성 확인을 한다.
  처리 시간 제한은 쪽마다(쪽 시작 + timeout_seconds) 적용하고, 전체 마감(deadline_mono)은 쪽 수 × 제한이다.
  '불신' 쪽은 실패로 본다. 쪽 판정은 request_page 에, 엔진 시도·쪽 단계 시간은 page_no 를 붙여 적는다.
- 성공한 쪽을 올린 순서대로 이어 붙여 MusicXML/MIDI 하나로 만든다(services/join.py). 등급은 변환한 쪽 중 가장 낮은 것.
  일부 쪽이 실패하면 그 쪽을 빼고 이어 붙이고 안내 PAGES_PARTIAL, 모든 쪽이 실패하면 요청 전체가 대체(fallback_reason).
- 요청 전체 값(processing_job): 구조 판정은 변환한 쪽(없으면 모든 쪽)에서 가장 나쁜 것, 종류 불일치는 구조를 확인한 쪽의
  절반 이상이 다른 종류로 보일 때, 타당성 항목은 음 개수는 합, 나머지는 가장 낮은 값.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from app.db import Database, utcnow
from app.errors import fallback_catalog
from app.jobs.limiter import Limiter, QueueTimeout
from app.models.registry import ModelRegistry
from app.services import engine_api, scoreio
from app.services.requests import DB_TO_CODE, stage
from app.settings import Settings

log = logging.getLogger("model-api.recognize")

VALIDITY_ITEMS = ("note_count", "beat_sum", "range_leap", "yulmyeong_ratio", "engine_confidence")
SUPERSEDED = "SUPERSEDED"
GRADE_ORDER = {"trust": 0, "caution": 1, "distrust": 2}
VERDICT_ORDER = {"pass": 0, "ambiguous": 1, "fail": 2}
# 모든 쪽이 실패했을 때 요청 대체 사유 — 가장 많은 사유, 같으면 이 순서(가장 뜻있는 실패: 음표 없음·인식 실패 먼저)
REASON_PRIORITY = ("recognition_failed", "distrust", "no_structure", "timeout", "engine_stopped")


@dataclass
class PageInput:
    """인식할 쪽 하나(2026-09-29 여러 쪽). 사진은 그 파일, PDF 는 쪽을 300dpi 로 바꾼 PNG."""

    page_no: int  # 이어 붙이는 순서(1부터)
    file_no: int  # upload_file.file_no (사진 올린 순서, PDF 는 1)
    source: str  # 'file' | 'pdf_page'
    image: bytes
    image_path: Path
    short_edge_px: int | None = None
    upscaled_short_side_px: int | None = None  # 작은 쪽을 늘려 읽었으면 늘린 짧은 변(2026-09-30 119번)


@dataclass
class RecognizeInput:
    request_id: int
    request_no: str
    score_type: str  # staff | jeongganbo
    pages: list[PageInput]
    is_web: bool
    deadline_mono: float  # 전체 마감(쪽 수 × 처리 시간 제한)
    settings: Settings
    page_timeout_s: float | None = None  # 쪽마다 처리 시간 제한(없으면 settings.timeout_seconds)


@dataclass
class PageOutcome:
    """쪽 하나의 판정과 결과 (request_page 한 행)."""

    page_no: int
    file_no: int
    source: str
    short_edge_px: int | None = None
    upscaled_short_side_px: int | None = None  # 2026-09-30 119번
    fallback_reason: str | None = None  # 쪽 실패 사유(DB 소문자 값)
    no_notes: bool = False
    structure_verdict: str | None = None
    type_mismatch: bool = False
    detected_type: str | None = None
    validity_grade: str | None = None
    validity_items: dict[str, float | None] = field(default_factory=dict)
    validity_score: float | None = None  # 타당성 종합 점수 0~1(로그 score 용, 응답·DB 에는 넣지 않음 — 2026-09-30 D5)
    musicxml: str | None = None
    midi: bytes | None = None
    engine_name: str | None = None
    engine_version: str | None = None
    tried: list[dict] = field(default_factory=list)
    attempts: list[str] = field(default_factory=list)
    timings_ms: dict[str, int] = field(default_factory=dict)
    validity_meta: tuple[str, datetime, datetime] | None = field(default=None, repr=False)

    @property
    def converted(self) -> bool:
        return self.fallback_reason is None and self.musicxml is not None

    @property
    def fallback_code(self) -> str | None:
        if self.fallback_reason is None:
            return None
        if self.fallback_reason == "recognition_failed" and self.no_notes:
            return "NO_NOTES"
        return DB_TO_CODE[self.fallback_reason]

    def summary(self) -> dict[str, Any]:
        """응답의 쪽별 상태(쪽 번호 · 변환/못 읽음 · 등급 또는 사유)."""
        code = self.fallback_code
        return {
            "page_no": self.page_no,
            "file_no": self.file_no,
            "source": self.source,
            "short_edge_px": self.short_edge_px,
            "upscaled_short_side_px": self.upscaled_short_side_px,
            "outcome": "converted" if self.converted else "failed",
            "fallback_reason": code,
            "fallback_message": fallback_catalog().get(code, {}).get("message") if code else None,
            "structure_verdict": self.structure_verdict,
            "validity_grade": self.validity_grade,
            "engine": {"name": self.engine_name, "version": self.engine_version} if self.engine_name else None,
        }


@dataclass
class RecognitionOutcome:
    request_no: str
    fallback_reason: str | None = None  # DB 소문자 값
    no_notes: bool = False
    structure_verdict: str | None = None
    type_mismatch: bool = False
    detected_type: str | None = None
    validity_grade: str | None = None
    validity_items: dict[str, float | None] = field(default_factory=dict)
    validity_score: float | None = None  # 타당성 종합 점수 0~1(로그 score 용, 응답·DB 에는 넣지 않음 — 2026-09-30 D5)
    musicxml: str | None = None
    midi: bytes | None = None
    engine_name: str | None = None
    engine_version: str | None = None
    tried: list[dict] = field(default_factory=list)
    timings_ms: dict[str, int | None] = field(default_factory=dict)
    pages: list[PageOutcome] = field(default_factory=list)
    page_count: int = 1
    notice: dict | None = None  # 일부 쪽을 못 읽었으면 PAGES_PARTIAL

    @property
    def fallback(self) -> bool:
        return self.fallback_reason is not None

    @property
    def fallback_code(self) -> str | None:
        if self.fallback_reason is None:
            return None
        if self.fallback_reason == "recognition_failed" and self.no_notes:
            return "NO_NOTES"
        return DB_TO_CODE[self.fallback_reason]

    @property
    def converted_pages(self) -> int:
        return sum(1 for p in self.pages if p.converted)

    def response(self, *, files: tuple[str, bytes] | None) -> dict[str, Any]:
        """RecognitionResult (INTERFACES §6). files=(musicxml, midi) 를 넣을지는 부르는 쪽이 정한다."""
        code = self.fallback_code
        hint = fallback_catalog().get(code, {}).get("retry_hint") if code else None
        xml, midi = (files if files else (None, None))
        items = {k: self.validity_items.get(k) for k in VALIDITY_ITEMS}
        return {
            "api_version": "v1",
            "request_no": self.request_no,
            "fallback": self.fallback,
            "fallback_reason": code,
            "fallback_message": fallback_catalog().get(code, {}).get("message") if code else None,
            "retry_hint": hint,
            "structure_verdict": self.structure_verdict,
            "type_mismatch": self.type_mismatch,
            "detected_type": self.detected_type,
            "validity_grade": self.validity_grade,
            "validity_items": items,
            "musicxml": xml,
            "midi_base64": base64.b64encode(midi).decode("ascii") if midi else None,
            "midi_available": bool(midi),
            "engine": {
                "name": self.engine_name,
                "version": self.engine_version,
                "tried": self.tried,
            },
            "timings_ms": self.timings_ms,
            # 여러 쪽(2026-09-29): 쪽 수 · 변환한 쪽 수 · 쪽별 상태 · 부분 실패 안내
            "page_count": self.page_count,
            "converted_pages": self.converted_pages,
            "pages": [p.summary() for p in self.pages],
            "notice": self.notice,
        }


def _ms(a: datetime, b: datetime) -> int:
    return max(0, int((b - a).total_seconds() * 1000))


def _remaining(deadline_mono: float) -> float:
    return deadline_mono - time.monotonic()


async def _upsert_job(db: Database, inp: RecognizeInput, verdict: str, mismatch: bool, started: datetime) -> None:
    # 웹이 적은 type_answer 는 그대로 둔다. 답이 있으면 불일치는 있었던 것이므로 참으로 남긴다(chk_job_answer).
    await db.execute(
        "INSERT INTO processing_job (request_id, confirmed_score_type, structure_verdict, type_mismatch, "
        "validity_grade, started_at, finished_at) VALUES (%s,%s,%s,%s,NULL,%s,NULL) "
        "ON DUPLICATE KEY UPDATE confirmed_score_type = VALUES(confirmed_score_type), "
        "structure_verdict = VALUES(structure_verdict), "
        "type_mismatch = (VALUES(type_mismatch) OR type_answer IS NOT NULL), "
        "validity_grade = NULL, started_at = VALUES(started_at), finished_at = NULL",
        (inp.request_id, inp.score_type, verdict, mismatch, started),
    )


async def _finish_job(db: Database, request_id: int, verdict: str, mismatch: bool, grade: str | None) -> None:
    await db.execute(
        "UPDATE processing_job SET structure_verdict = %s, type_mismatch = (%s OR type_answer IS NOT NULL), "
        "validity_grade = %s, finished_at = %s WHERE request_id = %s",
        (verdict, mismatch, grade, utcnow(), request_id),
    )


async def _write_attempt(db: Database, request_id: int, page_no: int, name: str, version: str, outcome: str,
                         failure_code: str | None, started: datetime, ended: datetime) -> None:
    async with db.transaction() as cur:
        await cur.execute("SELECT COALESCE(MAX(attempt_no), 0) + 1 AS n FROM engine_attempt "
                          "WHERE request_id = %s AND page_no = %s FOR UPDATE", (request_id, page_no))
        attempt_no = int((await cur.fetchone())["n"])
        if outcome == "success":
            # 다시 돌아 성공하면 앞선 성공을 '대체됨' 오류로 바꾼다(쪽마다 성공 하나 — uq_engine_one_success)
            await cur.execute(
                "UPDATE engine_attempt SET outcome = 'error', failure_code = %s "
                "WHERE request_id = %s AND page_no = %s AND outcome = 'success'",
                (SUPERSEDED, request_id, page_no),
            )
        await cur.execute(
            "INSERT INTO engine_attempt (request_id, page_no, attempt_no, engine_name, engine_version, outcome, "
            "failure_code, started_at, ended_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (request_id, page_no, attempt_no, name[:40], (version or "unknown")[:40], outcome,
             None if outcome == "success" else (failure_code or outcome.upper())[:40], started, max(ended, started)),
        )


async def _write_validity(db: Database, request_id: int, items: dict[str, float | None]) -> None:
    async with db.transaction() as cur:
        await cur.execute("DELETE FROM validity_check_item WHERE request_id = %s", (request_id,))
        for code in VALIDITY_ITEMS:
            value = items.get(code)
            if value is None:
                continue
            value = max(-99999999.0, min(99999999.0, float(value)))
            await cur.execute(
                "INSERT INTO validity_check_item (request_id, item_code, measured_value) VALUES (%s,%s,%s)",
                (request_id, code, round(value, 4)),
            )


async def _start_pages(db: Database, inp: RecognizeInput) -> None:
    """쪽 행을 '대기'로 새로 만든다(다시 도는 요청이면 앞선 쪽 판정·성공 시도를 지운다)."""
    rid = inp.request_id
    await db.execute("DELETE FROM stage_timing WHERE request_id = %s AND stage_code IN ('structure','jg_convert','validity')",
                     (rid,))
    await db.execute("UPDATE engine_attempt SET outcome = 'error', failure_code = %s "
                     "WHERE request_id = %s AND outcome = 'success'", (SUPERSEDED, rid))
    async with db.transaction() as cur:
        await cur.execute("DELETE FROM request_page WHERE request_id = %s", (rid,))
        for p in inp.pages:
            # (2026-09-30 119번) 반려 기준이 300px 로 내려갔다(DB CHECK 도 300) — 늘려 읽은 쪽은 늘린 짧은 변을 함께 적는다
            edge = p.short_edge_px if p.short_edge_px is not None and p.short_edge_px >= 300 else None
            await cur.execute(
                "INSERT INTO request_page (request_id, page_no, file_no, source, image_short_side_px, upscaled_short_side_px, outcome) "
                "VALUES (%s,%s,%s,%s,%s,%s,'pending')",
                (rid, p.page_no, p.file_no, p.source, edge, getattr(p, "upscaled_short_side_px", None)),
            )


async def _finish_page(db: Database, request_id: int, page: PageOutcome, started: datetime, ended: datetime) -> None:
    grade = page.validity_grade if page.validity_grade in GRADE_ORDER else None
    await db.execute(
        "UPDATE request_page SET structure_verdict = %s, validity_grade = %s, outcome = %s, fallback_reason = %s, "
        "engine_name = %s, engine_version = %s, started_at = %s, ended_at = %s WHERE request_id = %s AND page_no = %s",
        (page.structure_verdict, grade, "converted" if page.converted else "failed",
         None if page.converted else (page.fallback_reason or "recognition_failed"),
         (page.engine_name or None) and page.engine_name[:40], (page.engine_version or None) and page.engine_version[:40],
         started, max(ended, started), request_id, page.page_no),
    )


async def run_recognition(db: Database, limiter: Limiter, registry: ModelRegistry, inp: RecognizeInput) -> RecognitionOutcome:
    out = RecognitionOutcome(request_no=inp.request_no, page_count=max(1, len(inp.pages)))
    channel = "web" if inp.is_web else "api"
    q_start = utcnow()
    try:
        async with limiter.slot("recognize", channel, inp.deadline_mono):
            q_end = utcnow()
            out.timings_ms["queue"] = _ms(q_start, q_end)
            if not inp.is_web:
                await stage(db, inp.request_id, "queue", q_start, q_end)
            await _recognize_pages(db, registry, inp, out)
    except QueueTimeout:
        # 마감 안에 자리를 얻지 못함 → 시간 초과 대체(SC-003). 구조 확인 전이라 작업 행·쪽 행은 없다.
        if not inp.is_web:
            await stage(db, inp.request_id, "queue", q_start, utcnow())
        out.fallback_reason = "timeout"
    return out


async def _recognize_pages(db: Database, registry: ModelRegistry, inp: RecognizeInput, out: RecognitionOutcome) -> None:
    rid = inp.request_id
    page_timeout = float(inp.page_timeout_s or inp.settings.timeout_seconds)
    await _start_pages(db, inp)
    # 작업 행을 먼저 둔다(engine_attempt 가 참조). 구조 판정·등급은 모든 쪽을 본 뒤 요청 전체 값으로 고친다
    await _upsert_job(db, inp, "ambiguous", False, utcnow())

    for page in inp.pages:
        po = PageOutcome(page_no=page.page_no, file_no=page.file_no, source=page.source,
                         short_edge_px=page.short_edge_px, upscaled_short_side_px=page.upscaled_short_side_px)
        out.pages.append(po)
        p_start = utcnow()
        # 쪽마다 처리 시간 제한(BR-ENG-08) — 전체 마감을 넘지 않는다
        page_deadline = min(inp.deadline_mono, time.monotonic() + page_timeout)
        if _remaining(inp.deadline_mono) <= 0:
            po.fallback_reason = "timeout"
        else:
            await _recognize_page(db, registry, inp, page, po, page_deadline)
        await _finish_page(db, rid, po, p_start, utcnow())

    await _combine(inp, out)

    # 요청 전체 판정 기록(타당성 항목은 요청에 한 벌 — 음 개수는 합, 나머지는 가장 낮은 값)
    if out.validity_items:
        await _write_validity(db, rid, out.validity_items)
    await _finish_job(db, rid, out.structure_verdict or "ambiguous", out.type_mismatch, out.validity_grade)


async def _combine(inp: RecognizeInput, out: RecognitionOutcome) -> None:
    """쪽 결과를 요청 하나로 모은다: 이어 붙이기 · 등급 · 구조 판정 · 부분 실패 안내 (SD_01 1.12a · BR-FBK-08)."""
    from app.services.uploads import pages_notice

    pages = out.pages
    converted = [p for p in pages if p.converted]
    for key in ("structure", "recognize", "jg_convert", "validity"):
        vals = [p.timings_ms[key] for p in pages if key in p.timings_ms]
        if vals:
            out.timings_ms[key] = sum(vals)
    for p in pages:
        for t in p.tried:
            out.tried.append({**t, "page": p.page_no} if len(pages) > 1 else t)

    checked = [p for p in pages if p.structure_verdict is not None]
    mism = [p for p in checked if p.type_mismatch]
    out.type_mismatch = bool(checked) and len(mism) * 2 >= len(checked)
    if out.type_mismatch:
        out.detected_type = Counter(p.detected_type for p in mism if p.detected_type).most_common(1)[0][0] \
            if any(p.detected_type for p in mism) else None
    else:
        out.detected_type = next((p.detected_type for p in checked if p.detected_type), None)

    basis = converted or checked
    verdicts = [p.structure_verdict for p in basis if p.structure_verdict]
    if converted:
        out.structure_verdict = max(verdicts, key=lambda v: VERDICT_ORDER[v]) if verdicts else "ambiguous"
    elif verdicts and all(v == "fail" for v in verdicts):
        out.structure_verdict = "fail"
    else:
        # 모든 쪽이 실패했지만 구조는 찾은 쪽이 있음 → 구조를 찾은 쪽 중 가장 나쁜 것
        found = [v for v in verdicts if v != "fail"]
        out.structure_verdict = max(found, key=lambda v: VERDICT_ORDER[v]) if found else "ambiguous"

    graded = converted or [p for p in pages if p.validity_meta is not None]
    out.validity_items = _merge_items([p.validity_items for p in graded])

    if converted:
        out.validity_grade = max((p.validity_grade or "caution" for p in converted), key=lambda g: GRADE_ORDER[g])
        scores = [p.validity_score for p in converted if p.validity_score is not None]
        out.validity_score = min(scores) if scores else None
        first = converted[0]
        out.engine_name, out.engine_version = first.engine_name, first.engine_version
        if len(converted) == 1:
            out.musicxml, out.midi = first.musicxml, first.midi
        else:
            from app.services.join import join_musicxml

            try:
                out.musicxml = await asyncio.to_thread(join_musicxml, [p.musicxml for p in converted if p.musicxml])
            except Exception as exc:  # noqa: BLE001
                log.warning("쪽 이어 붙이기 실패 %s: %s", inp.request_no, exc)
                out.musicxml = out.midi = None
                out.fallback_reason = "recognition_failed"
                return
            # 이은 악보의 MIDI 는 안전 변환(별도 프로세스·시간 제한). 실패하면 MusicXML 만(2026-09-30 SD_04 §8-1)
            from app.services.safe_midi import musicxml_to_midi_safe

            out.midi = await musicxml_to_midi_safe(out.musicxml, deadline_monotonic=inp.deadline_mono)
        failed = [p.page_no for p in pages if not p.converted]
        out.notice = pages_notice(len(pages), failed)
        return

    # 모든 쪽 실패 → 요청 전체 대체(UC2). 사유: 전체 마감을 넘겼으면 시간 초과, 아니면 가장 많은 쪽 사유
    out.musicxml = out.midi = None
    reasons = [p.fallback_reason or "recognition_failed" for p in pages]
    if len(pages) == 1:
        reason = reasons[0]
    elif "timeout" in reasons and _remaining(inp.deadline_mono) <= 0:
        reason = "timeout"
    else:
        counts = Counter(reasons)
        top = max(counts.values())
        reason = next(r for r in REASON_PRIORITY if counts.get(r) == top)
    out.fallback_reason = reason
    # 음표 없음(NO_NOTES)은 가장 마지막 엔진 시도로 가른다 — 웹·연주 API 가 DB 에서 읽는 규칙과 같다
    last = next((p for p in reversed(pages) if p.attempts), None)
    out.no_notes = reason == "recognition_failed" and last is not None and last.attempts[-1] == "no_notes"
    out.validity_grade = "distrust" if reason == "distrust" else None


def _merge_items(items_list: list[dict[str, float | None]]) -> dict[str, float | None]:
    """쪽별 타당성 항목을 요청 한 벌로: 음 개수는 합, 나머지(0~1 점수)는 가장 낮은 값."""
    if not items_list:
        return {}
    if len(items_list) == 1:
        return dict(items_list[0])
    merged: dict[str, float | None] = {}
    for code in VALIDITY_ITEMS:
        vals = [float(i[code]) for i in items_list if i.get(code) is not None]
        if not vals:
            continue
        merged[code] = sum(vals) if code == "note_count" else min(vals)
    return merged


async def _recognize_page(db: Database, registry: ModelRegistry, inp: RecognizeInput, page: PageInput,
                          out: PageOutcome, deadline: float) -> None:
    rid, settings, pno = inp.request_id, inp.settings, page.page_no

    # 1) 구조 확인 — 불통과면 엔진을 부르지 않는다(BR-ENG-06)
    s_start = utcnow()
    try:
        sv = await asyncio.to_thread(engine_api.check_structure, page.image, inp.score_type, settings.structure_threshold)
        verdict, mismatch, detected = sv.verdict, bool(sv.type_mismatch), sv.detected_type
    except Exception as exc:  # noqa: BLE001
        log.warning("구조 확인을 하지 못함(애매로 처리): %s", exc)
        verdict, mismatch, detected = "ambiguous", False, None
    s_end = utcnow()
    out.structure_verdict, out.type_mismatch, out.detected_type = verdict, mismatch, detected
    out.timings_ms["structure"] = _ms(s_start, s_end)
    await stage(db, rid, "structure", s_start, s_end, page_no=pno)
    if verdict == "fail":
        out.fallback_reason = "no_structure"
        return

    # 2) 엔진을 설정 순서대로(BR-ENG-02). 끈 모델·설치 안 된 모델은 건너뛴다
    kind = f"omr_{inp.score_type}"
    recognize_ms = 0
    deadline_hit = False
    success = None
    for name in settings.order(inp.score_type):
        entry = registry.get(name)
        if entry is None or not entry.enabled or entry.kind != kind:
            out.tried.append({"name": name, "outcome": "skipped", "failure_code": "NOT_REGISTERED_OR_DISABLED",
                              "duration_ms": 0})
            continue
        if not entry.installed or entry.state == "unavailable":
            out.tried.append({"name": name, "outcome": "skipped", "failure_code": "NOT_INSTALLED", "duration_ms": 0})
            continue
        remaining = _remaining(deadline)
        if remaining <= 0:
            deadline_hit = True
            break
        try:
            entry.adapter = entry.adapter or engine_api.build_adapter(dict(entry.row))
        except Exception as exc:  # noqa: BLE001
            out.tried.append({"name": name, "outcome": "skipped", "failure_code": "ADAPTER_MISSING", "duration_ms": 0})
            log.warning("어댑터를 만들지 못함 %s: %s", name, exc)
            continue
        first_use = registry.begin_request_use(name)
        a_start = utcnow()
        version = entry.version or "unknown"
        result = None
        try:
            result = await asyncio.wait_for(entry.adapter.recognize(str(page.image_path), deadline),
                                            timeout=remaining + 5)
            outcome, failure = result.outcome, result.failure_code
            version = result.engine_version or version
        except TimeoutError:
            outcome, failure = "timeout", "DEADLINE"
        except Exception as exc:
            log.exception("엔진 %s 호출 오류", name)
            outcome, failure = "error", f"ADAPTER_EXCEPTION:{exc.__class__.__name__}"
        a_end = utcnow()
        if first_use:
            await registry.end_request_use(name, a_start, a_end, ok=outcome not in ("stopped", "timeout"),
                                           error=failure, timed_out=outcome == "timeout")

        extra = dict(result.extra or {}) if result is not None else {}
        if outcome == "success" and result is not None:
            # 음표 없음 확인과 MIDI 준비를 성공 기록 전에 한다(성공은 쪽마다 하나)
            checked = await _check_success(inp, result, extra, out)
            if checked is None:
                outcome, failure = "no_notes", "NO_NOTES"
            elif checked is False:
                outcome, failure = "convert_failed", "MIDI_CONVERT_FAILED"
        dur = _ms(a_start, a_end)
        recognize_ms += dur
        await _write_attempt(db, rid, pno, name, version, outcome, failure, a_start, a_end)
        out.attempts.append(outcome)
        out.tried.append({"name": name, "outcome": outcome, "failure_code": None if outcome == "success" else failure,
                          "duration_ms": dur})
        if inp.score_type == "jeongganbo" and extra.get("jg_convert_ms") is not None:
            jg_ms = int(extra["jg_convert_ms"])
            jg_end = a_end
            jg_start = jg_end - timedelta(milliseconds=jg_ms)
            out.timings_ms["jg_convert"] = jg_ms
            await stage(db, rid, "jg_convert", max(jg_start, a_start), jg_end, page_no=pno)
        if outcome == "success":
            success = (name, version, result)
            break
        if outcome == "no_notes":
            # 엔진이 이미지를 읽었는데 음표가 없다 → 다음 엔진으로 넘겨도 음표가 나오지 않고 시간만 든다(가이드 G2)
            break
        if outcome == "timeout" and _remaining(deadline) <= 0:
            deadline_hit = True
            break
    out.timings_ms["recognize"] = recognize_ms

    attempts = out.attempts
    if success is None:
        # 실패 이유는 마지막 엔진이 아니라 가장 뜻있는 실패로 정한다: 음표 없음 > 시간 초과 > 오류 > 멈춤(가이드 G3)
        if "no_notes" in attempts:
            out.fallback_reason = "recognition_failed"
            out.no_notes = True
        elif deadline_hit or (attempts and attempts[-1] == "timeout" and _remaining(deadline) <= 0):
            out.fallback_reason = "timeout"
        elif not attempts or all(a == "stopped" for a in attempts):
            out.fallback_reason = "engine_stopped"
        else:
            out.fallback_reason = "recognition_failed"
        out.musicxml = out.midi = None
        return

    name, version, result = success
    out.engine_name, out.engine_version = name, version

    # 3) 타당성(FR-059) — 이미 _check_success 에서 계산한 값. '불신' 쪽은 실패(BR-ENG-08)
    v, v_start, v_end = out.validity_meta or ("caution", utcnow(), utcnow())
    await stage(db, rid, "validity", v_start, v_end, page_no=pno)
    out.timings_ms["validity"] = _ms(v_start, v_end)
    out.validity_grade = v
    if v == "distrust":
        out.fallback_reason = "distrust"


async def _check_success(inp: RecognizeInput, result: Any, extra: dict, out: PageOutcome) -> bool | None:
    """성공 결과를 확인한다. 음표가 없으면 None, MIDI 를 만들 수 없으면 False, 괜찮으면 True.

    타당성 판정도 여기서 한 번 한다(음표 수가 거기서 나온다).
    """
    if not result.musicxml:
        return None
    settings = inp.settings
    v_start = utcnow()
    try:
        verdict = await asyncio.to_thread(
            engine_api.check_validity, result.musicxml, inp.score_type,
            engine_confidence=result.confidence,
            caution_boundary=settings.grade_caution_boundary,
            distrust_boundary=settings.grade_distrust_boundary,
            yulmyeong_ratio=extra.get("yulmyeong_ratio"),
        )
        grade, items = verdict.grade, dict(verdict.items)
        out.validity_score = float(verdict.score) if verdict.score is not None else None
    except Exception as exc:  # noqa: BLE001
        log.warning("타당성 확인을 하지 못함(주의로 처리): %s", exc)
        grade, items = "caution", {}
    v_end = utcnow()
    if items.get("note_count") is not None and float(items["note_count"]) <= 0:
        return None
    if items.get("note_count") is None:
        try:
            score = await asyncio.to_thread(scoreio.load_score, result.musicxml.encode("utf-8"))
            if scoreio.count_notes(score) == 0:
                return None
        except Exception:  # noqa: BLE001
            return False
    midi = result.midi
    if not midi and not extra.get("midi_unavailable"):
        # 어댑터가 MIDI 를 주지 않은 엔진이면 안전 변환(별도 프로세스·시간 제한). 실패해도 인식은 성공 — MusicXML 만(2026-09-30)
        from app.services.safe_midi import musicxml_to_midi_safe

        midi = await musicxml_to_midi_safe(result.musicxml, deadline_monotonic=inp.deadline_mono)
    if inp.score_type == "jeongganbo" and extra.get("yulmyeong_ratio") is not None:
        items.setdefault("yulmyeong_ratio", extra["yulmyeong_ratio"])
    if result.confidence is not None:
        items.setdefault("engine_confidence", result.confidence)
    out.musicxml, out.midi = result.musicxml, midi
    out.validity_items = {k: (float(v) if v is not None else None) for k, v in items.items()}
    out.validity_meta = (grade, v_start, v_end)
    return True
