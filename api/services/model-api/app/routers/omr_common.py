"""#29·#30 공통 인식 처리: 검증 → 쪽별 인식·DB 판정 → 파일 또는 대체 사유.

구조에서의 위치: 오선보·정간보 라우터 → 이 파일 → uploads·recognize·requests.
웹은 기존 요청의 판정만, API는 원본·결과 위치와 요청을 DB에 기록한다.
"""
import asyncio
from datetime import UTC, datetime
from pathlib import Path
import tempfile
import time

from fastapi import Request, UploadFile

from app.auth.keys import Caller, call_record
from app.db import utcnow
from app.errors import ApiError
from app.fallback.template import TemplateMissing, load_template
from app.services import uploads
from app.services.recognize import RecognizeInput, run_recognition
from app.services.requests import complete_api_request, create_api_request, find_web_request, stage

def deadline_from_header(value, timeout_seconds, started_mono=None):
    cap = (time.monotonic() if started_mono is None else started_mono) + timeout_seconds
    if value:
        try:
            at = datetime.fromisoformat(value.strip())
            at = at.replace(tzinfo=UTC) if at.tzinfo is None else at
            return min(cap, time.monotonic() + (at - datetime.now(UTC)).total_seconds())
        except ValueError:
            pass  # 기존 계약: 잘못된 X-Deadline이면 설정 시간으로 판정한다.
    return cap


async def recognize_endpoint(request: Request, score_type: str, image: list[UploadFile],
                             identifier: str | None, caller: Caller):
    state = request.app.state
    db, cfg, settings = state.db, state.config, state.settings.current
    started_mono, check_start = time.monotonic(), utcnow()
    rec = call_record(request)
    is_web = caller.is_service and bool(identifier)
    try:
        files = await uploads.read_files(image, max_files=uploads.max_files_for(state.upload_rules))
        checked = await asyncio.to_thread(
            uploads.check, files, settings=settings, score_type=score_type, require_score_type=True,
            allowed_kinds=uploads.USER_UPLOAD, rules=state.upload_rules,
        )
        check_end = utcnow()
        deadline = deadline_from_header(request.headers.get("x-deadline"),
                                        settings.timeout_seconds * checked.page_count, started_mono)
        if is_web:
            request_row = await find_web_request(db, identifier)
            if request_row is None:
                raise ApiError("REQUEST_NOT_FOUND")
            rid, identifier = int(request_row["request_id"]), request_row["request_no"]
        else:
            rid, identifier, _ = await create_api_request(
                db, cfg, key_id=caller.key_id, setting_version_id=settings.version_id,
                file_kind=checked.kind, score_type=score_type, original_name=checked.name, data=checked.data,
                short_edge_px=checked.short_edge_px, status="converting", pdf_page_count=checked.pdf_page_count,
                files=checked.files,
            )
            await stage(db, rid, "check", check_start, check_end)
        rec.request_id = rid
        # 양쪽 경로 모두 인식용 사본을 쓴다. 원본·결과 영속 파일 위치만 DB에 기록한다.
        with tempfile.TemporaryDirectory(prefix="klassic-recognize-") as temp:
            paths = []
            for pg in checked.pages:
                path = Path(temp) / f"page{pg.page_no}{pg.suffix}"
                path.write_bytes(pg.image or b"")
                paths.append(path)
            outcome = await run_recognition(db, state.limiter, state.registry, RecognizeInput(
                request_id=rid, request_no=identifier, score_type=score_type, is_web=is_web,
                pages=uploads.page_inputs(checked, paths), deadline_mono=deadline,
                settings=settings, page_timeout_s=settings.timeout_seconds,
            ))
        files_out = None if outcome.fallback else (outcome.musicxml, outcome.midi)
        template_id, template_missing = None, False
        if not is_web and outcome.fallback:
            try:
                template = await load_template(db, cfg, score_type)
                files_out, template_id = (template.musicxml, template.midi), template.template_id
            except TemplateMissing:
                template_missing = True
        if not is_web:
            await complete_api_request(
                db, cfg, request_id=rid, request_no=identifier, fallback_reason=outcome.fallback_reason,
                musicxml=files_out[0] if files_out else None, midi=files_out[1] if files_out else None,
                template_id=template_id, origin="fallback" if outcome.fallback else "recognized",
                final_status="service_down" if template_missing else "completed",
            )
        body = outcome.response(files=files_out)
        body.update(file_kind=checked.kind, pdf_page_count=checked.pdf_page_count,
                    short_edge_px=checked.short_edge_px)
        if template_missing:
            body["service_down"] = True
        return body
    finally:
        for uploaded in image:
            await uploaded.close()
