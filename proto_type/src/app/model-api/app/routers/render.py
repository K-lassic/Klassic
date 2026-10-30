"""MP3·PDF 렌더링 (FR-040 ④⑤ · UC7 · UC12 A3 · research R5).

- MP3: 악기 지정 없으면 기본 국악기 구성(FR-020). 음원은 기본 음원(gugak.sf2 · FluidR3_GM.sf2)만 쓴다.
  성부별 음원(T150): tracks[].sf2_ref(기본 음원 이름만)와 악기 목록의 soundfont 대로 성부마다 음원을 나눈다.
  사용자 음원(.sf2) 받기(sf2_files · session_id)는 2026-09-29 US8 삭제로 뺐다 — 모르는 sf2_ref 는 BAD_REQUEST.
  외부 호출자는 라이선스 확인 전(v_mp3_license.api_mp3_allowed=0)이면 MP3 대신 제외 안내(G7 · FR-050).
- PDF: MuseScore → 없으면 Verovio(엔진 쪽 render_pdf).
- 렌더러 오류 코드: RENDER_FAILED·RENDERER_MISSING → 502, RENDER_TIMEOUT → 504.
- 렌더링 동시 처리 자리(limiter 'render')를 쓴다.
"""

from __future__ import annotations

import asyncio
import functools
import time

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, Response

from app.auth.keys import Caller, require_key
from app.auth.limits import enforce_limits
from app.errors import ApiError, status_message
from app.jobs.limiter import QueueTimeout
from app.recommend.service import run_recommend
from app.services import engine_api, scoreio, uploads
from app.services.arrange import arrange, check_sf2_refs, parse_assignment, render_fonts, render_presets

router = APIRouter(tags=["렌더링"])


async def mp3_allowed(db) -> bool:
    row = await db.fetch_one("SELECT api_mp3_allowed FROM v_mp3_license")
    return bool(row and int(row["api_mp3_allowed"]) == 1)


def withheld_body() -> dict:
    return {"api_version": "v1", "mp3_withheld": True, "mp3_withheld_reason": "LICENSE_UNCONFIRMED",
            "message": status_message("LICENSE_UNCONFIRMED")}


def renderer_header(name: str, version: str) -> dict[str, str]:
    return {"X-Renderer": f"{name} {version}".encode("ascii", "replace").decode("ascii")}


async def render_in_slot(request: Request, caller: Caller, fn, *args) -> tuple[bytes, str, str]:
    """렌더링 자리를 얻어 하위 프로세스 렌더러를 부른다. 렌더러 오류는 ApiError(RENDER_*) 로 바꾼다."""
    state = request.app.state
    timeout = state.config.render_timeout_s
    try:
        async with state.limiter.slot("render", caller.channel, time.monotonic() + timeout):
            return await asyncio.to_thread(fn, *args, timeout)
    except QueueTimeout as exc:
        raise ApiError("RENDER_TIMEOUT") from exc
    except ApiError:
        raise
    except Exception as exc:
        code = engine_api.render_error_code(exc)
        if code is None:
            raise
        raise ApiError(code, details={"detail": str(exc)[:300]}) from exc


@router.post("/render/mp3", summary="MP3 렌더링",
             responses={200: {"content": {"audio/mpeg": {}, "application/json": {}}}, 502: {}, 504: {}})
async def render_mp3(
    request: Request,
    score: list[UploadFile] = File(..., description="편집 반영 MIDI 또는 MusicXML"),
    instruments: str | None = Form(None, description='InstrumentAssignment JSON {"mode":"default"|...,"tracks":[...]}'),
    caller: Caller = Depends(require_key),
):
    state = request.app.state
    settings = state.settings.current
    await enforce_limits(request, caller, "render")
    files = await uploads.read_files(score)
    checked = uploads.check(files, settings=settings, score_type=None, require_score_type=False,
                            allowed_kinds=("midi", "musicxml"))
    assignment = parse_assignment(instruments)
    check_sf2_refs(assignment)
    if not caller.is_service and not await mp3_allowed(state.db):
        return JSONResponse(withheld_body())

    codes = None
    if assignment.mode == "recommend":
        rec = await run_recommend(state.registry, settings, checked.data)
        codes = rec.combinations[0]["instruments"] if rec.available and rec.combinations else None

    def build_midi() -> tuple[bytes, list[str | None], list[tuple[int, int] | None]]:
        doc = scoreio.load_score(checked.data)
        if assignment.mode == "original":
            return (checked.data if checked.kind == "midi" else scoreio.to_midi(doc)), [], []
        arrange(doc, assignment=assignment, codes=codes, transpose=0, volume=1.0)
        fonts = render_fonts(doc)
        return scoreio.to_midi(doc), fonts, render_presets(doc, fonts)

    try:
        midi, part_fonts, part_presets = await asyncio.to_thread(build_midi)
    except Exception as exc:
        raise ApiError("UPLOAD_CORRUPTED", details={"detail": str(exc)[:200]}) from exc

    # 기본 음원(FluidR3_GM·gugak.sf2)은 render_mp3 가 스스로 싣는다. 성부별 음원(T150)은 part_fonts 로,
    # 국악기 성부의 gugak.sf2 소리 번호(bank 1 · 타악 세트 128/1, 결정 C11)는 part_presets 로
    fn = functools.partial(engine_api.render_mp3, part_fonts=part_fonts, part_presets=part_presets)
    mp3, name, version = await render_in_slot(request, caller, fn, midi, [])
    return Response(content=mp3, media_type="audio/mpeg", headers=renderer_header(name, version))


@router.post("/render/pdf", summary="PDF 렌더링", responses={200: {"content": {"application/pdf": {}}}, 502: {}, 504: {}})
async def render_pdf(
    request: Request,
    score: list[UploadFile] = File(..., description="MusicXML (화면 악보와 같은 내용). MIDI 도 받는다"),
    caller: Caller = Depends(require_key),
):
    state = request.app.state
    await enforce_limits(request, caller, "render")
    files = await uploads.read_files(score)
    checked = uploads.check(files, settings=state.settings.current, score_type=None, require_score_type=False,
                            allowed_kinds=("midi", "musicxml"))

    def to_xml() -> str:
        if checked.kind == "musicxml" and checked.data[:4] != b"PK\x03\x04":
            return checked.data.decode("utf-8", errors="replace")
        return scoreio.to_musicxml(scoreio.load_score(checked.data))

    try:
        xml = await asyncio.to_thread(to_xml)
    except Exception as exc:
        raise ApiError("UPLOAD_CORRUPTED", details={"detail": str(exc)[:200]}) from exc
    pdf, name, version = await render_in_slot(request, caller, engine_api.render_pdf, xml)
    return Response(content=pdf, media_type="application/pdf", headers=renderer_header(name, version))
