"""#29 모델 상태: backend·화면 → 공개 GET /v1/models → models.registry.

설치·준비 상태와 DB 기반 예상 로딩 시간을 반환하며 파일·요청은 저장하지 않는다.
"""
from fastapi import APIRouter, Request
from app.schemas import ModelState

router = APIRouter(prefix="/v1", tags=["상태"])


@router.get("/models", response_model=list[ModelState], summary="모델 설치·로딩 상태 조회")
async def models(request: Request):
    return await request.app.state.registry.public_models()
