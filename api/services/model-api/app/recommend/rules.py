"""#88 규칙표 추천 — 빠르기 × 선법 칸에서 국악기 조합을 고른다. 추천의 마지막 안전판이다.

구조에서의 위치: (아직 연결 안 됨) /v1/recommend → features.py → 이 파일 → app/resources/rules.yaml · SHARED_DIR/instruments.json.
    DB · 엔진 · 네트워크를 쓰지 않는다. Ollama 가 없어도 이것만으로 답한다 (#88 완료 기준).
    v0.1.1 app/recommend/rules.py 를 옮겼다.

- 모델 이름 'rules', 버전 = rules.yaml 내용 해시 앞 12자.
    app/resources/startup.py 가 /v1/models 에 내는 rules 모델의 version 과 같은 값이다 (같은 파일 · 같은 계산).
- 칸이 비어 있으면 기본 국악기 구성(가야금 · 장구) 하나를 돌려준다.
- 악기 코드는 shared/instruments.json 과 대조한다. 목록에 없는 코드는 빼고, 남는 악기가 없는 조합은 버린다.

v0.1.1 에 없던 것 — 음역 순서
    한 칸의 조합(최대 3개)을 **선율이 그 조합의 선율 악기 음역에 얼마나 들어가는가** 순으로 다시 놓는다.
    규칙표는 빠르기 · 선법만 보는데, 같은 '느린 평조' 라도 낮은 곡에는 거문고 조합이, 높은 곡에는 대금 조합이 먼저 나오는 게 맞다.
    옥타브를 통째로 옮기면 들어가는 경우(조옮김 12 · 24반음)는 들어가는 것으로 친다 — 화면에 [음역에 맞게 옮기기]가 있다.
    음역이 같게 맞으면 규칙표에 적힌 순서를 지킨다. 조합을 지어내거나 빼지는 않는다.
"""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

from app.recommend.features import MODE_LABEL, TEMPO_LABEL, Features
from app.services.catalog import Instrument, default_ensemble, instruments, label_of

RULES_PATH = Path(__file__).resolve().parent.parent / "resources" / "rules.yaml"
MAX_COMBINATIONS = 3
OCTAVE_SHIFTS = (0, 12, -12, 24, -24)


@lru_cache(maxsize=1)
def _load() -> tuple[dict, str]:
    import yaml

    raw = RULES_PATH.read_bytes()
    return yaml.safe_load(raw) or {}, hashlib.sha256(raw).hexdigest()[:12]


def rules_hash() -> str:
    return _load()[1]


def clean_combination(item: dict, catalog: dict[str, Instrument]) -> dict | None:
    """악기 코드를 목록과 대조하고 중복을 뺀다. 남는 악기가 없으면 None."""
    codes: list[str] = []
    for code in item.get("instruments") or []:
        if isinstance(code, str) and code in catalog and code not in codes:
            codes.append(code)
    if not codes:
        return None
    label = str(item.get("label") or "").strip() or label_of(codes)
    # 계약: 조합마다 label · instruments · reason 이 모두 있어야 한다. 이유가 비어 있으면 빈 문자열로 둔다
    return {"label": label[:60], "instruments": codes, "reason": str(item.get("reason") or "")[:200]}


def range_fit(pitch_seconds: dict[int, float], low: int | None, high: int | None) -> float:
    """선율이 음역 [low, high] 에 들어가는 비중(울린 시간 기준, 0~1). 옥타브를 통째로 옮겨 가장 잘 맞는 경우를 본다."""
    total = sum(pitch_seconds.values())
    if total <= 0 or (low is None and high is None):
        return 1.0
    lo = -1 if low is None else low
    hi = 128 if high is None else high
    best = 0.0
    for shift in OCTAVE_SHIFTS:
        inside = sum(sec for pitch, sec in pitch_seconds.items() if lo <= pitch + shift <= hi)
        best = max(best, inside / total)
    return round(best, 4)


def combination_fit(combo: dict, features: Features, catalog: dict[str, Instrument]) -> float:
    """조합의 선율 악기들 중 가장 잘 맞는 악기의 음역 적합도. 선율 악기가 없으면(타악만) 1.0."""
    melodic = [catalog[c] for c in combo["instruments"] if not catalog[c].is_percussion]
    if not melodic or not features.pitch_seconds:
        return 1.0
    return max(range_fit(features.pitch_seconds, i.range_low, i.range_high) for i in melodic)


def recommend(features: Features) -> list[dict]:
    """특징 → 조합 목록(최대 3개). 언제나 하나 이상 돌려준다."""
    table, _ = _load()
    catalog = instruments()
    cell = ((table.get("rules") or {}).get(features.tempo) or {}).get(features.mode) or []
    combos = [c for c in (clean_combination(i, catalog) for i in cell if isinstance(i, dict)) if c]
    if combos:
        # 음역이 잘 맞는 조합 먼저. sorted 는 순서를 지키므로 같으면 규칙표 순서 그대로다
        ranked = sorted(combos, key=lambda c: -combination_fit(c, features, catalog))
        return ranked[:MAX_COMBINATIONS]
    codes = [c for c in default_ensemble() if c in catalog]
    return [{
        "label": label_of(codes),
        "instruments": codes,
        "reason": f"{TEMPO_LABEL[features.tempo]}·{MODE_LABEL[features.mode]} 칸이 아직 비어 있어 기본 국악기 구성을 추천합니다.",
    }]


def recommend_response(features: Features) -> dict:
    """계약 RecommendationResponse 모양의 본문 (recommendation_id 는 기록을 남긴 쪽이 붙인다)."""
    return {
        "api_version": "v1", "available": True, "reason": None, "pending": False,
        "combinations": recommend(features),
        "model": {"name": "rules", "version": rules_hash(), "provider": "builtin"},
        "features": features.public(),
        "tried": [{"name": "rules", "outcome": "ok"}],
    }
