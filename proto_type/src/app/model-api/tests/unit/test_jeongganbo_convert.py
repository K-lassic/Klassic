"""정간보 인코딩 변환기(T041) — 손으로 쓴 인코딩으로 율명·길이·각·실패를 본다."""

from fractions import Fraction

import pytest
from music21 import converter

from app.engines.jeongganbo_convert import ConvertError, convert, parse_encoding, yul_to_midi


def notes_of(xml: str) -> list[tuple[str, Fraction]]:
    s = converter.parseData(xml, format="musicxml")
    out = []
    for n in s.recurse().notesAndRests:
        out.append(("r" if n.isRest else str(n.pitch.midi), Fraction(n.quarterLength)))
    return out


def merged(xml: str) -> list[tuple[str, Fraction]]:
    """붙임줄로 이어진 같은 음은 합쳐서 본다."""
    s = converter.parseData(xml, format="musicxml").stripTies()
    return [("r" if n.isRest else str(n.pitch.midi), Fraction(n.quarterLength)) for n in s.recurse().notesAndRests]


def test_yul_pitches() -> None:
    assert yul_to_midi("황") == 63  # E♭4
    assert yul_to_midi("태") == 65
    assert yul_to_midi("중") == 68  # 중려(옥타브 앞말 아님)
    assert yul_to_midi("임") == yul_to_midi("림") == 70
    assert yul_to_midi("남") == 72
    assert yul_to_midi("청황") == 75
    assert yul_to_midi("중청황") == 87
    assert yul_to_midi("중청중") == 92
    assert yul_to_midi("배임") == 58
    assert yul_to_midi("하배황") == 39
    assert yul_to_midi("황종") == 63
    assert yul_to_midi("가") is None


def test_whole_jeonggan_and_continuation() -> None:
    xml, midi, ratio = convert("황:5|태:5|중:5|-:5")
    assert midi[:4] == b"MThd"
    assert ratio == 1.0
    assert merged(xml) == [("63", 1), ("65", 1), ("68", 2)]
    s = converter.parseData(xml, format="musicxml")
    assert s.recurse().getElementsByClass("TimeSignature")[0].ratioString == "4/4"


def test_three_row_split() -> None:
    # 윗줄 좌우 두 음, 가운데 줄 비움(앞 음 이음), 아랫줄 한 음
    xml, _m, _r = convert("태:1 중:3 황:8")
    assert merged(xml) == [("65", Fraction(1, 6)), ("68", Fraction(1, 2)), ("63", Fraction(1, 3))]


def test_two_row_split_and_rest() -> None:
    xml, _m, _r = convert("남:10 임:11|쉼표:5|황:12 태:13 중:14 임:15")
    assert merged(xml) == [
        ("72", Fraction(1, 2)), ("70", Fraction(1, 2)), ("r", 1),
        ("63", Fraction(1, 4)), ("65", Fraction(1, 4)), ("68", Fraction(1, 4)), ("70", Fraction(1, 4)),
    ]


def test_gak_is_measure_and_tie_across_gak() -> None:
    enc = "황:5|태:5|중:5\n-:5|임:5|남:5"
    xml, _m, _r = convert(enc)
    s = converter.parseData(xml, format="musicxml")
    measures = list(s.parts[0].getElementsByClass("Measure"))
    assert len(measures) == 2
    assert merged(xml)[2] == ("68", 2)  # 각을 넘는 이음은 붙임줄


def test_parts_split_by_blank_line_and_ornaments_ignored() -> None:
    enc = "황_퇴성:5|태:5\n\n청황:5|-:5"
    xml, _m, _r = convert(enc)
    s = converter.parseData(xml, format="musicxml")
    assert len(s.parts) == 2


def test_ratio_counts_non_yul_cells() -> None:
    _p, ratio, n = parse_encoding("황:5|리:5|알수없음:5|-:5")
    assert ratio == 0.5 and n == 1
    _x, _m, r = convert("황:5|리:5|태:5|-:5")
    assert r == 0.75


@pytest.mark.parametrize("bad", ["", "   ", "hello world foo", "리:5|로:5|노:5", "-:5|-:5", "쉼표:5"])
def test_garbage_raises(bad: str) -> None:
    with pytest.raises(ConvertError):
        convert(bad)


def test_jeonggan_length_option() -> None:
    xml, _m, _r = convert("황:5|태:5|중:5", jeonggan_ql=1.5)
    s = converter.parseData(xml, format="musicxml")
    assert s.recurse().getElementsByClass("TimeSignature")[0].ratioString == "9/8"


def test_candidate_or_cell_uses_first_candidate() -> None:
    """(2026-09-30 SD_01 1.10) 엔진이 한 칸에 후보 둘(`A OR B`)을 내면 첫 후보만 쓴다(박예은 팀장 검수 결과).
    전에는 칸을 셋으로 쪼개 2/9 · 4/9박이 생기고 잇단음이 어긋나 화면 악보가 그려지지 않았다(타령 97쪽)."""
    xml, _mid, ratio = convert("황:5|-:5|배중_자출:5 OR 배황:5|태:5")
    assert merged(xml) == [("63", Fraction(2)), ("56", Fraction(1)), ("65", Fraction(1))]  # 배중 = A♭3
    assert "<time-modification>" not in xml and "<tuplet" not in xml
    assert ratio == pytest.approx(1.0)  # 첫 후보를 읽은 칸으로 센다
