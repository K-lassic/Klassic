"""규칙표 추천 (T088·T089, research R18). 항상 마지막 안전판이다.

모델 이름 'rules', 버전 = rules.yaml 내용 해시 앞 12자.
칸이 비어 있으면 기본 국악기 구성(가야금 · 장구) 하나를 돌려준다.
"""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

import yaml

from app.recommend.features import MODE_LABEL, TEMPO_LABEL, Features
from app.services.catalog import default_ensemble, instruments, label_of

RULES_PATH = Path(__file__).with_name("rules.yaml")
MAX_COMBINATIONS = 3


@lru_cache(maxsize=1)
def _load() -> tuple[dict, str]:
    raw = RULES_PATH.read_bytes()
    return yaml.safe_load(raw) or {}, hashlib.sha256(raw).hexdigest()[:12]


def rules_hash() -> str:
    return _load()[1]


def clean_combination(item: dict) -> dict | None:
    """악기 코드를 목록과 대조하고 중복을 뺀다. 남는 악기가 없으면 None."""
    catalog = instruments()
    codes: list[str] = []
    for code in item.get("instruments") or []:
        if isinstance(code, str) and code in catalog and code not in codes:
            codes.append(code)
    if not codes:
        return None
    label = str(item.get("label") or "").strip() or label_of(codes)
    out = {"label": label[:60], "instruments": codes}
    if item.get("reason"):
        out["reason"] = str(item["reason"])[:200]
    return out


def recommend(features: Features) -> list[dict]:
    table, _ = _load()
    cell = ((table.get("rules") or {}).get(features.tempo) or {}).get(features.mode) or []
    combos = [c for c in (clean_combination(i) for i in cell if isinstance(i, dict)) if c]
    if combos:
        return combos[:MAX_COMBINATIONS]
    codes = default_ensemble()
    return [{
        "label": label_of(codes),
        "instruments": codes,
        "reason": f"{TEMPO_LABEL[features.tempo]}·{MODE_LABEL[features.mode]} 칸이 아직 비어 있어 기본 국악기 구성을 추천합니다.",
    }]
