"""연주 옵션 해석 (UC13 A1·A2·A2-1 · BR-API-08 · InstrumentAssignment).

instruments = {mode: default|recommend|original|custom, tracks?: [{part, instrument, sf2_ref?}]}
- default  : 기본 국악기 구성(가야금 · 장구)
- recommend: 추천 첫 조합(부르는 쪽이 코드 목록을 넘긴다). 실패하면 기본 구성
- original : 올린 파일의 원래 악기 그대로(정보가 없으면 기본 구성)
- custom   : 성부별 지정(part 는 0부터 센 성부 번호 — ScoreDoc EditOp 와 같다). DB 에는 'explicit'

타악 파트 처리(T150 — spec 에 "없으면 만든다"는 규칙이 없어 지금 동작을 규칙으로 못 박음, R10 · 화면 ensemble.ts 와 같음):
- default·recommend: 타악 악기(장구·북)는 **이미 있는 타악 성부**(MIDI 채널 10 · MusicXML 타악 파트)에만 놓는다.
  악보에 타악 성부가 없으면 타악 파트를 **새로 만들지 않는다**(ADD_MISSING_PERCUSSION = False).
  선율 음표를 타악 채널로 복사하면 음높이 대신 엉뚱한 북 소리가 나기 때문이다.
- custom: 부르는 쪽이 성부 번호로 타악기를 고르면 그대로 따른다(없는 번호면 첫 성부 복사 — 화면 [악기 추가]와 같음).
- original: 원래 악기 그대로.

성부별 음원(T150 · R5): 성부마다 쓸 .sf2 를 render_fonts() 로 정한다 — 악기 목록(shared/instruments.json)의
soundfont(gugak.sf2 → 'gugak', FluidR3_GM.sf2 → 'gm'), tracks[].sf2_ref 가 있으면 그것이 우선.
성부별 소리 번호(결정 C11): render_presets() 가 gugak.sf2 로 연주할 국악기 성부의 (bank, program) 을 정한다 —
국악기 bank 1 · program 0~5, 장구·북 bank 128 · program 1. 악보(MIDI·MusicXML)에는 GM 호환 번호(gm_program)가
그대로 적히고, 렌더러가 MP3 를 만들 때만 이 번호로 바꿔 부른다(내려받는 파일은 다른 프로그램도 읽을 수 있게 GM).
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field

from app.errors import ApiError
from app.services import scoreio
from app.services.catalog import default_ensemble, instruments

API_MODES = ("default", "recommend", "original", "custom")
ADD_MISSING_PERCUSSION = False  # 타악 성부가 없는 악보에 장구 파트를 더하지 않는다(위 설명)

# 기본 음원 이름 → 렌더러 음원 키(fluidsynth_mp3.FONT_*). 연주 API 의 sf2_ref 는 이 이름만 받는다.
BUILTIN_FONTS = {"gugak.sf2": "gugak", "gugak": "gugak", "fluidr3_gm.sf2": "gm", "gm": "gm"}
SF2_REF_ATTR = "gugak_sf2_ref"  # apply_tracks 가 성부(music21 Part)에 붙이는 표시
DB_MODE = {"default": "default", "recommend": "recommend", "original": "original", "custom": "explicit"}


@dataclass
class Assignment:
    mode: str = "default"
    tracks: list[dict] = field(default_factory=list)

    @property
    def db_mode(self) -> str:
        return DB_MODE[self.mode]


def parse_assignment(raw: str | None) -> Assignment:
    """폼의 instruments(JSON 글자) → Assignment. 알 수 없는 악기 코드는 VALIDATION_ERROR(422, 2026-09-30)."""
    if raw is None or not raw.strip():
        return Assignment()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ApiError("VALIDATION_ERROR", details={"field": "instruments", "reason": "JSON 이 아닙니다"}) from exc
    if isinstance(data, str):
        data = {"mode": data}
    if not isinstance(data, dict):
        raise ApiError("VALIDATION_ERROR", details={"field": "instruments"})
    mode = data.get("mode") or ("custom" if data.get("tracks") else "default")
    if mode == "explicit":
        mode = "custom"
    if mode not in API_MODES:
        raise ApiError("VALIDATION_ERROR", details={"field": "instruments.mode", "allowed": list(API_MODES)})
    tracks = []
    catalog = instruments()
    for i, t in enumerate(data.get("tracks") or []):
        if not isinstance(t, dict) or t.get("instrument") not in catalog:
            raise ApiError("VALIDATION_ERROR", details={"field": f"instruments.tracks[{i}].instrument",
                                                   "allowed": sorted(catalog)})
        part = t.get("part", i)
        if not isinstance(part, int) or part < 0:
            raise ApiError("VALIDATION_ERROR", details={"field": f"instruments.tracks[{i}].part"})
        tracks.append({"part": part, "instrument": t["instrument"], "sf2_ref": t.get("sf2_ref")})
    if mode == "custom" and not tracks:
        raise ApiError("VALIDATION_ERROR", details={"field": "instruments.tracks", "reason": "custom 에는 tracks 가 필요합니다"})
    return Assignment(mode=mode, tracks=tracks)


def apply_tracks(score, tracks: list[dict]) -> list[str]:
    """성부 번호별로 악기를 놓는다. 없는 번호는 첫 성부를 복사해 더한다(melody_copy)."""
    parts = list(score.parts)
    if not parts:
        return []
    used = []
    for t in sorted(tracks, key=lambda x: x["part"]):
        code = t["instrument"]
        if t["part"] < len(parts):
            part = parts[t["part"]]
        else:
            part = copy.deepcopy(parts[0])
            part.id = f"P{len(parts) + 1}"
            score.insert(0, part)
            parts.append(part)
        info = instruments()[code]
        channel = scoreio.PERCUSSION_CHANNEL if info.is_percussion else scoreio._melodic_channel(len(used))
        scoreio._set_instrument(part, scoreio._make_instrument(code, channel))
        setattr(part, SF2_REF_ATTR, t.get("sf2_ref"))
        used.append(code)
    return used


def arrange(score, *, assignment: Assignment, codes: list[str] | None, transpose: int, volume: float) -> list[str]:
    """악기 → 조옮김 → 음량 순서로 score 를 바꾼다. 실제로 놓인 악기 코드를 돌려준다(original 이면 빈 목록)."""
    if assignment.mode == "custom":
        used = apply_tracks(score, assignment.tracks)
    elif assignment.mode == "original" and codes is None:
        used = []
    else:
        # 타악 성부가 없으면 타악 코드는 놓이지 않는다(ADD_MISSING_PERCUSSION = False)
        used = scoreio.apply_ensemble(score, codes or default_ensemble())
    scoreio.transpose(score, transpose)
    scoreio.scale_volume(score, volume)
    return used


def builtin_font(ref: str | None) -> str | None:
    """sf2_ref 가 기본 음원 이름이면 음원 키('gugak'|'gm'), 아니면 None."""
    return BUILTIN_FONTS.get(ref.strip().lower()) if isinstance(ref, str) and ref.strip() else None


def check_sf2_refs(assignment: Assignment) -> None:
    """tracks[].sf2_ref 는 기본 음원 이름(gugak.sf2 · FluidR3_GM.sf2)만 된다 — 사용자 음원(.sf2)은 받지 않는다
    (US8 삭제, 2026-09-29). 모르는 이름을 조용히 무시하지 않고 거절한다(T150)."""
    for i, t in enumerate(assignment.tracks):
        ref = t.get("sf2_ref")
        if ref is not None and builtin_font(ref) is None:
            raise ApiError("VALIDATION_ERROR", details={
                "field": f"instruments.tracks[{i}].sf2_ref", "allowed": ["gugak.sf2", "FluidR3_GM.sf2"],
                "reason": "사용자 음원은 받지 않습니다. 기본 음원 이름만 쓸 수 있습니다"})


def render_fonts(score, resolve_ref=builtin_font) -> list[str | None]:
    """성부(score.parts 순서)별 렌더링 음원 — 'gugak' | 'gm' | .sf2 경로 | None(정하지 않음 = 기본 겹침).

    1) apply_tracks 가 붙인 sf2_ref 를 resolve_ref 로 풀 수 있으면 그것
    2) 성부 악기 이름이 악기 목록의 한글 이름이면 그 악기의 soundfont
    3) 그 밖(원래 악기 등)은 None
    """
    by_name = {info.name_ko: info for info in instruments().values()}
    out: list[str | None] = []
    for part in score.parts:
        ref = getattr(part, SF2_REF_ATTR, None)
        font = resolve_ref(ref) if ref else None
        if font is None:
            inst = part.getInstrument(returnDefault=False)
            info = by_name.get((inst.instrumentName or "") if inst is not None else "")
            sf = (getattr(info, "soundfont", None) or "") if info is not None else ""
            font = builtin_font(sf)
        out.append(font)
    return out


def render_presets(score, fonts: list[str | None] | None = None) -> list[tuple[int, int] | None]:
    """성부(score.parts 순서)별 서비스 음원 소리 번호 (bank, program) — 결정 C11.

    악기 목록의 악기이고 그 성부를 gugak.sf2 로 연주할 때(render_fonts 가 'gugak')만 목록의 bank·program 을 돌려준다
    (국악기 bank 1 · program 0~5, 장구·북 bank 128 · program 1). 그 밖(다른 악기 = GM 번호 그대로 bank 0,
    원래 악기, sf2_ref 로 GM 음원만 고른 성부)은 None — MIDI 에 적힌 GM 번호를 그대로 쓴다.
    """
    if fonts is None:
        fonts = render_fonts(score)
    by_name = {info.name_ko: info for info in instruments().values()}
    out: list[tuple[int, int] | None] = []
    for part, font in zip(score.parts, fonts, strict=False):
        inst = part.getInstrument(returnDefault=False)
        info = by_name.get((inst.instrumentName or "") if inst is not None else "")
        if (font == "gugak" and info is not None and info.soundfont == "gugak.sf2"
                and info.bank is not None and info.program is not None):
            out.append((int(info.bank), int(info.program)))
        else:
            out.append(None)
    return out
