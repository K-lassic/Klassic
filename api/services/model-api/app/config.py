"""실행 환경 설정. 비밀값은 환경변수에서만 읽고 repr에도 노출하지 않는다."""
from dataclasses import dataclass, field
import os
from pathlib import Path

API_VERSION = "v1"


@dataclass(frozen=True)
class Config:
    db_host: str = "db"
    db_port: int = 3306
    db_user: str = "klassic"
    db_password: str = field(default="", repr=False)
    db_name: str = "klassic"
    db_attempts: int = 5
    db_retry_seconds: float = 2
    shared_dir: Path = Path("/app/shared")
    engines_dir: Path = Path("/opt/gugak-engines")
    soundfonts_dir: Path = Path("/app/shared/soundfonts")
    model_load_timeout_s: float = 120
    jeongganbo_device: str = "cpu"


def load_config() -> Config:
    cfg = Config(
        db_host=os.environ.get("DB_HOST", "db"),
        db_port=int(os.environ.get("DB_PORT", "3306")),
        db_user=os.environ.get("DB_USER", "klassic"),
        db_password=os.environ.get("DB_PASSWORD", ""),
        db_name=os.environ.get("DB_NAME", "klassic"),
        db_attempts=int(os.environ.get("DB_CONNECT_ATTEMPTS", "5")),
        db_retry_seconds=float(os.environ.get("DB_RETRY_SECONDS", "2")),
        shared_dir=Path(os.environ.get("SHARED_DIR", "/app/shared")),
        engines_dir=Path(os.environ.get("ENGINES_DIR", "/opt/gugak-engines")),
        soundfonts_dir=Path(os.environ.get("SOUNDFONTS_DIR", "/app/shared/soundfonts")),
        model_load_timeout_s=float(os.environ.get("MODEL_LOAD_TIMEOUT_SECONDS", "120")),
        jeongganbo_device=os.environ.get("JEONGGANBO_DEVICE", "cpu"),
    )
    if not 1 <= cfg.db_attempts <= 10 or not 0 <= cfg.db_retry_seconds <= 30:
        raise ValueError("DB 재시도 설정 범위를 확인하십시오")
    if not 1 <= cfg.model_load_timeout_s <= 600 or not 1 <= cfg.db_port <= 65535:
        raise ValueError("포트·모델 로딩 제한 범위를 확인하십시오")
    for path in (cfg.shared_dir, cfg.engines_dir, cfg.soundfonts_dir):
        if not path.is_absolute():
            raise ValueError("자원 경로는 절대 경로여야 합니다")
    if cfg.jeongganbo_device != "cpu":
        raise ValueError("현재 Linux/amd64 검증 범위는 정간보 CPU 실행입니다")
    return cfg
