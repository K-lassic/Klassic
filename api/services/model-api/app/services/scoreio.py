"""#29~#31 악보 읽기·쓰기와 악기 배정 (music21).

구조에서의 위치: 인식·렌더링 작업자 → 이 파일 → music21·shared 악기 목록. DB·영속 파일은 저장하지 않는다.

- MusicXML ↔ MIDI 변환(엔진이 MIDI 를 주지 않을 때), 원래 악기 읽기(BR-PLY-04).
- 연주 옵션(UC13 A1): 악기 구성 → 성부별 악기(한글 이름 + GM 번호, 타악은 채널 10),
  조옮김(음표 + 조표, 타악 제외), 음량 배율(음표 세기 velocity). MusicXML·MIDI·MP3 에 같은 값이 들어간다.
악기 구성을 성부에 놓는 규칙(웹 score-core applyInstrumentMode 와 같은 뜻):
  선율 악기는 선율 성부에 차례로, 선율 악기가 성부보다 많으면 첫 성부를 복사한 새 성부(melody_copy)에 놓는다.
  타악 악기는 타악 성부에 놓고, 원래 타악 성부가 없으면 만들지 않는다(없는 장단을 지어내지 않는다).
"""

from __future__ import annotations

import copy
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

from app.services.catalog import default_ensemble, instruments

PERCUSSION_CHANNEL = 9  # 0부터 센 채널 → MIDI 채널 10


def parse_musicxml(data: bytes):
    from music21 import converter
    if data.startswith(b"PK\x03\x04"):
        from app.checks.upload import _read_mxl
        data = _read_mxl(data)
    if not data:
        raise ValueError("빈 MusicXML")
    doc = converter.parseData(data.decode("utf-8"), format="musicxml")
    _restore_percussion_ids(doc, data)
    return doc


def _restore_percussion_ids(doc, data):
    """MusicXML의 음표별 instrument id와 1부터 센 midi-unpitched를 보존한다."""
    from music21 import instrument, note
    from music21.midi.percussion import PercussionMapper

    root = ET.fromstring(data)
    for node in root.iter():
        node.tag = node.tag.rsplit("}", 1)[-1]
    pitches = {}
    for inst in root.findall("part-list/score-part/midi-instrument"):
        raw = inst.findtext("midi-unpitched")
        if raw and 1 <= int(raw) <= 128:
            pitches[inst.get("id")] = int(raw) - 1
    mapper = PercussionMapper()
    for source, part in zip(root.findall("part"), doc.parts, strict=False):
        source_notes = [n for n in source.findall("measure/note") if n.find("unpitched") is not None]
        parsed = []
        for event in part.recurse().notes:
            parsed.extend(n for n in (event.notes if event.isChord else [event]) if isinstance(n, note.Unpitched))
        if len(source_notes) != len(parsed):
            continue
        for source_note, parsed_note in zip(source_notes, parsed, strict=True):
            ref = source_note.find("instrument")
            pitch = pitches.get(ref.get("id")) if ref is not None else None
            if pitch is not None:
                try:
                    parsed_note.storedInstrument = mapper.midiPitchToInstrument(pitch)
                except Exception:
                    stored = instrument.UnpitchedPercussion()
                    stored.percMapPitch = pitch
                    parsed_note.storedInstrument = stored


def load_score(data: bytes):
    """MIDI 또는 MusicXML 바이트 → music21 Score."""
    from music21 import converter

    if data[:4] == b"MThd":
        with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as tmp:
            tmp.write(data)
            path = Path(tmp.name)
        try:
            return converter.parse(str(path), format="midi")
        finally:
            path.unlink(missing_ok=True)
    return parse_musicxml(data)


def to_musicxml(score) -> str:
    from music21 import instrument
    from music21.musicxml.m21ToXml import GeneralObjectExporter

    exported = copy.deepcopy(score)
    # MIDI 타악 음표의 storedInstrument도 MusicXML part-list에 등록해야 한다.
    # 음표에만 BassDrum 등이 있으면 music21이 instrumentStream 누락으로 내보내기를 거절한다.
    for part in exported.parts:
        known = {type(inst) for inst in part.recurse().getElementsByClass(instrument.Instrument)}
        for event in part.recurse().notes:
            members = list(event.notes) if event.isChord else [event]
            for member in members:
                inst = member.storedInstrument
                if inst is not None and type(inst) not in known:
                    part.insert(0, copy.deepcopy(inst))
                    known.add(type(inst))
    return GeneralObjectExporter(exported).parse().decode("utf-8")


def to_midi(score) -> bytes:
    from music21 import midi as m21midi

    return m21midi.translate.music21ObjectToMidiFile(score).writestr()


def musicxml_to_midi(musicxml: str) -> bytes:
    return to_midi(parse_musicxml(musicxml.encode("utf-8")))


def count_notes(score) -> int:
    return sum(1 for _ in score.flatten().notes)


def is_percussion_part(part) -> bool:
    from music21 import instrument

    inst = part.getInstrument(returnDefault=False)
    if inst is None:
        return False
    return isinstance(inst, instrument.UnpitchedPercussion) or inst.midiChannel == PERCUSSION_CHANNEL


@dataclass
class SourceInstrument:
    part_no: int
    name: str
    program: int | None
    percussion: bool


def source_instruments(score) -> list[SourceInstrument]:
    """올린 파일에 적힌 원래 악기(FR-056). 이름이 하나도 없으면 빈 목록 = 원래 악기 정보 없음."""
    out: list[SourceInstrument] = []
    for i, part in enumerate(score.parts, start=1):
        inst = part.getInstrument(returnDefault=False)
        name = (inst.instrumentName or inst.partName or "").strip() if inst else ""
        name = name or (part.partName or "").strip()
        program = inst.midiProgram if inst is not None else None
        if name or program is not None:
            out.append(SourceInstrument(i, name[:100] or f"악기 {i}", program, is_percussion_part(part)))
    return out


def _make_instrument(code: str, channel: int):
    from music21 import instrument

    info = instruments()[code]
    inst = instrument.UnpitchedPercussion() if info.is_percussion else instrument.Instrument()
    inst.partName = info.name_ko
    inst.instrumentName = info.name_ko
    inst.partAbbreviation = info.name_ko
    inst.midiProgram = info.gm_program if (info.gm_program is not None and not info.is_percussion) else 0
    inst.midiChannel = PERCUSSION_CHANNEL if info.is_percussion else channel
    return inst


def _set_instrument(part, inst) -> None:
    from music21 import instrument, note

    # 원래의 BassDrum/Snare/HiHat 문맥을 지우기 전에 각 타악 음표에 보존한다.
    # 없애면 music21의 기본 음번호 60으로 뭉개져 장구 음원에서 소리가 나지 않는다.
    for event in part.recurse().notes:
        members = list(event.notes) if event.isChord else [event]
        for member in members:
            if isinstance(member, note.Unpitched) and member.storedInstrument is None:
                original = member.getContextByClass(instrument.UnpitchedPercussion)
                if original is not None:
                    member.storedInstrument = copy.deepcopy(original)

    for old in list(part.recurse().getElementsByClass(instrument.Instrument)):
        old.activeSite.remove(old)
    part.insert(0, inst)
    part.partName = inst.partName


def _melodic_channel(index: int) -> int:
    ch = index % 15
    return ch if ch < PERCUSSION_CHANNEL else ch + 1  # 채널 10(타악) 건너뛰기


def apply_ensemble(score, codes: list[str]) -> list[str]:
    """악기 코드 목록을 성부에 놓는다. 실제로 놓인 코드 목록을 돌려준다.

    타악만의 조합(예: 장구 · 북, 2026-09-29 LLM 추천 규칙 완화로 올 수 있다)이면 선율 성부에 놓을 악기가 없다.
    이때 선율 성부는 기본 구성의 선율 악기(가야금)로 둔다 — 화면 applyCombination(ensemble.ts)과 같다.
    타악 성부가 없는 악보에서는 타악 코드가 놓이지 않으므로 돌려주는 목록에 없다(기록도 놓인 악기만).
    """
    catalog = instruments()
    melodic_codes = [c for c in codes if c in catalog and not catalog[c].is_percussion]
    if not melodic_codes:
        melodic_codes = [c for c in default_ensemble() if c in catalog and not catalog[c].is_percussion][:1]
    perc_codes = [c for c in codes if c in catalog and catalog[c].is_percussion]
    parts = list(score.parts)
    melodic_parts = [p for p in parts if not is_percussion_part(p)]
    perc_parts = [p for p in parts if is_percussion_part(p)]
    used: list[str] = []
    channel = 0
    if melodic_codes and melodic_parts:
        for i, part in enumerate(melodic_parts):
            code = melodic_codes[i % len(melodic_codes)]  # 성부가 더 많으면 악기를 돌려 쓴다
            _set_instrument(part, _make_instrument(code, _melodic_channel(channel)))
            channel += 1
            used.append(code)
        # 선율 악기가 성부보다 많으면 첫 선율 성부를 복사해 새 성부로 더한다(BR-EDT-07 melody_copy)
        for extra, code in enumerate(melodic_codes[len(melodic_parts):], start=1):
            clone = copy.deepcopy(melodic_parts[0])
            clone.id = f"P{len(parts) + extra}"
            _set_instrument(clone, _make_instrument(code, _melodic_channel(channel)))
            channel += 1
            score.insert(0, clone)
            used.append(code)
    if perc_codes:
        for i, part in enumerate(perc_parts):
            code = perc_codes[i % len(perc_codes)]
            _set_instrument(part, _make_instrument(code, PERCUSSION_CHANNEL))
            used.append(code)
    return used


def transpose(score, semitones: int) -> None:
    """타악을 빼고 음표와 조표를 옮긴다."""
    if not semitones:
        return
    for part in score.parts:
        if not is_percussion_part(part):
            part.transpose(semitones, inPlace=True)


def scale_volume(score, factor: float) -> None:
    """음표 세기에 배율을 곱한다(1..127). MusicXML 에는 note dynamics 로 담긴다."""
    if factor == 1.0:
        return
    for n in score.flatten().notes:
        base = n.volume.velocity if n.volume.velocity is not None else 90
        n.volume.velocity = max(1, min(127, round(base * factor)))
