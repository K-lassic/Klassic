"""#29 오선보 진입점: backend·API 호출자 → 이 라우터 → omr_common의 검사·인식·DB 기록."""
from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from app.auth.keys import Caller, require_key
from app.routers.omr_common import recognize_endpoint
from app.schemas import RecognitionResult

router = APIRouter(prefix="/v1", tags=["인식"])


@router.post("/omr/staff", response_model=RecognitionResult, summary="오선보 사진·PDF 인식")
async def recognize_staff(request: Request, image: list[UploadFile] = File(...),
                          request_no: str | None = Form(None), request_id: str | None = Form(None),
                          caller: Caller = Depends(require_key)):
    return await recognize_endpoint(request, "staff", image, request_no or request_id, caller)
