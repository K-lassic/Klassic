"""타당성 확인(T056) — 음 개수·박자 합·음역/도약·율명 비율·엔진 확신도 → 등급."""

from xml.etree import ElementTree as ET

from music21 import meter, note, stream
from music21.musicxml.m21ToXml import GeneralObjectExporter

from app.checks.validity import check_validity


def xml_of(pitches: list[str | None], ts: str = "4/4", ql: float = 1.0, broken_measures: int = 0) -> str:
    p = stream.Part()
    p.append(meter.TimeSignature(ts))
    for name in pitches:
        p.append(note.Rest(quarterLength=ql) if name is None else note.Note(name, quarterLength=ql))
    s = stream.Score()
    s.insert(0, p)
    xml = GeneralObjectExporter(s).parse().decode()
    if broken_measures:
        # 내보내기가 빈 박을 쉼표로 채우므로 XML 에서 직접 가운데 마디의 음 하나씩을 뺀다(박자 합 깨기)
        root = ET.fromstring(xml)
        for m in root.iter("measure"):
            if 2 <= int(m.get("number", "0")) <= 1 + broken_measures:
                m.remove(m.findall("note")[-1])
        xml = ET.tostring(root, encoding="unicode")
    return xml


SCALE = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"] * 4


def run(xml: str, **kw):
    args = {"engine_confidence": None, "caution_boundary": None, "distrust_boundary": None}
    args.update(kw)
    st = args.pop("score_type", "staff")
    return check_validity(xml, st, **args)


def test_clean_melody_trusted() -> None:
    v = run(xml_of(SCALE))
    assert run(xml_of(SCALE), engine_confidence=0.99).grade == "trust"
    assert v.items["note_count"] == 32
    assert v.items["beat_sum"] == 1.0
    assert v.items["range_leap"] == 1.0
    assert "yulmyeong_ratio" not in v.items


def test_zero_notes_distrust() -> None:
    v = run(xml_of([None] * 8))
    assert v.grade == "distrust" and v.score == 0.0 and v.items["note_count"] == 0


def test_unparseable_distrust() -> None:
    assert run("<not-musicxml/>").grade == "distrust"


def test_beat_sum_broken_lowers_grade() -> None:
    v = run(xml_of(SCALE, broken_measures=6))
    assert v.items["beat_sum"] < 0.5
    assert v.grade in ("caution", "distrust")


def test_wild_leaps_penalised() -> None:
    wild = ["C2", "C6", "D2", "E6"] * 8
    v = run(xml_of(wild))
    assert v.items["range_leap"] == 0.0
    assert v.grade != "trust"


def test_jeongganbo_uses_yulmyeong_ratio() -> None:
    good = run(xml_of(SCALE), score_type="jeongganbo", yulmyeong_ratio=0.95)
    bad = run(xml_of(SCALE), score_type="jeongganbo", yulmyeong_ratio=0.1)
    assert good.items["yulmyeong_ratio"] == 0.95
    assert bad.score < good.score
    # 오선보에서는 율명 비율을 넣어도 쓰지 않는다
    assert "yulmyeong_ratio" not in run(xml_of(SCALE), yulmyeong_ratio=0.1).items


def test_engine_confidence_and_boundaries() -> None:
    v = run(xml_of(SCALE), engine_confidence=0.2)
    assert v.items["engine_confidence"] == 0.2
    assert v.score < run(xml_of(SCALE), engine_confidence=0.99).score
    # 경계를 올리면 같은 점수라도 등급이 내려간다
    assert run(xml_of(SCALE), engine_confidence=0.99).grade == "trust"
    assert run(xml_of(SCALE), engine_confidence=0.2, caution_boundary=0.99, distrust_boundary=0.98).grade == \
        "distrust"
