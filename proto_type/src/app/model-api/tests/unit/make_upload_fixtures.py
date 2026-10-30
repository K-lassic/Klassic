"""업로드 검사 공용 시험 파일 만들기 (T077).

    cd app/model-api && uv run python tests/unit/make_upload_fixtures.py

`app/shared/fixtures/upload/` 에 파일과 expected.json(파일 → 사유 코드|null)을 쓴다.
웹(TS) 검사기와 모델 API(Python) 검사기가 같은 파일·같은 기대값으로 시험한다(SC-015).
ok_staff.png 는 ok.musicxml 을 Verovio 로 그린 쪽(macOS `sips` 로 PDF→PNG)이며, sips 가 없으면 합성 오선 그림을 쓴다.

PDF 시험 파일(2026-09-29 사진·PDF 입력)만 다시 만들기:

    cd app/model-api && uv run python tests/unit/make_upload_fixtures.py --pdf-only

기대값은 **사용자 업로드 기준**(allowed_kinds = upload-rules.json user_upload_kinds = 사진·PDF)이라
MIDI·MusicXML 시험 파일은 UPLOAD_UNSUPPORTED_TYPE 이다.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
ROOT = HERE.parents[1]  # app/model-api
sys.path.insert(0, str(ROOT))
OUT = ROOT.parent / "shared" / "fixtures" / "upload"

import synth_images as S


def ok_score():
    """아리랑 앞부분 비슷한 짧은 선율(3/4) — 음표·쉼표가 있는 정상 악보."""
    from music21 import clef, metadata, meter, note, stream

    sc = stream.Score()
    sc.metadata = metadata.Metadata(title="시험 악보", composer="gugak-fixture")
    p = stream.Part()
    p.partName = "Melody"
    p.append(clef.TrebleClef())
    p.append(meter.TimeSignature("3/4"))
    tune = [("G4", 1.5), ("A4", 0.5), ("G4", 1), ("C5", 1.5), ("D5", 0.5), ("C5", 1),
            ("D5", 1), ("E5", 1), ("D5", 1), ("C5", 2), ("A4", 1),
            ("G4", 1.5), ("A4", 0.5), ("G4", 1), ("C5", 1.5), ("D5", 0.5), ("C5", 1),
            ("D5", 1), ("E5", 1), ("D5", 1), ("C5", 2), ("r", 1)] * 2
    for name, ql in tune:
        p.append(note.Rest(quarterLength=ql) if name == "r" else note.Note(name, quarterLength=ql))
    sc.insert(0, p)
    return sc


def musicxml_str(sc) -> str:
    from music21.musicxml.m21ToXml import GeneralObjectExporter

    return GeneralObjectExporter(sc).parse().decode("utf-8")


def midi_bytes(sc) -> bytes:
    from music21.midi.translate import streamToMidiFile

    return bytes(streamToMidiFile(sc).writestr())


def staff_png_from_musicxml(xml: str, scale: float = 3.0) -> bytes | None:
    """Verovio → SVG → (svglib, 확대) PDF → sips PNG → 흰 배경 RGB. 도구가 없으면 None."""
    if shutil.which("sips") is None:
        return None
    import verovio
    from reportlab.graphics import renderPDF
    from reportlab.pdfgen import canvas
    from svglib.svglib import svg2rlg

    tk = verovio.toolkit()
    tk.setOptions({"pageWidth": 2100, "pageHeight": 2970, "scale": 45, "adjustPageHeight": False, "footer": "none",
                   "header": "none"})
    if not tk.loadData(xml):
        return None
    with tempfile.TemporaryDirectory() as tmp:
        svg = os.path.join(tmp, "p.svg")
        Path(svg).write_text(tk.renderToSVG(1), encoding="utf-8")
        d = svg2rlg(svg)
        d.scale(scale, scale)
        d.width, d.height = d.width * scale, d.height * scale
        pdf_path = os.path.join(tmp, "p.pdf")
        c = canvas.Canvas(pdf_path, pagesize=(d.width, d.height))
        renderPDF.draw(d, c, 0, 0)
        c.showPage()
        c.save()
        png = os.path.join(tmp, "p.png")
        subprocess.run(["sips", "-s", "format", "png", pdf_path, "--out", png], check=True, capture_output=True)
        img = cv2.imread(png, cv2.IMREAD_UNCHANGED)
    if img is None:
        return None
    if img.ndim == 3 and img.shape[2] == 4:
        a = img[:, :, 3:4].astype(np.float32) / 255
        img = (img[:, :, :3].astype(np.float32) * a + 255 * (1 - a)).astype(np.uint8)
    # 위아래 여백을 두고 짧은 변이 800 이상인지 확인
    if min(img.shape[:2]) < 800:
        return None
    return S.to_png(img)


def pdf_fixtures(staff_png: bytes) -> dict[str, bytes]:
    """PDF 시험 파일(2026-09-29).

    - ok_staff_2p.pdf: 1쪽 = ok_staff.png(300dpi 로 넣어 300dpi 로 그리면 같은 크기), 2쪽 = 빈 쪽 → 통과 · 쪽수 2
    - broken.pdf: 머리 %PDF 만 맞고 속은 깨짐 → UPLOAD_CORRUPTED
    - encrypted.pdf: 열기 암호가 걸린 PDF → UPLOAD_CORRUPTED
    - small_page.pdf: 첫 쪽이 2인치(300dpi 로 600px) → (2026-09-30 119번) 통과 — 1000px 로 늘려 읽는다
    - tiny_page.pdf: 첫 쪽이 0.8인치(300dpi 로 240px) → UPLOAD_RESOLUTION_TOO_LOW(반려 기준 300px)
    """
    import io

    from PIL import Image
    from reportlab.lib import pdfencrypt
    from reportlab.pdfgen import canvas

    out: dict[str, bytes] = {}
    page1 = Image.open(io.BytesIO(staff_png)).convert("RGB")
    blank = Image.new("RGB", page1.size, "white")
    buf = io.BytesIO()
    page1.save(buf, format="PDF", resolution=300.0, save_all=True, append_images=[blank])
    out["ok_staff_2p.pdf"] = buf.getvalue()
    out["broken.pdf"] = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R" + bytes(range(256)) * 2
    buf = io.BytesIO()
    enc = pdfencrypt.StandardEncryption("user-secret", ownerPassword="owner-secret", canPrint=1)
    c = canvas.Canvas(buf, pagesize=(595, 842), encrypt=enc)
    c.drawString(72, 770, "encrypted score")
    c.showPage()
    c.save()
    out["encrypted.pdf"] = buf.getvalue()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(144, 144))
    c.line(10, 72, 134, 72)
    c.showPage()
    c.save()
    out["small_page.pdf"] = buf.getvalue()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(57.6, 57.6))
    c.line(4, 28, 53, 28)
    c.showPage()
    c.save()
    out["tiny_page.pdf"] = buf.getvalue()
    return out


EXPECTED = {
    "$comment": "업로드 검사 기대값(T077, SC-015). 값 = shared/error-codes.json 코드, null = 통과. "
    "조건: 파일 1개씩, score_type='staff', require_score_type=true, 상한은 upload-rules.json 기본값, "
    "받는 종류 = upload-rules.json user_upload_kinds(사진·PDF — 2026-09-29 황송해 결정, MIDI·MusicXML 은 형식 반려). "
    "PDF 의 손상·암호·사진 크기는 모델 API 검사기(pypdfium2)가 판정한다 — 웹(TS)은 형식·용량·악보 종류만 보고 "
    "나머지는 모델 API /v1/internal/upload-check 에 맡긴다($remote_checked). "
    "Python: app/model-api/tests/unit/test_upload.py · TS: app/backend/tests/contract/upload_rules.test.ts. "
    "다시 만들기: tests/unit/make_upload_fixtures.py",
    "$params": {"score_type": "staff", "require_score_type": True, "allowed_kinds": "user_upload_kinds"},
    "$remote_checked": ["broken.pdf", "encrypted.pdf", "small_page.pdf", "tiny_page.pdf"],
    "$pdf_pages": {"ok_staff_2p.pdf": 2},
    "text.txt": "UPLOAD_UNSUPPORTED_TYPE",
    "broken.png": "UPLOAD_CORRUPTED",
    # (2026-09-30 황송해 119번) 짧은 변 300~649px 은 반려하지 않고 1000px 로 늘려 읽는다 — 300px 미만만 반려
    "small_600.png": None,
    "tiny_250.png": "UPLOAD_RESOLUTION_TOO_LOW",
    "big_25mb.png": "UPLOAD_TOO_LARGE",
    "broken.musicxml": "UPLOAD_UNSUPPORTED_TYPE",
    "empty_parts.musicxml": "UPLOAD_UNSUPPORTED_TYPE",
    "ok_staff.png": None,
    "ok_jeongganbo.png": None,
    "ok.mid": "UPLOAD_UNSUPPORTED_TYPE",
    "ok.musicxml": "UPLOAD_UNSUPPORTED_TYPE",
    "ok_staff_2p.pdf": None,
    "broken.pdf": "UPLOAD_CORRUPTED",
    "encrypted.pdf": "UPLOAD_CORRUPTED",
    "small_page.pdf": None,
    "tiny_page.pdf": "UPLOAD_RESOLUTION_TOO_LOW",
}


def write_expected() -> None:
    (OUT / "expected.json").write_text(json.dumps(EXPECTED, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if "--pdf-only" in sys.argv:
        for name, data in pdf_fixtures((OUT / "ok_staff.png").read_bytes()).items():
            (OUT / name).write_bytes(data)
            print(f"{name:24s} {len(data):>10d} bytes")
        write_expected()
        return
    sc = ok_score()
    xml = musicxml_str(sc)
    files: dict[str, bytes] = {}
    files["text.txt"] = "악보가 아닌 글자 파일입니다.\nplain text\n".encode()
    # PNG 앞머리만 맞고 속은 깨진 파일 → 형식 통과, 열기 실패
    files["broken.png"] = bytes.fromhex("89504e470d0a1a0a") + b"\x00\x00\x00\rIHDR" + os.urandom(64)
    files["small_600.png"] = S.to_png(S.staff_image(w=900, h=600, n_staves=3, gap=12))
    files["tiny_250.png"] = S.to_png(S.staff_image(w=400, h=250, n_staves=1, gap=10))
    rng = np.random.default_rng(25)
    files["big_25mb.png"] = S.to_png(rng.integers(0, 256, (3000, 3000, 3), dtype=np.uint8))
    files["broken.musicxml"] = (
        b'<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">\n  <part-list>\n'
        b'    <score-part id="P1"><part-name>Broken</part-name></score-part>\n  </part-list>\n'
        b'  <part id="P1">\n    <measure number="1">\n      <note><pitch><step>C</step>'
    )
    files["empty_parts.musicxml"] = (
        b'<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">\n'
        b"  <part-list/>\n</score-partwise>\n"
    )
    files["ok.musicxml"] = xml.encode("utf-8")
    files["ok.mid"] = midi_bytes(sc)
    staff_png = staff_png_from_musicxml(xml)
    files["ok_staff.png"] = staff_png if staff_png is not None else S.to_png(S.staff_image())
    # 정간보 엔진(jeongganbo-omr)이 기대하는 쪽 크기(세로 약 3091px, 칸 폭 85~110px)에 맞춘 합성 정간보
    files["ok_jeongganbo.png"] = S.to_png(
        S.jeongganbo_image(w=2200, h=3091, n_cols=12, n_rows=20, cell_w=100, cell_h=130, daegang=4)
    )
    files.update(pdf_fixtures(files["ok_staff.png"]))
    for name, data in files.items():
        (OUT / name).write_bytes(data)
    write_expected()
    for name, data in files.items():
        print(f"{name:24s} {len(data):>10d} bytes")


if __name__ == "__main__":
    main()
