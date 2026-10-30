"""POST /v1/omr/jeongganbo — 정간보 이미지 인식 (T058, FR-040 ② · FR-041 · UC12 A1).

jeongganbo-omr 자체 인코딩 → MusicXML·MIDI 변환은 엔진 어댑터 안에서 한다(extra.yulmyeong_ratio·jg_convert_ms).
바꾸지 못하면 convert_failed → 다음 엔진 또는 인식 실패 대체(UC12 E5).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from app.auth.keys import Caller, require_key
from app.routers.omr_common import recognize_endpoint
from app.schemas import RecognitionResult

router = APIRouter(tags=["인식"])


@router.post("/omr/jeongganbo", summary="정간보 이미지 인식", response_model=RecognitionResult)
async def recognize_jeongganbo(
    request: Request,
    image: list[UploadFile] = File(..., description="정간보 한 곡: PDF 한 개(모든 쪽을 300dpi 로 바꿔 인식) 또는 사진 여러 장(올린 순서) — 최대 10쪽"),
    request_no: str | None = Form(None, description="웹 서비스가 부를 때만 — 웹 요청 번호"),
    request_id: str | None = Form(None, description="request_no 의 옛 이름(계약 초안)"),
    caller: Caller = Depends(require_key),
) -> dict:
    return await recognize_endpoint(request, "jeongganbo", image, request_no or request_id, caller)
