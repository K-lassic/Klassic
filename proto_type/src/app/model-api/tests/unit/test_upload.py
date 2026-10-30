"""업로드 검사(T032) — 공용 시험 파일(expected.json)과 순서·상한 인자.

expected.json 은 사용자 업로드 기준(allowed_kinds = user_upload_kinds = 사진·PDF, 2026-09-29 황송해 결정)이다.
MIDI·MusicXML 구조 검사는 내부 입력(/v1/recommend · /v1/render/*, allowed_kinds=None)용으로 아래에서 따로 본다.
"""

import io
import json
import zipfile

import pytest
from conftest import FIXTURES

from app.checks.upload import check_upload, load_rules, user_upload_kinds

EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
CASES = [(k, v) for k, v in EXPECTED.items() if not k.startswith("$")]


@pytest.mark.parametrize(("name", "code"), CASES)
def test_shared_fixtures(name: str, code: str | None) -> None:
    params = EXPECTED["$params"]
    assert params["allowed_kinds"] == "user_upload_kinds"
    v = check_upload([(name, (FIXTURES / name).read_bytes())], score_type=params["score_type"],
                     require_score_type=params["require_score_type"], allowed_kinds=user_upload_kinds())
    assert v.code == code
    assert v.ok is (code is None)
    if name in EXPECTED.get("$pdf_pages", {}):
        assert v.pdf_page_count == EXPECTED["$pdf_pages"][name]


def test_user_upload_kinds_are_photo_and_pdf() -> None:
    assert user_upload_kinds() == ("image", "pdf")
    rules = load_rules()
    pdf = rules["kinds"]["pdf"]
    assert pdf["magic"][0]["hex_prefix"] == "25504446"
    assert pdf["max_bytes"] == rules["kinds"]["image"]["max_bytes"] == 20 * 1024 * 1024
    assert pdf["render_dpi"] == 300 and pdf["requires_score_type"] is True


def test_midi_musicxml_rejected_for_user_upload_at_type_step() -> None:
    # 깨진 MIDI 라도 '손상'이 아니라 형식 반려 — 종류 확인이 먼저다
    bad_mid = b"MThd" + b"\x00" * 4
    for name, data in (("x.mid", bad_mid), ("ok.musicxml", (FIXTURES / "ok.musicxml").read_bytes())):
        v = check_upload([(name, data)], score_type="staff", require_score_type=True, allowed_kinds=user_upload_kinds())
        assert v.code == "UPLOAD_UNSUPPORTED_TYPE"
        assert v.details["allowed"] == ["image", "pdf"]


def test_pdf_all_pages_converted_to_png() -> None:
    # 2026-09-29 여러 쪽: 사용자 업로드(multi_page)는 모든 쪽을 300dpi PNG 로 바꾼다
    data = (FIXTURES / "ok_staff_2p.pdf").read_bytes()
    v = check_upload([("score.pdf", data)], score_type="staff", require_score_type=True,
                     allowed_kinds=user_upload_kinds(), multi_page=True)
    assert v.ok and v.kind == "pdf" and v.pdf_page_count == 2
    assert [(p.page_no, p.file_no, p.source) for p in v.pages] == [(1, 1, "pdf_page"), (2, 1, "pdf_page")]
    assert all(p.image is not None and p.image[:8] == bytes.fromhex("89504e470d0a1a0a") for p in v.pages)
    # 300dpi 로 넣은 ok_staff.png 와 같은 크기로 그려진다
    png = check_upload([("s.png", (FIXTURES / "ok_staff.png").read_bytes())], score_type="staff",
                       require_score_type=True)
    assert abs(v.short_edge_px - png.short_edge_px) <= 2
    assert v.details["render_dpi"] == 300.0
    # 웹 검사 위임(render_pdf=False)은 그리지 않고 크기만 잰다 — 같은 크기
    w = check_upload([("score.pdf", data)], score_type="staff", require_score_type=True,
                     allowed_kinds=user_upload_kinds(), multi_page=True, render_pdf=False)
    assert w.ok and [p.image for p in w.pages] == [None, None]
    assert [p.short_edge_px for p in w.pages] == [p.short_edge_px for p in v.pages]


def _pdf(pages: int) -> bytes:
    from PIL import Image

    imgs = [Image.new("RGB", (595, 842), (255, 255, 255)) for _ in range(pages)]
    buf = io.BytesIO()
    imgs[0].save(buf, format="PDF", save_all=True, append_images=imgs[1:], resolution=72.0)
    return buf.getvalue()


def test_multi_page_rules() -> None:
    # 사진 여러 장은 올린 순서대로 쪽이 된다
    ok = (FIXTURES / "ok_staff.png").read_bytes()
    kw = {"score_type": "staff", "require_score_type": True, "allowed_kinds": user_upload_kinds(), "multi_page": True}
    v = check_upload([("b.png", ok), ("a.png", ok), ("c.png", ok)], **kw)
    assert v.ok and [(p.page_no, p.file_no, p.source) for p in v.pages] == [(1, 1, "file"), (2, 2, "file"), (3, 3, "file")]
    assert [f.name for f in v.files] == ["b.png", "a.png", "c.png"]
    # 10장까지, 11장은 UPLOAD_TOO_MANY_PAGES
    assert check_upload([("p.png", ok)] * 10, **kw).ok
    assert check_upload([("p.png", ok)] * 11, **kw).code == "UPLOAD_TOO_MANY_PAGES"
    # PDF 는 10쪽까지, 11쪽은 UPLOAD_TOO_MANY_PAGES
    assert check_upload([("s.pdf", _pdf(10))], **kw).ok
    over = check_upload([("s.pdf", _pdf(11))], **kw)
    assert over.code == "UPLOAD_TOO_MANY_PAGES" and over.details["pdf_page_count"] == 11
    # PDF 여러 개 · PDF 와 사진 섞기는 UPLOAD_TOO_MANY_FILES
    pdf = (FIXTURES / "ok_staff_2p.pdf").read_bytes()
    assert check_upload([("a.pdf", pdf), ("b.pdf", pdf)], **kw).code == "UPLOAD_TOO_MANY_FILES"
    assert check_upload([("a.pdf", pdf), ("b.png", ok)], **kw).code == "UPLOAD_TOO_MANY_FILES"
    # 쪽마다 사진 크기 — 몇 번째 사진인지 알려 준다
    # (2026-09-30 119번) 반려 기준은 300px — 250px 사진은 몇 번째 쪽인지와 함께 반려
    tiny = (FIXTURES / "tiny_250.png").read_bytes()
    bad = check_upload([("a.png", ok), ("b.png", tiny)], **kw)
    assert bad.code == "UPLOAD_RESOLUTION_TOO_LOW" and bad.details["page"] == 2
    assert bad.details["min_short_edge_px"] == 300
    # 내부 입력(multi_page=False)은 예전처럼 파일 한 개
    assert check_upload([("a.png", ok), ("b.png", ok)], score_type="staff",
                        require_score_type=True).code == "UPLOAD_TOO_MANY_FILES"


def test_pdf_reasons_and_order() -> None:
    enc = check_upload([("e.pdf", (FIXTURES / "encrypted.pdf").read_bytes())], score_type="staff",
                       require_score_type=True, allowed_kinds=user_upload_kinds())
    assert enc.code == "UPLOAD_CORRUPTED" and enc.details["reason"] == "encrypted"
    # 손상이 용량보다 먼저
    broken = check_upload([("b.pdf", (FIXTURES / "broken.pdf").read_bytes())], score_type="staff",
                          require_score_type=True, image_max_bytes=10)
    assert broken.code == "UPLOAD_CORRUPTED"
    ok = (FIXTURES / "ok_staff_2p.pdf").read_bytes()
    assert check_upload([("s.pdf", ok)], score_type="staff", require_score_type=True,
                        image_max_bytes=1000).code == "UPLOAD_TOO_LARGE"
    assert check_upload([("s.pdf", ok)], score_type=None, require_score_type=True).code == \
        "UPLOAD_SCORE_TYPE_REQUIRED"
    # 확장자는 .pdf 인데 속이 PDF 가 아니면 형식 반려
    png = (FIXTURES / "ok_staff.png").read_bytes()
    assert check_upload([("fake.pdf", png)], score_type="staff", require_score_type=True).code == \
        "UPLOAD_UNSUPPORTED_TYPE"


def test_rules_version_and_codes() -> None:
    rules = load_rules()
    assert rules["check_order"] == ["count", "type", "corrupted", "size", "resolution"]
    assert rules["codes"]["musicxml_structure"] == "UPLOAD_MUSICXML_UNREADABLE"


def test_too_many_files_first() -> None:
    d = (FIXTURES / "ok_staff.png").read_bytes()
    v = check_upload([("a.png", d), ("b.png", d)], score_type="staff", require_score_type=True)
    assert v.code == "UPLOAD_TOO_MANY_FILES"


def test_no_file_is_bad_request() -> None:
    assert check_upload([], score_type="staff", require_score_type=True).code == "BAD_REQUEST"


def test_extension_content_mismatch() -> None:
    txt = (FIXTURES / "text.txt").read_bytes()
    assert check_upload([("fake.png", txt)], score_type="staff", require_score_type=True).code == \
        "UPLOAD_UNSUPPORTED_TYPE"


def test_score_type_required_for_images_only() -> None:
    png = (FIXTURES / "ok_staff.png").read_bytes()
    assert check_upload([("s.png", png)], score_type=None, require_score_type=True).code == \
        "UPLOAD_SCORE_TYPE_REQUIRED"
    assert check_upload([("s.png", png)], score_type=None, require_score_type=False).ok
    mid = (FIXTURES / "ok.mid").read_bytes()
    assert check_upload([("x.mid", mid)], score_type=None, require_score_type=True).ok


def test_setting_limits_override() -> None:
    png = (FIXTURES / "ok_staff.png").read_bytes()
    v = check_upload([("s.png", png)], score_type="staff", require_score_type=True, image_max_bytes=1000)
    assert v.code == "UPLOAD_TOO_LARGE"
    v = check_upload([("s.png", png)], score_type="staff", require_score_type=True, min_short_edge_px=5000)
    assert v.code == "UPLOAD_RESOLUTION_TOO_LOW"
    xml = (FIXTURES / "ok.musicxml").read_bytes()
    v = check_upload([("x.musicxml", xml)], score_type=None, require_score_type=True, score_file_max_bytes=100)
    assert v.code == "UPLOAD_TOO_LARGE"


def test_corrupted_checked_before_size() -> None:
    # 깨진 PNG 가 상한보다 커도 먼저 '손상'
    v = check_upload([("b.png", (FIXTURES / "broken.png").read_bytes())], score_type="staff",
                     require_score_type=True, image_max_bytes=10)
    assert v.code == "UPLOAD_CORRUPTED"


def _mxl(xml: bytes, with_container: bool = True) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        if with_container:
            z.writestr("META-INF/container.xml",
                       '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>')
        z.writestr("score.xml", xml)
    return buf.getvalue()


def test_mxl_ok_and_broken() -> None:
    xml = (FIXTURES / "ok.musicxml").read_bytes()
    assert check_upload([("s.mxl", _mxl(xml))], score_type=None, require_score_type=False).ok
    empty = (FIXTURES / "empty_parts.musicxml").read_bytes()
    assert check_upload([("s.mxl", _mxl(empty))], score_type=None, require_score_type=False).code == \
        "UPLOAD_MUSICXML_UNREADABLE"
    broken_zip = b"PK\x03\x04" + b"\x00" * 50
    assert check_upload([("s.mxl", broken_zip)], score_type=None, require_score_type=False).code == \
        "UPLOAD_CORRUPTED"


def test_corrupted_midi() -> None:
    bad = b"MThd" + b"\x00\x00\x00\x06\x00\x01" + b"\xff" * 10
    assert check_upload([("x.mid", bad)], score_type=None, require_score_type=False).code == "UPLOAD_CORRUPTED"


def test_measure_without_notes_unreadable() -> None:
    xml = (b'<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list>'
           b'<part id="P1"><measure number="1"/></part></score-partwise>')
    assert check_upload([("x.xml", xml)], score_type=None, require_score_type=False).code == \
        "UPLOAD_MUSICXML_UNREADABLE"


def test_small_photo_is_upscaled_for_recognition() -> None:
    """(2026-09-30 황송해 119번) 짧은 변 300~649px 은 반려하지 않고 인식용 그림을 1000px 로 늘린다. 원본은 그대로."""
    from PIL import Image

    small = (FIXTURES / "small_600.png").read_bytes()
    ok = (FIXTURES / "ok_staff.png").read_bytes()
    v = check_upload([("a.png", ok), ("b.png", small)], score_type="staff", require_score_type=True,
                     allowed_kinds=user_upload_kinds(), multi_page=True)
    assert v.ok
    big, little = v.pages
    assert big.upscaled_short_side_px is None and big.image == ok
    assert little.short_edge_px == 600 and little.upscaled_short_side_px == 1000 and little.suffix == ".png"
    with Image.open(io.BytesIO(little.image)) as im:
        assert min(im.size) == 1000
    assert v.files[1].data == small  # 원본은 그대로


def test_small_pdf_page_is_upscaled() -> None:
    pdf = (FIXTURES / "small_page.pdf").read_bytes()
    v = check_upload([("s.pdf", pdf)], score_type="staff", require_score_type=True,
                     allowed_kinds=user_upload_kinds(), multi_page=True)
    assert v.ok and v.pages[0].short_edge_px == 600 and v.pages[0].upscaled_short_side_px == 1000
    tiny = (FIXTURES / "tiny_page.pdf").read_bytes()
    assert check_upload([("t.pdf", tiny)], score_type="staff", require_score_type=True,
                        allowed_kinds=user_upload_kinds(), multi_page=True).code == "UPLOAD_RESOLUTION_TOO_LOW"
