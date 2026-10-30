"""model_registry 행(dict) → 엔진 어댑터 (T039·T040, INTERFACES §6-1 provider 'venv').

행 예: {'model_name': 'homr', 'provider': 'venv', 'provider_ref': '~/gugak-engines/homr',
        'config_json': '{"adapter":"homr","cold_start_hint_s":40}', ...}
config_json.adapter 가 homr|audiveris|jeongganbo 중 하나여야 한다. ENGINES_DIR 로 기본 폴더를 바꿀 수 있다.
"""

from __future__ import annotations

import json
from typing import Any

from app.engines.audiveris import AudiverisEngine
from app.engines.base import EngineAdapter, VenvEngine, resolve_ref
from app.engines.homr import HomrEngine
from app.engines.jeongganbo import JeongganboEngine

ADAPTERS: dict[str, type[VenvEngine]] = {
    "homr": HomrEngine,
    "audiveris": AudiverisEngine,
    "jeongganbo": JeongganboEngine,
}

# 시드(db/seeds/001_initial.sql)와 같은 기본 인식 엔진 행 — DB 없이 selftest 에서 쓴다
DEFAULT_ROWS: list[dict[str, Any]] = [
    {"model_name": "homr", "kind": "omr_staff", "provider": "venv", "provider_ref": "~/gugak-engines/homr",
     "config_json": '{"adapter":"homr","cold_start_hint_s":40}'},
    {"model_name": "audiveris", "kind": "omr_staff", "provider": "venv", "provider_ref": "~/gugak-engines/audiveris",
     "config_json": '{"adapter":"audiveris","java":"/opt/homebrew/opt/openjdk@21/bin/java","cold_start_hint_s":20}'},
    {"model_name": "jeongganbo-omr", "kind": "omr_jeongganbo", "provider": "venv",
     "provider_ref": "~/gugak-engines/jeongganbo",
     "config_json": '{"adapter":"jeongganbo","device":"mps","cold_start_hint_s":30}'},
]


class UnknownAdapterError(ValueError):
    """등록부 행으로 어댑터를 만들 수 없음(provider 가 venv 가 아니거나 adapter 이름을 모름)."""


def _config(row: dict) -> dict:
    cfg = row.get("config_json")
    if cfg is None:
        return {}
    if isinstance(cfg, dict):
        return dict(cfg)
    try:
        val = json.loads(cfg)
    except (TypeError, json.JSONDecodeError) as e:
        raise UnknownAdapterError(f"config_json 을 읽을 수 없음: {e}") from e
    return val if isinstance(val, dict) else {}


def build_adapter(model_row: dict) -> EngineAdapter:
    """model_registry 행으로 인식 엔진 어댑터를 만든다(설치 여부와 상관없이 만들어지고, probe 로 확인)."""
    if model_row.get("provider") != "venv":
        raise UnknownAdapterError(f"인식 엔진 어댑터는 provider 'venv' 만 됨: {model_row.get('provider')}")
    cfg = _config(model_row)
    adapter = cfg.get("adapter")
    cls = ADAPTERS.get(str(adapter))
    if cls is None:
        raise UnknownAdapterError(f"알 수 없는 adapter: {adapter!r} (가능: {', '.join(ADAPTERS)})")
    folder = resolve_ref(model_row.get("provider_ref"), cls.default_folder)
    return cls(str(model_row["model_name"]), folder, cfg)
