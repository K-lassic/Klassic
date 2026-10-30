"""PDF 입력 — 열어 보기 · 쪽을 사진(PNG)으로 바꾸기 (2026-09-29 황송해 결정, UC3 A7 · SD_01 1.2a).

- 변환 도구: pypdfium2(Apache-2.0 / BSD-3, PDFium). PyMuPDF(AGPL)는 쓰지 않는다.
- 손상됐거나 암호가 걸린 PDF → 열지 못함(UPLOAD_CORRUPTED, UC3 E2).
- (2026-09-29 여러 쪽 결정) 한 요청 = 악보 한 곡 — 모든 쪽(최대 10쪽)을 render_dpi(기본 300)로 그린다(render_pages).
  사진 크기 검사는 그리기 전에 쪽 크기로 계산한다(page_sizes — 그린 그림과 같은 계산, 웹 검사 위임은 그리지 않는다).
- PDFium 은 여러 스레드에서 동시에 부르면 안 되므로 호출은 한 줄로 세운다(_LOCK).
"""

from __future__ import annotations

import io
import threading
from dataclasses import dataclass

_LOCK = threading.Lock()

# 쪽이 터무니없이 크면(예: 수 m 짜리 도면) 300dpi 그림이 메모리를 다 먹는다 — 긴 변을 이 값으로 줄여 그린다
MAX_RENDER_EDGE_PX = 10000


@dataclass
class PdfOpen:
    ok: bool
    page_count: int
    reason: str | None  # 'encrypted' | 'unreadable' | 'no_pages' | None


@dataclass
class PdfPage:
    png: bytes
    width: int
    height: int
    dpi: float


def open_pdf(data: bytes) -> PdfOpen:
    """열리는지·암호가 있는지·쪽수. 열지 못하면 ok=False + 이유."""
    import pypdfium2 as pdfium

    with _LOCK:
        try:
            doc = pdfium.PdfDocument(data)
        except pdfium.PdfiumError as exc:
            reason = "encrypted" if getattr(exc, "err_code", None) == pdfium.raw.FPDF_ERR_PASSWORD else "unreadable"
            return PdfOpen(ok=False, page_count=0, reason=reason)
        # PDFium 이 던지는 예외 종류가 여럿이다 — 무엇이든 '열 수 없음'
        except Exception:  # noqa: BLE001
            return PdfOpen(ok=False, page_count=0, reason="unreadable")
        try:
            n = len(doc)
        finally:
            doc.close()
    if n < 1:
        return PdfOpen(ok=False, page_count=0, reason="no_pages")
    return PdfOpen(ok=True, page_count=n, reason=None)


def _scale(w_pt: float, h_pt: float, dpi: float) -> float:
    """dpi 로 그릴 배율. 긴 변이 MAX_RENDER_EDGE_PX 를 넘으면 그만큼 줄인다."""
    scale = dpi / 72.0
    if max(w_pt, h_pt) * scale > MAX_RENDER_EDGE_PX:
        scale = MAX_RENDER_EDGE_PX / max(w_pt, h_pt)
    return scale


def page_sizes(data: bytes, dpi: float = 300.0, limit: int | None = None) -> list[tuple[int, int]] | None:
    """쪽마다 dpi 로 그렸을 때의 (가로, 세로) 픽셀 — 그리지 않고 쪽 크기로 계산한다. 읽지 못하면 None.

    limit: 앞에서부터 이만큼 쪽만 본다(None 이면 모두)."""
    import pypdfium2 as pdfium

    out: list[tuple[int, int]] = []
    with _LOCK:
        try:
            doc = pdfium.PdfDocument(data)
        except Exception:  # noqa: BLE001
            return None
        try:
            n = len(doc) if limit is None else min(len(doc), limit)
            for i in range(n):
                page = doc[i]
                try:
                    w_pt, h_pt = page.get_size()
                finally:
                    page.close()
                sc = _scale(w_pt, h_pt, dpi)
                out.append((max(1, round(w_pt * sc)), max(1, round(h_pt * sc))))
        except Exception:  # noqa: BLE001
            return None
        finally:
            doc.close()
    return out


def _render(doc, index: int, dpi: float) -> PdfPage:
    page = doc[index]
    try:
        w_pt, h_pt = page.get_size()
        scale = _scale(w_pt, h_pt, dpi)
        bitmap = page.render(scale=scale)
        try:
            image = bitmap.to_pil().convert("RGB")
        finally:
            bitmap.close()
    finally:
        page.close()
    buf = io.BytesIO()
    image.save(buf, format="PNG", dpi=(round(scale * 72), round(scale * 72)))
    return PdfPage(png=buf.getvalue(), width=int(image.width), height=int(image.height), dpi=scale * 72.0)


def render_pages(data: bytes, dpi: float = 300.0, limit: int | None = None) -> list[PdfPage] | None:
    """쪽마다 dpi 로 그려 흰 바탕 RGB PNG 로(여러 쪽, 2026-09-29). 한 쪽이라도 그리지 못하면 None."""
    import pypdfium2 as pdfium

    with _LOCK:
        try:
            doc = pdfium.PdfDocument(data)
        except Exception:  # noqa: BLE001
            return None
        try:
            n = len(doc) if limit is None else min(len(doc), limit)
            return [_render(doc, i, dpi) for i in range(n)]
        except Exception:  # noqa: BLE001
            return None
        finally:
            doc.close()


def render_first_page(data: bytes, dpi: float = 300.0) -> PdfPage | None:
    """첫 쪽만 그린다(예전 '첫 쪽만' 규칙용 — 지금은 render_pages 를 쓴다). 그리지 못하면 None."""
    pages = render_pages(data, dpi, limit=1)
    return pages[0] if pages else None
