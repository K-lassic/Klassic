"""업로드 검사 연결 (G1 · UC3 · shared/upload-rules.json).

검사 자체는 엔진 쪽 check_upload(웹과 같은 순서·같은 코드, SC-015). 여기서는 받은 파일을 모아 넘기고
실패하면 ApiError(UPLOAD_*) 로 바꾼다 — 반려된 호출은 요청을 만들지 않는다(chk_call_no_request_on_reject).

2026-09-29(사진·PDF 입력): 사용자 업로드 창구는 USER_UPLOAD 로 부른다. 원본(data)은 PDF 그대로 저장한다.
2026-09-29(여러 쪽 — 황송해 결정): 한 요청 = 악보 한 곡 — PDF 한 개(모든 쪽을 PNG 로) 또는 사진 여러 장(올린 순서),
최대 10쪽. 검사가 돌려준 쪽 목록(pages)을 쪽마다 인식한다(services/recognize.py). 일부 쪽을 못 읽으면
안내 PAGES_PARTIAL "N쪽 중 M쪽 변환했어요 (못 읽은 쪽: 3·7쪽)"(pages_notice). 'PDF 첫 쪽만' 안내는 더 내지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from fastapi import UploadFile

from app.errors import ApiError, status_message
from app.services import engine_api
from app.settings import Settings

USER_UPLOAD = "user_upload"  # allowed_kinds 대신 넘기면 upload-rules.json user_upload_kinds(사진·PDF) + 여러 쪽


@dataclass
class UploadedFile:
    file_no: int
    name: str
    data: bytes
    short_edge_px: int | None
    pdf_page_count: int | None = None


@dataclass
class UploadPage:
    page_no: int
    file_no: int
    source: str  # 'file' | 'pdf_page'
    short_edge_px: int | None
    image: bytes | None
    suffix: str = ".png"
    upscaled_short_side_px: int | None = None  # 작은 쪽을 늘려 읽으면 늘린 짧은 변(2026-09-30 119번)


@dataclass
class CheckedUpload:
    name: str  # 첫 파일 이름
    data: bytes  # 첫 파일 원본(PDF 면 PDF)
    kind: str  # image | pdf | midi | musicxml
    short_edge_px: int | None  # 쪽 중 가장 작은 짧은 변
    image_data: bytes | None = None  # 첫 쪽 그림(예전 호환)
    pdf_page_count: int | None = None
    files: list[UploadedFile] = field(default_factory=list)
    pages: list[UploadPage] = field(default_factory=list)

    @property
    def page_count(self) -> int:
        return max(1, len(self.pages))


def pages_notice(total: int, failed_pages: list[int]) -> dict | None:
    """일부 쪽만 못 읽었으면 "N쪽 중 M쪽 변환했어요 (못 읽은 쪽: 3·7쪽)"(status_codes PAGES_PARTIAL). 아니면 None.

    모든 쪽을 못 읽었으면(대체 결과) 안내 없이 대체 사유로 알린다(BR-FBK-08)."""
    if total <= 1 or not failed_pages or len(failed_pages) >= total:
        return None
    converted = total - len(failed_pages)
    listed = "·".join(str(p) for p in sorted(failed_pages))
    text = status_message("PAGES_PARTIAL") or "{pages}쪽 중 {converted}쪽 변환했습니다 (못 읽은 쪽: {failed_pages}쪽)"
    message = text.replace("{pages}", str(total)).replace("{converted}", str(converted)).replace("{failed_pages}", listed)
    return {"code": "PAGES_PARTIAL", "message": message, "pages": total, "converted": converted,
            "failed_pages": sorted(failed_pages)}


def page_inputs(checked: CheckedUpload, paths: list[Path]) -> list:
    """검사한 쪽 목록 + 쪽마다 인식할 그림 경로 → 인식 파이프라인 입력(recognize.PageInput, 올린 순서)."""
    from app.services.recognize import PageInput

    return [PageInput(page_no=p.page_no, file_no=p.file_no, source=p.source, image=p.image or b"", image_path=path,
                      short_edge_px=p.short_edge_px, upscaled_short_side_px=p.upscaled_short_side_px)
            for p, path in zip(checked.pages, paths, strict=True)]


def page_rows_notice(rows: list[dict]) -> dict | None:
    """request_page 행(page_no · outcome)으로 부분 실패 안내를 만든다(상태 조회용). 아직 처리 중인 쪽이 있으면 None."""
    if len(rows) <= 1 or any(r["outcome"] == "pending" for r in rows):
        return None
    failed = [int(r["page_no"]) for r in rows if r["outcome"] == "failed"]
    return pages_notice(len(rows), failed)


async def read_files(files: list[UploadFile] | None) -> list[tuple[str, bytes]]:
    out = []
    for f in files or []:
        out.append((f.filename or "upload", await f.read()))
    return out


def check(files: list[tuple[str, bytes]], *, settings: Settings, score_type: str | None,
          require_score_type: bool, allowed_kinds: tuple[str, ...] | str | None = None,
          render_pdf: bool = True) -> CheckedUpload:
    # 빈 입력은 계약 위반 422(2026-09-30 API 점검 B7). 웹과 같이 쓰는 검사기(checks/upload.py)는 건드리지 않는다
    if not files:
        raise ApiError("VALIDATION_ERROR", details={"errors": [{"loc": ["body", "file"], "msg": "파일이 없습니다"}]})
    empty = [i for i, (_n, d) in enumerate(files) if not d]
    if empty:
        raise ApiError("VALIDATION_ERROR", details={"errors": [
            {"loc": ["body", "file", i], "msg": "빈 파일입니다"} for i in empty]})
    multi_page = allowed_kinds == USER_UPLOAD
    try:
        if allowed_kinds == USER_UPLOAD:
            from app.checks.upload import user_upload_kinds

            allowed_kinds = user_upload_kinds()
        verdict = engine_api.check_upload(
            files, score_type=score_type, require_score_type=require_score_type,
            score_file_max_bytes=settings.score_file_max_bytes, allowed_kinds=allowed_kinds,
            multi_page=multi_page, render_pdf=render_pdf,
        )
    except engine_api.EngineModuleMissing as exc:
        raise ApiError("INTERNAL_ERROR", details={"reason": "upload check module missing", "detail": str(exc)}) from exc
    if not verdict.ok:
        # 모델 API 상태는 error-codes.json 의 api_http 를 따른다(악보 종류 누락 422 — errors.ApiError)
        raise ApiError(verdict.code or "UPLOAD_CORRUPTED", details=dict(verdict.details or {}))
    if allowed_kinds and verdict.kind not in allowed_kinds:
        raise ApiError("UPLOAD_UNSUPPORTED_TYPE", details={"kind": verdict.kind, "allowed": list(allowed_kinds)})
    name, data = files[0]
    page_count = getattr(verdict, "pdf_page_count", None)
    raw_pages = list(getattr(verdict, "pages", None) or [])
    raw_files = list(getattr(verdict, "files", None) or [])
    if raw_files:
        up_files = [UploadedFile(file_no=f.file_no, name=f.name, data=f.data, short_edge_px=f.short_edge_px,
                                 pdf_page_count=f.pdf_page_count) for f in raw_files]
    else:
        up_files = [UploadedFile(file_no=i, name=n, data=d, short_edge_px=verdict.short_edge_px,
                                 pdf_page_count=page_count) for i, (n, d) in enumerate(files, start=1)]
    if raw_pages:
        pages = [UploadPage(page_no=p.page_no, file_no=p.file_no, source=p.source, short_edge_px=p.short_edge_px,
                            image=p.image, suffix=p.suffix,
                            upscaled_short_side_px=getattr(p, "upscaled_short_side_px", None)) for p in raw_pages]
    elif verdict.kind == "image":
        # 검사기가 쪽 목록을 주지 않으면(시험의 가짜 검사기) 사진마다 한 쪽
        pages = [UploadPage(page_no=i, file_no=i, source="file", short_edge_px=verdict.short_edge_px, image=d,
                            suffix=Path(n).suffix.lower() or ".png") for i, (n, d) in enumerate(files, start=1)]
    else:
        pages = []
    first_image = pages[0].image if pages else (data if verdict.kind == "image" else None)
    return CheckedUpload(name=name, data=data, kind=verdict.kind, short_edge_px=verdict.short_edge_px,
                         image_data=first_image, pdf_page_count=page_count, files=up_files, pages=pages)
