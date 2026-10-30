"""환경 설정 — app/.env 를 읽는다(research R15: 비밀은 .env 에만).

값은 서버 시작 때 한 번 읽고, 처리 설정(시간 제한·동시 처리 등)은 DB 판본(app/settings.py)에서 따로 읽는다.
"""

from __future__ import annotations

import hashlib
import hmac
import os
from dataclasses import dataclass, field
from pathlib import Path

# model-api/app/config.py → model-api → app(모노레포 루트)
MODEL_API_DIR = Path(__file__).resolve().parent.parent
APP_ROOT = MODEL_API_DIR.parent
API_VERSION = "v1"


def _read_env_file(path: Path) -> dict[str, str]:
    """KEY=VALUE 줄만 읽는다(주석·빈 줄 무시). python-dotenv 없이 충분하다."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


@dataclass
class Config:
    db_host: str = "127.0.0.1"
    db_port: int = 26133
    db_user: str = "gugak_dev"
    db_password: str = ""
    db_name: str = "gugak_dev"
    port: int = 9543
    service_api_key: str = ""
    storage_dir: Path = APP_ROOT / "storage"
    engines_dir: Path = Path.home() / "gugak-engines"
    ollama_url: str = "http://127.0.0.1:11434"
    shared_dir: Path = APP_ROOT / "shared"
    assets_dir: Path = APP_ROOT / "assets"
    # 모델 준비 시간 예측이 없을 때 쓰는 기본값(INTERFACES §4 model_wait)
    cold_start_hint_s: float = 30.0
    # 서버 시작 때 Ollama 모델까지 데울지(공유 서버라 기본은 끔 — 필요할 때만 불러온다)
    ollama_warm_on_startup: bool = False
    # 서버 시작 때 venv 모델을 데울지
    warm_on_startup: bool = True
    model_load_timeout_s: float = 300.0
    render_timeout_s: float = 120.0
    file_token_ttl_s: int = 900
    busy_retry_after_s: int = 30
    purge_interval_s: int = 600
    result_retention_h: int = 24
    file_token_secret: bytes = field(default=b"", repr=False)

    @property
    def templates_dir(self) -> Path:
        return self.assets_dir / "templates"

    @property
    def soundfonts_dir(self) -> Path:
        return self.assets_dir / "soundfonts"

    @property
    def api_storage(self) -> Path:
        return self.storage_dir / "api"


def load_config(env_file: Path | None = None, overrides: dict | None = None) -> Config:
    """app/.env → 환경 변수 → overrides 순으로 덮어쓴다."""
    values = _read_env_file(env_file or APP_ROOT / ".env")
    values.update({k: v for k, v in os.environ.items() if k in values or k.startswith(("DB_", "MODEL_API", "OLLAMA"))})

    def get(key: str, default: str) -> str:
        return values.get(key, default) or default

    cfg = Config(
        db_host=get("DB_HOST", "127.0.0.1"),
        db_port=int(get("DB_PORT", "26133")),
        db_user=get("DB_USER", "gugak_dev"),
        db_password=values.get("DB_PASSWORD", ""),
        db_name=get("DB_NAME", "gugak_dev"),
        port=int(get("MODEL_API_PORT", "9543")),
        service_api_key=values.get("SERVICE_API_KEY", ""),
        storage_dir=Path(get("STORAGE_DIR", str(APP_ROOT / "storage"))).expanduser(),
        engines_dir=Path(get("ENGINES_DIR", str(Path.home() / "gugak-engines"))).expanduser(),
        ollama_url=get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/"),
        ollama_warm_on_startup=get("OLLAMA_WARM_ON_STARTUP", "0") in ("1", "true", "yes"),
        warm_on_startup=get("MODEL_WARM_ON_STARTUP", "1") in ("1", "true", "yes"),
    )
    # 내려받기 토큰 서명 키: 별도 비밀을 두지 않고 SESSION_SECRET(없으면 서비스 키)에서 파생한다
    base = values.get("SESSION_SECRET") or cfg.service_api_key or "dev-only"
    cfg.file_token_secret = hmac.new(base.encode(), b"model-api-file-token", hashlib.sha256).digest()
    for key, value in (overrides or {}).items():
        setattr(cfg, key, value)
    return cfg
