"""추천용 악보 특징 추출 (T087, research R18).

- 빠르기: BPM 구간 느림(<70) · 보통(70~110) · 빠름(>110). 빠르기 표시가 없는 MusicXML 은 BPM 없음 → 보통.
- 선법: 음 길이로 가중한 음이름 분포를 마지막 음(으뜸음 후보) 기준으로 두 틀에 맞춰 본다.
    평조(솔선법 꼴) {0,2,5,7,9}, 계면조(라선법 꼴) {0,3,5,7,10}. 둘 다 잘 안 맞으면 unknown.
  [추정] 규칙 기반 근사이며 국악 전공 팀원 확인 전이다.
- 음역: 가장 낮은 음~가장 높은 음(반음 수), 음표 밀도: 초당 음표 수.
MIDI 는 pretty_midi, MusicXML 은 music21 로 읽는다.
"""

from __future__ import annotations

import io
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path

PYEONGJO = {0, 2, 5, 7, 9}
GYEMYEONJO = {0, 3, 5, 7, 10}
TEMPO_LABEL = {"slow": "느림", "medium": "보통", "fast": "빠름"}
MODE_LABEL = {"pyeongjo": "평조", "gyemyeonjo": "계면조", "unknown": "알 수 없음"}


class FeatureError(ValueError):
    """악보에서 특징을 뽑지 못했다(음표 없음·읽기 실패)."""


@dataclass
class Features:
    bpm: float | None
    tempo: str  # slow | medium | fast
    mode: str  # pyeongjo | gyemyeonjo | unknown
    range_low: int
    range_high: int
    range: str
    density: float
    note_count: int

    def public(self) -> dict:
        """INTERFACES §4 Recommendation.features 모양(+ 한국어 표시 이름)."""
        return {
            "tempo": self.tempo, "tempo_label": TEMPO_LABEL[self.tempo], "bpm": self.bpm,
            "mode": self.mode, "mode_label": MODE_LABEL[self.mode], "range": self.range,
            "range_semitones": self.range_high - self.range_low, "density": self.density,
        }

    def as_dict(self) -> dict:
        return asdict(self)


def tempo_class(bpm: float | None) -> str:
    if bpm is None:
        return "medium"
    if bpm < 70:
        return "slow"
    if bpm > 110:
        return "fast"
    return "medium"


def estimate_mode(weights: dict[int, float], final_pc: int | None) -> str:
    total = sum(weights.values())
    if total <= 0:
        return "unknown"
    candidates = [final_pc] if final_pc is not None else []
    top = max(weights, key=weights.get)
    if top not in candidates:
        candidates.append(top)
    best_mode, best_fit = "unknown", 0.0
    for tonic in candidates:
        rel = {(pc - tonic) % 12: w for pc, w in weights.items()}
        p = sum(w for pc, w in rel.items() if pc in PYEONGJO) / total
        g = sum(w for pc, w in rel.items() if pc in GYEMYEONJO) / total
        if abs(p - g) < 0.05:
            # 거의 같으면 셋째 음으로 가른다: 단3도(계면) · 장2도/장3도(평조)
            mode, fit = ("gyemyeonjo", g) if rel.get(3, 0) > rel.get(4, 0) + rel.get(2, 0) * 0.5 else ("pyeongjo", p)
        else:
            mode, fit = ("pyeongjo", p) if p > g else ("gyemyeonjo", g)
        if fit > best_fit:
            best_mode, best_fit = mode, fit
        if tonic == final_pc and fit >= 0.8:
            break  # 마지막 음 기준으로 잘 맞으면 그것을 쓴다
    return best_mode if best_fit >= 0.7 else "unknown"


def _note_name(num: int) -> str:
    import pretty_midi

    return pretty_midi.note_number_to_name(num)


def _finish(bpm: float | None, notes: list[tuple[float, float, int]], duration_s: float) -> Features:
    """notes: (시작 초, 길이 초, 음번호)."""
    if not notes:
        raise FeatureError("음표가 없습니다")
    pitches = [n[2] for n in notes]
    weights: dict[int, float] = {}
    for _, dur, pitch in notes:
        weights[pitch % 12] = weights.get(pitch % 12, 0.0) + max(dur, 0.01)
    last_start = max(n[0] for n in notes)
    final_pc = min(n[2] for n in notes if n[0] == last_start) % 12
    lo, hi = min(pitches), max(pitches)
    density = round(len(notes) / duration_s, 3) if duration_s > 0 else 0.0
    return Features(
        bpm=round(bpm, 1) if bpm else None, tempo=tempo_class(bpm), mode=estimate_mode(weights, final_pc),
        range_low=lo, range_high=hi, range=f"{_note_name(lo)}–{_note_name(hi)} ({hi - lo}반음)",
        density=density, note_count=len(notes),
    )


def from_midi(data: bytes) -> Features:
    import pretty_midi

    try:
        pm = pretty_midi.PrettyMIDI(io.BytesIO(data))
    except Exception as exc:
        raise FeatureError(f"MIDI 를 읽지 못했습니다: {exc}") from exc
    _, tempi = pm.get_tempo_changes()
    bpm = float(tempi[0]) if len(tempi) else None
    notes = [(n.start, n.end - n.start, n.pitch) for inst in pm.instruments if not inst.is_drum for n in inst.notes]
    return _finish(bpm, notes, pm.get_end_time())


def parse_musicxml(data: bytes):
    """music21 으로 MusicXML(.xml·.musicxml·압축 .mxl) 을 읽는다."""
    from music21 import converter

    suffix = ".mxl" if data[:4] == b"PK\x03\x04" else ".musicxml"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        path = Path(tmp.name)
    try:
        return converter.parse(str(path), format="musicxml")
    finally:
        path.unlink(missing_ok=True)


def from_musicxml(data: bytes) -> Features:
    try:
        score = parse_musicxml(data)
    except Exception as exc:
        raise FeatureError(f"MusicXML 을 읽지 못했습니다: {exc}") from exc
    from music21 import tempo

    # 빠르기 표시가 실제로 있을 때만 BPM 으로 쓴다(metronomeMarkBoundaries 는 없으면 120 을 지어낸다)
    marks = list(score.recurse().getElementsByClass(tempo.MetronomeMark))
    bpm = None
    if marks and marks[0].number:
        try:
            bpm = float(marks[0].getQuarterBPM() or marks[0].number)
        except Exception:  # noqa: BLE001
            bpm = float(marks[0].number)
    qbpm = bpm or 120.0  # 초 계산용(표시 BPM 은 없음으로 둔다)
    sec_per_q = 60.0 / qbpm
    notes: list[tuple[float, float, int]] = []
    for part in score.parts:
        if _is_percussion_part(part):
            continue
        for el in part.flatten().notes:
            start = float(el.offset) * sec_per_q
            dur = float(el.quarterLength) * sec_per_q
            for p in getattr(el, "pitches", ()):
                notes.append((start, dur, int(p.midi)))
    duration = float(score.highestTime) * sec_per_q
    return _finish(bpm, notes, duration)


def _is_percussion_part(part) -> bool:
    from music21 import instrument

    inst = part.getInstrument(returnDefault=False)
    return isinstance(inst, instrument.UnpitchedPercussion) or (inst is not None and inst.midiChannel == 9)


def extract(data: bytes) -> Features:
    """파일 내용의 첫 바이트로 MIDI/MusicXML 을 가른다."""
    if data[:4] == b"MThd":
        return from_midi(data)
    return from_musicxml(data)
