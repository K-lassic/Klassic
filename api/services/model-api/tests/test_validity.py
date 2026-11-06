"""인식 결과 타당성 — 여러 쪽 악보의 2쪽 이후 · 피아노 큰보표 회귀 시험 (#177).

구조에서의 위치: services/recognize.py `_check_success` → app/checks/validity.py `check_validity`.
시험 자료는 저작권 문제가 없게 직접 만든 MusicXML 이다.
"""
from app.checks.validity import check_validity

STEPS = ["C", "D", "E", "F", "G", "A", "B"]
TIME = "<time><beats>4</beats><beat-type>4</beat-type></time>"


def _note(step: str, octave: int, beats: int = 1, staff: int | None = None) -> str:
    st = f"<staff>{staff}</staff>" if staff else ""
    return (f"<note><pitch><step>{step}</step><octave>{octave}</octave></pitch>"
            f"<duration>{beats}</duration>{st}</note>")


def _melody(bars: int, octave: int = 4, beats_per_bar: int = 4) -> list[str]:
    """음계를 오르내리는 4분음표 선율 — 마디마다 beats_per_bar 박."""
    return ["".join(_note(STEPS[(b + i) % 7], octave) for i in range(beats_per_bar)) for b in range(bars)]


def _single(bars: list[str], *, time: bool) -> str:
    measures = []
    for i, body in enumerate(bars):
        attrs = f"<attributes><divisions>1</divisions>{TIME if time else ''}</attributes>" if i == 0 else ""
        measures.append(f'<measure number="{i + 1}">{attrs}{body}</measure>')
    return ('<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name>'
            f'</score-part></part-list><part id="P1">{"".join(measures)}</part></score-partwise>')


def _grand(upper: list[str], lower: list[str], *, time: bool) -> str:
    """보표 2개짜리 파트 1개(homr 가 피아노 악보를 내는 모양)."""
    measures = []
    for i, (u, low) in enumerate(zip(upper, lower, strict=True)):
        attrs = (f"<attributes><divisions>1</divisions>{TIME if time else ''}<staves>2</staves>"
                 '<clef number="1"><sign>G</sign><line>2</line></clef>'
                 '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>') if i == 0 else ""
        measures.append(f'<measure number="{i + 1}">{attrs}{u}<backup><duration>4</duration></backup>{low}</measure>')
    return ('<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name>'
            f'</score-part></part-list><part id="P1">{"".join(measures)}</part></score-partwise>')


def _check(xml: str):
    return check_validity(xml, "staff", engine_confidence=None, caution_boundary=None, distrust_boundary=None)


def test_page_without_time_signature_uses_usual_bar_length():
    # 2쪽부터는 박자표가 없다 — 예전에는 beat_sum 0 → 무조건 불신이었다
    with_ts = _check(_single(_melody(8), time=True))
    without_ts = _check(_single(_melody(8), time=False))
    assert without_ts.items["beat_sum"] == with_ts.items["beat_sum"] == 1.0
    assert without_ts.grade == with_ts.grade == "trust"


def test_page_without_time_signature_still_catches_uneven_bars():
    # 박자표가 없어도 마디 길이가 제각각이면(인식이 틀어진 쪽) 박자 점수가 낮다
    bars = [_melody(1, beats_per_bar=n)[0] for n in (4, 3, 5, 2, 6, 3, 5, 7)]
    assert _check(_single(bars, time=False)).items["beat_sum"] < 0.5


def test_grand_staff_range_is_measured_per_staff():
    # 오른손 C5 근처 · 왼손 C2 근처 — 두 손을 합치면 3옥타브를 넘지만 보표마다는 좁다
    upper = ["".join(_note(STEPS[i], 5, staff=1) for i in range(4)) for _ in range(8)]
    lower = ["".join(_note(STEPS[i], 2, staff=2) for i in range(4)) for _ in range(8)]
    verdict = _check(_grand(upper, lower, time=False))
    assert verdict.items["range_leap"] == 1.0
    assert verdict.items["beat_sum"] == 1.0
    assert verdict.grade == "trust"


def test_single_staff_with_huge_range_is_still_penalised():
    # 한 보표 안에서 C1 ~ C7(6옥타브)을 오가면 여전히 깎인다
    bars = ["".join(_note("C", o) for o in (1, 7, 1, 7)) for _ in range(8)]
    verdict = _check(_single(bars, time=True))
    assert verdict.items["range_leap"] == 0.0
    assert verdict.grade == "distrust"
