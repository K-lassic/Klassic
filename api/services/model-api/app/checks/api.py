"""#28 사진·PDF 검사 전용 내부 API.

구조에서의 위치: backend uploadInspect.ts → POST /v1/internal/upload-check → checks.upload.
서비스 키로 인증하고 shared 규칙에 따른 판정·쪽별 크기만 돌려준다.
인식용 확대·PDF 렌더링은 하지 않으며 DB 요청·작업 행이나 입력 파일을 저장하지 않는다.
"""
import asyncio

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from app.auth.keys import require_service_key
from app.checks.upload import check_upload
from app.errors import ApiError

router = APIRouter(prefix="/v1/internal", tags=["내부"])


def inspect_files(files, rules, settings):
    if not files:
        raise ApiError("VALIDATION_ERROR", details={"errors": [
            {"loc": ["body", "file"], "msg": "파일이 없습니다"}]})
    empty = [i for i, (_, data) in enumerate(files) if not data]
    if empty:
        raise ApiError("VALIDATION_ERROR", details={"errors": [
            {"loc": ["body", "file", i], "msg": "빈 파일입니다"} for i in empty]})
    verdict = check_upload(
        files, rules=rules, score_type=settings["score_type"], require_score_type=True,
        score_file_max_bytes=settings["score_file_max_bytes"],
        allowed_kinds=tuple(rules["user_upload_kinds"]), multi_page=True, render_pdf=False,
    )
    if not verdict.ok:
        raise ApiError(verdict.code or "UPLOAD_CORRUPTED", details=verdict.details)
    return {
        "ok": True, "kind": verdict.kind, "short_edge_px": verdict.short_edge_px,
        "pdf_page_count": verdict.pdf_page_count, "page_count": len(verdict.pages),
        "pages": [{"page_no": p.page_no, "file_no": p.file_no, "source": p.source,
                   "short_edge_px": p.short_edge_px} for p in verdict.pages],
    }


@router.post("/upload-check", dependencies=[Depends(require_service_key)], summary="웹 업로드 검사 위임")
async def upload_check(request: Request, file: list[UploadFile] = File(...), score_type: str | None = Form(None)):
    try:
        files = [(f.filename or "upload", await f.read()) for f in file]
        settings = {"score_type": score_type,
                    "score_file_max_bytes": request.app.state.settings.current.score_file_max_bytes}
        # PDFium 내부는 lock으로 직렬화한다. 무거운 검사는 이벤트 루프에서 실행하지 않는다.
        return await asyncio.to_thread(inspect_files, files, request.app.state.upload_rules, settings)
    finally:
        for uploaded in file:
            await uploaded.close()
