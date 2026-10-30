"""국악기 음원 gugak.sf2 만들기 (tasks T052, research R10·R11).

원천: 국립국악원 국악기 디지털 음원 — 단음(공공누리 제1유형, 출처 표시). 2026-09-28 비상업·교육용으로 신고하고 받은 WAV 를
app/assets/soundfonts/source/ 에 둔다. 이 스크립트는 사람 손(Polyphone) 대신 다음을 자동으로 한다.

  1. 가락악기의 '기본음계' 녹음에서 음마다 시작점과 음높이(YIN)를 찾아 잘라 낸다.
  2. 지속음 악기(대금·피리·해금·아쟁)는 안정된 가운데 구간에 반복 구간(loop)을 잡고, 발현 악기(가야금·거문고)는 자연 감쇠를 둔다.
  3. 잘라 낸 음을 건반 구역에 나눠 싣고, shared/instruments.json 의 bank·program 자리에 악기를 둔다 —
     국악기 전용 bank 1, program 0~5(가야금·거문고·대금·해금·피리·아쟁, 결정 C11 2026-09-29).
     예전처럼 GM 번호 자리(bank 0)에 두면 FluidR3_GM 과 겹쳐 실을 때 같은 번호의 다른 악기(아쟁 42 ↔ 첼로 42)를 가로챘다.
  4. 장구(덩·기덕·쿵·더러러러)·좌고는 국악 타악 세트(bank 128, program 1 — 장구·북의 bank·program)에 세기(중·강)별로 둔다.
     GM 표준 드럼 세트 자리(bank 128, program 0)는 비워 FluidR3_GM 이 받게 한다.

실행:  cd app/model-api && uv run python ../ops/soundfonts/build_gugak_sf2.py
결과:  app/assets/soundfonts/gugak.sf2 + gugak.sf2.json(잘라 낸 음 목록 — 검수용)
"""
from __future__ import annotations

import json
import math
import struct
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy.io import wavfile

APP = Path(__file__).resolve().parents[2]
SRC = APP / "assets" / "soundfonts" / "source"
OUT = APP / "assets" / "soundfonts" / "gugak.sf2"
HOP = 256
FRAME = 2048


# ---------------------------------------------------------------------------------------------
# 원천 파일과 악기 대응 (국립국악원 파일 이름 → 서비스 악기 코드)
# ---------------------------------------------------------------------------------------------
MELODIC = {
    # code: (파일들, 지속음 여부)
    "gayageum": (["jungak_gayageum_sus_mid_04_05.wav"], False),
    "geomungo": (["gumungo_D_scale_mid_80.wav", "gumungo_U_scale_mid_02.wav"], False),
    "daegeum": (["jungak_deageum_scale_sus_25.wav"], True),
    "haegeum": (["Haegeum_1.wav"], True),
    "piri": (["hyangpiri_scale_05_06.wav"], True),
    "ajaeng": (["Ajaeng_2.wav"], True),
}
# 타악: (파일, 건반들, 세기 구역)
DRUMS = [
    ("Janggu_1_2.wav", [36, 35], (0, 95), "덩 중"), ("Janggu_1_1.wav", [36, 35], (96, 127), "덩 강"),
    ("Janggu_2_2.wav", [38, 40], (0, 95), "기덕 중"), ("Janggu_2_1.wav", [38, 40], (96, 127), "기덕 강"),
    ("Janggu_3_2.wav", [42, 37], (0, 95), "쿵 중"), ("Janggu_3_1.wav", [42, 37], (96, 127), "쿵 강"),
    ("Janggu_4_2.wav", [44, 46], (0, 95), "더러러러 중"), ("Janggu_4_1.wav", [44, 46], (96, 127), "더러러러 강"),
    ("Jwago_2.wav", [41, 43, 45], (0, 127), "좌고(북)"),
]
# 이보다 짧은 샘플은 건반 구역에 싣지 않고 이웃 샘플이 그 건반을 맡는다(2026-09-30 박예은 국악 검수).
# 가야금 D#4·D#5·F3 은 음 추적이 한 음을 옥타브 위로 잘못 읽어 0.2~0.27초 조각으로 잘렸다 — D4 는 C4 샘플, C5 는 G#4 샘플이 낸다.
MIN_SAMPLE_S = {"gayageum": 0.5}


def catalog() -> dict:
    data = json.loads((APP / "shared" / "instruments.json").read_text(encoding="utf-8"))
    return {i["code"]: i for i in data["instruments"]}


def load_mono(path: Path) -> tuple[np.ndarray, int]:
    sr, x = wavfile.read(path)
    x = x.astype(np.float64)
    if x.ndim == 2:
        x = x.mean(axis=1)
    peak = np.max(np.abs(x)) or 1.0
    return x / peak, sr


# ---------------------------------------------------------------------------------------------
# 음높이(YIN)와 음 나누기
# ---------------------------------------------------------------------------------------------
def yin_track(x: np.ndarray, sr: int, fmin: float = 50.0, fmax: float = 1500.0):
    """프레임별 (기본 주파수, 비주기성, RMS dB). 비주기성이 낮을수록 음높이가 또렷하다."""
    n_frames = max(0, (len(x) - FRAME) // HOP)
    tau_min, tau_max = int(sr / fmax), min(int(sr / fmin), FRAME // 2)
    f0 = np.zeros(n_frames)
    ap = np.ones(n_frames)
    rms = np.zeros(n_frames)
    for i in range(n_frames):
        fr = x[i * HOP: i * HOP + FRAME]
        rms[i] = 20 * math.log10(np.sqrt(np.mean(fr * fr)) + 1e-9)
        w = FRAME // 2
        # 차이 함수: d(t) = r(0)+r_t(0)-2r(t) — FFT 자기상관으로 빠르게
        a = fr[:w]
        corr = np.fft.irfft(np.fft.rfft(fr, 2 * FRAME) * np.conj(np.fft.rfft(a, 2 * FRAME)))[: tau_max + 1]
        e = np.cumsum(fr * fr)
        energy_a = e[w - 1]
        energy_t = e[np.arange(tau_max + 1) + w - 1] - np.concatenate(([0.0], e[: tau_max]))
        d = energy_a + energy_t - 2 * corr
        d[0] = 0
        cmnd = d[1:] * np.arange(1, tau_max + 1) / (np.cumsum(d[1:]) + 1e-12)
        cmnd = np.concatenate(([1.0], cmnd))
        seg = cmnd[tau_min: tau_max]
        below = np.where(seg < 0.15)[0]
        t = (below[0] if len(below) else int(np.argmin(seg))) + tau_min
        # 첫 극소점까지 내려간다
        while t + 1 < tau_max and cmnd[t + 1] < cmnd[t]:
            t += 1
        # 포물선 보간
        if 1 <= t < tau_max:
            s0, s1, s2 = cmnd[t - 1], cmnd[t], cmnd[t + 1]
            den = s0 - 2 * s1 + s2
            t_ref = t + (0.5 * (s0 - s2) / den if den else 0.0)
        else:
            t_ref = float(t)
        f0[i] = sr / t_ref if t_ref > 0 else 0.0
        ap[i] = cmnd[t]
    return f0, ap, rms


@dataclass
class Note:
    start: int          # 샘플 위치
    end: int
    midi: float
    energy: float
    frames: list = field(default_factory=list)


def segment_notes(x: np.ndarray, sr: int, sustained: bool) -> list[Note]:
    f0, ap, rms = yin_track(x, sr)
    top = np.percentile(rms, 99)
    voiced = (rms > top - 38) & (ap < 0.3) & (f0 > 0)
    midi = np.where(f0 > 0, 69 + 12 * np.log2(np.maximum(f0, 1e-6) / 440.0), 0)
    notes: list[Note] = []
    cur: list[int] = []

    def close():
        if len(cur) * HOP / sr >= 0.12:
            m = float(np.median(midi[cur[len(cur) // 4: max(len(cur) // 4 + 1, 3 * len(cur) // 4)]]))
            notes.append(Note(cur[0] * HOP, (cur[-1] + 1) * HOP + FRAME // 2, m, float(np.max(rms[cur])), list(cur)))

    for i in range(len(f0)):
        if not voiced[i]:
            if cur:
                close()
                cur = []
            continue
        if cur:
            ref = float(np.median(midi[cur[-8:]]))
            jump = abs(midi[i] - ref) > 0.7
            # 발현 악기는 같은 음을 다시 뜯으면 에너지가 크게 오른다
            onset = (not sustained) and rms[i] - rms[i - 1] > 6
            if jump or onset:
                # 짧은 흔들림(시김새·잡음)이면 넘긴다: 다음 3프레임도 다른 음이면 끊는다
                ahead = midi[i: i + 3]
                if onset or (len(ahead) == 3 and np.all(np.abs(ahead - ref) > 0.7) and voiced[i: i + 3].all()):
                    close()
                    cur = []
        cur.append(i)
    if cur:
        close()
    return notes


def pick_per_key(notes: list[Note]) -> dict[int, Note]:
    """같은 건반은 가장 크고 긴 음 하나만"""
    best: dict[int, Note] = {}
    for n in notes:
        k = int(round(n.midi))
        score = n.energy + 10 * math.log10(max(n.end - n.start, 1))
        if k not in best or score > best[k].energy + 10 * math.log10(max(best[k].end - best[k].start, 1)):
            best[k] = n
    return best


# ---------------------------------------------------------------------------------------------
# 샘플 다듬기
# ---------------------------------------------------------------------------------------------
@dataclass
class Sample:
    name: str
    data: np.ndarray    # int16
    sr: int
    root: int
    cents: int
    loop: tuple[int, int] | None


def rising_zero_crossings(x: np.ndarray) -> np.ndarray:
    return np.where((x[:-1] < 0) & (x[1:] >= 0))[0] + 1


def find_loop(x: np.ndarray, sr: int, f0: float) -> tuple[int, int] | None:
    """가운데 안정 구간에서 반복 구간을 찾는다. 시작·끝 모두 오르는 영점, 두 지점의 파형이 가장 닮은 곳."""
    n = len(x)
    if n < sr * 0.4:
        return None
    zc = rising_zero_crossings(x)
    a_target, b_target = int(n * 0.35), int(n * 0.8)
    starts = zc[(zc > a_target - sr * 0.05) & (zc < a_target + sr * 0.05)]
    ends = zc[(zc > b_target - sr * 0.1) & (zc < b_target + sr * 0.05)]
    if len(starts) == 0 or len(ends) == 0:
        return None
    win = max(32, int(sr / max(f0, 60)))
    best, best_err = None, float("inf")
    for s in starts[:12]:
        ref = x[s: s + win]
        for e in ends[:: max(1, len(ends) // 60)]:
            if e + win >= n or e - s < sr * 0.15:
                continue
            err = float(np.sum((x[e: e + win] - ref) ** 2))
            if err < best_err:
                best, best_err = (int(s), int(e)), err
    return best


def to_int16(x: np.ndarray) -> np.ndarray:
    return np.clip(np.round(x * 32767), -32768, 32767).astype(np.int16)


def fade_out(x: np.ndarray, sr: int, ms: float) -> np.ndarray:
    n = min(len(x), int(sr * ms / 1000))
    y = x.copy()
    if n > 0:
        y[-n:] *= np.linspace(1, 0, n)
    return y


def trim_tail(x: np.ndarray, sr: int, floor_db: float = -50, max_s: float = 2.5) -> np.ndarray:
    env = np.abs(x)
    idx = np.where(env > 10 ** (floor_db / 20))[0]
    end = min(len(x), (idx[-1] + int(sr * 0.02)) if len(idx) else len(x), int(sr * max_s))
    return x[:end]


def melodic_samples(code: str, files: list[str], sustained: bool) -> tuple[list[Sample], list[dict]]:
    samples: list[Sample] = []
    report: list[dict] = []
    for fname in files:
        x, sr = load_mono(SRC / fname)
        notes = sorted(pick_per_key(segment_notes(x, sr, sustained)).values(), key=lambda n: n.midi)
        all_starts = sorted(n.start for n in segment_notes(x, sr, sustained))
        for n in notes:
            key = int(round(n.midi))
            cents = int(round((n.midi - key) * 100))
            pre = int(sr * 0.01)
            start = max(0, n.start - pre)
            if sustained:
                seg = x[start: min(len(x), n.end, start + int(sr * 4))]
            else:
                # 발현 악기: 다음 음이 나기 전까지의 감쇠를 담는다
                nxt = next((s for s in all_starts if s > n.start + sr * 0.05), len(x))
                seg = trim_tail(x[start: min(nxt, start + int(sr * 3))], sr)
            if len(seg) < sr * 0.1:
                continue
            seg = seg / (np.max(np.abs(seg)) or 1) * 0.89   # -1 dBFS
            loop = find_loop(seg, sr, 440 * 2 ** ((n.midi - 69) / 12)) if sustained else None
            if loop is None:
                seg = fade_out(seg, sr, 30)
            samples.append(Sample(f"{code}_{key}", to_int16(seg), sr, key, -cents, loop))
            report.append({"instrument": code, "file": fname, "key": key, "cents": cents,
                           "start_s": round(start / sr, 3), "length_s": round(len(seg) / sr, 3), "loop": loop is not None})
    # 같은 건반이 여러 파일에서 나오면 첫 것만
    seen, uniq = set(), []
    for s in sorted(samples, key=lambda s: s.root):
        if s.root not in seen:
            seen.add(s.root)
            uniq.append(s)
    return uniq, report


# ---------------------------------------------------------------------------------------------
# SF2 쓰기 (SoundFont 2.01)
# ---------------------------------------------------------------------------------------------
GEN = {"keyRange": 43, "velRange": 44, "instrument": 41, "sampleID": 53, "sampleModes": 54,
       "overridingRootKey": 58, "fineTune": 52, "releaseVolEnv": 38, "exclusiveClass": 57, "attenuation": 48}


def chunk(cid: bytes, data: bytes) -> bytes:
    pad = b"\0" if len(data) % 2 else b""
    return cid + struct.pack("<I", len(data)) + data + pad


def list_chunk(kind: bytes, body: bytes) -> bytes:
    return chunk(b"LIST", kind + body)


def name20(s: str) -> bytes:
    return s.encode("ascii", "replace")[:19].ljust(20, b"\0")


def gen(op: str, amount: int) -> bytes:
    return struct.pack("<Hh", GEN[op], amount)


def gen_range(op: str, lo: int, hi: int) -> bytes:
    return struct.pack("<HBB", GEN[op], lo, hi)


def timecents(seconds: float) -> int:
    return int(round(1200 * math.log2(max(seconds, 0.001))))


@dataclass
class Zone:
    sample: int
    key_lo: int
    key_hi: int
    vel_lo: int = 0
    vel_hi: int = 127
    root: int | None = None
    release_s: float = 0.35
    exclusive: int = 0


def write_sf2(path: Path, samples: list[Sample], instruments: list[tuple[str, list[Zone]]],
              presets: list[tuple[str, int, int, int]]) -> None:
    # sdta: 샘플마다 뒤에 0 46개
    smpl = bytearray()
    shdr = bytearray()
    for s in samples:
        start = len(smpl) // 2
        smpl += s.data.tobytes() + b"\0" * 92
        end = start + len(s.data)
        ls, le = (start + s.loop[0], start + s.loop[1]) if s.loop else (start, end - 1)
        shdr += name20(s.name) + struct.pack("<IIIIIBbHH", start, end, ls, le, s.sr, s.root, s.cents, 0, 1)
    shdr += name20("EOS") + b"\0" * 26

    inst = bytearray()
    ibag = bytearray()
    igen = bytearray()
    bag_i = 0
    gen_i = 0
    for iname, zones in instruments:
        inst += name20(iname) + struct.pack("<H", bag_i)
        for z in zones:
            ibag += struct.pack("<HH", gen_i, 0)
            bag_i += 1
            g = [gen_range("keyRange", z.key_lo, z.key_hi), gen_range("velRange", z.vel_lo, z.vel_hi),
                 gen("releaseVolEnv", timecents(z.release_s))]
            if samples[z.sample].loop:
                g.append(gen("sampleModes", 1))
            if z.root is not None:
                g.append(gen("overridingRootKey", z.root))
            if z.exclusive:
                g.append(gen("exclusiveClass", z.exclusive))
            g.append(gen("sampleID", z.sample))
            igen += b"".join(g)
            gen_i += len(g)
    inst += name20("EOI") + struct.pack("<H", bag_i)
    ibag += struct.pack("<HH", gen_i, 0)
    igen += struct.pack("<HH", 0, 0)
    imod = b"\0" * 10

    phdr = bytearray()
    pbag = bytearray()
    pgen = bytearray()
    for i, (pname, program, bank, inst_idx) in enumerate(presets):
        phdr += name20(pname) + struct.pack("<HHHIII", program, bank, i, 0, 0, 0)
        pbag += struct.pack("<HH", i, 0)
        pgen += gen("instrument", inst_idx)
    phdr += name20("EOP") + struct.pack("<HHHIII", 0, 0, len(presets), 0, 0, 0)
    pbag += struct.pack("<HH", len(presets), 0)
    pgen += struct.pack("<HH", 0, 0)
    pmod = b"\0" * 10

    info = (chunk(b"ifil", struct.pack("<HH", 2, 1)) + chunk(b"isng", b"EMU8000\0")
            + chunk(b"INAM", "Gugak (NGC samples)".encode() + b"\0")
            + chunk(b"ICOP", "Source: National Gugak Center digital sounds, KOGL Type 1 (attribution)".encode() + b"\0")
            + chunk(b"ICMT", "Built by app/ops/soundfonts/build_gugak_sf2.py for team3 gugak score service (non-commercial/education)".encode() + b"\0"))
    sdta = chunk(b"smpl", bytes(smpl))
    pdta = (chunk(b"phdr", bytes(phdr)) + chunk(b"pbag", bytes(pbag)) + chunk(b"pmod", pmod) + chunk(b"pgen", bytes(pgen))
            + chunk(b"inst", bytes(inst)) + chunk(b"ibag", bytes(ibag)) + chunk(b"imod", imod) + chunk(b"igen", bytes(igen))
            + chunk(b"shdr", bytes(shdr)))
    body = b"sfbk" + list_chunk(b"INFO", info) + list_chunk(b"sdta", sdta) + list_chunk(b"pdta", pdta)
    path.write_bytes(b"RIFF" + struct.pack("<I", len(body)) + body)


# ---------------------------------------------------------------------------------------------
def main() -> int:
    missing = [f for files, _ in MELODIC.values() for f in files if not (SRC / f).exists()]
    missing += [d[0] for d in DRUMS if not (SRC / d[0]).exists()]
    if missing:
        print("원천 WAV 가 없습니다:", missing, "\n→ app/assets/soundfonts/SOURCES.md 의 내려받기 절차를 따르세요.")
        return 1
    cat = catalog()
    samples: list[Sample] = []
    instruments: list[tuple[str, list[Zone]]] = []
    presets: list[tuple[str, int, int, int]] = []
    report: dict = {"melodic": [], "drums": []}

    for code, (files, sustained) in MELODIC.items():
        found, rep = melodic_samples(code, files, sustained)
        if code in MIN_SAMPLE_S:
            short = {s.root for s in found if len(s.data) / s.sr < MIN_SAMPLE_S[code]}
            found = [s for s in found if s.root not in short]
            for r in rep:
                if r["key"] in short:
                    r["excluded"] = f"{MIN_SAMPLE_S[code]}초보다 짧아 싣지 않음"
        report["melodic"] += rep
        if not found:
            print(f"경고: {code} 에서 음을 찾지 못함")
            continue
        base = len(samples)
        samples += found
        info = cat[code]
        # (2026-09-30 박예은 팀장 결정) 음역으로 제한하지 않는다 — 맨 아래·맨 위 샘플이 건반 0~127 전체를 맡아
        # 악기 음역 밖의 음도 소리가 난다(전에는 음역 ±12반음 밖은 소리가 나지 않았다). 끝 음은 원본에서 멀리 늘여 음색이 달라질 수 있다.
        lo_lim, hi_lim = 0, 127
        zones: list[Zone] = []
        for j, s in enumerate(found):
            lo = lo_lim if j == 0 else (found[j - 1].root + s.root) // 2 + 1
            hi = hi_lim if j == len(found) - 1 else (s.root + found[j + 1].root) // 2
            zones.append(Zone(base + j, max(0, lo), min(127, hi), release_s=0.25 if sustained else 0.6))
        instruments.append((info["name_ko"] and code, zones))
        presets.append((code, int(info["program"]), int(info["bank"]), len(instruments) - 1))
        print(f"{code}: {len(found)}음 ({found[0].root}~{found[-1].root}), bank {info['bank']} program {info['program']}")

    drum_zones: list[Zone] = []
    for fname, keys, (vlo, vhi), label in DRUMS:
        x, sr = load_mono(SRC / fname)
        # 치는 순간 앞 무음을 걷어 낸다
        on = int(np.argmax(np.abs(x) > 0.05))
        seg = trim_tail(x[max(0, on - int(sr * 0.003)):], sr, -48, 2.0)
        seg = fade_out(seg / (np.max(np.abs(seg)) or 1) * 0.89, sr, 20)
        idx = len(samples)
        samples.append(Sample(f"drum_{fname[:-4]}", to_int16(seg), sr, keys[0], 0, None))
        for k in keys:
            drum_zones.append(Zone(idx, k, k, vlo, vhi, root=k, release_s=0.4))
        report["drums"].append({"file": fname, "label": label, "keys": keys, "vel": [vlo, vhi], "length_s": round(len(seg) / sr, 3)})
    instruments.append(("janggu_buk", drum_zones))
    kit = {(int(cat[c]["bank"]), int(cat[c]["program"])) for c in ("janggu", "buk")}
    if len(kit) != 1 or next(iter(kit))[0] != 128:
        print("장구·북의 bank·program 이 타악 세트 한 자리(bank 128)가 아닙니다:", kit)
        return 1
    kit_bank, kit_program = kit.pop()
    presets.append(("gugak_kit", kit_program, kit_bank, len(instruments) - 1))

    write_sf2(OUT, samples, instruments, presets)
    (OUT.with_suffix(".sf2.json")).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"만듦: {OUT} ({OUT.stat().st_size / 1e6:.1f} MB, 샘플 {len(samples)}개, 프리셋 {len(presets)}개)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
