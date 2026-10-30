"""POST /v1/recommend — 국악기 조합 추천 (T089, FR-040 ③ · FR-007·FR-008 · UC5 · UC12 A2).

multipart score(MIDI·MusicXML) + 선택 request_no. 실패해도 200 + available:false + RECOMMEND_UNAVAILABLE.
request_no 가 있으면 recommendation·recommendation_option 을 이 서버가 쓴다(INTERFACES §6).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from app.auth.keys import Caller, call_record, require_key
from app.auth.limits import enforce_limits
from app.errors import ApiError
from app.recommend.service import run_recommend, save_recommendation
from app.services import uploads

router = APIRouter(tags=["추천"])


@router.post("/recommend", summary="국악기 조합 추천")
async def recommend(
    request: Request,
    score: list[UploadFile] = File(..., description="MIDI 또는 MusicXML"),
    request_no: str | None = Form(None, description="요청 번호(있으면 추천 기록을 남긴다)"),
    caller: Caller = Depends(require_key),
) -> dict:
    state = request.app.state
    settings = state.settings.current
    rec = call_record(request)
    await enforce_limits(request, caller, None)
    files = await uploads.read_files(score)
    checked = uploads.check(files, settings=settings, score_type=None, require_score_type=False,
                            allowed_kinds=("midi", "musicxml"))
    request_id = None
    if request_no:
        row = await state.db.fetch_one(
            "SELECT request_id, channel, access_key_id FROM score_request WHERE request_no = %s", (request_no,))
        # 웹 요청은 서비스 키로만, API 요청은 만든 키로만 볼 수 있다(UC13 E7)
        if row is None or (row["channel"] == "web" and not caller.is_service) or (
                row["channel"] == "api" and row["access_key_id"] != caller.key_id and not caller.is_service):
            raise ApiError("REQUEST_NOT_FOUND", details={"request_no": request_no})
        request_id = int(row["request_id"])
        rec.request_id = request_id
    result = await run_recommend(state.registry, settings, checked.data)
    body = result.public()
    if request_id is not None:
        body["recommendation_id"] = await save_recommendation(state.db, request_id, result)
    body["api_version"] = "v1"
    return body
