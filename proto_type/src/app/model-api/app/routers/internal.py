"""내부 엔드포인트 — 서비스 전용 키만 (T030, UC10 기본흐름 5).

- POST /v1/internal/settings/reload: 최신 설정 판본을 읽어 이후 요청부터 쓴다(처리 중 요청은 이전 값, UC10 E3).
- POST /v1/internal/upload-check: 웹 업로드(PDF) 검사 위임 — 모델 API 와 같은 검사기로 판정(2026-09-29 사진·PDF 입력).
  (2026-09-29 여러 쪽) PDF 의 모든 쪽(최대 10쪽)을 본다. 웹은 이 검사에 닿지 못하면 PDF 를 접수하지 않는다
  (UPLOAD_CHECK_UNAVAILABLE 503 — 웹 쪽 판정, BR-UPL-06).

사용자 음원(.sf2) 사본 받기·지우기(/v1/internal/sf2, T132)는 2026-09-29 US8 삭제로 뺐다.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from app.auth.keys import Caller, require_service_key
from app.services import uploads

router = APIRouter(tags=["내부"], prefix="/internal")


@router.post("/settings/reload", summary="새 처리 설정 반영")
async def reload_settings(request: Request, caller: Caller = Depends(require_service_key)) -> dict:
    state = request.app.state
    current = await state.settings.load()
    state.limiter.resize(current)
    await state.settings.mark_applied()
    return {"settings_version": current.version_id, "engine_order": current.engine_order}



@router.post("/upload-check", summary="웹 업로드 검사 위임 (사진·PDF, 2026-09-29)")
async def upload_check(
    request: Request,
    file: list[UploadFile] = File(..., description="웹에 올라온 파일(지금은 PDF 한 개만 보낸다)"),
    score_type: str | None = Form(None, description="staff | jeongganbo"),
    caller: Caller = Depends(require_service_key),
) -> dict:
    """웹 서비스가 PDF 를 접수하기 전에 부른다 — 열기(손상·암호) · 쪽수(10쪽 넘으면 UPLOAD_TOO_MANY_PAGES) · 20MB ·
    쪽마다 300dpi 로 그렸을 때의 사진 크기(300px 미만 반려, 2026-09-30 119번) · 악보 종류를 연주 API·/v1/omr 과 같은 검사기(checks/upload.py,
    pypdfium2)로 판정한다(SC-015, UC3 A7 · E2 · E9). 그림은 그리지 않고 쪽 크기로 잰다(인식 때 다시 그린다).
    통과면 쪽수·쪽마다 사진 크기를, 반려면 G1 사유 코드(UPLOAD_*) 오류를 돌려준다. 요청은 만들지 않는다."""
    files = await uploads.read_files(file)
    checked = uploads.check(files, settings=request.app.state.settings.current, score_type=score_type,
                            require_score_type=True, allowed_kinds=uploads.USER_UPLOAD, render_pdf=False)
    return {
        "ok": True,
        "kind": checked.kind,
        "short_edge_px": checked.short_edge_px,
        "pdf_page_count": checked.pdf_page_count,
        "page_count": checked.page_count,
        "pages": [{"page_no": p.page_no, "file_no": p.file_no, "source": p.source, "short_edge_px": p.short_edge_px}
                  for p in checked.pages],
    }
