"""DB의 엔진 행을 어댑터로 연결한다. #29는 homr, 정간보는 #30에서 추가한다."""
import json
from pathlib import Path

from app.engines.homr import HomrEngine


class UnknownAdapterError(ValueError):
    pass


def build_adapter(model_row: dict, *, engines_dir: Path | None = None):
    import os
    root = engines_dir or Path(os.environ.get("ENGINES_DIR", "/opt/gugak-engines"))
    options = model_row.get("config_json") or {}
    options = json.loads(options) if isinstance(options, str) else dict(options)
    if model_row.get("provider") != "venv" or options.get("adapter") != "homr":
        raise UnknownAdapterError("#29에서 지원하는 인식 어댑터는 homr입니다")
    ref = model_row.get("provider_ref") or "~/gugak-engines/homr"
    folder = root / ref.removeprefix("~/gugak-engines/") if ref.startswith("~/gugak-engines/") else Path(ref)
    if not folder.is_absolute():
        raise UnknownAdapterError("엔진 위치는 절대 경로여야 합니다")
    return HomrEngine(model_row["model_name"], folder, options)
