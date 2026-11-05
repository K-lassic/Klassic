"""#31 MP3·PDF 렌더링 API.

구조에서의 위치: backend·API 호출자 → 이 라우터 → 업로드 검사·악기 배정 → RenderPool.
공통 설정과 MP3 정책을 읽고 결과 바이너리를 반환한다. 원본·결과·요청 행은 저장하지 않는다.
"""
import asyncio
from dataclasses import asdict
import json
import logging
import time

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, Response

from app.auth.keys import Caller, require_key
from app.errors import ApiError, status_message
from app.jobs.limiter import QueueTimeout
from app.services import uploads
from app.services.arrange import check_sf2_refs, parse_assignment
from app.services.policy import mp3_allowed

router = APIRouter(prefix="/v1", tags=["렌더링"])
log = logging.getLogger("model-api.render")


async def render_response(request, caller, files, kind, assignment=None):
    state = request.app.state
    started = time.monotonic()
    deadline = started + state.config.render_timeout_s
    try:
        read_limit = state.settings.current.score_file_max_bytes or state.upload_rules["kinds"]["musicxml"]["max_bytes"]
        checked = await asyncio.to_thread(uploads.check, await uploads.read_files(files, max_bytes=read_limit, max_files=1),
            settings=state.settings.current, score_type=None, require_score_type=False,
            allowed_kinds=("midi", "musicxml"), render_pdf=False, rules=state.upload_rules)
        # #93 전체 선율 성부 선택은 MP3 렌더링 요청에서만 허용한다.
        assigned = parse_assignment(assignment, allow_melodic=True) if kind == "mp3" else None
        if assigned:
            check_sf2_refs(assigned)
        if kind == "mp3" and not caller.is_service:
            if not await mp3_allowed(state.db):
                return JSONResponse({"api_version": "v1", "mp3_withheld": True,
                    "mp3_withheld_reason": "LICENSE_UNCONFIRMED", "message": status_message("LICENSE_UNCONFIRMED")})
        try:
            async with state.limiter.slot("render", caller.channel, deadline):
                result = await state.render_pool.render(kind, checked.data, asdict(assigned) if assigned else None, deadline)
        except QueueTimeout:
            raise ApiError("RENDER_TIMEOUT") from None
        stages = result.timings | {"total": round((time.monotonic() - started) * 1000)}
        log.info("render_complete req_id=%s kind=%s timings_ms=%s", request.state.req_id, kind,
                 json.dumps(stages, sort_keys=True))
        renderer = f"{result.name} {result.version}".encode("ascii", "replace").decode("ascii")
        return Response(result.data, media_type="audio/mpeg" if kind == "mp3" else "application/pdf",
                        headers={"X-Renderer": renderer})
    finally:
        for file in files:
            await file.close()


@router.post("/render/mp3", summary="MP3 렌더링", responses={200: {"content": {"audio/mpeg": {}, "application/json": {}}},
                                                        502: {}, 504: {}})
async def render_mp3(request: Request, score: list[UploadFile] = File(...), instruments: str | None = Form(None),
                     caller: Caller = Depends(require_key)):
    return await render_response(request, caller, score, "mp3", instruments)


@router.post("/render/pdf", summary="PDF 렌더링", responses={200: {"content": {"application/pdf": {}}}, 502: {}, 504: {}})
async def render_pdf(request: Request, score: list[UploadFile] = File(...), caller: Caller = Depends(require_key)):
    return await render_response(request, caller, score, "pdf")
