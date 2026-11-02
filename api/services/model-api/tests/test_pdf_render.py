"""렌더러(T124·T125) — Verovio PDF 는 실제로 만들고, FluidSynth 가 없으면 RENDERER_MISSING 을 깔끔히 낸다."""

import pytest

from app.render import pdf
from app.render.errors import RenderError
from app.render.pdf import render_pdf
from test_foundation import SHARED

FIX = SHARED / "fixtures/upload"


def test_pdf_via_verovio(monkeypatch) -> None:
    monkeypatch.setattr(pdf, "find_musescore", lambda: None)
    data, name, version = render_pdf((FIX / "ok.musicxml").read_text(encoding="utf-8"), 60)
    assert name == "verovio" and version and version != "unknown"
    assert data.startswith(b"%PDF-") and b"%%EOF" in data[-1024:]
    assert data.count(b"/Type /Page") - data.count(b"/Type /Pages") >= 1


_KO_XML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><work><work-title>굿거리 黃太仲林</work-title></work>
<part-list><score-part id="P1"><part-name>가야금</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key>
<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>66</per-minute></metronome></direction-type></direction>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>"""


def _pdf_text_and_fonts(data: bytes) -> tuple[str, set[str], tuple[float, float]]:
    import ctypes

    import pypdfium2 as pdfium
    from pypdfium2 import raw

    doc = pdfium.PdfDocument(data)
    page = doc[0]
    tp = page.get_textpage()
    names: set[str] = set()
    for i in range(tp.count_chars()):
        buf = ctypes.create_string_buffer(256)
        flags = ctypes.c_int()
        raw.FPDFText_GetFontInfo(tp.raw, i, buf, 256, ctypes.byref(flags))
        if buf.value:
            names.add(buf.value.decode())
    text = tp.get_text_range()
    title = tp.get_charbox(text.index("굿")), tp.get_charbox(text.index("林"))
    size = page.get_size()
    tp.close()
    page.close()
    doc.close()
    return text, names, ((title[0][0] + title[1][2]) / 2, size[0])


def test_pdf_korean_hanja_and_music_text_not_tofu(monkeypatch) -> None:
    """2026-09-30 황송해: PDF 의 한글 · 한자 · 빠르기표가 검정 네모(■)로 깨지던 것 — 함께 싣는 글꼴(OFL)로 그린다."""
    monkeypatch.setattr(pdf, "find_musescore", lambda: None)
    data, name, _v = render_pdf(_KO_XML, 60)
    assert name == "verovio"
    text, fonts, (title_center, page_w) = _pdf_text_and_fonts(data)
    assert "가야금" in text and "굿거리" in text and "黃太仲林" in text
    assert "\u25a0" not in text  # ■ 없음
    assert any(glyph in text for glyph in ("\ueca5", "\ue1d5"))  # Verovio 판별 빠르기표 음표
    assert fonts == {"NotoSerifKR-Regular", "Leipzig"}, fonts  # Times · Helvetica(한글 없음)로 그리지 않음
    assert abs(title_center - page_w / 2) < page_w * 0.03  # 제목이 쪽 가운데(쪽을 3/4 만 쓰던 문제 재발 방지)


def test_pdf_fonts_are_bundled_ofl() -> None:
    assert pdf.TEXT_FONT_FILE.is_file() and pdf.MUSIC_FONT_FILE.is_file()
    assert (pdf.FONTS_DIR / "OFL-NotoSerifKR.txt").is_file() and (pdf.FONTS_DIR / "OFL-Leipzig.txt").is_file()


def test_pdf_multi_page(monkeypatch) -> None:
    from music21 import note, stream
    from music21.musicxml.m21ToXml import GeneralObjectExporter

    monkeypatch.setattr(pdf, "find_musescore", lambda: None)
    p = stream.Part()
    for i in range(1200):
        p.append(note.Note(60 + (i * 5) % 17, quarterLength=0.5))
    s = stream.Score()
    s.insert(0, p)
    data, _n, _v = render_pdf(GeneralObjectExporter(s).parse().decode(), 120)
    assert data.count(b"/Type /Page") - data.count(b"/Type /Pages") >= 2


def test_pdf_bad_input(monkeypatch) -> None:
    monkeypatch.setattr(pdf, "find_musescore", lambda: None)
    with pytest.raises(RenderError) as e:
        render_pdf("", 10)
    assert e.value.code == "RENDER_FAILED"
    with pytest.raises(RenderError) as e:
        render_pdf("<nonsense>", 10)
    assert e.value.code == "RENDER_FAILED"


def test_svg_external_images_and_references_are_removed():
    svg = '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///private.png"/><use href="https://example.invalid/x"/><use href="#glyph"/></svg>'
    cleaned = pdf._flatten_text(svg)
    assert "file:" not in cleaned and "https:" not in cleaned and "#glyph" in cleaned
