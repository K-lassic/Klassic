"""여러 쪽 인식 중 먼저 변환된 쪽 미리보기 (2026-11-04 황송해, #181).

구조에서의 위치: backend 작업자(requestWorker.ts) → GET /v1/internal/omr/preview/{request_no} → services/page_preview(메모리).
서비스 키 전용 내부 경로라 공개 gateway 는 404 로 막는다. 아직 변환된 쪽이 없거나 요청이 끝났으면 preview=null.
"""
from fastapi import APIRouter, Depends

from app.auth.keys import require_service_key
from app.config import API_VERSION
from app.services import page_preview

router = APIRouter(prefix="/v1/internal", tags=["내부"])


@router.get("/omr/preview/{request_no}", dependencies=[Depends(require_service_key)], summary="먼저 변환된 쪽 미리보기")
async def omr_preview(request_no: str):
    p = page_preview.get(request_no)
    body = None if p is None else {"page_no": p.page_no, "page_count": p.page_count,
                                   "pages_done": p.pages_done, "musicxml": p.musicxml}
    return {"api_version": API_VERSION, "request_no": request_no, "preview": body}
