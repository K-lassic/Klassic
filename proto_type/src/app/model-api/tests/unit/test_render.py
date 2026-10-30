"""렌더러(T124·T125) — Verovio PDF 는 실제로 만들고, FluidSynth 가 없으면 RENDERER_MISSING 을 깔끔히 낸다."""

from pathlib import Path

import pytest

from app.render import fluidsynth_mp3, pdf
from app.render.errors import RenderError
from app.render.fluidsynth_mp3 import render_mp3
from app.render.pdf import render_pdf, renderer_versions

FIX = Path(__file__).resolve().parents[3] / "shared" / "fixtures" / "upload"


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
    tp.close(); page.close(); doc.close()
    return text, names, ((title[0][0] + title[1][2]) / 2, size[0])


def test_pdf_korean_hanja_and_music_text_not_tofu(monkeypatch) -> None:
    """2026-09-30 황송해: PDF 의 한글 · 한자 · 빠르기표가 검정 네모(■)로 깨지던 것 — 함께 싣는 글꼴(OFL)로 그린다."""
    monkeypatch.setattr(pdf, "find_musescore", lambda: None)
    data, name, _v = render_pdf(_KO_XML, 60)
    assert name == "verovio"
    text, fonts, (title_center, page_w) = _pdf_text_and_fonts(data)
    assert "가야금" in text and "굿거리" in text and "黃太仲林" in text
    assert "\u25a0" not in text  # ■ 없음
    assert "\ueca5" in text  # 빠르기표 음표(SMuFL metNoteQuarterUp)가 음악 글꼴 글자로 남음
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


def test_mp3_missing_fluidsynth(monkeypatch) -> None:
    monkeypatch.setattr(fluidsynth_mp3, "find_fluidsynth", lambda: None)
    with pytest.raises(RenderError) as e:
        render_mp3((FIX / "ok.mid").read_bytes(), [], 30)
    assert e.value.code == "RENDERER_MISSING"


def test_mp3_missing_soundfont(monkeypatch) -> None:
    monkeypatch.setattr(fluidsynth_mp3, "find_fluidsynth", lambda: "/bin/echo")
    monkeypatch.setattr(fluidsynth_mp3, "find_lame", lambda: "/bin/echo")
    monkeypatch.setattr(fluidsynth_mp3, "default_soundfonts", list)
    with pytest.raises(RenderError) as e:
        render_mp3((FIX / "ok.mid").read_bytes(), ["/no/such.sf2"], 30)
    assert e.value.code == "RENDERER_MISSING"


def test_mp3_real_if_available() -> None:
    """이 서버에 fluidsynth·lame·음원이 있으면 실제로 MP3 를 만든다(없으면 건너뜀)."""
    if not (fluidsynth_mp3.find_fluidsynth() and fluidsynth_mp3.find_lame() and fluidsynth_mp3.default_soundfonts()):
        pytest.skip("fluidsynth/lame/음원 없음")
    data, name, version = render_mp3((FIX / "ok.mid").read_bytes(), [], 120)
    assert name == "fluidsynth" and "+lame" in version
    assert data[:3] == b"ID3" or data[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xfa")
    assert len(data) > 10_000


def test_mp3_timeout(monkeypatch, tmp_path) -> None:
    slow = tmp_path / "slow.sh"
    slow.write_text("#!/bin/sh\nsleep 30\n")
    slow.chmod(0o755)
    sf = tmp_path / "x.sf2"
    sf.write_bytes(b"RIFF")
    monkeypatch.setattr(fluidsynth_mp3, "find_fluidsynth", lambda: str(slow))
    monkeypatch.setattr(fluidsynth_mp3, "find_lame", lambda: str(slow))
    monkeypatch.setattr(fluidsynth_mp3, "default_soundfonts", lambda: [str(sf)])
    with pytest.raises(RenderError) as e:
        render_mp3(b"MThd", [], 0.5)
    assert e.value.code == "RENDER_TIMEOUT"


def test_renderer_versions_shape() -> None:
    rows = renderer_versions()
    assert {r["name"] for r in rows} == {"musescore", "verovio", "fluidsynth", "lame"}
    assert all({"name", "version", "installed", "kind"} <= set(r) for r in rows)
    assert next(r for r in rows if r["name"] == "verovio")["installed"]
