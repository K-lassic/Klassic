"""구조 확인 사진 보정(T153) — 평가셋 실사진(기울기·원근·흐림·저대비)은 통과, 가짜 20장은 계속 막힌다.

평가셋 폴더(app/evalset/real, app/evalset/fake)가 없으면 건너뛴다.
"""

from pathlib import Path

import pytest

from app.checks.structure import DEFAULT_THRESHOLD, check_structure

EVALSET = Path(__file__).resolve().parents[3] / "evalset"
REAL = sorted((EVALSET / "real").glob("S*.*")) if (EVALSET / "real").is_dir() else []
FAKE = sorted((EVALSET / "fake").glob("F*.*")) if (EVALSET / "fake").is_dir() else []

needs_real = pytest.mark.skipif(not REAL, reason="evalset/real 없음")
needs_fake = pytest.mark.skipif(not FAKE, reason="evalset/fake 없음")


@needs_real
@pytest.mark.parametrize("path", REAL, ids=lambda p: p.name)
def test_real_staff_images_pass(path: Path) -> None:
    v = check_structure(path.read_bytes(), "staff", DEFAULT_THRESHOLD)
    assert v.verdict == "pass", (path.name, v.scores, v.details)
    assert not v.type_mismatch


@needs_fake
@pytest.mark.parametrize("chosen", ["staff", "jeongganbo"])
@pytest.mark.parametrize("path", FAKE, ids=lambda p: p.name)
def test_fake_images_blocked(path: Path, chosen: str) -> None:
    v = check_structure(path.read_bytes(), chosen, DEFAULT_THRESHOLD)
    assert v.scores[chosen] < DEFAULT_THRESHOLD, (path.name, v.scores, v.details)
    assert v.verdict != "pass"
    if chosen == "staff":  # 오선보로 골랐을 때는 애매(ambiguous)도 없이 모두 막힌다(빈 오선지+마디줄 F10 포함)
        assert v.verdict == "fail", (path.name, v.scores, v.details)


@needs_real
def test_rotated_photo_is_deskewed() -> None:
    path = EVALSET / "real" / "S06_photo_rot3_arirang.jpg"
    if not path.exists():
        pytest.skip("S06 없음")
    v = check_structure(path.read_bytes(), "staff", DEFAULT_THRESHOLD)
    assert v.verdict == "pass"
    assert abs(v.details["staff"].get("deskew_deg", 0.0)) >= 2.0
