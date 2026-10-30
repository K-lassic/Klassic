"""MIDI 안전 변환 시험 (2026-09-30 — SD_04 §8-1). 실제 music21 작업자(별도 프로세스)를 띄운다.

fixtures/midi_unmatched_repeats.musicxml: 2026-09-30 14:04 운영 멈춤을 일으킨 요청의 5쪽(homr 결과) — 여는 반복 기호만 12개.
그대로 변환하면 music21 반복 펼치기가 끝나지 않는다(60초 넘게, 재현함).
"""

from __future__ import annotations

import time
from pathlib import Path

from app.services.safe_midi import SafeMidi

FIX = Path(__file__).parent / "fixtures" / "midi_unmatched_repeats.musicxml"


def _simple_xml() -> str:
    from music21 import note, stream
    from music21.musicxml.m21ToXml import GeneralObjectExporter

    s = stream.Score()
    p = stream.Part()
    for n in ("C4", "D4", "E4", "G4"):
        p.append(note.Note(n, quarterLength=1))
    s.insert(0, p)
    return GeneralObjectExporter(s).parse().decode("utf-8")


async def test_normal_score_converts_first_try():
    sm = SafeMidi(workers=1, normal_s=20, no_repeats_s=10)
    try:
        r = await sm.convert(_simple_xml())
    finally:
        await sm.close()
    assert r.mode == "normal" and r.midi[:4] == b"MThd"


async def test_unmatched_repeats_fall_back_to_no_repeats_without_blocking():
    sm = SafeMidi(workers=1, normal_s=5, no_repeats_s=20)
    try:
        await sm.warm(60)
        t = time.monotonic()
        r = await sm.convert(FIX.read_text(encoding="utf-8"))
        took = time.monotonic() - t
    finally:
        await sm.close()
    assert r.mode == "no_repeats" and r.midi[:4] == b"MThd"
    assert "normal:timeout" in r.detail
    assert took < 5 + 20 + 5  # 멈추지 않고 시간 제한 안에 끝난다


async def test_broken_xml_gives_none_so_only_musicxml_is_served():
    sm = SafeMidi(workers=1, normal_s=10, no_repeats_s=10)
    try:
        r = await sm.convert("<이것은 MusicXML 이 아님")
    finally:
        await sm.close()
    assert r.midi is None and r.mode == "failed"


async def test_deadline_is_respected():
    sm = SafeMidi(workers=1, normal_s=30, no_repeats_s=30)
    try:
        await sm.warm(60)
        t = time.monotonic()
        r = await sm.convert(FIX.read_text(encoding="utf-8"), deadline_monotonic=time.monotonic() + 3)
        took = time.monotonic() - t
    finally:
        await sm.close()
    assert r.midi is None and took < 8
