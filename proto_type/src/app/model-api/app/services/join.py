"""쪽 이어 붙이기 (2026-09-29 황송해 결정 — 여러 쪽, SD_01 1.12a · UC1 A9 · BR-FBK-08).

변환한 쪽들(MusicXML, 올린 순서)을 악보 한 곡의 MusicXML 하나로 잇는다.
- 마디를 쪽 순서대로 뒤에 붙인다(쪽의 첫 마디에 있는 박자·조표·음자리표 attributes 는 그대로 둔다).
- 성부(part)는 순서로 맞춘다: 쪽마다 n 번째 성부를 결과의 n 번째 성부 뒤에 붙인다.
  쪽마다 성부 수가 다르면 가장 많은 수에 맞추고, 없는 성부는 그 쪽 첫 성부의 마디 길이만큼 온쉼표 마디로 채운다.
  한 쪽 안에서 성부마다 마디 수가 다르면 가장 긴 성부에 맞춰 뒤를 쉼표 마디로 채운다.
- 마디 번호는 1부터 다시 매긴다(못갖춘마디 표시 implicit 는 맨 앞 마디에만 남긴다).
- 첫 쪽의 머리(제목·part-list·defaults)를 쓴다. 새로 생긴 성부의 score-part 는 그 성부가 처음 나온 쪽에서 가져온다.
score-timewise 는 music21 로 partwise 로 바꾼 뒤 잇는다. MIDI 는 이은 MusicXML 에서 만든다(scoreio.musicxml_to_midi).
"""

from __future__ import annotations

import copy
import xml.etree.ElementTree as ET

DOCTYPE = ('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
           '"http://www.musicxml.org/dtds/partwise.dtd">')


def _partwise(xml: str) -> ET.Element:
    root = ET.fromstring(xml.encode("utf-8") if isinstance(xml, str) else xml)
    if root.tag == "score-partwise":
        return root
    if root.tag == "score-timewise":
        from app.services import scoreio

        score = scoreio.load_score(xml.encode("utf-8"))
        return ET.fromstring(scoreio.to_musicxml(score).encode("utf-8"))
    raise ValueError(f"MusicXML 이 아님: <{root.tag}>")


def _measure_length(measure: ET.Element) -> int:
    """마디 안 가장 먼 위치(divisions 단위) — note(화음·꾸밈음 제외) · forward 는 앞으로, backup 은 뒤로."""
    pos = best = 0
    for el in measure:
        if el.tag == "note":
            if el.find("chord") is not None or el.find("grace") is not None:
                continue
            d = el.findtext("duration")
            pos += int(float(d)) if d else 0
        elif el.tag == "forward":
            pos += int(float(el.findtext("duration") or 0))
        elif el.tag == "backup":
            pos -= int(float(el.findtext("duration") or 0))
        best = max(best, pos)
    return best


class _AttrState:
    """성부를 따라가며 지금 걸린 divisions · 박자 · 조표 · 음자리표."""

    def __init__(self) -> None:
        self.divisions: int | None = None
        self.time: ET.Element | None = None
        self.key: ET.Element | None = None
        self.clef: ET.Element | None = None

    def update(self, measure: ET.Element) -> None:
        for attrs in measure.findall("attributes"):
            d = attrs.findtext("divisions")
            if d:
                self.divisions = int(float(d))
            for name in ("time", "key", "clef"):
                el = attrs.find(name)
                if el is not None:
                    setattr(self, name, copy.deepcopy(el))

    def nominal_length(self) -> int:
        div = self.divisions or 1
        if self.time is not None:
            try:
                beats = sum(int(b) for b in (self.time.findtext("beats") or "4").split("+"))
                beat_type = int(self.time.findtext("beat-type") or 4)
                return max(1, beats * div * 4 // beat_type)
            except ValueError:
                pass
        return 4 * div


def _rest_measures(ref_measures: list[ET.Element], count: int, first_in_part: bool, start: int = 0) -> list[ET.Element]:
    """ref_measures(그 쪽 기준 성부)의 start 번째 마디부터 길이를 따라 온쉼표 마디 count 개.
    앞 마디(start 전)의 divisions·박자를 이어받고, 쉼표 마디의 첫 마디에 divisions·박자를 적는다."""
    out: list[ET.Element] = []
    state = _AttrState()
    for m in ref_measures[:start]:
        state.update(m)
    last_time = None
    for i in range(count):
        k = start + i
        ref = ref_measures[k] if k < len(ref_measures) else None
        if ref is not None:
            state.update(ref)
        length = (_measure_length(ref) if ref is not None else 0) or state.nominal_length()
        m = ET.Element("measure", {"number": "0"})
        time_changed = state.time is not None and (last_time is None or ET.tostring(state.time) != last_time)
        if i == 0 or time_changed:
            attrs = ET.SubElement(m, "attributes")
            ET.SubElement(attrs, "divisions").text = str(state.divisions or 1)
            if first_in_part and i == 0 and state.key is not None:
                attrs.append(copy.deepcopy(state.key))
            if state.time is not None:
                attrs.append(copy.deepcopy(state.time))
            if first_in_part and i == 0 and state.clef is not None:
                attrs.append(copy.deepcopy(state.clef))
            last_time = ET.tostring(state.time) if state.time is not None else None
        note = ET.SubElement(m, "note")
        ET.SubElement(note, "rest", {"measure": "yes"})
        ET.SubElement(note, "duration").text = str(length)
        ET.SubElement(note, "voice").text = "1"
        out.append(m)
    return out


def _rename_ids(el: ET.Element, old: str, new: str) -> None:
    for node in el.iter():
        v = node.get("id")
        if v and (v == old or v.startswith(old + "-")):
            node.set("id", new + v[len(old):])


def _strip_foreign_instruments(measures: list[ET.Element], allowed: set[str]) -> None:
    """다른 쪽에서 온 음표의 <instrument id> 가 결과 성부의 악기 id 에 없으면 뗀다(잘못된 참조 방지)."""
    for m in measures:
        for note in m.iter("note"):
            for inst in list(note.findall("instrument")):
                if inst.get("id") not in allowed:
                    note.remove(inst)


def join_musicxml(pages: list[str]) -> str:
    """변환한 쪽들의 MusicXML(올린 순서)을 하나로 잇는다. 한 쪽이면 그대로 돌려준다."""
    if not pages:
        raise ValueError("이을 쪽이 없음")
    if len(pages) == 1:
        return pages[0]
    docs = [_partwise(x) for x in pages]
    base = docs[0]
    part_list = base.find("part-list")
    if part_list is None:
        part_list = ET.SubElement(base, "part-list")
    n_parts = max(len(d.findall("part")) for d in docs)

    # 결과 성부를 n_parts 개로 — 모자라면 그 성부가 처음 나온 쪽의 score-part 를 가져온다
    used_ids = {sp.get("id") for sp in part_list.findall("score-part")}
    base_parts = base.findall("part")
    first_filled = [True] * len(base_parts)
    for j in range(len(base_parts), n_parts):
        src = next(d for d in docs if len(d.findall("part")) > j)
        src_sp = src.find("part-list").findall("score-part")[j]  # type: ignore[union-attr]
        new_id = src_sp.get("id") or f"P{j + 1}"
        n = j + 1
        while new_id in used_ids:
            new_id = f"P{n}"
            n += 1
        sp = copy.deepcopy(src_sp)
        _rename_ids(sp, src_sp.get("id") or "", new_id)
        sp.set("id", new_id)
        part_list.append(sp)
        used_ids.add(new_id)
        base.append(ET.Element("part", {"id": new_id}))
        first_filled.append(False)
    base_parts = base.findall("part")
    allowed = [
        {si.get("id") for si in part_list.findall("score-part")[j].iter("score-instrument")} if
        j < len(part_list.findall("score-part")) else set()
        for j in range(n_parts)
    ]

    for p_index, doc in enumerate(docs):
        parts = doc.findall("part")
        page_len = max(len(p.findall("measure")) for p in parts) if parts else 0
        ref = parts[0].findall("measure") if parts else []
        for j in range(n_parts):
            target = base_parts[j]
            if j < len(parts):
                measures = parts[j].findall("measure")
                if p_index == 0:
                    # 첫 쪽의 성부는 이미 결과에 있다 — 짧으면 뒤만 채운다
                    if len(measures) < page_len:
                        target.extend(_rest_measures(ref, page_len - len(measures), False, start=len(measures)))
                    continue
                chunk = [copy.deepcopy(m) for m in measures]
                _strip_foreign_instruments(chunk, allowed[j])
                target.extend(chunk)
                if len(measures) < page_len:
                    target.extend(_rest_measures(ref, page_len - len(measures), False, start=len(measures)))
            else:
                empty = len(target.findall("measure")) == 0
                target.extend(_rest_measures(ref, page_len, empty or not first_filled[j]))
                first_filled[j] = True

    # 마디 번호를 1부터 다시(맨 앞 못갖춘마디 표시만 남긴다)
    for part in base_parts:
        for k, m in enumerate(part.findall("measure"), start=1):
            m.set("number", str(k))
            if k > 1 and "implicit" in m.attrib:
                del m.attrib["implicit"]

    body = ET.tostring(base, encoding="unicode")
    return f'<?xml version="1.0" encoding="UTF-8"?>\n{DOCTYPE}\n{body}\n'
