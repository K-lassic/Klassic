"""성부별 음원(.sf2) 렌더링 · 타악 파트 처리 규칙 (T150, T106 메모 · R5 · R10).

- 성부마다 음원을 정하면 음원 묶음끼리 MIDI 트랙을 나눠 따로 렌더링하고 WAV 를 섞는다.
- 기본·추천 구성은 타악 성부가 없는 악보에 장구 파트를 새로 만들지 않는다.
"""

from __future__ import annotations

import io
import os
import wave
from pathlib import Path

import mido
import numpy as np
import pytest

from app.render import fluidsynth_mp3 as fm
from app.render.errors import RenderError
from app.render.tools import ProcOutcome
from app.services import scoreio
from app.services.arrange import (
    ADD_MISSING_PERCUSSION,
    Assignment,
    arrange,
    builtin_font,
    render_fonts,
    render_presets,
)

GUGAK = fm.ASSETS_SOUNDFONTS / "gugak.sf2"


# ------------------------------------------------------------------ 악보 만들기
def _score(n_melody: int = 1, with_drums: bool = False, name: str = "Violin"):
    from music21 import instrument, meter, note, stream

    s = stream.Score()
    for k in range(n_melody):
        p = stream.Part()
        inst = instrument.Instrument()
        inst.partName = inst.instrumentName = f"{name}{k}" if k else name
        inst.midiProgram, inst.midiChannel = 40, k
        p.insert(0, inst)
        p.append(meter.TimeSignature("4/4"))
        for pitch in ["C4", "E4", "G4", "C5"]:
            p.append(note.Note(pitch, quarterLength=1))
        s.insert(0, p)
    if with_drums:
        d = stream.Part()
        inst = instrument.Instrument()
        inst.partName = inst.instrumentName = "Drums"
        inst.midiChannel = 9
        d.insert(0, inst)
        d.append(meter.TimeSignature("4/4"))
        for _ in range(4):
            d.append(note.Note(38, quarterLength=1))
        s.insert(0, d)
    return s


def _instruments(score) -> list[tuple[str, int | None]]:
    out = []
    for p in score.parts:
        inst = p.getInstrument(returnDefault=False)
        out.append((inst.instrumentName, inst.midiChannel))
    return out


# ------------------------------------------------------------------ 타악 파트 처리 규칙
def test_policy_constant_is_explicit() -> None:
    assert ADD_MISSING_PERCUSSION is False


@pytest.mark.parametrize("mode", ["default", "recommend"])
def test_no_percussion_part_is_created_when_score_has_none(mode) -> None:
    s = _score(n_melody=1)
    codes = ["gayageum", "janggu"] if mode == "recommend" else None
    used = arrange(s, assignment=Assignment(mode=mode), codes=codes, transpose=0, volume=1.0)
    assert len(s.parts) == 1  # 장구 파트를 새로 만들지 않는다
    assert used == ["gayageum"]
    assert _instruments(s) == [("가야금", 0)]


def test_existing_percussion_part_gets_janggu() -> None:
    s = _score(n_melody=1, with_drums=True)
    used = arrange(s, assignment=Assignment(mode="default"), codes=None, transpose=2, volume=1.0)
    assert len(s.parts) == 2 and sorted(used) == ["gayageum", "janggu"]
    names = dict(_instruments(s))
    assert names["장구"] == scoreio.PERCUSSION_CHANNEL
    drum_part = next(p for p in s.parts if p.getInstrument().instrumentName == "장구")
    assert [n.pitch.midi for n in drum_part.flatten().notes] == [38] * 4  # 타악은 조옮김하지 않는다


def test_percussion_only_combo_on_score_without_percussion() -> None:
    """타악만의 추천 조합(장구 · 북 — 2026-09-29 규칙 완화로 올 수 있음)을 타악 성부 없는 악보에 놓아도 깨지지 않는다.
    선율 성부는 기본 선율 악기(가야금)가 되고, 타악 파트는 새로 생기지 않으며, 놓인 악기에 장구·북이 없다."""
    s = _score(n_melody=2)
    used = arrange(s, assignment=Assignment(mode="recommend"), codes=["janggu", "buk"], transpose=0, volume=1.0)
    assert len(s.parts) == 2 and used == ["gayageum", "gayageum"]
    assert [name for name, _ in _instruments(s)] == ["가야금", "가야금"]
    assert all(ch != scoreio.PERCUSSION_CHANNEL for _, ch in _instruments(s))
    assert scoreio.count_notes(s) == 8


def test_percussion_only_combo_on_score_with_percussion() -> None:
    s = _score(n_melody=1, with_drums=True)
    used = arrange(s, assignment=Assignment(mode="recommend"), codes=["janggu", "buk"], transpose=0, volume=1.0)
    assert sorted(used) == ["gayageum", "janggu"]  # 타악 성부 하나 → 첫 타악기(장구)만, 북은 놓이지 않는다
    assert dict(_instruments(s))["장구"] == scoreio.PERCUSSION_CHANNEL


def test_custom_percussion_track_is_honoured() -> None:
    """custom 으로 타악기를 고르면 그대로 따른다(없는 성부 번호면 첫 성부 복사 — 화면 [악기 추가]와 같음)."""
    s = _score(n_melody=1)
    a = Assignment(mode="custom", tracks=[{"part": 0, "instrument": "daegeum"}, {"part": 1, "instrument": "janggu"}])
    arrange(s, assignment=a, codes=None, transpose=0, volume=1.0)
    assert _instruments(s) == [("대금", 0), ("장구", scoreio.PERCUSSION_CHANNEL)]


# ------------------------------------------------------------------ 성부별 음원 정하기
def test_builtin_font_names() -> None:
    assert builtin_font("gugak.sf2") == "gugak" and builtin_font("FluidR3_GM.sf2") == "gm"
    assert builtin_font("GM") == "gm" and builtin_font("abc") is None and builtin_font(None) is None


def test_render_fonts_follow_catalog_and_sf2_ref() -> None:
    s = _score(n_melody=1)
    a = Assignment(mode="custom", tracks=[
        {"part": 0, "instrument": "ajaeng"}, {"part": 1, "instrument": "cello"},
        {"part": 2, "instrument": "gayageum", "sf2_ref": "FluidR3_GM.sf2"},
        {"part": 3, "instrument": "janggu"}])
    arrange(s, assignment=a, codes=None, transpose=0, volume=1.0)
    assert render_fonts(s) == ["gugak", "gm", "gm", "gugak"]
    # 풀 수 없는 sf2_ref 는 악기 목록 음원으로
    assert render_fonts(s, lambda ref: None) == ["gugak", "gm", "gugak", "gugak"]
    # 세션 사본 경로로 풀리면 그 경로
    assert render_fonts(s, lambda ref: "/x/user.sf2")[2] == "/x/user.sf2"


def test_render_fonts_original_instruments_are_unassigned() -> None:
    s = _score(n_melody=2)
    arrange(s, assignment=Assignment(mode="original"), codes=None, transpose=0, volume=1.0)
    assert render_fonts(s) == [None, None]
    assert render_presets(s) == [None, None]  # 원래 악기는 MIDI 의 GM 번호(bank 0) 그대로


# ------------------------------------------------------------------ 성부별 소리 번호(결정 C11)
def test_render_presets_give_gugak_bank_and_kit() -> None:
    """국악기 = gugak.sf2 bank 1 · program 0~5, 장구·북 = 타악 세트 bank 128 · program 1, 다른 악기 = GM 번호 그대로."""
    s = _score(n_melody=1, with_drums=True)
    a = Assignment(mode="custom", tracks=[
        {"part": 0, "instrument": "ajaeng"}, {"part": 1, "instrument": "janggu"},
        {"part": 2, "instrument": "cello"}, {"part": 3, "instrument": "gayageum", "sf2_ref": "FluidR3_GM.sf2"},
        {"part": 4, "instrument": "piri"}])
    arrange(s, assignment=a, codes=None, transpose=0, volume=1.0)
    assert render_presets(s) == [(1, 5), (128, 1), None, None, (1, 4)]


def test_catalog_sound_numbers_are_unique() -> None:
    from app.services.catalog import instruments

    cat = instruments()
    melodic = [(i.bank, i.program) for i in cat.values() if not i.is_percussion]
    assert len(melodic) == len(set(melodic))  # 국악기와 다른 악기의 (bank, program) 이 겹치지 않는다
    assert [(cat[c].bank, cat[c].program) for c in ("gayageum", "geomungo", "daegeum", "haegeum", "piri", "ajaeng")] \
        == [(1, 0), (1, 1), (1, 2), (1, 3), (1, 4), (1, 5)]
    assert (cat["janggu"].bank, cat["janggu"].program) == (cat["buk"].bank, cat["buk"].program) == (128, 1)
    assert all(i.bank == 0 and i.program == i.gm_program for i in cat.values() if i.family != "gugak")
    assert (cat["ajaeng"].gm_program, cat["cello"].gm_program) == (42, 42)  # GM 호환 번호(내려받기)는 그대로


def test_apply_part_presets_rewrites_bank_program_and_kit() -> None:
    s = _score(n_melody=1, with_drums=True)
    a = Assignment(mode="custom", tracks=[{"part": 0, "instrument": "ajaeng"}, {"part": 1, "instrument": "janggu"},
                                          {"part": 2, "instrument": "cello"}])
    arrange(s, assignment=a, codes=None, transpose=0, volume=1.0)
    midi = scoreio.to_midi(s)
    before = mido.MidiFile(file=io.BytesIO(midi))
    assert {m.program for m in before.tracks[1] if m.type == "program_change"} == {42}  # 악보(내려받기)는 GM 호환 번호
    out = mido.MidiFile(file=io.BytesIO(fm.apply_part_presets(midi, render_presets(s))))
    t1, t2, t3 = out.tracks[1], out.tracks[2], out.tracks[3]
    first = [m for m in t1 if m.type in ("control_change", "program_change")][:3]
    assert [(m.type, getattr(m, "control", None), getattr(m, "value", getattr(m, "program", None))) for m in first] \
        == [("control_change", 0, 1), ("control_change", 32, 0), ("program_change", None, 5)]  # bank select 가 먼저
    assert {m.program for m in t1 if m.type == "program_change"} == {5}
    assert {m.program for m in t2 if m.type == "program_change"} == {1} and all(m.channel == 9 for m in t2 if hasattr(m, "channel"))
    assert not any(m.type == "control_change" and m.control == 0 for m in t2)  # 타악 채널에는 bank select 를 쓰지 않는다
    assert t3 == before.tracks[3]  # 첼로(GM 42) 그대로
    assert fm.apply_part_presets(midi, [None, None, None]) == midi
    assert fm.apply_part_presets(midi, [(1, 5)]) == midi  # 트랙 수가 맞지 않으면 그대로


# ------------------------------------------------------------------ .sf2 소리 목록
@pytest.mark.skipif(not GUGAK.is_file(), reason="gugak.sf2 없음")
def test_sf2_presets_reads_gugak() -> None:
    presets = {(b, p): n for b, p, n in fm.sf2_presets(str(GUGAK))}
    # 결정 C11: 국악기는 전용 bank 1 · program 0~5, 국악 타악 세트는 bank 128 · program 1 — GM 자리(bank 0, 128/0)는 비어 있다
    assert presets == {(1, 0): "gayageum", (1, 1): "geomungo", (1, 2): "daegeum", (1, 3): "haegeum", (1, 4): "piri",
                       (1, 5): "ajaeng", (128, 1): "gugak_kit"}
    assert fm._first_preset(str(GUGAK)) == (1, 0)  # (0,0) 이 없으면 가장 앞 선율 소리


def test_sf2_presets_bad_file(tmp_path) -> None:
    bad = tmp_path / "bad.sf2"
    bad.write_bytes(b"not a soundfont")
    assert fm.sf2_presets(str(bad)) == [] and fm.sf2_presets(str(tmp_path / "none.sf2")) == []


# ------------------------------------------------------------------ 묶음 · MIDI 나누기 · 섞기
@pytest.fixture
def fake_fonts(monkeypatch, tmp_path):
    gm, gugak, user = (tmp_path / n for n in ("gm.sf2", "gugak.sf2", "user.sf2"))
    for p in (gm, gugak, user):
        p.write_bytes(b"RIFF")
    monkeypatch.setattr(fm, "gm_soundfont", lambda: str(gm))
    monkeypatch.setattr(fm, "gugak_soundfont", lambda: str(gugak))
    monkeypatch.setattr(fm, "default_soundfonts", lambda: [str(gm), str(gugak)])
    monkeypatch.setattr(fm, "_first_preset", lambda path: (0, 5))
    return str(gm), str(gugak), str(user)


def test_plan_groups(fake_fonts) -> None:
    gm, gugak, user = fake_fonts
    groups = fm.plan_groups(5, ["gugak", "gm", user, None], [])
    by_stack = {g[0]: (g[1], g[2]) for g in groups}
    assert by_stack[(gm, gugak)] == (None, [0, 1, 4])  # gugak 과 기본 겹침은 한 묶음, 0번 지휘 트랙은 모두에
    assert by_stack[(gm,)] == (None, [0, 2])  # GM 만 → 아쟁(gugak 42)이 첼로(GM 42)를 가로채지 않는다
    assert by_stack[(gm, gugak, user)] == ((0, 5), [0, 3])
    # 트랙 수가 맞지 않으면 한 묶음(기본 겹침)
    assert fm.plan_groups(7, ["gm", "gugak"], [user]) == [((gm, gugak, user), None, list(range(7)))]


def test_split_midi_keeps_conductor_and_rewrites_program() -> None:
    s = _score(n_melody=2, with_drums=True)
    midi = scoreio.to_midi(s)
    src = mido.MidiFile(file=io.BytesIO(midi))
    assert len(src.tracks) == 4  # 지휘 + 성부 3
    out = mido.MidiFile(file=io.BytesIO(fm.split_midi(midi, [0, 2], (1, 7))))
    assert len(out.tracks) == 2
    progs = {m.program for m in out.tracks[1] if m.type == "program_change"}
    banks = {m.value for m in out.tracks[1] if m.type == "control_change" and m.control == 0}
    assert progs == {7} and banks == {1}
    drum = mido.MidiFile(file=io.BytesIO(fm.split_midi(midi, [3], (0, 7))))
    assert all(m.program == 0 for m in drum.tracks[0] if m.type == "program_change")  # 타악 채널은 그대로


def _write_wav(path: Path, samples: list[int]) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(44100)
        w.writeframes(np.array(samples, dtype="<i2").tobytes())


def test_mix_wavs_sums_pads_and_clips(tmp_path) -> None:
    a, b, out = tmp_path / "a.wav", tmp_path / "b.wav", tmp_path / "o.wav"
    _write_wav(a, [100, -100, 30000, 30000])
    _write_wav(b, [1, 2, 30000, -1000, 5, 6])
    fm.mix_wavs([str(a), str(b)], str(out))
    with wave.open(str(out)) as w:
        got = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").tolist()
    assert got == [101, -98, 32767, 29000, 5, 6]


def test_mix_wavs_rejects_mismatch(tmp_path) -> None:
    a, b = tmp_path / "a.wav", tmp_path / "b.wav"
    _write_wav(a, [1, 2])
    with wave.open(str(b), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(22050)
        w.writeframes(b"\x00\x00")
    with pytest.raises(RenderError):
        fm.mix_wavs([str(a), str(b)], str(tmp_path / "o.wav"))


def test_render_mp3_runs_fluidsynth_per_group(monkeypatch, fake_fonts) -> None:
    gm, gugak, user = fake_fonts
    calls: list[list[str]] = []

    def fake_run(cmd, deadline, cwd=None):
        calls.append(cmd)
        if cmd[0] == "FS":
            _write_wav(Path(cmd[cmd.index("-F") + 1]), [10, 10, 10, 10])
        else:
            Path(cmd[-1]).write_bytes(b"ID3mp3")
        return ProcOutcome(0, "", "", False, 1)

    monkeypatch.setattr(fm, "find_fluidsynth", lambda: "FS")
    monkeypatch.setattr(fm, "find_lame", lambda: "LAME")
    monkeypatch.setattr(fm, "run_until", fake_run)
    monkeypatch.setattr(fm, "tool_version", lambda p: "1.0")
    s = _score(n_melody=2)
    midi = scoreio.to_midi(s)

    data, name, _v = fm.render_mp3(midi, [], 30, part_fonts=["gugak", "gm"])
    fs_calls = [c for c in calls if c[0] == "FS"]
    assert data == b"ID3mp3" and name == "fluidsynth" and len(fs_calls) == 2
    assert [c[c.index("44100") + 1:-1] for c in fs_calls] == [[gm, gugak], [gm]]

    calls.clear()  # 한 묶음이면 예전처럼 한 번만(기본 국악기 구성)
    fm.render_mp3(midi, [], 30, part_fonts=["gugak", "gugak"])
    assert len([c for c in calls if c[0] == "FS"]) == 1

    calls.clear()  # part_fonts 없음 = 예전 그대로(사용자 음원 전체 겹침)
    fm.render_mp3(midi, [user], 30)
    assert [c[c.index("44100") + 1:-1] for c in calls if c[0] == "FS"] == [[gm, gugak, user]]


def test_render_mp3_applies_part_presets(monkeypatch, fake_fonts) -> None:
    """part_presets 가 있으면 fluidsynth 에 넘기는 MIDI 의 국악기 트랙이 gugak.sf2 bank 1 소리를 부른다(결정 C11)."""
    seen: list[mido.MidiFile] = []

    def fake_run(cmd, deadline, cwd=None):
        if cmd[0] == "FS":
            seen.append(mido.MidiFile(cmd[-1]))
            _write_wav(Path(cmd[cmd.index("-F") + 1]), [10, 10])
        else:
            Path(cmd[-1]).write_bytes(b"ID3mp3")
        return ProcOutcome(0, "", "", False, 1)

    monkeypatch.setattr(fm, "find_fluidsynth", lambda: "FS")
    monkeypatch.setattr(fm, "find_lame", lambda: "LAME")
    monkeypatch.setattr(fm, "run_until", fake_run)
    monkeypatch.setattr(fm, "tool_version", lambda p: "1.0")
    midi = scoreio.to_midi(_score(n_melody=2))

    def progs(mf, i):
        return {m.program for m in mf.tracks[i] if m.type == "program_change"}

    fm.render_mp3(midi, [], 30, part_fonts=["gugak", "gm"], part_presets=[(1, 5), None])
    assert [progs(mf, len(mf.tracks) - 1) for mf in seen] == [{5}, {40}]  # 묶음마다: 아쟁 1/5, 첼로 자리는 GM 그대로
    seen.clear()  # gugak.sf2 가 없으면 GM 번호 그대로(대신 연주)
    monkeypatch.setattr(fm, "gugak_soundfont", lambda: None)
    fm.render_mp3(midi, [], 30, part_presets=[(1, 5), None])
    assert progs(seen[0], 1) == {40}


# ------------------------------------------------------------------ 실제 렌더링(있을 때만)
def _real_ready() -> bool:
    return bool(fm.find_fluidsynth() and fm.find_lame() and fm.gm_soundfont() and fm.gugak_soundfont())


def _decode(mp3: bytes, tmp_path: Path, name: str) -> np.ndarray:
    src, dst = tmp_path / f"{name}.mp3", tmp_path / f"{name}.wav"
    src.write_bytes(mp3)
    os.system(f'"{fm.find_lame()}" --quiet --decode "{src}" "{dst}"')
    with wave.open(str(dst)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float)


def _rel_diff(a: np.ndarray, b: np.ndarray) -> float:
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    return float(((a - b) ** 2).sum() / max(1.0, (a ** 2).sum()))


@pytest.mark.skipif(not _real_ready(), reason="fluidsynth/lame/음원 없음")
def test_real_ajaeng_and_cello_no_longer_collide(tmp_path) -> None:
    """결정 C11: 아쟁(gugak.sf2 1/5) · 첼로(GM 0/42) — 두 음원을 한 번에 겹쳐 실어도(화면 연주와 같음) 서로 다른 소리."""
    s = _score(n_melody=1)
    arrange(s, assignment=Assignment(mode="custom", tracks=[{"part": 0, "instrument": "ajaeng"},
                                                            {"part": 1, "instrument": "cello"}]),
            codes=None, transpose=0, volume=1.0)
    fonts, presets = render_fonts(s), render_presets(s)
    assert fonts == ["gugak", "gm"] and presets == [(1, 5), None]
    midi = scoreio.to_midi(s)
    solo = {name: fm.split_midi(midi, [0, i + 1], None) for i, name in enumerate(("ajaeng", "cello"))}
    # 기본 겹침(GM + gugak 한 번에)
    ajaeng = _decode(fm.render_mp3(solo["ajaeng"], [], 120, part_presets=[presets[0]])[0], tmp_path, "a")
    cello = _decode(fm.render_mp3(solo["cello"], [], 120)[0], tmp_path, "c")
    cello_gm = _decode(fm.render_mp3(solo["cello"], [], 120, part_fonts=["gm"])[0], tmp_path, "cg")
    ajaeng_gm42 = _decode(fm.render_mp3(solo["ajaeng"], [], 120)[0], tmp_path, "a42")  # 소리 번호를 안 바꾸면 GM 42
    assert ajaeng.std() > 50 and cello.std() > 50  # 소리가 난다
    assert _rel_diff(ajaeng, cello) > 0.1  # 아쟁과 첼로가 뚜렷이 다르다(예전 겹침에서는 0 — 첼로가 아쟁 소리)
    assert _rel_diff(cello, cello_gm) < 1e-6  # 겹쳐 실어도 첼로는 GM 첼로 그대로
    assert _rel_diff(ajaeng_gm42, cello) < 1e-6 and _rel_diff(ajaeng, ajaeng_gm42) > 0.1  # 아쟁 소리는 bank 1 에서만
    # 성부별 음원 묶음 렌더링(T150)도 그대로 된다
    both = _decode(fm.render_mp3(midi, [], 120, part_fonts=fonts, part_presets=presets)[0], tmp_path, "both")
    assert both.std() > 50


def test_gugak_reverb_send_only_on_gugak_tracks() -> None:
    """(2026-09-30 UC_07 BR-RND-05) 국악기(bank 1)·국악 타악 세트(128/1) 트랙에만 잔향 보내기 CC91 = GUGAK_REVERB_SEND."""
    import io

    import mido

    from app.render.fluidsynth_mp3 import GUGAK_REVERB_SEND, REVERB_OPTS, apply_part_presets

    mf = mido.MidiFile(type=1)
    mf.tracks.append(mido.MidiTrack())  # 머리 트랙
    for ch in (0, 1, 9):
        t = mido.MidiTrack()
        t.append(mido.Message("program_change", channel=ch, program=0, time=0))
        t.append(mido.Message("note_on", channel=ch, note=60, velocity=80, time=0))
        t.append(mido.Message("note_off", channel=ch, note=60, velocity=0, time=480))
        mf.tracks.append(t)
    buf = io.BytesIO()
    mf.save(file=buf)
    out = mido.MidiFile(file=io.BytesIO(apply_part_presets(buf.getvalue(), [(1, 0), (0, 40), (128, 1)])))
    cc91 = [[m.value for m in tr if m.type == "control_change" and m.control == 91] for tr in out.tracks[1:]]
    assert cc91 == [[GUGAK_REVERB_SEND], [], [GUGAK_REVERB_SEND]]  # 가야금 · 바이올린(GM) · 장구
    assert "synth.reverb.room-size=0.6" in REVERB_OPTS
