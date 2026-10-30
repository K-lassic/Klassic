"""악기 목록(shared/instruments.json) — 추천·연주가 같은 코드를 쓴다(INTERFACES §1)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache

from app.config import APP_ROOT


@dataclass(frozen=True)
class Instrument:
    code: str
    name_ko: str
    family: str  # 'gugak' | 'other'
    gm_program: int | None  # GM 호환 번호 — 내려받는 MIDI·MusicXML, gugak.sf2 가 없을 때
    is_percussion: bool
    soundfont: str | None
    range_low: int | None
    range_high: int | None
    # 서비스 음원(화면 연주·MP3)에서 소리를 고르는 번호(결정 C11): 다른 악기 bank 0 = GM, 국악기 bank 1, 장구·북 bank 128 program 1
    bank: int | None = None
    program: int | None = None


@lru_cache(maxsize=1)
def _raw() -> dict:
    return json.loads((APP_ROOT / "shared" / "instruments.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def instruments() -> dict[str, Instrument]:
    out: dict[str, Instrument] = {}
    for item in _raw()["instruments"]:
        out[item["code"]] = Instrument(
            code=item["code"], name_ko=item["name_ko"], family=item["family"], gm_program=item.get("gm_program"),
            is_percussion=bool(item.get("is_percussion")), soundfont=item.get("soundfont"),
            range_low=item.get("range_low"), range_high=item.get("range_high"),
            bank=item.get("bank"), program=item.get("program"),
        )
    return out


def default_ensemble() -> list[str]:
    """기본 국악기 구성 = 선율 가야금 + 타악 장구(BR-PLY-01)."""
    return [m["instrument"] for m in _raw()["default_ensemble"]]


def gugak_first_codes() -> list[str]:
    """국악기 먼저(BR-PLY-03)."""
    items = list(instruments().values())
    return [i.code for i in items if i.family == "gugak"] + [i.code for i in items if i.family != "gugak"]


def label_of(codes: list[str]) -> str:
    cat = instruments()
    return " · ".join(cat[c].name_ko for c in codes if c in cat)
