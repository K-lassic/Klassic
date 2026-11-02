"""설치 누락·음원 실패·기동 후 작업자 사망을 준비 완료로 오인하지 않는다."""
import asyncio
from pathlib import Path
from unittest.mock import Mock

from app.config import Config
from app.resources.startup import Resources, worker_environment


def test_engine_environment_excludes_server_secrets(monkeypatch):
    monkeypatch.setenv("DB_PASSWORD", "db-secret")
    monkeypatch.setenv("SERVICE_API_KEY", "api-secret")
    monkeypatch.setenv("PYTHONPATH", "/server-only")
    monkeypatch.setenv("XDG_CACHE_HOME", "/tmp/cache")
    env = worker_environment()
    assert not {"DB_PASSWORD", "SERVICE_API_KEY", "PYTHONPATH"} & env.keys()
    assert env["XDG_CACHE_HOME"] == "/tmp/cache"


class EmptyDB:
    async def fetch_all(self, sql):
        return [{"model_name": "homr", "kind": "omr_staff", "provider": "venv", "enabled": True,
                 "config_json": '{"adapter":"homr"}', "provider_ref": "~/gugak-engines/homr"}]


def test_missing_engine_and_font_fail_closed(tmp_path):
    resources = Resources(Config(engines_dir=tmp_path), EmptyDB())
    resources.soundfonts.load = Mock(side_effect=FileNotFoundError("missing sf2"))
    asyncio.run(resources.start())
    assert resources.startup_done
    assert not resources.soundfonts_ready
    assert resources.missing_kinds() == ["omr_staff", "omr_jeongganbo"]
    assert not Path("/tmp/model-api-ready").exists()


def test_dead_worker_is_no_longer_ready():
    resources = Resources(Config(), EmptyDB())
    resources.entries = [{"name": "homr", "kind": "omr_staff", "enabled": True,
                          "installed": True, "state": "ready"}]
    resources.workers["homr"] = Mock(alive=Mock(return_value=False))
    assert resources.snapshot()[0]["state"] == "failed"
    assert "omr_staff" in resources.missing_kinds()
