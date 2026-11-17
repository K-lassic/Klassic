"""평가셋 채점 — 인식 결과의 음높이를 정답과 견준다 (v0.1.1 evalset/score_pitch.py 를 api/ 기준으로 옮김).

구조에서의 위치: 서비스가 아니다. 평가 도구(evalset/run.py → report.py)만 쓴다. DB · 엔진 · 설정을 읽지 않는다.
    입력은 "인식된 음높이 목록"과 "정답 음높이 목록" 두 개뿐이라, 엔진이 없는 PC 에서도 시험할 수 있다.

v0.1.1 과 같은 것
    일치율 = difflib 시퀀스 유사도(0~1). 리듬 · 박자는 보지 않는다.
    정상 변환 = 대체가 아니고 일치율 0.80 이상.  (기준을 바꾸면 예전 결과와 견줄 수 없으니 그대로 둔다)

더한 것 — 일치율 하나로는 "왜 틀렸는지"를 알 수 없어서
    recall · precision   정답 음 중 맞힌 비율 · 인식한 음 중 맞는 비율 (빠뜨림과 지어냄을 가른다)
    missing · extra · wrong   빠진 음 · 없는 음 · 다른 음으로 읽은 음의 수
    octave_errors        다른 음으로 읽은 것 중 옥타브만 다른 것 (음자리표를 잘못 읽으면 여기가 는다)
    best_shift           인식 결과 전체를 몇 반음 옮기면 가장 잘 맞는가. 0 이 아니면 조표 · 음자리표를 통째로 잘못 읽은 것이다
"""

from __future__ import annotations

import difflib
from dataclasses import asdict, dataclass

NORMAL_THRESHOLD = 0.80

# 통째로 밀린 것을 찾을 때 볼 범위(반음). 옥타브 둘까지.
SHIFT_RANGE = range(-24, 25)
# 옮겼을 때 일치율이 이만큼은 올라야 "통째로 밀렸다"고 본다 (우연히 조금 오르는 것은 무시)
SHIFT_MIN_GAIN = 0.15
# 그리고 옮긴 뒤에는 대부분 맞아야 한다. 짧거나 서로 관계없는 목록은 어느 쪽으로 옮겨도 우연히 몇 음이 맞는다
SHIFT_MIN_RATIO = 0.6


@dataclass(frozen=True)
class PitchScore:
    got: int                # 인식한 음 수
    want: int               # 정답 음 수
    ratio: float            # difflib 유사도 (v0.1.1 의 일치율)
    matched: int            # 순서를 지키며 맞은 음 수
    missing: int            # 정답에는 있는데 빠뜨린 음
    extra: int              # 정답에 없는데 지어낸 음
    wrong: int              # 자리는 맞는데 다른 음으로 읽은 것
    octave_errors: int      # wrong 중 옥타브만 다른 것
    recall: float           # matched / want
    precision: float        # matched / got
    best_shift: int         # 전체를 이만큼(반음) 옮기면 가장 잘 맞는다. 0 = 밀리지 않음
    shifted_ratio: float    # 그렇게 옮겼을 때의 일치율

    @property
    def normal(self) -> bool:
        return self.ratio >= NORMAL_THRESHOLD

    def as_dict(self) -> dict:
        return {**asdict(self), "normal": self.normal}


def similarity(got: list[int], want: list[int]) -> float:
    """v0.1.1 과 같은 일치율. 둘 다 비면 1.0 이 아니라 0.0 으로 본다 (아무것도 못 읽은 것을 만점으로 치지 않는다)."""
    if not got or not want:
        return 0.0
    return difflib.SequenceMatcher(None, got, want, autojunk=False).ratio()


def score_pitches(got: list[int], want: list[int]) -> PitchScore:
    """인식한 음높이 목록과 정답 목록을 견준다. 둘 다 MIDI 번호의 순서 있는 목록."""
    ratio = similarity(got, want)
    matched = missing = extra = wrong = octave = 0
    if got and want:
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, got, want, autojunk=False).get_opcodes():
            if tag == "equal":
                matched += i2 - i1
            elif tag == "delete":           # 인식 결과에만 있다
                extra += i2 - i1
            elif tag == "insert":           # 정답에만 있다
                missing += j2 - j1
            else:                           # replace — 짝지을 수 있는 만큼은 '다른 음', 남는 것은 빠짐/지어냄
                a, b = got[i1:i2], want[j1:j2]
                paired = min(len(a), len(b))
                wrong += paired
                octave += sum(1 for x, y in zip(a, b) if x != y and (x - y) % 12 == 0)
                extra += len(a) - paired
                missing += len(b) - paired
    else:
        missing, extra = len(want), len(got)

    best_shift, shifted = 0, ratio
    if got and want:
        for s in SHIFT_RANGE:
            if s == 0:
                continue
            r = similarity([p + s for p in got], want)
            if r > shifted + 1e-9:
                best_shift, shifted = s, r
        if shifted - ratio < SHIFT_MIN_GAIN or shifted < SHIFT_MIN_RATIO:
            best_shift, shifted = 0, ratio

    return PitchScore(
        got=len(got), want=len(want), ratio=ratio, matched=matched, missing=missing, extra=extra,
        wrong=wrong, octave_errors=octave,
        recall=matched / len(want) if want else 0.0,
        precision=matched / len(got) if got else 0.0,
        best_shift=best_shift, shifted_ratio=shifted,
    )


def pitches_of_musicxml(text: str) -> list[int]:
    """MusicXML 문자열 → 음높이(MIDI 번호) 목록. 화음은 음마다 센다 (v0.1.1 과 같은 규칙).

    music21 은 여기서만 불러온다 — 채점 함수만 쓰는 시험은 music21 없이도 돈다.
    """
    from music21 import converter

    out: list[int] = []
    for n in converter.parseData(text, format="musicxml").recurse().notes:
        if n.isChord:
            out.extend(int(p.midi) for p in n.pitches)
        elif hasattr(n, "pitch"):           # 타악(Unpitched)은 음높이가 없다
            out.append(int(n.pitch.midi))
    return out
