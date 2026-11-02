"""#30 정간보 인식 API.

구조에서의 위치: backend·API 호출자 → 이 라우터 → omr_common → 정간보 엔진·변환기.
쪽별 판정은 공통 파이프라인이 DB에 기록하며 웹 대체 응답에는 파일을 넣지 않는다.
"""
from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from app.auth.keys import Caller, require_key
from app.routers.omr_common import recognize_endpoint
from app.schemas import RecognitionResult

router = APIRouter(prefix="/v1", tags=["인식"])


@router.post("/omr/jeongganbo", response_model=RecognitionResult, summary="정간보 사진·PDF 인식")
async def recognize_jeongganbo(request: Request, image: list[UploadFile] = File(...),
                              request_no: str | None = Form(None), request_id: str | None = Form(None),
                              caller: Caller = Depends(require_key)):
    return await recognize_endpoint(request, "jeongganbo", image, request_no or request_id, caller)
