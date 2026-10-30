"""오선보·정간보 인식 엔드포인트 공통 (T058, FR-040 ①② · FR-041 · FR-049 · UC12).

순서: 접근 키(G2) → 호출 한도·동시 처리(G3) → 파일 검사(G1) → 인식 파이프라인 → 응답.
- 웹 요청(서비스 키 + 폼 request_no): 웹이 만든 score_request 에 판정 기록만 붙인다. 대체면 파일을 넣지 않는다(BR-FBK-02).
- 외부 호출: score_request(channel api)를 만들고, 대체면 서버 보유 템플릿(api_server)의 MusicXML·MIDI 를 넣는다.
- 머리글 X-Deadline(ISO) 이 있으면 그 시각에 엔진을 끊는다. 없으면 접수 + timeout_seconds.
- 받는 파일은 사진·PDF(2026-09-29 황송해 결정).
- 여러 쪽(2026-09-29 황송해 결정 — UC12 · BR-UPL-02 · BR-ENG-08 · BR-FBK-08): 한 요청 = 악보 한 곡 — PDF 한 개(모든 쪽을
  300dpi PNG 로) 또는 사진 여러 장(image 를 올린 순서대로 여러 번), 최대 10쪽. 쪽마다 구조 확인 → 엔진 → 타당성 확인을 하고
  (처리 시간 제한은 쪽마다, 전체 마감 = 쪽 수 × 제한), 성공한 쪽을 순서대로 이어 붙인 MusicXML/MIDI 하나를 돌려준다.
  응답에 page_count · converted_pages · pages(쪽별 상태)와, 일부 쪽을 못 읽었으면 notice(PAGES_PARTIAL)를 담는다.
  웹 요청이면 X-Deadline 이 전체 마감이다(웹이 쪽 수 × 제한으로 보낸다).
"""

from __future__ import annotations

import logging
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import Request, UploadFile

from app.auth.keys import Caller, call_record
from app.auth.limits import enforce_limits
from app.db import utcnow
from app.errors import ApiError
from app.fallback.template import TemplateMissing, load_template
from app.services import uploads
from app.services.recognize import RecognizeInput, run_recognition
from app.services.requests import complete_api_request, create_api_request, find_web_request, stage

log = logging.getLogger("model-api.omr")


def deadline_from_header(value: str | None, timeout_seconds: int) -> float:
    """X-Deadline(ISO) → monotonic 마감. 잘못된 값이면 설정 시간 제한을 쓴다."""
    now_mono = time.monotonic()
    if value:
        try:
            at = datetime.fromisoformat(value.strip())
            if at.tzinfo is None:
                at = at.replace(tzinfo=UTC)
            return now_mono + (at - datetime.now(UTC)).total_seconds()
        except ValueError:
            log.warning("X-Deadline 형식 오류: %r", value)
    return now_mono + timeout_seconds


async def recognize_endpoint(request: Request, score_type: str, image: list[UploadFile] | None,
                             request_no: str | None, caller: Caller) -> dict:
    state = request.app.state
    db, cfg = state.db, state.config
    settings = state.settings.current  # 접수 시점 판본(BR-OPS-02)
    rec = call_record(request)
    check_start = utcnow()
    await enforce_limits(request, caller, "recognize")
    files = await uploads.read_files(image)
    checked = uploads.check(files, settings=settings, score_type=score_type, require_score_type=True,
                            allowed_kinds=uploads.USER_UPLOAD)
    check_end = utcnow()
    page_count = checked.page_count
    deadline = deadline_from_header(request.headers.get("x-deadline"), settings.timeout_seconds * page_count)
    is_web = caller.is_service and bool(request_no)

    temp_paths: list[Path] = []
    if is_web:
        row = await find_web_request(db, request_no)
        if row is None:
            raise ApiError("REQUEST_NOT_FOUND", details={"request_no": request_no})
        request_id = int(row["request_id"])
        tmp_dir = cfg.storage_dir / "tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        tag = uuid.uuid4().hex[:8]
        for pg in checked.pages:
            path = tmp_dir / f"{request_no}-{tag}-p{pg.page_no}{pg.suffix or '.png'}"
            path.write_bytes(pg.image or b"")
            temp_paths.append(path)
        image_paths = temp_paths
    else:
        request_id, request_no, image_paths = await create_api_request(
            db, cfg, key_id=caller.key_id, setting_version_id=settings.version_id, file_kind=checked.kind,
            score_type=score_type, original_name=checked.name, data=checked.data,
            short_edge_px=checked.short_edge_px, status="converting", image_data=checked.image_data,
            pdf_page_count=checked.pdf_page_count, files=checked.files, pages=checked.pages,
        )
        await stage(db, request_id, "check", check_start, check_end)
    rec.request_id = request_id

    try:
        outcome = await run_recognition(db, state.limiter, state.registry, RecognizeInput(
            request_id=request_id, request_no=request_no, score_type=score_type,
            pages=uploads.page_inputs(checked, image_paths), is_web=is_web, deadline_mono=deadline,
            settings=settings, page_timeout_s=settings.timeout_seconds,
        ))
    finally:
        for path in temp_paths:
            path.unlink(missing_ok=True)

    files_out: tuple[str, bytes] | None = None
    template_id: int | None = None
    template_missing = False
    if not outcome.fallback:
        files_out = (outcome.musicxml, outcome.midi)
    elif not is_web:
        try:
            tpl = await load_template(db, cfg, score_type)
            files_out, template_id = (tpl.musicxml, tpl.midi), tpl.template_id
        except TemplateMissing as exc:
            log.error("대체 템플릿을 불러오지 못함: %s", exc)
            template_missing = True

    if not is_web:
        await complete_api_request(
            db, cfg, request_id=request_id, request_no=request_no, fallback_reason=outcome.fallback_reason,
            musicxml=files_out[0] if files_out else None, midi=files_out[1] if files_out else None,
            template_id=template_id, origin="fallback" if outcome.fallback else "recognized",
            final_status="service_down" if template_missing else "completed",
        )
    body = outcome.response(files=files_out)
    # 요청 로그에 남길 요약(원문 없음): 등급 또는 대체 이유 · 엔진 버전 (D5 로그 필드 label·model_version)
    conf = (outcome.validity_items or {}).get("engine_confidence")
    if conf is None:  # 엔진이 확신도를 내지 않으면(homr) 타당성 종합 점수
        conf = outcome.validity_score
    request.state.log_extra = {"label": outcome.fallback_code or outcome.validity_grade or "-",
                               "score": f"{conf:.3f}" if isinstance(conf, (int, float)) else "-",
                               "model_version": f"{outcome.engine_name}@{outcome.engine_version}"
                               if outcome.engine_name else "-"}
    body["file_kind"] = checked.kind
    body["pdf_page_count"] = checked.pdf_page_count
    body["short_edge_px"] = checked.short_edge_px
    if template_missing:
        body["service_down"] = True
    return body
