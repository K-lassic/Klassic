"""구조 확인(T055) — 합성 이미지로 오선보·정간보를 가르고, 공책·표·블라인드·빈 종이·풍경은 거른다."""

import pytest
import synth_images as S
from conftest import FIXTURES

from app.checks.structure import check_structure, judge


def verdict(img, chosen: str, thr: float | None = None):
    return check_structure(S.to_png(img), chosen, thr)


def test_staff_passes() -> None:
    v = verdict(S.staff_image(), "staff")
    assert v.verdict == "pass"
    assert v.detected_type == "staff"
    assert not v.type_mismatch
    assert v.scores["jeongganbo"] < 0.3


def test_single_staff_passes() -> None:
    assert verdict(S.staff_image(n_staves=1), "staff").verdict == "pass"


def test_jeongganbo_passes() -> None:
    v = verdict(S.jeongganbo_image(), "jeongganbo")
    assert v.verdict == "pass"
    assert v.detected_type == "jeongganbo"
    assert v.scores["staff"] < 0.3


def test_type_mismatch_both_ways() -> None:
    v = verdict(S.jeongganbo_image(), "staff")
    assert v.verdict == "fail" and v.type_mismatch and v.detected_type == "jeongganbo"
    v = verdict(S.staff_image(), "jeongganbo")
    assert v.verdict == "fail" and v.type_mismatch and v.detected_type == "staff"


@pytest.mark.parametrize(
    "name",
    ["notebook", "table", "blinds", "blank", "landscape", "manuscript_blank", "square_grid", "jeongganbo_blank"],
)
@pytest.mark.parametrize("chosen", ["staff", "jeongganbo"])
def test_non_scores_rejected(name: str, chosen: str) -> None:
    img = {
        "notebook": S.notebook_image(),
        "table": S.table_image(),
        "blinds": S.blinds_image(),
        "blank": S.blank(),
        "landscape": S.landscape_image(),
        "manuscript_blank": S.staff_image(notes=False),  # 빈 오선지 — 줄은 있지만 악보가 아니다
        "square_grid": S.square_grid_image(),  # 빈 원고지·모눈
        "jeongganbo_blank": S.jeongganbo_image(text=False),  # 빈 정간 격자
    }[name]
    v = verdict(img, chosen)
    assert v.verdict == "fail", (name, v.scores)
    assert not v.type_mismatch
    assert max(v.scores.values()) < 0.3


def test_undecodable_bytes_fail() -> None:
    v = check_structure(b"not an image", "staff", None)
    assert v.verdict == "fail" and v.detected_type is None


def test_shared_fixture_images() -> None:
    assert check_structure((FIXTURES / "ok_staff.png").read_bytes(), "staff", None).verdict == "pass"
    assert check_structure((FIXTURES / "ok_jeongganbo.png").read_bytes(), "jeongganbo", None).verdict == "pass"


def test_judge_boundaries() -> None:
    assert judge({"staff": 0.5, "jeongganbo": 0.0}, "staff", None).verdict == "pass"
    assert judge({"staff": 0.3, "jeongganbo": 0.0}, "staff", None).verdict == "ambiguous"
    assert judge({"staff": 0.29, "jeongganbo": 0.0}, "staff", None).verdict == "fail"
    assert judge({"staff": 0.7, "jeongganbo": 0.0}, "staff", 0.8).verdict == "ambiguous"
    # 다른 종류가 기준 이상이어도 0.25 이상 높지 않으면 불일치 아님
    v = judge({"staff": 0.6, "jeongganbo": 0.8}, "staff", None)
    assert v.verdict == "pass" and not v.type_mismatch
    v = judge({"staff": 0.2, "jeongganbo": 0.9}, "staff", None)
    assert v.type_mismatch and v.detected_type == "jeongganbo"
