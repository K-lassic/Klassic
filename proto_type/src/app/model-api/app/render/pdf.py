"""MusicXML → PDF (T125, research R5).

MuseScore Studio CLI(`mscore -o out.pdf in.musicxml`)가 있으면 그것을 쓰고, 없거나 실패하면
Verovio(MusicXML → 쪽별 SVG) + svglib/reportlab(SVG → 여러 쪽 PDF)으로 만든다.
(이 서버에서는 cairosvg 가 libcairo 를 못 불러 svglib 을 쓴다.)
"""

from __future__ import annotations

import io
import os
import tempfile
import threading
import time
from pathlib import Path

from app.render.errors import RenderError
from app.render.tools import find_fluidsynth, find_lame, find_musescore, run_until, tool_version

__all__ = ["RenderError", "render_pdf", "renderer_versions"]


def _toolkit():
    """글꼴 경로를 직접 지정한 Verovio toolkit.

    Verovio 는 기본 글꼴 경로를 **처음 불러온 스레드에만** 기억한다. 요청은 작업 스레드(asyncio.to_thread)에서
    돌므로 경로를 지정하지 않으면 "Leipzig font could not be loaded" 로 악보를 읽지 못한다(→ RENDER_FAILED).
    2026-09-29 확인: 새 프로세스에 PDF 4건 동시 → 3건 502, 판 읽기(/v1/versions)가 먼저 돈 뒤에는 모두 502.
    """
    import verovio

    tk = verovio.toolkit(False)
    tk.setResourcePath(os.path.join(os.path.dirname(verovio.__file__), "data"))
    return tk

# 악보 글자용 글꼴(2026-09-30 황송해, UC_07 · app/assets/fonts/SOURCES.md). svglib 은 SVG 의 "Times, serif" 를
# reportlab 기본 Times(라틴 1 글자만)로, "Leipzig" 는 Helvetica 로 바꿔 한글 · 한자 · SMuFL 글자가 검정 네모(■)가 됐다.
# 두 글꼴(OFL 1.1)을 서비스가 함께 싣고, SVG 의 글꼴 이름을 우리 이름으로 바꿔 그 글꼴로만 그리게 한다.
FONTS_DIR = Path(__file__).resolve().parents[3] / "assets" / "fonts"
TEXT_FONT_FILE = FONTS_DIR / "NotoSerifKR-Regular.ttf"
MUSIC_FONT_FILE = FONTS_DIR / "Leipzig.ttf"
TEXT_FAMILY = "GugakScoreText"
MUSIC_FAMILY = "GugakScoreMusic"
_fonts_lock = threading.Lock()
_fonts_ready = False


def _register_fonts() -> None:
    """svglib 글꼴 표에 두 글꼴을 한 번만 올린다(굵게 · 기울임도 같은 글꼴 — 가짜 굵게는 만들지 않는다)."""
    global _fonts_ready
    if _fonts_ready:
        return
    with _fonts_lock:
        if _fonts_ready:
            return
        from svglib.fonts import FontMap, get_global_font_map, register_font

        for family, path in ((TEXT_FAMILY, TEXT_FONT_FILE), (MUSIC_FAMILY, MUSIC_FONT_FILE)):
            if not path.is_file():
                raise RenderError("RENDERER_MISSING", f"PDF 글꼴 없음: {path}")
            base, ok = register_font(family, str(path))
            if not ok or base is None:
                raise RenderError("RENDERER_MISSING", f"PDF 글꼴을 올리지 못함: {path}")
            # 굵게 · 기울임도 같은 글꼴로(svglib 은 파일 없는 별칭을 받지 않아 글꼴 표에 직접 적는다)
            fmap = get_global_font_map()
            for weight, style in (("bold", "normal"), ("normal", "italic"), ("bold", "italic")):
                fmap._map[FontMap.build_internal_name(family, weight, style)] = {
                    "svg_family": family, "svg_weight": weight, "svg_style": style, "rlgFont": base, "exact": True}
        _fonts_ready = True


_SVG_NS = "http://www.w3.org/2000/svg"
_XLINK_NS = "http://www.w3.org/1999/xlink"
_MUSIC_NAMES = ("leipzig", "bravura", "gootville", "leland", "petaluma")


def _family_for(fam: str | None) -> str:
    return MUSIC_FAMILY if fam and any(n in fam.lower() for n in _MUSIC_NAMES) else TEXT_FAMILY


def _px(v: str | None) -> float | None:
    if not v:
        return None
    try:
        return float(v.strip().removesuffix("px"))
    except ValueError:
        return None


def _flatten_text(svg: str) -> str:
    """Verovio 글자를 svglib 이 읽을 수 있는 모양으로 편다.

    Verovio 는 `<text font-size="0px">` 안에 글꼴 · 크기가 다른 `<tspan>` 을 겹쳐 넣는다(빠르기표 = 음악 글꼴 음표 +
    "= 66"). svglib 은 글자 폭을 바깥 `<text>` 의 글꼴 · 크기(0px)로 재서 조각이 한 자리에 겹치고, 가운데 · 끝 맞춤도
    틀어진다. 그래서 조각마다 글꼴 · 크기를 정하고 폭을 직접 재서, 자리(x)를 적은 `<text>` 여럿으로 바꾼다.
    """
    import xml.etree.ElementTree as ET

    from reportlab.pdfbase.pdfmetrics import stringWidth

    ET.register_namespace("", _SVG_NS)
    ET.register_namespace("xlink", _XLINK_NS)
    root = ET.fromstring(svg)
    parents = {c: p for p in root.iter() for c in p}

    def tag(el) -> str:
        return el.tag.rsplit("}", 1)[-1]

    for text in [el for el in root.iter() if tag(el) == "text"]:
        parent = parents.get(text)
        if parent is None:
            continue
        # 줄(덩이): x/y 가 새로 적힌 곳에서 새 덩이. 덩이마다 맞춤(start/middle/end)을 따로 한다
        chunks: list[dict] = []
        cur = {"x": _px(text.get("x")) or 0.0, "y": _px(text.get("y")) or 0.0,
               "anchor": text.get("text-anchor", "start"), "frags": []}
        chunks.append(cur)

        def walk(el, fam, size, anchor, text=text, chunks=chunks):
            nonlocal cur
            fam = el.get("font-family") or fam
            sz = _px(el.get("font-size"))
            size = sz if sz else size
            anchor = el.get("text-anchor") or anchor
            if el is not text and (el.get("x") is not None or el.get("y") is not None):
                cur = {"x": _px(el.get("x")) if el.get("x") is not None else cur["x"],
                       "y": _px(el.get("y")) if el.get("y") is not None else cur["y"], "anchor": anchor, "frags": []}
                chunks.append(cur)
            if el.text and el.text.strip("\n\t") and tag(el) != "title":
                t = " ".join(el.text.split()) if el.text.strip() else " "
                if el.text.startswith(" ") and not t.startswith(" ") and cur["frags"]:
                    t = " " + t
                if el.text.endswith(" ") and not t.endswith(" "):
                    t = t + " "
                cur["frags"].append((t, _family_for(fam), size or 0.0))
            for ch in el:
                if tag(ch) in ("tspan",):
                    walk(ch, fam, size, anchor, text, chunks)

        walk(text, text.get("font-family"), None, cur["anchor"])
        out = []
        for ch in chunks:
            frags = [f for f in ch["frags"] if f[0] and f[2] > 0]
            if not frags:
                continue
            widths = [stringWidth(t, fam, size) for t, fam, size in frags]
            total = sum(widths)
            x = ch["x"] - (total / 2 if ch["anchor"] == "middle" else total if ch["anchor"] == "end" else 0)
            for (t, fam, size), w in zip(frags, widths):
                if t.strip():
                    el = ET.Element(f"{{{_SVG_NS}}}text", {
                        "x": f"{x:.1f}", "y": f"{ch['y']:.1f}", "font-family": fam, "font-size": f"{size:g}px"})
                    el.text = t
                    out.append(el)
                x += w
        idx = list(parent).index(text)
        parent.remove(text)
        for k, el in enumerate(out):
            parent.insert(idx + k, el)
    return ET.tostring(root, encoding="unicode")


def _fill_page(drawing) -> None:
    """svglib 이 Verovio 의 겹친 <svg>(바깥 840px · 안 viewBox) 에 px→pt(0.75)를 두 번 곱해 악보가 쪽의 왼쪽 위
    3/4 만 차지하던 것을 바로잡는다(2026-09-30). 맨 위 묶음이 (0.75, 0, 0, -0.75, 0, 높이) 일 때만 (1, 0, 0, -1, 0, 높이)로."""
    top = drawing.contents[0] if getattr(drawing, "contents", None) else None
    t = getattr(top, "transform", None)
    if t and len(t) == 6 and abs(t[0] - 0.75) < 1e-6 and abs(t[3] + 0.75) < 1e-6 and abs(t[5] - drawing.height) < 1e-3:
        top.transform = (1, 0, 0, -1, 0, drawing.height)


# A4 세로(verovio 단위 = 1/10 mm)
_VEROVIO_OPTIONS = {
    "pageWidth": 2100,
    "pageHeight": 2970,
    "pageMarginTop": 100,
    "pageMarginBottom": 100,
    "pageMarginLeft": 100,
    "pageMarginRight": 100,
    "scale": 40,
    "adjustPageHeight": False,
    "footer": "none",
}


def _verovio_version() -> str | None:
    try:

        return str(_toolkit().getVersion())
    # 판을 못 읽으면 설치 안 됨으로 표시
    except Exception:  # noqa: BLE001
        return None


def _render_musescore(mscore: str, musicxml: str, deadline: float) -> bytes | None:
    """MuseScore 로 만들기. 실패하면 None(→ Verovio 로 넘어감), 시간 초과면 RenderError."""
    with tempfile.TemporaryDirectory(prefix="gugak-pdf-") as tmp:
        src = os.path.join(tmp, "in.musicxml")
        out = os.path.join(tmp, "out.pdf")
        with open(src, "w", encoding="utf-8") as f:
            f.write(musicxml)
        r = run_until([mscore, "-o", out, src], deadline, cwd=tmp)
        if r.timed_out:
            raise RenderError("RENDER_TIMEOUT", "MuseScore 시간 초과")
        if r.returncode == 0 and os.path.isfile(out) and os.path.getsize(out) > 0:
            with open(out, "rb") as f:
                return f.read()
    return None


def _render_verovio(musicxml: str, deadline: float) -> bytes:
    try:
        import verovio  # noqa: F401 — 설치 여부 확인(toolkit 은 _toolkit() 이 만든다)
        from reportlab.graphics import renderPDF
        from reportlab.pdfgen import canvas
        from svglib.svglib import svg2rlg
    except ImportError as e:  # pragma: no cover - 의존성은 pyproject 에 있다
        raise RenderError("RENDERER_MISSING", f"verovio/svglib 없음: {e}") from e

    _register_fonts()
    tk = _toolkit()
    tk.setOptions(_VEROVIO_OPTIONS)
    if not tk.loadData(musicxml):
        raise RenderError("RENDER_FAILED", "Verovio 가 MusicXML 을 읽지 못함")
    pages = tk.getPageCount()
    if pages < 1:
        raise RenderError("RENDER_FAILED", "쪽이 없음")

    buf = io.BytesIO()
    pdf = canvas.Canvas(buf)
    with tempfile.TemporaryDirectory(prefix="gugak-svg-") as tmp:
        for p in range(1, pages + 1):
            if time.monotonic() > deadline:
                raise RenderError("RENDER_TIMEOUT", f"Verovio {p}/{pages}쪽에서 시간 초과")
            svg_path = os.path.join(tmp, f"p{p}.svg")
            with open(svg_path, "w", encoding="utf-8") as f:
                f.write(_flatten_text(tk.renderToSVG(p)))
            drawing = svg2rlg(svg_path)
            if drawing is None:
                raise RenderError("RENDER_FAILED", f"{p}쪽 SVG 변환 실패")
            _fill_page(drawing)
            pdf.setPageSize((drawing.width, drawing.height))
            renderPDF.draw(drawing, pdf, 0, 0)
            pdf.showPage()
    pdf.save()
    return buf.getvalue()


def render_pdf(musicxml: str, timeout_s: float) -> tuple[bytes, str, str]:
    """(pdf, renderer_name, version). MuseScore → 없거나 실패하면 Verovio."""
    if not musicxml or not musicxml.strip():
        raise RenderError("RENDER_FAILED", "빈 MusicXML")
    deadline = time.monotonic() + max(0.1, float(timeout_s))
    mscore = find_musescore()
    if mscore is not None:
        data = _render_musescore(mscore, musicxml, deadline)
        if data is not None:
            return data, "musescore", tool_version(mscore) or "unknown"
    data = _render_verovio(musicxml, deadline)
    return data, "verovio", _verovio_version() or "unknown"


def renderer_versions() -> list[dict]:
    """/v1/versions 용 렌더러 목록: [{name, version, installed, kind, path}]."""
    rows: list[dict] = []
    ms = find_musescore()
    rows.append({"name": "musescore", "kind": "pdf", "installed": ms is not None,
                 "version": tool_version(ms) if ms else None, "path": ms})
    vv = _verovio_version()
    rows.append({"name": "verovio", "kind": "pdf", "installed": vv is not None, "version": vv, "path": None})
    fs = find_fluidsynth()
    rows.append({"name": "fluidsynth", "kind": "mp3", "installed": fs is not None,
                 "version": tool_version(fs) if fs else None, "path": fs})
    lm = find_lame()
    rows.append({"name": "lame", "kind": "mp3", "installed": lm is not None,
                 "version": tool_version(lm) if lm else None, "path": lm})
    return rows
