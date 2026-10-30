"""POST /v1/omr/staff — 오선보 이미지 인식 (T058, FR-040 ① · UC12 기본흐름)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from app.auth.keys import Caller, require_key
from app.routers.omr_common import recognize_endpoint
from app.schemas import RecognitionResult

router = APIRouter(tags=["인식"])


@router.post("/omr/staff", summary="오선보 이미지 인식", response_model=RecognitionResult)
async def recognize_staff(
    request: Request,
    image: list[UploadFile] = File(..., description="악보 한 곡: PDF 한 개(모든 쪽을 300dpi 로 바꿔 인식) 또는 사진(PNG·JPG·WEBP) 여러 장(올린 순서) — 최대 10쪽, 파일마다 20MB 이하, 쪽마다 사진 크기 300px 이상(650px 보다 작으면 1000px 로 키워 인식, 2026-09-30)"),
    request_no: str | None = Form(None, description="웹 서비스가 부를 때만 — 웹 요청 번호(작업 기록 연결)"),
    request_id: str | None = Form(None, description="request_no 의 옛 이름(계약 초안)"),
    caller: Caller = Depends(require_key),
) -> dict:
    return await recognize_endpoint(request, "staff", image, request_no or request_id, caller)
