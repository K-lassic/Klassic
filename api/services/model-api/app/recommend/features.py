"""#88 추천용 악보 특징 — 빠르기 · 선법 · 음역 · 음표 밀도.

구조에서의 위치: (아직 연결 안 됨) /v1/recommend → 이 파일 → rules.py. DB · 엔진 · 설정을 읽지 않는다. 악보 바이트만 받는다.
    v0.1.1 app/recommend/features.py 를 옮겼다. 달라진 것은 MIDI 읽기뿐이다 —
    v0.1.1 은 pretty_midi 를 썼는데 재구성 model-api 의 의존성에는 없다. 이미 있는 mido 로 읽는다.

- 빠르기: 4분음표 BPM 으로 느림(<70) · 보통(70~110) · 빠름(>110). 빠르기 표시가 없으면 BPM 없음 → 보통.
- 선법: 음 길이로 가중한 음이름 분포를 으뜸음 후보(마지막 음 · 가장 많이 나온 음) 기준으로 두 틀에 맞춰 본다.
    평조(솔선법 꼴) {0,2,5,7,9} · 계면조(라선법 꼴) {0,3,5,7,10}. 둘 다 잘 안 맞으면 unknown.
    [추정] 규칙 기반 근사이며 국악 전공 팀원 확인 전이다 (rules.yaml 의 status: draft 와 같은 상태).
- 음역: 가장 낮은 음 ~ 가장 높은 음. 음표 밀도: 초당 음표 수. 타악 성부는 뺀다.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field

PYEONGJO = frozenset({0, 2, 5, 7, 9})
GYEMYEONJO = frozenset({0, 3, 5, 7, 10})
TEMPO_LABEL = {"slow": "느림", "medium": "보통", "fast": "빠름"}
MODE_LABEL = {"pyeongjo": "평조", "gyemyeonjo": "계면조", "unknown": "알 수 없음"}

SLOW_BELOW = 70
FAST_ABOVE = 110
MODE_MIN_FIT = 0.7          # 틀에 든 음의 비중이 이만큼은 돼야 그 선법이라고 한다
MODE_TIE = 0.05             # 두 틀의 비중 차이가 이보다 작으면 셋째 음으로 가른다
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


class FeatureError(ValueError):
    """악보에서 특징을 뽑지 못했다 (음표 없음 · 읽기 실패)."""


@dataclass
class Features:
    bpm: float | None
    tempo: str                  # slow | medium | fast
    mode: str                   # pyeongjo | gyemyeonjo | unknown
    range_low: int
    range_high: int
    range: str
    density: float
    note_count: int
    # 음높이(MIDI 번호) → 그 음이 울린 길이의 합(초). 악기 음역과 견줄 때 쓴다. 응답에는 싣지 않는다.
    pitch_seconds: dict[int, float] = field(default_factory=dict, repr=False)

    def public(self) -> dict:
        """계약 RecommendationFeatures 모양."""
        return {
            "tempo": self.tempo, "tempo_label": TEMPO_LABEL[self.tempo], "bpm": self.bpm,
            "mode": self.mode, "mode_label": MODE_LABEL[self.mode], "range": self.range,
            "range_semitones": self.range_high - self.range_low, "density": self.density,
        }


def note_name(num: int) -> str:
    """60 → 'C4' (pretty_midi.note_number_to_name 과 같은 표기)."""
    return f"{NOTE_NAMES[num % 12]}{num // 12 - 1}"


def tempo_class(bpm: float | None) -> str:
    if bpm is None:
        return "medium"
    if bpm < SLOW_BELOW:
        return "slow"
    if bpm > FAST_ABOVE:
        return "fast"
    return "medium"


def estimate_mode(weights: dict[int, float], final_pc: int | None) -> str:
    """음이름(0~11)별 비중과 마지막 음으로 선법을 어림한다."""
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
        if abs(p - g) < MODE_TIE:
            # 거의 같으면 셋째 음으로 가른다: 단3도(계면) · 장2도/장3도(평조)
            mode, fit = ("gyemyeonjo", g) if rel.get(3, 0) > rel.get(4, 0) + rel.get(2, 0) * 0.5 else ("pyeongjo", p)
        else:
            mode, fit = ("pyeongjo", p) if p > g else ("gyemyeonjo", g)
        if fit > best_fit:
            best_mode, best_fit = mode, fit
        if tonic == final_pc and fit >= 0.8:
            break               # 마지막 음 기준으로 잘 맞으면 그것을 쓴다
    return best_mode if best_fit >= MODE_MIN_FIT else "unknown"


def finish(bpm: float | None, notes: list[tuple[float, float, int]], duration_s: float) -> Features:
    """notes: (시작 초, 길이 초, 음번호)."""
    if not notes:
        raise FeatureError("음표가 없습니다")
    weights: dict[int, float] = {}
    by_pitch: dict[int, float] = {}
    for _, dur, pitch in notes:
        d = max(dur, 0.01)
        weights[pitch % 12] = weights.get(pitch % 12, 0.0) + d
        by_pitch[pitch] = by_pitch.get(pitch, 0.0) + d
    last_start = max(n[0] for n in notes)
    final_pc = min(n[2] for n in notes if n[0] == last_start) % 12      # 마지막 화음의 가장 낮은 음
    lo, hi = min(by_pitch), max(by_pitch)
    return Features(
        bpm=round(bpm, 1) if bpm else None, tempo=tempo_class(bpm), mode=estimate_mode(weights, final_pc),
        range_low=lo, range_high=hi, range=f"{note_name(lo)}–{note_name(hi)} ({hi - lo}반음)",
        density=round(len(notes) / duration_s, 3) if duration_s > 0 else 0.0,
        note_count=len(notes), pitch_seconds=by_pitch,
    )


def from_midi(data: bytes) -> Features:
    import mido

    try:
        mid = mido.MidiFile(file=io.BytesIO(data))
    except Exception as exc:  # noqa: BLE001 — mido 는 깨진 파일에 여러 종류의 예외를 낸다
        raise FeatureError(f"MIDI 를 읽지 못했습니다: {type(exc).__name__}") from exc
    ppq = mid.ticks_per_beat or 480
    tempo_us = 500000                   # 빠르기 이벤트가 없을 때의 MIDI 기본값(120 BPM) — 초 계산에만 쓴다
    bpm: float | None = None
    now = 0.0
    open_notes: dict[tuple[int, int], list[float]] = {}
    notes: list[tuple[float, float, int]] = []
    try:
        for msg in mido.merge_tracks(mid.tracks):
            now += mido.tick2second(msg.time, ppq, tempo_us)
            if msg.type == "set_tempo":
                tempo_us = msg.tempo
                if bpm is None:
                    bpm = mido.tempo2bpm(msg.tempo)
            elif msg.type in ("note_on", "note_off") and msg.channel != 9:          # 채널 10(0부터 세면 9) = 타악
                key = (msg.channel, msg.note)
                if msg.type == "note_on" and msg.velocity > 0:
                    open_notes.setdefault(key, []).append(now)
                elif open_notes.get(key):
                    start = open_notes[key].pop(0)
                    notes.append((start, now - start, msg.note))
    except Exception as exc:  # noqa: BLE001
        raise FeatureError(f"MIDI 를 읽지 못했습니다: {type(exc).__name__}") from exc
    return finish(bpm, notes, now)


def from_musicxml(data: bytes) -> Features:
    from music21 import converter, instrument, tempo

    try:
        if data[:4] == b"PK\x03\x04":
            # 압축 MusicXML(.mxl) — music21 은 파일 이름으로 형식을 가리므로 임시 파일을 거친다
            import tempfile
            from pathlib import Path

            with tempfile.NamedTemporaryFile(suffix=".mxl", delete=False) as tmp:
                tmp.write(data)
                path = Path(tmp.name)
            try:
                score = converter.parse(str(path), format="musicxml")
            finally:
                path.unlink(missing_ok=True)
        else:
            score = converter.parseData(data.decode("utf-8-sig"), format="musicxml")
    except Exception as exc:  # noqa: BLE001 — music21 파서 예외는 종류가 많다
        raise FeatureError(f"MusicXML 을 읽지 못했습니다: {type(exc).__name__}") from exc

    # 빠르기 표시가 실제로 있을 때만 BPM 으로 쓴다 (metronomeMarkBoundaries 는 없으면 120 을 지어낸다)
    marks = list(score.recurse().getElementsByClass(tempo.MetronomeMark))
    bpm = None
    if marks and marks[0].number:
        try:
            bpm = float(marks[0].getQuarterBPM() or marks[0].number)
        except Exception:  # noqa: BLE001
            bpm = float(marks[0].number)
    sec_per_q = 60.0 / (bpm or 120.0)   # 초 계산용 (표시 BPM 은 없음으로 둔다)
    notes: list[tuple[float, float, int]] = []
    parts = list(score.parts) or [score]
    for part in parts:
        inst = part.getInstrument(returnDefault=False)
        if isinstance(inst, instrument.UnpitchedPercussion) or (inst is not None and inst.midiChannel == 9):
            continue
        # 붙임줄로 이어진 음은 한 음으로 센다. 안 그러면 마디를 넘는 음이 둘로 세어져 MIDI 로 읽은 것과 음 수 · 밀도가 달라진다
        for el in part.stripTies().flatten().notes:
            start = float(el.offset) * sec_per_q
            dur = float(el.quarterLength) * sec_per_q
            for p in getattr(el, "pitches", ()):
                notes.append((start, dur, int(p.midi)))
    return finish(bpm, notes, float(score.highestTime) * sec_per_q)


def extract(data: bytes) -> Features:
    """파일 내용의 첫 바이트로 MIDI / MusicXML 을 가른다."""
    if data[:4] == b"MThd":
        return from_midi(data)
    return from_musicxml(data)
