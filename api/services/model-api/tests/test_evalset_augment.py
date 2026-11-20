"""평가 도구 — 어려운 평가셋 만들기(evalset/augment.py) 시험.

구조에서의 위치: 서비스 코드가 아니라 도구의 시험이다. 그림 파일만 다룬다. 엔진 · DB · model-api 없이 돈다.
"""
import json
from pathlib import Path

import httpx
import numpy as np
import pytest
from PIL import Image, ImageDraw

from evalset import augment, report, run
from test_evalset import ARIRANG, fake_server, fallback, recognized


def staff_image(width=900, height=1200):
    """오선 다섯 줄 몇 묶음과 점 몇 개가 찍힌 흰 종이 — 악보처럼 가는 가로줄이 있는 그림."""
    img = Image.new("RGB", (width, height), "white")
    d = ImageDraw.Draw(img)
    for system in range(4):
        top = 150 + system * 250
        for line in range(5):
            d.line([(80, top + line * 16), (width - 80, top + line * 16)], fill="black", width=2)
        for k in range(12):
            x = 120 + k * 60
            d.ellipse([x, top + (k % 5) * 8, x + 16, top + (k % 5) * 8 + 12], fill="black")
    return img


def diff(a, b):
    """두 그림이 얼마나 다른가 (크기가 다르면 b 를 a 크기로 맞춰 견준다)."""
    if a.size != b.size:
        b = b.resize(a.size)
    return float(np.abs(np.asarray(a, dtype=float) - np.asarray(b.convert("RGB"), dtype=float)).mean())


PHOTOMETRIC = ["blur", "noise", "shadow", "jpeg"]        # 자리는 그대로 두고 화소 값만 바꾸는 변형


@pytest.mark.parametrize("kind", list(augment.TRANSFORMS))
def test_each_transform_is_repeatable_and_changes_the_image(kind):
    img = staff_image(1200, 1600)        # 짧은 변이 1000 보다 커야 저해상도 1단계도 실제로 줄어든다
    outs = [augment.apply(img, kind, level, seed=7) for level in (1, 2, 3)]
    # 같은 씨앗이면 화소까지 같다
    assert np.array_equal(np.asarray(outs[1]), np.asarray(augment.apply(img, kind, 2, seed=7)))
    assert all(o.mode == "RGB" and diff(img, o) > 0 for o in outs)


@pytest.mark.parametrize("kind", PHOTOMETRIC)
def test_photometric_transforms_get_stronger_with_level(kind):
    # 세기가 오를수록 원본에서 더 멀어진다. (기울임 · 원근 · 저해상도는 화소 차이가 세기를 따라가지 않는다 —
    # 가는 줄은 조금만 어긋나도 차이가 다 차 버린다. 그쪽은 아래 test_transform_geometry 가 모양으로 확인한다)
    img = staff_image()
    d = [diff(img, augment.apply(img, kind, level, seed=7)) for level in (1, 2, 3)]
    assert 0 < d[0] < d[1] < d[2], d


def test_geometric_transforms_get_stronger_with_level():
    img = staff_image(900, 1200)
    widths = [augment.apply(img, "rotate", lv, 0).size[0] for lv in (1, 2, 3)]
    assert 900 < widths[0] < widths[1] < widths[2]                       # 더 기울일수록 종이가 더 커진다
    shorts = [min(augment.apply(img, "lowres", lv, 0).size) for lv in (1, 2, 3)]
    assert shorts == [900, 800, 600]                                     # 1000 은 이미 그보다 작아 그대로
    # 원근: 위쪽 가장자리에 생기는 빈 종이(원래 그림이 안으로 당겨진 만큼)가 세기를 따라 넓어진다
    black = Image.new("RGB", (900, 1200), "black")
    paper = [int((np.asarray(augment.apply(black, "persp", lv, 0))[2] > 200).all(axis=1).sum()) for lv in (1, 2, 3)]
    assert 0 < paper[0] < paper[1] < paper[2], paper


def test_perspective_coefficients_map_the_corners():
    src = [(0, 0), (100, 0), (100, 50), (0, 50)]
    dst = [(10, 0), (95, 0), (100, 50), (0, 50)]
    a, b, c, d, e, f, g, h = augment._perspective_coeffs(src, dst)
    for (x, y), (u, v) in zip(dst, src):
        den = g * x + h * y + 1
        assert ((a * x + b * y + c) / den, (d * x + e * y + f) / den) == pytest.approx((u, v), abs=1e-6)


def test_transform_geometry():
    img = staff_image(900, 1200)
    assert augment.apply(img, "lowres", 3, 0).size == (600, 800)          # 짧은 변 600 으로, 비율 유지
    assert augment.apply(img.resize((450, 600)), "lowres", 1, 0).size == (450, 600)   # 이미 작으면 키우지 않는다
    assert augment.apply(img, "persp", 3, 0).size == img.size
    w, h = augment.apply(img, "rotate", 3, 0).size
    assert w > 900 and h > 1200                                           # 돌리면 잘리지 않게 종이가 커진다
    # 돌려서 생긴 모서리는 검정이 아니라 종이색이다 (검은 삼각형이 구조 확인을 속이지 않게)
    assert augment.apply(img, "rotate", 3, 0).getpixel((1, 1)) == (255, 255, 255)
    for bad in (("swirl", 1), ("blur", 0), ("blur", 4)):
        with pytest.raises(ValueError):
            augment.apply(img, *bad, 0)


def test_different_seed_changes_noise_but_not_blur():
    img = staff_image()
    assert not np.array_equal(np.asarray(augment.apply(img, "noise", 2, 1)), np.asarray(augment.apply(img, "noise", 2, 2)))
    assert np.array_equal(np.asarray(augment.apply(img, "blur", 2, 1)), np.asarray(augment.apply(img, "blur", 2, 2)))


def test_generate_writes_images_manifest_and_answers_that_run_and_report_accept(tmp_path):
    source = tmp_path / "src"
    (source / "real").mkdir(parents=True)
    staff_image().save(source / "real" / "S01_clean_arirang.png")
    staff_image(800, 1000).save(source / "real" / "S02_clean_doraji.png")
    staff_image().save(source / "real" / "S06_photo_rot3_arirang.jpg")     # 깨끗한 원본이 아니다 — 쓰지 않는다
    answers = {"S01_clean_arirang.png": {"piece": "arirang", "variant": "clean", "pitches": ARIRANG},
               "S02_clean_doraji.png": {"piece": "doraji", "variant": "clean", "pitches": ARIRANG[:10]},
               "S06_photo_rot3_arirang.jpg": {"piece": "arirang", "variant": "photo", "pitches": ARIRANG}}
    out = tmp_path / "aug"
    made = augment.generate(source, out, answers, kinds=["rotate", "jpeg"], levels=[1, 3], seed=3, log=lambda s: None)
    assert made == {"images": 10, "sources": 2}                           # 원본 2 × (깨끗 1 + 2종류 × 2세기)

    items = run.load_items(out / "manifest.json")
    assert len(items) == 10 and all(i["kind"] == "real" and i["score_type"] == "staff" for i in items)
    assert all((out / i["file"]).is_file() for i in items)
    names = sorted(Path(i["file"]).name for i in items)
    assert "S01_arirang__clean.png" in names and "S01_arirang__rotate3.png" in names and "S02_doraji__jpeg1.jpg" in names

    new_answers = json.loads((out / "answers.json").read_text(encoding="utf-8"))["staff"]
    assert set(new_answers) == set(names)
    assert new_answers["S02_doraji__jpeg3.jpg"] == {"piece": "doraji", "pitches": ARIRANG[:10], "variant": "jpeg3",
                                                    "source": "S02_clean_doraji.png"}
    assert new_answers["S01_arirang__clean.png"]["variant"] == "clean"

    # 만든 목록 · 정답으로 실행 · 채점이 이어진다: 깨끗한 것과 약한 변형은 읽고, 센 변형은 못 읽는 가짜 서버
    def handler(request, n):
        strong = b"rotate3" in request.content or b"jpeg3" in request.content
        tune = ARIRANG[:10] if b"doraji" in request.content else ARIRANG
        return httpx.Response(200, json=fallback("no_structure") if strong else recognized(tune))

    client, _ = fake_server(handler)
    assert run.run(client, items, out, tmp_path / "res", log=lambda s: None)["done"] == 10
    rows, summary = report.build(tmp_path / "res", out / "answers.json")
    assert summary["real"]["by_variant"] == {
        "clean": {"n": 2, "normal": 2}, "rotate1": {"n": 2, "normal": 2}, "rotate3": {"n": 2, "normal": 0},
        "jpeg1": {"n": 2, "normal": 2}, "jpeg3": {"n": 2, "normal": 0}}
    md = report.to_markdown(rows, summary)
    assert "### 변형별 정상 변환" in md
    assert "| clean | 2 / 2 | ██ |" in md and "| rotate3 | 0 / 2 | ░░ |" in md
    assert md.index("| clean |") < md.index("| jpeg1 |")                  # 깨끗한 것이 맨 위


def test_generate_fails_clearly_without_clean_sources(tmp_path, capsys):
    with pytest.raises(FileNotFoundError):
        augment.generate(tmp_path, tmp_path / "o", {}, kinds=["blur"], levels=[1])
    answers = tmp_path / "a.json"
    answers.write_text(json.dumps({"staff": {}}), encoding="utf-8")
    assert augment.main(["--out", str(tmp_path / "o"), "--source", str(tmp_path), "--answers", str(answers)]) == 2
    assert "깨끗한 원본" in capsys.readouterr().err


def test_augment_on_the_real_clean_scores_if_present(tmp_path):
    """저장소의 진짜 깨끗한 악보로 한 번 만들어 본다 (그림이 없으면 건너뛴다)."""
    if not (augment.DEFAULT_SOURCE / "real").is_dir():
        pytest.skip("평가 이미지 폴더(evalset/data)가 없다")
    answers = json.loads(augment.DEFAULT_ANSWERS.read_text(encoding="utf-8"))["staff"]
    made = augment.generate(augment.DEFAULT_SOURCE, tmp_path / "aug", answers, kinds=["rotate", "lowres"], levels=[2],
                            log=lambda s: None)
    # 깨끗한 원본은 S01~S05 와 한 줄짜리 S14 — 여섯 장
    assert made == {"images": 18, "sources": 6}
    low = Image.open(tmp_path / "aug" / "real" / "S01_arirang__lowres2.png")
    assert min(low.size) == 800
