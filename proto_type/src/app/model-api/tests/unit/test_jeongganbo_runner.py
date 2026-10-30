"""정간보 러너의 장단 칸 판정 (2026-09-30 SD_01 1.9) — 러너는 엔진 가상환경에서 돌지만 판정 함수는 표준 라이브러리만 쓴다."""

import importlib.util
from pathlib import Path

RUNNER = Path(__file__).resolve().parents[2] / "app" / "engines" / "runners" / "jeongganbo_runner.py"
spec = importlib.util.spec_from_file_location("jeongganbo_runner", RUNNER)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def test_real_jangdan_column_is_skipped() -> None:
    # 장단 칸: 저자 표시 있음 + 율명 없음(엔진은 장단 기호를 '-' 등으로 낸다)
    assert runner.is_jangdan_gak(True, ["-:5", "-:5", "-_미는표:5", ""]) is True


def test_melody_gak_marked_as_jangdan_is_kept() -> None:
    # 거문고 책: 율명 칸이 굵은 줄로 둘러싸여 저자 코드가 장단으로 표시한 선율 각
    assert runner.is_jangdan_gak(True, ["배황_퇴성:5", "-:2 -:5 -:8", "하배임:5"]) is False
    assert runner.is_jangdan_gak(True, ["-:10 배태_자출:11"]) is False


def test_not_flagged_is_never_jangdan() -> None:
    assert runner.is_jangdan_gak(False, ["-:5", "-:5"]) is False


def test_yulmyeong_forms() -> None:
    for tok in ("황:5", "하하배황:5", "중청태:5", "청남_자출:5", "임종:5", "림:5"):
        assert runner.has_yulmyeong([tok]), tok
    for tok in ("-:5", "쉼표:5", "노:5", "OR", "같은음표:5"):
        assert not runner.has_yulmyeong([tok]), tok
