"""#31 MIDI → MP3 (T124·T150, research R5).

구조에서의 위치: 렌더링 작업자 → 이 파일 → FluidSynth·WAV 섞기·LAME.
성부별 국악/GM 음원 묶음을 따로 합성해 필요한 음원만 읽는다. 국악 전용 bank 1과 타악 128/1을 적용한다.
음원 누락·트랙 대응 실패는 오류로 반환한다. 임의 음원 파일은 받지 않는다.
중간 파일은 임시 폴더에서 정리하고 최종 MP3와 단계별 시간·음원 이름을 메모리로 반환한다.
"""

from __future__ import annotations

import io
import logging
import os
import struct
import tempfile
import time
import wave
from pathlib import Path

from app.render.errors import RenderError
from app.render.tools import find_fluidsynth, find_lame, run_until, tool_version

# app/model-api/app/render → parents[3] = app/
ASSETS_SOUNDFONTS = Path("/app/shared/soundfonts")

FONT_GM = "gm"
FONT_GUGAK = "gugak"

log = logging.getLogger("model-api.render")

__all__ = ["FONT_GM", "FONT_GUGAK", "RenderError", "apply_part_presets", "default_soundfonts", "gm_soundfont",
           "gugak_soundfont", "mix_wavs", "plan_groups", "render_mp3", "renderer_versions", "sf2_presets",
           "split_midi"]


def _soundfont_dir() -> Path:
    return Path(os.environ.get("SOUNDFONTS_DIR", str(ASSETS_SOUNDFONTS)))


def gm_soundfont() -> str | None:
    """GM 음원. assets 에 없으면 팀 공용 폴더의 판을 쓴다."""
    cands = [_soundfont_dir() / "FluidR3_GM.sf2"]
    gm = next((p for p in cands if p.is_file()), None)
    return str(gm) if gm is not None else None


def gugak_soundfont() -> str | None:
    p = _soundfont_dir() / "gugak.sf2"
    return str(p) if p.is_file() else None


def default_soundfonts() -> list[str]:
    """기본 음원 목록(우선순위 낮은 것부터): GM → gugak."""
    return [p for p in (gm_soundfont(), gugak_soundfont()) if p]


# ------------------------------------------------------------------ .sf2 소리 목록
def sf2_presets(path: str) -> list[tuple[int, int, str]]:
    """.sf2 의 소리 목록 [(bank, program, 이름)] — pdta/phdr 조각만 읽는다. 읽지 못하면 빈 목록."""
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        return []
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"sfbk":
        return []
    pos, end = 12, min(len(data), 8 + struct.unpack("<I", data[4:8])[0])
    while pos + 8 <= end:
        cid, size = data[pos:pos + 4], struct.unpack("<I", data[pos + 4:pos + 8])[0]
        body = pos + 8
        if cid == b"LIST" and data[body:body + 4] == b"pdta":
            sub, sub_end = body + 4, body + size
            while sub + 8 <= sub_end:
                sid, ssize = data[sub:sub + 4], struct.unpack("<I", data[sub + 4:sub + 8])[0]
                if sid == b"phdr":
                    out = []
                    recs = data[sub + 8:sub + 8 + ssize]
                    for i in range(0, len(recs) - 38 + 1, 38):
                        name = recs[i:i + 20].split(b"\x00", 1)[0].decode("latin-1", "replace")
                        prog, bank = struct.unpack("<HH", recs[i + 20:i + 24])
                        out.append((bank, prog, name))
                    return out[:-1]  # 마지막은 'EOP' 끝 표시
                sub += 8 + ssize + (ssize & 1)
            return []
        pos = body + size + (size & 1)
    return []


def _first_preset(path: str) -> tuple[int, int] | None:
    """음원 경로로 지정된 트랙에 쓸 소리(사용자 음원 기능 제거 뒤 서비스에서는 쓰지 않음) — bank 0 · program 0 이 있으면 그것(화면 연주와 같음), 없으면 선율 소리 중 가장 앞."""
    presets = sorted({(b, p) for b, p, _ in sf2_presets(path) if b < 128})
    if not presets:
        return None
    return (0, 0) if (0, 0) in presets else presets[0]


# ------------------------------------------------------------------ 묶음 짜기 · MIDI 나누기
def _stack_for(font: str | None, extra: list[str]) -> tuple[tuple[str, ...], tuple[int, int] | None]:
    """성부 음원 지정 → (싣는 음원 순서, program 바꿀 소리)."""
    selected = gugak_soundfont() if font == FONT_GUGAK else gm_soundfont()
    if font not in (None, FONT_GM, FONT_GUGAK) or extra:
        raise RenderError("RENDER_FAILED", "기본 음원만 지원합니다")
    if selected is None:
        raise RenderError("RENDERER_MISSING", "요청에 필요한 음원이 없습니다")
    return (selected,), None


def plan_groups(n_tracks: int, part_fonts: list[str | None], extra: list[str]
                ) -> list[tuple[tuple[str, ...], tuple[int, int] | None, list[int]]]:
    """MIDI 트랙 수 + 성부별 음원 → [(음원 순서, program 바꿀 소리, 트랙 번호들)].

    music21 이 쓴 MIDI 는 0번이 지휘 트랙(템포·박자)이고 1번부터 악보 성부 순서다. 트랙 수가 성부 수 + 1 이 아니면
    대응을 알 수 없으므로 기본 겹침 한 묶음으로 돌린다. 0번 트랙은 모든 묶음에 넣는다(템포).
    """
    offset = _track_offset(n_tracks, len(part_fonts))
    if offset is None:
        raise RenderError("RENDER_FAILED", "MIDI 트랙과 성부의 대응을 확인할 수 없습니다")
    groups: dict[tuple[tuple[str, ...], tuple[int, int] | None], list[int]] = {}
    for i, font in enumerate(part_fonts):
        groups.setdefault(_stack_for(font, extra), []).append(i + offset)
    shared = list(range(offset))  # 지휘 트랙
    return [(stack, preset, shared + tracks) for (stack, preset), tracks in groups.items()]


def split_midi(midi: bytes, tracks: list[int], preset: tuple[int, int] | None) -> bytes:
    """고른 트랙만 남긴 MIDI. preset 이 있으면 그 트랙들의 선율 채널 program 을 그 소리로 바꾼다."""
    import mido

    src = mido.MidiFile(file=io.BytesIO(midi))
    out = mido.MidiFile(type=1 if len(tracks) > 1 else src.type, ticks_per_beat=src.ticks_per_beat)
    for idx in tracks:
        track = src.tracks[idx]
        if preset is None or idx == 0 and len(src.tracks) > 1 and not _has_notes(track):
            out.tracks.append(track)
            continue
        out.tracks.append(_set_track_sound(track, preset, drums=False))
    buf = io.BytesIO()
    out.save(file=buf)
    return buf.getvalue()


# 국악기 잔향 "약하게"(2026-09-30 박예은 팀장 결정, UC_07 BR-RND-05 · SD_01 3.3) — 국악기(bank 1)·국악 타악 세트(128/1)
# #31 청감 피드백: MP3 선율은 잔향을 조금 더 주고 타악은 기존 값을 유지한다.
GUGAK_REVERB_SEND = 72
GUGAK_PERCUSSION_REVERB_SEND = 60
REVERB_OPTS = ("-o", "synth.reverb.room-size=0.6", "-o", "synth.reverb.level=0.9", "-o", "synth.reverb.damp=0.3")


def _is_gugak_preset(preset: tuple[int, int]) -> bool:
    return preset[0] == 1 or preset == (128, 1)


def _set_track_sound(track, preset: tuple[int, int], drums: bool):
    """트랙의 소리를 (bank, program) 으로 바꾼 새 트랙. drums=False 면 선율 채널만, True 면 타악 채널(10)도.

    선율 채널(bank < 128): 맨 앞에 CC0(bank)·CC32(0)·program change 를 걸고, 곡 안의 bank select·program change 도
    같은 값으로 바꾼다. 타악 채널(bank 128, 타악 세트): program change 로 세트만 고른다(bank select 는 건드리지 않음).
    """
    import mido

    bank, prog = preset

    def target(ch: int) -> bool:
        return (drums and bank >= 128) if ch == 9 else bank < 128

    new = mido.MidiTrack()
    chans = sorted({m.channel for m in track if hasattr(m, "channel") and target(m.channel)})
    for ch in chans:  # 시작에 bank·program 을 걸어 둔다(곡 안에 program change 가 없어도)
        if ch != 9:
            new.append(mido.Message("control_change", channel=ch, control=0, value=bank, time=0))
            new.append(mido.Message("control_change", channel=ch, control=32, value=0, time=0))
        new.append(mido.Message("program_change", channel=ch, program=prog, time=0))
        if _is_gugak_preset(preset):
            send = GUGAK_REVERB_SEND if bank == 1 else GUGAK_PERCUSSION_REVERB_SEND
            new.append(mido.Message("control_change", channel=ch, control=91, value=send, time=0))
    pending = 0
    natural_drum = preset == (128, 1)
    for m in track:
        pending += m.time
        if natural_drum and getattr(m, "channel", None) == 9 and (
            m.type == "note_off" or m.type == "note_on" and m.velocity == 0
        ):
            # note-off의 시간은 다음 이벤트로 넘겨 타격 시점을 보존한다.
            continue
        m = m.copy(time=pending)
        pending = 0
        if m.type == "program_change" and target(m.channel):
            new.append(m.copy(program=prog))
        elif m.type == "control_change" and m.control in (0, 32) and m.channel != 9 and target(m.channel):
            new.append(m.copy(value=bank if m.control == 0 else 0))
        elif m.type == "control_change" and m.control == 91 and target(m.channel) and _is_gugak_preset(preset):
            new.append(m.copy(value=GUGAK_REVERB_SEND if bank == 1 else GUGAK_PERCUSSION_REVERB_SEND))
        else:
            new.append(m)
    if pending:
        new.append(mido.MetaMessage("end_of_track", time=pending))
    return new


def _track_offset(n_tracks: int, n_parts: int) -> int | None:
    """music21 이 쓴 MIDI 는 0번이 지휘 트랙(템포·박자)이고 1번부터 악보 성부 순서다. 대응을 알 수 없으면 None."""
    if n_tracks == n_parts + 1:
        return 1
    if n_tracks == n_parts:
        return 0
    return None


def apply_part_presets(midi: bytes, part_presets: list[tuple[int, int] | None]) -> bytes:
    """성부(악보 순서)별 서비스 음원 소리 번호(결정 C11)로 MIDI 트랙의 bank·program 을 바꾼다.

    None 인 성부는 그대로(MIDI 의 GM 번호). 트랙 수가 성부 수와 맞지 않으면 바꾸지 않는다.
    """
    import mido

    if not any(part_presets):
        return midi
    src = mido.MidiFile(file=io.BytesIO(midi))
    offset = _track_offset(len(src.tracks), len(part_presets))
    if offset is None:
        log.warning("MIDI 트랙 %d개와 성부 %d개가 맞지 않아 성부별 소리 번호를 쓰지 않음", len(src.tracks), len(part_presets))
        return midi
    for i, preset in enumerate(part_presets):
        if preset is not None:
            src.tracks[i + offset] = _set_track_sound(src.tracks[i + offset], preset, drums=True)
    buf = io.BytesIO()
    src.save(file=buf)
    return buf.getvalue()


def _has_notes(track) -> bool:
    return any(m.type == "note_on" for m in track)


# ------------------------------------------------------------------ WAV 섞기
def mix_wavs(paths: list[str], out_path: str) -> None:
    """16bit PCM WAV 여럿을 더해 하나로. 길이가 다르면 짧은 쪽 뒤는 무음. 넘치는 값은 자른다."""
    import numpy as np

    arrays, params = [], None
    for p in paths:
        with wave.open(p, "rb") as w:
            prm = (w.getnchannels(), w.getsampwidth(), w.getframerate())
            if prm[1] != 2:
                raise RenderError("RENDER_FAILED", f"16bit 가 아닌 WAV: {prm}")
            if params is None:
                params = prm
            elif prm != params:
                raise RenderError("RENDER_FAILED", f"WAV 형식이 서로 다름: {params} ≠ {prm}")
            arrays.append(np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.int32))
    if params is None:
        raise RenderError("RENDER_FAILED", "섞을 WAV 가 없음")
    total = np.zeros(max(len(a) for a in arrays), dtype=np.int32)
    for a in arrays:
        total[:len(a)] += a
    with wave.open(out_path, "wb") as w:
        w.setnchannels(params[0])
        w.setsampwidth(2)
        w.setframerate(params[2])
        w.writeframes(np.clip(total, -32768, 32767).astype("<i2").tobytes())


# ------------------------------------------------------------------ 렌더링
def _fluidsynth_wav(fs: str, fonts: tuple[str, ...] | list[str], mid_path: str, wav_path: str, deadline: float,
                    cwd: str) -> None:
    r = run_until([fs, "-ni", *REVERB_OPTS, "-F", wav_path, "-r", "44100", *fonts, mid_path], deadline, cwd=cwd)
    if r.timed_out:
        raise RenderError("RENDER_TIMEOUT", "fluidsynth 시간 초과")
    if r.returncode != 0 or not os.path.isfile(wav_path) or os.path.getsize(wav_path) <= 44:
        raise RenderError("RENDER_FAILED", f"fluidsynth 실패: {r.stderr[-300:]}")


def _track_count(midi: bytes) -> int | None:
    if len(midi) < 14 or midi[:4] != b"MThd":
        return None
    return struct.unpack(">H", midi[10:12])[0]


def render_mp3(midi: bytes, sf2_paths: list[str], timeout_s: float,
               part_fonts: list[str | None] | None = None,
               part_presets: list[tuple[int, int] | None] | None = None,
               timings: dict | None = None) -> tuple[bytes, str, str]:
    """(mp3, renderer_name, version). 실패하면 RenderError(RENDER_FAILED|RENDER_TIMEOUT|RENDERER_MISSING).

    part_fonts: 악보 성부 순서대로 'gugak' | 'gm' | None(GM). 묶음별로 음원 한 개만 읽는다.
    part_presets: 악보 성부 순서대로 서비스 음원 소리 번호 (bank, program) | None(MIDI 의 GM 번호 그대로) — 결정 C11.
                  필요한 음원이 없으면 RENDERER_MISSING 으로 반환한다.
    """
    fs = find_fluidsynth()
    timings = timings if timings is not None else {}
    timings.setdefault("mix", 0)
    preset_at = time.monotonic()
    lame = find_lame()
    if fs is None:
        raise RenderError("RENDERER_MISSING", "fluidsynth 가 설치되지 않음")
    if lame is None:
        raise RenderError("RENDERER_MISSING", "lame 이 설치되지 않음")
    extra = [os.path.abspath(p) for p in sf2_paths if p and os.path.isfile(p)]  # fluidsynth 는 임시 폴더(cwd)에서 돈다
    fonts = list(_stack_for(None, extra)[0]) if not part_fonts else []
    if not midi:
        raise RenderError("RENDER_FAILED", "빈 MIDI")
    if part_presets and any(part_presets) and gugak_soundfont():
        try:
            midi = apply_part_presets(midi, list(part_presets))
        except Exception as exc:  # 손상 MIDI
            raise RenderError("RENDER_FAILED", f"MIDI 소리 번호 바꾸기 실패: {exc}") from exc

    groups = None
    if part_fonts:
        n = _track_count(midi)
        if n is None:
            raise RenderError("RENDER_FAILED", "MIDI 머리가 아님")
        groups = plan_groups(n, list(part_fonts), extra)
        if len(groups) == 1 and groups[0][1] is None:
            fonts, groups = list(groups[0][0]), None  # 한 묶음이면 예전처럼 한 번에

    timings["midi"] = timings.get("midi", 0) + round((time.monotonic() - preset_at) * 1000)
    timings["soundfonts"] = sorted({Path(p).name for p in fonts} if groups is None else
                                    {Path(p).name for stack, _, _ in groups for p in stack})

    def synth(stack, mid, wav):
        at = time.monotonic()
        _fluidsynth_wav(fs, stack, mid, wav, deadline, tmp)
        key = "fluidsynth_gugak" if any(Path(p).name == "gugak.sf2" for p in stack) else "fluidsynth_gm"
        timings[key] = timings.get(key, 0) + round((time.monotonic() - at) * 1000)

    deadline = time.monotonic() + max(0.1, float(timeout_s))
    with tempfile.TemporaryDirectory(prefix="gugak-mp3-") as tmp:
        wav_path = os.path.join(tmp, "out.wav")
        mp3_path = os.path.join(tmp, "out.mp3")
        if groups is None:
            mid_path = os.path.join(tmp, "in.mid")
            with open(mid_path, "wb") as f:
                f.write(midi)
            synth(fonts, mid_path, wav_path)
        else:
            parts_wav = []
            for gi, (stack, preset, tracks) in enumerate(groups):
                try:
                    sub = split_midi(midi, tracks, preset)
                except Exception as exc:  # 손상 MIDI
                    raise RenderError("RENDER_FAILED", f"MIDI 나누기 실패: {exc}") from exc
                mid_path = os.path.join(tmp, f"part{gi}.mid")
                with open(mid_path, "wb") as f:
                    f.write(sub)
                wp = os.path.join(tmp, f"part{gi}.wav")
                synth(stack, mid_path, wp)
                parts_wav.append(wp)
            at = time.monotonic()
            mix_wavs(parts_wav, wav_path)
            timings["mix"] = round((time.monotonic() - at) * 1000)

        at = time.monotonic()
        r = run_until([lame, "--quiet", "-b", "192", wav_path, mp3_path], deadline, cwd=tmp)
        timings["lame"] = round((time.monotonic() - at) * 1000)
        if r.timed_out:
            raise RenderError("RENDER_TIMEOUT", "lame 시간 초과")
        if r.returncode != 0 or not os.path.isfile(mp3_path) or os.path.getsize(mp3_path) == 0:
            raise RenderError("RENDER_FAILED", f"lame 실패: {r.stderr[-300:]}")
        with open(mp3_path, "rb") as f:
            data = f.read()

    version = f"{tool_version(fs) or '?'}+lame{tool_version(lame) or '?'}"
    return data, "fluidsynth", version


def renderer_versions() -> list[dict]:
    from app.render.pdf import renderer_versions as _all

    return _all()
