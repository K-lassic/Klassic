"""연주 API (T104~T108, FR-040 ⑥ · FR-047 · FR-050 · UC13).

- POST /v1/performances: 접수 즉시 202 + 요청 번호. 처리는 jobs/performance.py.
- GET /v1/performances/{id}: 현재 단계. 만료면 status 'expired'(INTERFACES §1: 저장하지 않고 계산).
  완료 + 대체면 'completed_fallback'(D-3 계산 값).
- GET /v1/performances/{id}/result: 완료 전이면 425 + 현재 상태. 만료면 410 RESULT_EXPIRED(G4).
  외부 호출자이고 라이선스 확인 전이면 MP3 를 빼고 mp3_withheld(G7 · FR-050).
- GET /v1/files/{token}: 서명된 짧은 주소로 파일 내려받기(키 없음). 주소·보관 기간이 지나면 410.
다른 키로 만든 요청 번호는 없는 것으로 본다(UC13 E7 [추론]).
성부별 음원(T150): instruments.tracks[].sf2_ref 는 기본 음원 이름만 받고, MP3 는 성부마다 그 음원으로 만든다.
받는 파일(2026-09-29 황송해 결정): 사진(PNG·JPG·WEBP)·PDF 한 개. MIDI·MusicXML 은 G1 형식 반려(직행 없음).
(2026-09-29 여러 쪽 — 황송해 결정) 한 요청 = 악보 한 곡: PDF 한 개(모든 쪽을 300dpi PNG 로) 또는 사진 여러 장(score 를
올린 순서대로 여러 번), 최대 10쪽. 쪽마다 처리하고 성공한 쪽을 이어 붙여 연주한다. 상태·결과 응답에 page_count ·
pages(쪽별 상태: 쪽 번호 · 변환/실패 · 사유)와, 일부 쪽을 못 읽었으면 notice(PAGES_PARTIAL)를 담는다.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from app.auth.keys import Caller, call_record, require_key
from app.auth.limits import enforce_limits
from app.db import utcnow
from app.errors import ApiError, fallback_catalog, status_message
from app.jobs.performance import PerformanceJob, create_custom_ensemble
from app.routers.render import mp3_allowed
from app.services import files as file_tokens
from app.services import uploads
from app.services.arrange import check_sf2_refs, parse_assignment
from app.services.recognize import VALIDITY_ITEMS
from app.services.requests import DB_TO_CODE, create_api_request, resolve_uri, stage

router = APIRouter(tags=["연주"])

MEDIA = {"musicxml": "application/vnd.recordare.musicxml+xml", "midi": "audio/midi", "mp3": "audio/mpeg"}
EXT = {"musicxml": "musicxml", "midi": "mid", "mp3": "mp3"}


def _iso(dt) -> str | None:
    return dt.isoformat(timespec="milliseconds") + "Z" if dt else None


async def _load_request(request: Request, request_no: str, caller: Caller) -> dict:
    row = await request.app.state.db.fetch_one(
        "SELECT r.request_id, r.request_no, r.channel, r.access_key_id, r.file_kind, r.chosen_score_type, r.route, "
        "r.fallback_reason, r.status, r.received_at, r.completed_at, v.expires_at, v.remaining_seconds, v.is_expired, "
        "l.stage_label, (SELECT MAX(u.pdf_page_count) FROM upload_file u WHERE u.request_id = r.request_id) AS pdf_page_count, "
        "(SELECT COUNT(*) FROM upload_file u WHERE u.request_id = r.request_id) AS file_count "
        "FROM score_request r JOIN v_request_retention v ON v.request_id = r.request_id "
        "JOIN v_request_stage_label l ON l.request_id = r.request_id WHERE r.request_no = %s",
        (request_no,),
    )
    if row is None or row["channel"] != "api" or row["access_key_id"] != caller.key_id:
        raise ApiError("REQUEST_NOT_FOUND", details={"request_no": request_no})
    call_record(request).request_id = int(row["request_id"])
    row["page_rows"] = await request.app.state.db.fetch_all(
        "SELECT page_no, file_no, source, outcome, fallback_reason, validity_grade, structure_verdict, "
        "engine_name, engine_version FROM request_page WHERE request_id = %s ORDER BY page_no", (row["request_id"],))
    return row


def _page_status(r: dict) -> dict:
    """쪽별 상태 한 줄(쪽 번호 · 변환/실패/처리 중 · 사유 — UC13 6단계)."""
    code = DB_TO_CODE.get(r["fallback_reason"]) if r.get("fallback_reason") else None
    return {
        "page_no": int(r["page_no"]),
        "file_no": int(r["file_no"]),
        "source": r["source"],
        "outcome": r["outcome"],
        "fallback_reason": code,
        "fallback_message": fallback_catalog().get(code, {}).get("message") if code else None,
        "structure_verdict": r.get("structure_verdict"),
        "validity_grade": r.get("validity_grade"),
        "engine": {"name": r["engine_name"], "version": r["engine_version"]} if r.get("engine_name") else None,
    }


def _status_body(row: dict) -> dict:
    if int(row["is_expired"]) == 1:
        status, label = "expired", "만료"
    elif row["status"] == "completed" and row["route"] == "fallback":
        status, label = "completed_fallback", row["stage_label"]
    else:
        status, label = row["status"], row["stage_label"]
    return {
        "api_version": "v1",
        "id": row["request_no"],
        "status": status,
        "status_label": label,
        "route": row["route"],
        "file_kind": row["file_kind"],
        "score_type": row["chosen_score_type"],
        "created_at": _iso(row["received_at"]),
        "completed_at": _iso(row["completed_at"]),
        "expires_at": _iso(row["expires_at"]),
        "remaining_seconds": int(row["remaining_seconds"]),
        "pdf_page_count": row.get("pdf_page_count"),
        # 여러 쪽(2026-09-29): 쪽 수(PDF 쪽수 또는 사진 장수) · 쪽별 상태 · 일부 쪽 실패 안내
        "page_count": int(row["pdf_page_count"] or row.get("file_count") or 1),
        "pages": [_page_status(r) for r in row.get("page_rows") or []],
        "notice": uploads.page_rows_notice(row.get("page_rows") or []),
    }


@router.post("/performances", status_code=202, summary="연주 요청 (UC13)")
async def create_performance(
    request: Request,
    score: list[UploadFile] = File(..., description="악보 한 곡: PDF 한 개(모든 쪽 변환) 또는 사진(PNG·JPG·WEBP) 여러 장(올린 순서) — 최대 10쪽"),
    score_type: str | None = Form(None, description="필수: staff | jeongganbo"),
    instruments: str | None = Form(None, description='InstrumentAssignment JSON {"mode":"default|recommend|original|custom","tracks":[{"part":0,"instrument":"gayageum"}]}'),
    transpose_semitones: int = Form(0, ge=-12, le=12),
    volume: float = Form(1.0, ge=0, le=2, description="전체 음량 배율 0~2"),
    caller: Caller = Depends(require_key),
) -> JSONResponse:
    state = request.app.state
    db, cfg = state.db, state.config
    settings = state.settings.current
    rec = call_record(request)
    check_start = utcnow()
    await enforce_limits(request, caller, "recognize")
    files = await uploads.read_files(score)
    checked = uploads.check(files, settings=settings, score_type=score_type, require_score_type=True,
                            allowed_kinds=uploads.USER_UPLOAD)
    assignment = parse_assignment(instruments)
    check_sf2_refs(assignment)
    check_end = utcnow()
    request_id, request_no, image_paths = await create_api_request(
        db, cfg, key_id=caller.key_id, setting_version_id=settings.version_id, file_kind=checked.kind,
        score_type=score_type, original_name=checked.name, data=checked.data, short_edge_px=checked.short_edge_px,
        image_data=checked.image_data, pdf_page_count=checked.pdf_page_count, files=checked.files, pages=checked.pages,
    )
    rec.request_id = request_id
    await stage(db, request_id, "check", check_start, check_end)
    ensemble_id = await create_custom_ensemble(db, assignment) if assignment.db_mode == "explicit" else None
    await db.execute(
        "INSERT INTO performance_option (request_id, instrument_mode, ensemble_id, transpose_semitones, volume_level) "
        "VALUES (%s,%s,%s,%s,%s)",
        (request_id, assignment.db_mode, ensemble_id, transpose_semitones, round(volume * 100)),
    )
    state.performances.submit(PerformanceJob(
        request_id=request_id, request_no=request_no, channel=caller.channel, file_kind=checked.kind,
        score_type=score_type, data=checked.image_data or checked.data, original_path=image_paths[0],
        assignment=assignment, explicit_ensemble_id=ensemble_id, transpose=transpose_semitones, volume=volume,
        settings=settings, deadline_mono=time.monotonic() + settings.timeout_seconds * checked.page_count,
        pages=uploads.page_inputs(checked, image_paths),
    ))
    row = await _load_request(request, request_no, caller)
    return JSONResponse(status_code=202, content=_status_body(row))


@router.get("/performances/{request_no}", summary="연주 요청 상태")
async def get_performance(request_no: str, request: Request, caller: Caller = Depends(require_key)) -> dict:
    return _status_body(await _load_request(request, request_no, caller))


@router.get("/performances/{request_no}/result", summary="연주 결과", responses={425: {}, 410: {}})
async def get_performance_result(request_no: str, request: Request, caller: Caller = Depends(require_key)):
    state = request.app.state
    db, cfg = state.db, state.config
    row = await _load_request(request, request_no, caller)
    if int(row["is_expired"]) == 1:
        raise ApiError("RESULT_EXPIRED", details={"request_no": request_no})
    body = _status_body(row)
    if row["status"] not in ("completed", "service_down"):
        return JSONResponse(status_code=425, content=body)
    rid = int(row["request_id"])

    reason_db = row["fallback_reason"]
    code = DB_TO_CODE.get(reason_db) if reason_db else None
    if reason_db == "recognition_failed":
        last = await db.fetch_one("SELECT outcome FROM engine_attempt WHERE request_id = %s "
                                  "ORDER BY page_no DESC, attempt_no DESC LIMIT 1",
                                  (rid,))
        if last and last["outcome"] == "no_notes":
            code = "NO_NOTES"
    job = await db.fetch_one("SELECT * FROM processing_job WHERE request_id = %s", (rid,))
    items = {r["item_code"]: float(r["measured_value"]) for r in await db.fetch_all(
        "SELECT item_code, measured_value FROM validity_check_item WHERE request_id = %s", (rid,))}
    engine = await db.fetch_one("SELECT engine_name, engine_version FROM v_job_engine WHERE request_id = %s", (rid,))
    derived = {r["format"]: r for r in await db.fetch_all(
        "SELECT format, render_status, failure_reason, storage_uri, renderer_name, renderer_version "
        "FROM v_current_derived_file WHERE request_id = %s AND basis = 'original'", (rid,))}
    option = await db.fetch_one("SELECT * FROM performance_option WHERE request_id = %s", (rid,))
    result_row = await db.fetch_one("SELECT original_ensemble_id FROM v_current_result WHERE request_id = %s", (rid,))

    allowed = caller.is_service or await mp3_allowed(db)
    files: dict[str, str | None] = {}
    for fmt in ("musicxml", "midi", "mp3"):
        d = derived.get(fmt)
        if d and d["render_status"] == "ready" and d["storage_uri"] and (fmt != "mp3" or allowed):
            token = file_tokens.sign(cfg, request_no, fmt)
            files[fmt] = str(request.url_for("download_file", token=token))
        else:
            files[fmt] = None
    mp3_row = derived.get("mp3")
    detected = None
    if job:
        other = "jeongganbo" if job["confirmed_score_type"] == "staff" else "staff"
        detected = other if job["type_mismatch"] else (job["confirmed_score_type"] if job["structure_verdict"] == "pass" else None)
    mode = option["instrument_mode"] if option else "default"
    recommend_failed = False
    if mode == "recommend":
        ok = await db.fetch_one("SELECT 1 AS ok FROM recommendation WHERE request_id = %s AND outcome = 'ok' LIMIT 1", (rid,))
        recommend_failed = ok is None
    body.update({
        "fallback": row["route"] == "fallback",
        "fallback_reason": code,
        "fallback_message": fallback_catalog().get(code, {}).get("message") if code else None,
        "retry_hint": fallback_catalog().get(code, {}).get("retry_hint") if code else None,
        "structure_verdict": job["structure_verdict"] if job else None,
        "type_mismatch": bool(job["type_mismatch"]) if job else False,
        "detected_type": detected,
        "validity_grade": job["validity_grade"] if job else None,
        "validity_items": {k: items.get(k) for k in VALIDITY_ITEMS} if job else None,
        "files": files,
        "mp3_withheld": not allowed,
        "mp3_withheld_reason": None if allowed else "LICENSE_UNCONFIRMED",
        "mp3_withheld_message": None if allowed else status_message("LICENSE_UNCONFIRMED"),
        "render_failure": mp3_row["failure_reason"] if mp3_row and mp3_row["render_status"] == "failed" else None,
        "renderer": {"name": mp3_row["renderer_name"], "version": mp3_row["renderer_version"]}
        if mp3_row and mp3_row["renderer_name"] else None,
        "recommend_failed": recommend_failed,
        "original_instruments_unavailable": mode == "original" and not (result_row and result_row["original_ensemble_id"]),
        "instrument_mode": {"explicit": "custom"}.get(mode, mode),
        "transpose_semitones": option["transpose_semitones"] if option else 0,
        "volume": (option["volume_level"] / 100.0) if option and option["volume_level"] is not None else 1.0,
        "engine": {"name": engine["engine_name"], "version": engine["engine_version"]} if engine else None,
        "files_expire_in_seconds": cfg.file_token_ttl_s,
    })
    return body


@router.get("/files/{token}", name="download_file", summary="결과 파일 내려받기", tags=["연주"])
async def download_file(token: str, request: Request):
    state = request.app.state
    rec = call_record(request)
    request_no, fmt = file_tokens.verify(state.config, token)
    row = await state.db.fetch_one(
        "SELECT r.request_id, r.access_key_id, k.key_kind, v.is_expired FROM score_request r "
        "JOIN v_request_retention v ON v.request_id = r.request_id LEFT JOIN access_key k ON k.key_id = r.access_key_id "
        "WHERE r.request_no = %s AND r.channel = 'api'", (request_no,))
    if row is None:
        raise ApiError("REQUEST_NOT_FOUND")
    rec.key_id, rec.request_id = row["access_key_id"], int(row["request_id"])
    if int(row["is_expired"]) == 1:
        raise ApiError("RESULT_EXPIRED", details={"request_no": request_no})
    if fmt == "mp3" and row["key_kind"] != "service" and not await mp3_allowed(state.db):
        raise ApiError("REQUEST_NOT_FOUND", details={"reason": "LICENSE_UNCONFIRMED"})
    d = await state.db.fetch_one(
        "SELECT storage_uri FROM v_current_derived_file WHERE request_id = %s AND format = %s AND basis = 'original' "
        "AND render_status = 'ready' AND deleted_at IS NULL", (row["request_id"], fmt))
    path = resolve_uri(state.config, d["storage_uri"]) if d and d["storage_uri"] else None
    if path is None or not path.is_file():
        raise ApiError("RESULT_EXPIRED", details={"request_no": request_no})
    return FileResponse(path, media_type=MEDIA[fmt], filename=f"{request_no}.{EXT[fmt]}")
