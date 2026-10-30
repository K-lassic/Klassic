"""정간보 인코딩 → MusicXML·MIDI 변환기 (T041, FR-041, UC1 E9).

SejongMusic 저장소에는 라이선스 표기가 없어 **코드를 가져오지 않고**, 정간보 기보 규칙만으로 직접 구현했다.

입력(MALerLab jeongganbo-omr 출력 형식)
- 빈 줄로 나뉜 덩어리 = 성부(파트). 한 줄 = 한 각(=마디). `|` 로 나뉜 칸 = 정간(=한 박).
- 정간 안은 공백으로 나뉜 `<기호>[_<꾸밈>...]:<자리>` 들. 예: `황:5`, `태:1 중:3 황:8`, `-:5`.
- 자리 번호(정간 안 위치)
    * 5 하나뿐 → 정간 전체(1줄)
    * 10·11 → 2줄 나눔의 위·아래, 12·13 / 14·15 → 2줄 각 줄을 좌우로 나눔
    * 1~9 → 3줄 나눔: (자리-1)//3 이 줄, 한 줄 안의 여러 기호는 좌→우 순서로 그 줄을 똑같이 나눈다
  한 정간의 길이는 줄 수로 똑같이 나누고, 한 줄은 그 안의 기호 수로 똑같이 나눈다. 빈 줄은 앞 음을 잇는다.
율명(12율): 황 대 태 협 고 중 유 임(림) 이 남 무 응 — 황종 = E♭4(정악 관례, MIDI 63).
    옥타브 앞말: 청 +1, 중청 +2, 배 -1, 하배 -2, 하하배 -3.
그 밖: `-` 앞 음 이음, `쉼표` 쉼, `같은음표` 앞 음 다시, 구음 시김새(노·니·로·리…)는 앞 음 높이로 다시 친다(근사).
    한 칸에 후보가 여럿(`A OR B`)이면 첫 후보만 쓴다(2026-09-30).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from fractions import Fraction

YUL_BASE: dict[str, int] = {
    "황": 0, "대": 1, "태": 2, "협": 3, "고": 4, "중": 5,
    "유": 6, "임": 7, "림": 7, "이": 8, "남": 9, "무": 10, "응": 11,
}
# 두 글자 정식 이름도 받는다(황종·임종 …)
YUL_FULL: dict[str, str] = {
    "황종": "황", "대려": "대", "태주": "태", "협종": "협", "고선": "고", "중려": "중",
    "유빈": "유", "임종": "임", "림종": "임", "이칙": "이", "남려": "남", "무역": "무", "응종": "응",
}
OCTAVE_PREFIX: list[tuple[str, int]] = [("하하배", -3), ("하배", -2), ("중청", 2), ("배", -1), ("청", 1)]
HWANG_MIDI = 63  # E♭4

CONTINUE_TOKENS = {"-", "ㅡ", "—"}
REST_TOKENS = {"쉼표", "△", "rest"}
SAME_TOKENS = {"같은음표"}
OR_TOKEN = "OR"  # 모델 어휘: 한 칸의 후보 여럿을 잇는 기호
# 길이를 가지는 구음 시김새(앞 음 높이로 근사)
SIGIMSAE_W_DUR = {
    "노", "니", "로", "리", "니나*", "느나", "노라", "느니", "노라느니", "니레나", "네로나", "니로나",
    "니느라니", "느나니나", "느나르나니", "요성표", "겹요성표", "퇴성", "추성",
}
MIN_VALID_RATIO = 0.25  # 이보다 낮으면 인코딩이 아니라 쓰레기로 본다

_ITEM_RE = re.compile(r"^(?P<body>[^:\s]+):(?P<pos>\d{1,2})$")


class ConvertError(Exception):
    """정간보 인코딩을 악보로 바꿀 수 없음 → engine_attempt.outcome = convert_failed"""


def yul_to_midi(token: str) -> int | None:
    """율명 한 개 → MIDI 번호. 율명이 아니면 None."""
    t = token.strip()
    for prefix, octv in OCTAVE_PREFIX + [("", 0)]:
        if prefix and not t.startswith(prefix):
            continue
        rest = t[len(prefix):]
        base = YUL_FULL.get(rest, rest)
        if base in YUL_BASE:
            return HWANG_MIDI + YUL_BASE[base] + 12 * octv
    return None


@dataclass
class _Slot:
    kind: str  # 'note' | 'rest' | 'cont' | 'same'
    midi: int | None
    dur: Fraction


def _layout(positions: list[int]) -> str:
    if len(positions) == 1 and positions[0] == 5:
        return "one"
    if positions and all(p >= 10 for p in positions):
        return "two"
    return "three"


def _row_of(pos: int, layout: str) -> int:
    if layout == "one":
        return 0
    if layout == "two":
        return pos - 10 if pos < 12 else (pos - 12) // 2
    return max(0, min(2, (pos - 1) // 3))


def _classify(body: str) -> tuple[str, int | None, bool]:
    """(종류, midi, 율명 칸으로 셀지). 꾸밈(_...)은 떼고 본다.
    율명·이음(-)·쉼표·같은음표는 율명 칸으로 세고, 구음 시김새와 못 읽은 기호는 세지 않는다."""
    main = body.split("_", 1)[0].strip()
    if main in CONTINUE_TOKENS:
        return "cont", None, True
    if main in REST_TOKENS:
        return "rest", None, True
    if main in SAME_TOKENS:
        return "same", None, True
    midi = yul_to_midi(main)
    if midi is not None:
        return "note", midi, True
    if main in SIGIMSAE_W_DUR:
        return "same", None, False
    return "cont", None, False  # 못 읽은 기호: 박은 지키고(앞 음 이음) 비율에서 뺀다


def _parse_jeonggan(cell: str, beat: Fraction) -> tuple[list[_Slot], bool, bool]:
    """정간 한 칸 → 칸 안 조각들. (조각, 읽힘 여부, 율명 포함 여부)"""
    items = cell.split()
    if not items:
        return [_Slot("cont", None, beat)], False, False
    # 엔진이 한 칸에 후보를 둘 이상 냄("A OR B") — 첫 후보(OR 앞)만 쓴다(2026-09-30 SD_01 1.10, 박예은 팀장 검수).
    # 후보를 모두 한 칸에 넣으면 2/9·4/9박 같은 길이와 어긋난 잇단음이 생겨 화면 악보가 그려지지 않았다.
    if OR_TOKEN in items:
        items = items[: items.index(OR_TOKEN)]
        if not items:
            return [_Slot("cont", None, beat)], False, False
    parsed: list[tuple[int, str, int | None, bool]] = []
    for it in items:
        m = _ITEM_RE.match(it)
        if m:
            kind, midi, ok = _classify(m.group("body"))
            parsed.append((int(m.group("pos")), kind, midi, ok))
        else:
            # 자리 번호 없이 적은 간단한 꼴(예: "황 태")은 3줄 나눔 가운데 칸으로 본다
            kind, midi, ok = _classify(it)
            parsed.append((len(parsed) * 3 + 2 if len(items) > 1 else 5, kind, midi, ok))
    layout = _layout([p for p, *_ in parsed])
    n_rows = {"one": 1, "two": 2, "three": 3}[layout]
    rows: list[list[tuple[int, str, int | None]]] = [[] for _ in range(n_rows)]
    for pos, kind, midi, _ok in parsed:
        rows[_row_of(pos, layout)].append((pos, kind, midi))
    slots: list[_Slot] = []
    row_len = beat / n_rows
    for row in rows:
        if not row:
            slots.append(_Slot("cont", None, row_len))
            continue
        row.sort(key=lambda r: r[0])
        for _pos, kind, midi in row:
            slots.append(_Slot(kind, midi, row_len / len(row)))
    all_ok = all(ok for *_x, ok in parsed)
    has_yul = any(kind == "note" for _p, kind, _m, _ok in parsed)
    return slots, all_ok, has_yul


def _time_signature(total_ql: Fraction) -> str | None:
    if total_ql.denominator == 1:
        return f"{total_ql.numerator}/4"
    if (total_ql * 2).denominator == 1:
        return f"{(total_ql * 2).numerator}/8"
    return None


def parse_encoding(encoding: str, *, jeonggan_ql: Fraction = Fraction(1)) -> tuple[list[list[list[_Slot]]], float, int]:
    """인코딩 → 파트별·각별 조각 목록, 율명 비율, 율명 음 수."""
    parts_text = [blk for blk in re.split(r"\n\s*\n", encoding.strip()) if blk.strip()]
    parts: list[list[list[_Slot]]] = []
    cells = valid = notes = 0
    for blk in parts_text:
        gaks: list[list[_Slot]] = []
        for line in blk.splitlines():
            line = line.strip()
            if not line:
                continue
            gak: list[_Slot] = []
            for cell in line.split("|"):
                slots, ok, _has = _parse_jeonggan(cell, jeonggan_ql)
                cells += 1
                valid += 1 if ok else 0
                notes += sum(1 for s in slots if s.kind == "note")
                gak.extend(slots)
            gaks.append(gak)
        if gaks:
            parts.append(gaks)
    ratio = (valid / cells) if cells else 0.0
    return parts, ratio, notes


def _build_score(parts: list[list[list[_Slot]]], jeonggan_ql: Fraction):
    from music21 import instrument, meter, note, stream, tie

    score = stream.Score()
    for pi, gaks in enumerate(parts):
        part = stream.Part()
        part.partName = "정간보" if len(parts) == 1 else f"정간보 {pi + 1}"
        part.insert(0, instrument.Instrument())
        prev_ts: str | None = None
        last_pitch: int | None = None
        last_el = None  # 직전 음(이음 대상)
        for mi, gak in enumerate(gaks, start=1):
            meas = stream.Measure(number=mi)
            total = sum((s.dur for s in gak), Fraction(0))
            ts = _time_signature(total)
            if ts and ts != prev_ts:
                meas.timeSignature = meter.TimeSignature(ts)
                prev_ts = ts
            for s in gak:
                ql = s.dur
                if s.kind == "cont" and last_el is not None:
                    if last_el.activeSite is meas:
                        last_el.quarterLength = Fraction(last_el.quarterLength) + ql  # 같은 각 안이면 늘인다
                        continue
                    if isinstance(last_el, note.Note):  # 각을 넘으면 붙임줄로 잇는다
                        n = note.Note(midi=last_el.pitch.midi, quarterLength=ql)
                        n.pitch = last_el.pitch
                        last_el.tie = tie.Tie("start" if last_el.tie is None else "continue")
                        n.tie = tie.Tie("stop")
                        meas.append(n)
                        last_el = n
                    else:
                        r = note.Rest(quarterLength=ql)
                        meas.append(r)
                        last_el = r
                    continue
                if s.kind == "note" or (s.kind == "same" and last_pitch is not None):
                    midi = s.midi if s.kind == "note" else last_pitch
                    assert midi is not None
                    n = note.Note(midi=midi, quarterLength=ql)
                    if n.pitch.accidental is not None and n.pitch.accidental.name == "sharp":
                        n.pitch = n.pitch.getEnharmonic()  # 황종 E♭ 기준이라 내림표로 적는다
                    meas.append(n)
                    last_el, last_pitch = n, midi
                else:  # 쉼표 · 첫 음 앞 이음 · 앞 음 없는 시김새
                    r = note.Rest(quarterLength=ql)
                    meas.append(r)
                    last_el = r
            part.append(meas)
        score.insert(0, part)
    return score


def convert(encoding: str, *, jeonggan_ql: float = 1.0) -> tuple[str, bytes, float]:
    """(musicxml, midi, yulmyeong_ratio). 바꿀 수 없으면 ConvertError."""
    if not encoding or not encoding.strip():
        raise ConvertError("빈 인코딩")
    ql = Fraction(jeonggan_ql).limit_denominator(16)
    parts, ratio, n_notes = parse_encoding(encoding, jeonggan_ql=ql)
    if not parts:
        raise ConvertError("각(줄)이 없음")
    if ratio < MIN_VALID_RATIO:
        raise ConvertError(f"율명으로 읽힌 칸이 너무 적음({ratio:.2f})")
    if n_notes == 0:
        raise ConvertError("율명 음이 하나도 없음")
    try:
        from music21.midi.translate import streamToMidiFile
        from music21.musicxml.m21ToXml import GeneralObjectExporter

        score = _build_score(parts, ql)
        musicxml = GeneralObjectExporter(score).parse().decode("utf-8")
        mf = streamToMidiFile(score)
        midi = mf.writestr()
    except ConvertError:
        raise
    except Exception as e:  # music21 이 표현하지 못하는 길이 등
        raise ConvertError(f"악보 만들기 실패: {e}") from e
    return musicxml, bytes(midi), round(ratio, 4)
