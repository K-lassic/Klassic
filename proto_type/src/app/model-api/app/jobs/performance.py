"""연주 요청 작업 (T106, UC13 · FR-047).

접수(202) 뒤 백그라운드로:
  변환(converting): 사진·PDF = 인식 파이프라인(구조·타당성 포함) / 실패 = api_server 대체 템플릿
    (2026-09-29 여러 쪽: job.pages — PDF 는 쪽마다 PNG, 사진은 올린 순서. 쪽마다 처리하고 성공한 쪽을 이어 붙인다.
     처리 시간 제한은 쪽마다, job.deadline_mono 는 전체 마감 = 쪽 수 × 제한. 모든 쪽이 실패해야 대체)
  (MIDI·MusicXML 직행 갈래는 2026-09-29 황송해 결정으로 접수 단계에서 반려되어 닿지 않는다 — 전에 접수한 요청용으로만 남김)
  → 악기 구성(default·explicit·recommend·original) · 조옮김 · 음량 반영 → performance.musicxml·.mid
    (타악 성부가 없는 악보에 장구 파트를 새로 만들지 않는다 — arrange.ADD_MISSING_PERCUSSION, T150)
  → 연주 생성(rendering): MP3 (엔진 쪽 render_mp3, 렌더링 자리, 성부별 음원 part_fonts — T150) → 완료(completed)
결과 파일은 derived_file(basis original, ensemble_id = 연주 악기 구성)에 기록해 서버를 다시 켜도 결과를 낼 수 있다.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

from app.db import Database, utcnow
from app.fallback.template import TemplateMissing, load_template
from app.jobs.limiter import QueueTimeout
from app.recommend.service import run_recommend, save_recommendation
from app.services import engine_api, scoreio
from app.services.arrange import Assignment, arrange, render_fonts, render_presets
from app.services.catalog import default_ensemble, instruments
from app.services.recognize import PageInput, RecognizeInput, run_recognition
from app.services.requests import complete_api_request, request_dir, set_status, storage_uri
from app.settings import Settings

log = logging.getLogger("model-api.performance")


@dataclass
class PerformanceJob:
    request_id: int
    request_no: str
    channel: str  # limiter 몫: 'web'(서비스 키) | 'api'
    file_kind: str
    score_type: str | None
    data: bytes
    original_path: Path
    assignment: Assignment
    explicit_ensemble_id: int | None
    transpose: int
    volume: float
    settings: Settings
    deadline_mono: float  # 전체 마감(쪽 수 × 처리 시간 제한)
    pages: list[PageInput] = field(default_factory=list)  # 인식할 쪽(올린 순서, 2026-09-29 여러 쪽)


class PerformanceRunner:
    def __init__(self, app) -> None:
        self.app = app
        self.tasks: dict[str, asyncio.Task] = {}

    def submit(self, job: PerformanceJob) -> None:
        task = asyncio.create_task(self._run(job), name=f"perf-{job.request_no}")
        self.tasks[job.request_no] = task
        task.add_done_callback(lambda _t, no=job.request_no: self.tasks.pop(no, None))

    async def shutdown(self) -> None:
        for t in list(self.tasks.values()):
            t.cancel()
        if self.tasks:
            await asyncio.gather(*self.tasks.values(), return_exceptions=True)

    async def _run(self, job: PerformanceJob) -> None:
        try:
            await run_performance(self.app.state, job)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("연주 작업 실패 %s", job.request_no)
            await _finish_failed(self.app.state.db, job)


async def _finish_failed(db: Database, job: PerformanceJob) -> None:
    try:
        if job.file_kind in ("image", "pdf"):
            await db.execute(
                "UPDATE score_request SET route = 'fallback', fallback_reason = COALESCE(fallback_reason, 'recognition_failed'), "
                "status = 'service_down' WHERE request_id = %s AND status NOT IN ('completed','service_down')",
                (job.request_id,))
        else:
            await db.execute(
                "UPDATE score_request SET status = 'completed', completed_at = %s WHERE request_id = %s "
                "AND status NOT IN ('completed','service_down')", (utcnow(), job.request_id))
    except Exception:
        log.exception("실패 마감도 하지 못함 %s", job.request_no)


async def _insert_ensemble(db: Database, kind: str, members: list[dict]) -> int:
    """members: [{part_role, instrument_code | original_name, original_program}]"""
    codes = [m["instrument_code"] for m in members if m.get("instrument_code")]
    ids: dict[str, int] = {}
    if codes:
        rows = await db.fetch_all(
            f"SELECT instrument_id, code FROM instrument WHERE code IN ({','.join(['%s'] * len(codes))})", codes)
        ids = {r["code"]: int(r["instrument_id"]) for r in rows}
    async with db.transaction() as cur:
        await cur.execute("INSERT INTO ensemble (ensemble_kind) VALUES (%s)", (kind,))
        ens_id = int(cur.lastrowid)
        part_no = 0
        for m in members:
            code = m.get("instrument_code")
            if code and code not in ids:
                continue
            part_no += 1
            await cur.execute(
                "INSERT INTO ensemble_member (ensemble_id, part_no, part_role, instrument_id, original_instrument_name, "
                "original_midi_program) VALUES (%s,%s,%s,%s,%s,%s)",
                (ens_id, part_no, m.get("part_role"), ids.get(code) if code else None,
                 None if code else m["original_name"][:100],
                 None if code else (m.get("original_program") if m.get("original_program") is not None
                                    and 0 <= m["original_program"] <= 127 else None)),
            )
    return ens_id


async def create_custom_ensemble(db: Database, assignment: Assignment) -> int:
    cat = instruments()
    members = [{"part_role": "percussion" if cat[t["instrument"]].is_percussion else "melody",
                "instrument_code": t["instrument"]} for t in sorted(assignment.tracks, key=lambda x: x["part"])]
    return await _insert_ensemble(db, "custom", members)


async def placed_ensemble_id(db: Database, ensemble_id: int | None, used: list[str]) -> int | None:
    """실제로 놓인 악기(arrange 가 돌려준 used)를 가리키는 악기 구성 id (2026-09-29 황송해 결정).

    - 고른 구성(ensemble_id)의 서비스 악기가 놓인 악기와 같으면 그 구성을 그대로 쓴다(기본 · 추천 · 직접 지정).
    - 다르면(예: 타악 성부가 없어 장구가 놓이지 않음) 놓인 악기만 담은 'custom' 구성을 찾아 다시 쓰거나 새로 만든다.
      그래서 기록(instrument_selection · derived_file)에 연주하지 않은 장구·북이 남지 않는다.
    - 원래 악기 구성(서비스 악기가 아닌 파트가 있음)이나 놓인 악기가 없으면 ensemble_id 를 그대로 돌려준다.
    """
    cat = instruments()
    placed: list[str] = []
    for code in used:
        if code in cat and code not in placed:
            placed.append(code)
    if not placed:
        return ensemble_id
    if ensemble_id is not None:
        rows = await db.fetch_all(
            "SELECT i.code FROM ensemble_member m LEFT JOIN instrument i ON i.instrument_id = m.instrument_id "
            "WHERE m.ensemble_id = %s", (ensemble_id,))
        codes = [r["code"] for r in rows]
        if any(c is None for c in codes) or set(codes) == set(placed):
            return ensemble_id
    # 선율 먼저, 그다음 타악 — 기본 구성과 같은 차례
    placed.sort(key=lambda c: cat[c].is_percussion)
    members = [{"part_role": "percussion" if cat[c].is_percussion else "melody", "instrument_code": c} for c in placed]
    signature = ",".join(f"{m['part_role']}:{m['instrument_code']}" for m in members)
    row = await db.fetch_one(
        "SELECT e.ensemble_id FROM ensemble e JOIN ensemble_member m ON m.ensemble_id = e.ensemble_id "
        "JOIN instrument i ON i.instrument_id = m.instrument_id WHERE e.ensemble_kind = 'custom' "
        "GROUP BY e.ensemble_id HAVING COUNT(*) = %s AND COUNT(*) = (SELECT COUNT(*) FROM ensemble_member x "
        "WHERE x.ensemble_id = e.ensemble_id) "
        "AND GROUP_CONCAT(CONCAT(m.part_role, ':', i.code) ORDER BY m.part_no SEPARATOR ',') = %s "
        "ORDER BY e.ensemble_id LIMIT 1", (len(members), signature))
    if row:
        return int(row["ensemble_id"])
    return await _insert_ensemble(db, "custom", members)


async def _default_ensemble_id(db: Database) -> int | None:
    row = await db.fetch_one("SELECT ensemble_id FROM ensemble WHERE ensemble_kind = 'default'")
    return int(row["ensemble_id"]) if row else None


async def _derived(db: Database, request_id: int, fmt: str, *, ensemble_id: int | None, status: str,
                   path_uri: str | None = None, renderer: tuple[str, str] | None = None,
                   failure: str | None = None, started=None, finished=None) -> int:
    return await db.execute(
        "INSERT INTO derived_file (request_id, format, basis, ensemble_id, render_status, renderer_name, renderer_version, "
        "render_started_at, render_finished_at, failure_reason, storage_uri) VALUES (%s,%s,'original',%s,%s,%s,%s,%s,%s,%s,%s)",
        (request_id, fmt, ensemble_id, status, renderer[0][:40] if renderer else None,
         renderer[1][:40] if renderer else None, started, finished, failure, path_uri),
    )


async def run_performance(state, job: PerformanceJob) -> None:
    db: Database = state.db
    cfg = state.config
    folder = request_dir(cfg, job.request_no)
    base_xml: str | None = None
    base_midi: bytes | None = None
    fallback = False
    original_ensemble_id: int | None = None
    has_original = False

    # 1) 변환
    await set_status(db, job.request_id, "converting")
    if job.file_kind in ("image", "pdf"):
        pages = job.pages or [PageInput(page_no=1, file_no=1, source="file", image=job.data,
                                        image_path=job.original_path)]
        outcome = await run_recognition(db, state.limiter, state.registry, RecognizeInput(
            request_id=job.request_id, request_no=job.request_no, score_type=job.score_type or "staff",
            pages=pages, is_web=False, deadline_mono=job.deadline_mono, settings=job.settings,
            page_timeout_s=job.settings.timeout_seconds))
        if outcome.fallback:
            fallback = True
            try:
                tpl = await load_template(db, cfg, job.score_type)
            except TemplateMissing as exc:
                log.error("대체 템플릿 없음 → 서비스 중단 %s: %s", job.request_no, exc)
                await complete_api_request(db, cfg, request_id=job.request_id, request_no=job.request_no,
                                           fallback_reason=outcome.fallback_reason, musicxml=None, midi=None,
                                           template_id=None, origin="fallback", final_status="service_down")
                return
            base_xml, base_midi = tpl.musicxml, tpl.midi
            await complete_api_request(db, cfg, request_id=job.request_id, request_no=job.request_no,
                                       fallback_reason=outcome.fallback_reason, musicxml=base_xml, midi=base_midi,
                                       template_id=tpl.template_id, origin="fallback", final_status="keep")
        else:
            base_xml, base_midi = outcome.musicxml, outcome.midi
            await complete_api_request(db, cfg, request_id=job.request_id, request_no=job.request_no,
                                       fallback_reason=None, musicxml=base_xml, midi=base_midi, template_id=None,
                                       origin="recognized", final_status="keep")
    else:
        score = await asyncio.to_thread(scoreio.load_score, job.data)
        sources = scoreio.source_instruments(score)
        if sources:
            has_original = True
            original_ensemble_id = await _insert_ensemble(db, "original", [
                {"part_role": "percussion" if s.percussion else "melody", "original_name": s.name,
                 "original_program": s.program} for s in sources])
        if job.file_kind == "musicxml" and job.data[:4] != b"PK\x03\x04":
            base_xml = job.data.decode("utf-8", errors="replace")
        else:
            base_xml = await asyncio.to_thread(scoreio.to_musicxml, score)
        if job.file_kind == "midi":
            base_midi = job.data
        else:  # MusicXML 에서 안전 변환(별도 프로세스·시간 제한, 실패하면 MusicXML 만 — 2026-09-30)
            from app.services.safe_midi import musicxml_to_midi_safe

            base_midi = await musicxml_to_midi_safe(base_xml, deadline_monotonic=job.deadline_mono)
        await complete_api_request(db, cfg, request_id=job.request_id, request_no=job.request_no,
                                   fallback_reason=None, musicxml=base_xml, midi=base_midi, template_id=None,
                                   origin="direct", original_ensemble_id=original_ensemble_id, final_status="keep")

    # 2) 악기 구성 · 조옮김 · 음량 (UC13 A1·A2·A2-1)
    mode = job.assignment.mode
    codes: list[str] | None = None
    ensemble_id: int | None = None
    if mode == "custom":
        ensemble_id = job.explicit_ensemble_id
    elif mode == "recommend":
        # 연주는 MusicXML 기준(2026-09-30 조성기 지시) — 추천도 MusicXML 로
        rec = await run_recommend(state.registry, job.settings, base_xml.encode("utf-8") if base_xml else base_midi)
        await save_recommendation(db, job.request_id, rec)
        if rec.available and rec.combinations:
            codes = rec.combinations[0]["instruments"]
            row = await db.fetch_one(
                "SELECT o.ensemble_id FROM recommendation_option o JOIN recommendation r "
                "ON r.recommendation_id = o.recommendation_id WHERE r.request_id = %s AND o.rank_no = 1 "
                "ORDER BY r.recommendation_id DESC LIMIT 1", (job.request_id,))
            ensemble_id = int(row["ensemble_id"]) if row else None
    elif mode == "original" and has_original and not fallback:
        ensemble_id = original_ensemble_id
    if codes is None and mode in ("default", "recommend") or (mode == "original" and ensemble_id is None):
        codes = default_ensemble()
        ensemble_id = await _default_ensemble_id(db)
    keep_original = mode == "original" and ensemble_id == original_ensemble_id and ensemble_id is not None

    def build() -> tuple[str, list[str | None], list[tuple[int, int] | None], list[str]]:
        doc = scoreio.load_score(base_xml.encode("utf-8"))
        # 타악 성부가 없으면 장구 파트를 새로 만들지 않는다(arrange.ADD_MISSING_PERCUSSION, T150)
        used = arrange(doc, assignment=job.assignment if not keep_original else Assignment(mode="original"),
                       codes=None if keep_original else codes, transpose=job.transpose, volume=job.volume)
        # 성부별 음원(T150): 악기 목록의 soundfont, tracks[].sf2_ref(기본 음원 이름)가 있으면 그것
        # 성부별 소리 번호(결정 C11): 국악기는 gugak.sf2 의 bank 1, 장구·북은 타악 세트 128/1 — MP3 렌더링에만 쓴다.
        # performance.mid·musicxml(내려받기)에는 다른 프로그램도 읽을 수 있게 GM 호환 번호(gm_program)를 그대로 적는다.
        fonts = render_fonts(doc)
        return scoreio.to_musicxml(doc), fonts, render_presets(doc, fonts), used

    perf_xml, part_fonts, part_presets, used = await asyncio.to_thread(build)
    # 연주는 MusicXML 기준(2026-09-30 조성기 지시): 연주용 MusicXML 에서 MIDI 를 안전 변환으로 만든다
    # (별도 프로세스·시간 제한 · 반복 기호 오류면 빼고 다시). 그래도 안 되면 MusicXML 만 주고 MP3 는 만들지 않는다
    from app.services.safe_midi import musicxml_to_midi_safe

    perf_midi = await musicxml_to_midi_safe(perf_xml)
    # 기록은 실제로 놓인 악기만(타악 성부가 없으면 장구·북을 적지 않는다, 2026-09-29)
    if not keep_original:
        ensemble_id = await placed_ensemble_id(db, ensemble_id, used)
    (folder / "performance.musicxml").write_text(perf_xml, encoding="utf-8")
    if perf_midi is not None:
        (folder / "performance.mid").write_bytes(perf_midi)
    if ensemble_id is not None:
        await db.execute("INSERT INTO instrument_selection (request_id, ensemble_id, source) VALUES (%s,%s,'api_option')",
                         (job.request_id, ensemble_id))
    await _derived(db, job.request_id, "musicxml", ensemble_id=ensemble_id, status="ready",
                   path_uri=storage_uri(cfg, folder / "performance.musicxml"))
    if perf_midi is not None:
        await _derived(db, job.request_id, "midi", ensemble_id=ensemble_id, status="ready",
                       path_uri=storage_uri(cfg, folder / "performance.mid"))

    # 3) 연주 생성(MP3). 실패해도 MusicXML·MIDI 는 그대로 준다(UC13 E5)
    await set_status(db, job.request_id, "rendering")
    file_id = await _derived(db, job.request_id, "mp3", ensemble_id=ensemble_id, status="queued")
    started = utcnow()
    try:
        if perf_midi is None:  # MIDI 를 못 만들면 MP3 도 없다(MusicXML 은 그대로) — 아래 실패 처리로
            raise RuntimeError("연주용 MIDI 를 만들지 못함(MusicXML 만 제공)")
        async with state.limiter.slot("render", job.channel, time.monotonic() + cfg.render_timeout_s):
            started = utcnow()
            await db.execute("UPDATE derived_file SET render_status = 'rendering', render_started_at = %s WHERE file_id = %s",
                             (started, file_id))
            # 기본 음원은 render_mp3 가 싣는다(사용자 음원 업로드는 연주 API 에 없음). 성부별 음원은 part_fonts 로
            mp3, name, version = await asyncio.to_thread(engine_api.render_mp3, perf_midi, [], cfg.render_timeout_s,
                                                         part_fonts, part_presets)
        (folder / "performance.mp3").write_bytes(mp3)
        await db.execute(
            "UPDATE derived_file SET render_status = 'ready', renderer_name = %s, renderer_version = %s, "
            "render_finished_at = %s, storage_uri = %s WHERE file_id = %s",
            (name[:40], version[:40], utcnow(), storage_uri(cfg, folder / "performance.mp3"), file_id))
    except QueueTimeout:
        await _render_failed(db, file_id, "RENDER_TIMEOUT", started)
    except Exception as exc:  # noqa: BLE001
        code = engine_api.render_error_code(exc) or "RENDER_FAILED"
        log.warning("MP3 렌더링 실패 %s: %s", job.request_no, exc)
        await _render_failed(db, file_id, code, started)

    await db.execute(
        "UPDATE score_request SET status = 'completed', completed_at = %s WHERE request_id = %s "
        "AND status NOT IN ('completed','service_down')", (utcnow(), job.request_id))


async def _render_failed(db: Database, file_id: int, code: str, started) -> None:
    await db.execute(
        "UPDATE derived_file SET render_status = 'failed', failure_reason = %s, render_started_at = COALESCE(render_started_at, %s), "
        "render_finished_at = %s WHERE file_id = %s", (code, started, utcnow(), file_id))
