"""원본 보존과 실제 인식 전에 쓰는 색상·방향 사본을 확인한다."""
import io

import numpy as np
from PIL import Image

from app.checks.image import recognition_copy
from app.checks.upload import check_upload, read_rules
from test_foundation import SHARED


def encoded(image, kind="PNG", **kwargs):
    output = io.BytesIO()
    image.save(output, kind, **kwargs)
    return output.getvalue()


def test_transparent_background_becomes_white_and_notes_stay_black():
    image = Image.new("RGBA", (700, 700), (0, 0, 0, 0))
    image.putpixel((50, 50), (0, 0, 0, 255))
    original = encoded(image)
    rules = read_rules(SHARED)
    verdict = check_upload([("transparent.png", original)], rules=rules, score_type="staff",
                           require_score_type=True, render_pdf=True)
    assert verdict.ok and verdict.files[0].data == original
    with Image.open(io.BytesIO(verdict.pages[0].image)) as copy:
        assert copy.mode == "RGB"
        assert copy.getpixel((0, 0)) == (255, 255, 255)
        assert copy.getpixel((50, 50)) == (0, 0, 0)


def test_16bit_png_keeps_gray_levels():
    image = Image.fromarray(np.array([[0, 32768, 65535]], dtype=np.uint16))
    with Image.open(io.BytesIO(recognition_copy(encoded(image)))) as copy:
        assert [copy.getpixel((x, 0))[0] for x in range(3)] == [0, 128, 255]


def test_exif_direction_is_applied_once():
    image = Image.new("RGB", (700, 900), "white")
    exif = image.getexif()
    exif[274] = 6
    first = recognition_copy(encoded(image, "JPEG", exif=exif))
    second = recognition_copy(first)
    for data in (first, second):
        with Image.open(io.BytesIO(data)) as copy:
            assert copy.size == (900, 700)
            assert not copy.getexif().get(274)


def test_small_transparent_image_is_normalized_before_upscale():
    original = encoded(Image.new("RGBA", (600, 800), (0, 0, 0, 0)))
    verdict = check_upload([("small.png", original)], rules=read_rules(SHARED), score_type="staff",
                           require_score_type=True, render_pdf=True)
    assert verdict.ok and verdict.files[0].data == original
    assert verdict.pages[0].upscaled_short_side_px == 1000
    with Image.open(io.BytesIO(verdict.pages[0].image)) as copy:
        assert min(copy.size) == 1000 and copy.getpixel((0, 0)) == (255, 255, 255)


def test_inspection_does_not_normalize_or_expand(monkeypatch):
    def forbidden(*args):
        raise AssertionError("검사 API에서 사본을 만들면 안 됩니다")

    monkeypatch.setattr("app.checks.image.recognition_copy", forbidden)
    original = encoded(Image.new("RGBA", (600, 600), (0, 0, 0, 0)))
    verdict = check_upload([("small.png", original)], rules=read_rules(SHARED), score_type="staff",
                           require_score_type=True, render_pdf=False)
    assert verdict.ok and verdict.pages[0].image == original
