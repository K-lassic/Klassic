"""인식 결과 타당성 확인 (T056, FR-059, research R16).

music21 로 인식 결과(MusicXML)를 읽어 항목별 값을 재고, 가중 평균 점수(0..1)를 경계와 비교해
신뢰(trust) / 주의(caution) / 불신(distrust)을 정한다. 항목 이름은 validity_check_item.item_code 와 같다.

항목 값(items)
- note_count      : 음 개수(화음은 음마다). 0 이면 무조건 불신.
- beat_sum        : 박자표와 길이가 맞는 마디의 비율(첫·끝 못갖춘마디는 짧아도 맞음으로 본다)
- range_leap      : 1 − 벌점. 음역이 3옥타브를 넘거나, 옥타브보다 큰 도약이 많으면 깎인다
- yulmyeong_ratio : (정간보만) 율명으로 읽힌 칸 비율 — 변환기가 준 값
- engine_confidence: 엔진 확신도(있을 때)
점수 = 가중 평균 × (0.5 + 0.5 × 가장 낮은 항목 점수)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import pairwise

DEFAULT_CAUTION = 0.7
DEFAULT_DISTRUST = 0.4

# 항목 가중치(없는 항목은 빼고 나머지로 다시 나눈다)
WEIGHTS: dict[str, float] = {
    "note_count": 0.2,
    "beat_sum": 0.3,
    "range_leap": 0.2,
    "yulmyeong_ratio": 0.2,
    "engine_confidence": 0.1,
}
NOTE_COUNT_FULL = 16  # 이만큼 음이 있으면 음 개수 점수 만점
RANGE_OK_SEMITONES = 36  # 3옥타브
LEAP_SEMITONES = 12


@dataclass
class ValidityVerdict:
    grade: str  # 'trust' | 'caution' | 'distrust'
    items: dict[str, float] = field(default_factory=dict)
    score: float = 0.0


def _grade(score: float, caution: float, distrust: float) -> str:
    if score >= caution:
        return "trust"
    if score >= distrust:
        return "caution"
    return "distrust"


def _measure_beat_ratio(score) -> float:
    """박자표 길이와 맞는 마디 비율. 마디가 없으면 0."""
    from music21 import stream

    total = ok = 0
    for part in score.parts if hasattr(score, "parts") and score.parts else [score]:
        measures = list(part.getElementsByClass(stream.Measure))
        n = len(measures)
        for i, m in enumerate(measures):
            ts = m.timeSignature or m.getContextByClass("TimeSignature")
            if ts is None:
                continue
            bar = float(ts.barDuration.quarterLength)
            # 여러 성부(voice)가 있으면 가장 긴 성부 길이
            voices = list(m.voices)
            length = max((float(v.highestTime) for v in voices), default=float(m.highestTime))
            total += 1
            if abs(length - bar) < 1e-3:
                ok += 1
            elif (i == 0 or i == n - 1) and 0 < length < bar:
                ok += 1  # 못갖춘마디
    return ok / total if total else 0.0


def _range_leap(score) -> float:
    """1 − 벌점(음역 벌점과 큰 도약 벌점 중 큰 쪽이 아니라 곱으로 깎는다)."""
    quality = 1.0
    parts = score.parts if hasattr(score, "parts") and score.parts else [score]
    all_midis: list[int] = []
    leaps = steps = 0
    for part in parts:
        seq: list[int] = []
        for el in part.recurse().notes:
            ps = [p.midi for p in el.pitches]
            if ps:
                seq.append(max(ps))  # 윗소리 기준으로 도약을 본다
                all_midis.extend(ps)
        for a, b in pairwise(seq):
            steps += 1
            if abs(b - a) > LEAP_SEMITONES:
                leaps += 1
    if all_midis:
        span = max(all_midis) - min(all_midis)
        range_pen = min(1.0, max(0, span - RANGE_OK_SEMITONES) / 24)
        quality *= 1.0 - range_pen
    if steps:
        leap_pen = min(1.0, (leaps / steps) * 4)  # 큰 도약이 25% 면 0점
        quality *= 1.0 - leap_pen
    return max(0.0, min(1.0, quality))


def check_validity(
    musicxml: str,
    score_type: str,
    *,
    engine_confidence: float | None,
    caution_boundary: float | None,
    distrust_boundary: float | None,
    yulmyeong_ratio: float | None = None,
) -> ValidityVerdict:
    caution = DEFAULT_CAUTION if caution_boundary is None else float(caution_boundary)
    distrust = DEFAULT_DISTRUST if distrust_boundary is None else float(distrust_boundary)

    try:
        from music21 import converter

        score = converter.parseData(musicxml, format="musicxml")
    # music21 파서 예외는 종류가 많다 — 읽지 못하면 불신
    except Exception:  # noqa: BLE001
        return ValidityVerdict(grade="distrust", items={"note_count": 0.0}, score=0.0)

    note_count = sum(len(el.pitches) for el in score.recurse().notes)
    items: dict[str, float] = {"note_count": float(note_count)}
    if note_count == 0:
        items["beat_sum"] = 0.0
        return ValidityVerdict(grade="distrust", items=items, score=0.0)

    items["beat_sum"] = round(_measure_beat_ratio(score), 4)
    items["range_leap"] = round(_range_leap(score), 4)
    if score_type == "jeongganbo" and yulmyeong_ratio is not None:
        items["yulmyeong_ratio"] = round(max(0.0, min(1.0, float(yulmyeong_ratio))), 4)
    if engine_confidence is not None:
        items["engine_confidence"] = round(max(0.0, min(1.0, float(engine_confidence))), 4)

    parts: dict[str, float] = {
        "note_count": min(1.0, note_count / NOTE_COUNT_FULL),
        "beat_sum": items["beat_sum"],
        "range_leap": items["range_leap"],
    }
    if "yulmyeong_ratio" in items:
        parts["yulmyeong_ratio"] = items["yulmyeong_ratio"]
    if "engine_confidence" in items:
        parts["engine_confidence"] = items["engine_confidence"]
    wsum = sum(WEIGHTS[k] for k in parts)
    mean = sum(WEIGHTS[k] * v for k, v in parts.items()) / wsum
    # 한 항목이라도 크게 틀리면(예: 도약투성이) 평균이 좋아도 믿지 않게 가장 약한 항목으로 한 번 더 깎는다
    score_val = mean * (0.5 + 0.5 * min(parts.values()))
    score_val = round(max(0.0, min(1.0, score_val)), 4)
    return ValidityVerdict(grade=_grade(score_val, caution, distrust), items=items, score=score_val)
