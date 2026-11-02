"""#29·#30 구조에서의 위치: 모델 등록부 → 이 파일 → homr·정간보 어댑터. DB·파일은 저장하지 않는다."""
import json
from pathlib import Path

from app.engines.homr import HomrEngine
from app.engines.jeongganbo import JeongganboEngine


class UnknownAdapterError(ValueError):
    pass


def build_adapter(model_row: dict, *, engines_dir: Path | None = None):
    import os
    root = engines_dir or Path(os.environ.get("ENGINES_DIR", "/opt/gugak-engines"))
    options = model_row.get("config_json") or {}
    options = json.loads(options) if isinstance(options, str) else dict(options)
    adapters = {"homr": HomrEngine, "jeongganbo": JeongganboEngine}
    adapter = options.get("adapter")
    if model_row.get("provider") != "venv" or adapter not in adapters:
        raise UnknownAdapterError("지원하는 인식 어댑터는 homr·jeongganbo입니다")
    ref = model_row.get("provider_ref") or f"~/gugak-engines/{adapter}"
    folder = root / ref.removeprefix("~/gugak-engines/") if ref.startswith("~/gugak-engines/") else Path(ref)
    if not folder.is_absolute():
        raise UnknownAdapterError("엔진 위치는 절대 경로여야 합니다")
    return adapters[adapter](model_row["model_name"], folder, options)
