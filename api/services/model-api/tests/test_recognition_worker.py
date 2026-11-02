"""#29 모델 중복 로딩 방지와 기동 중 취소 정리를 확인한다."""
import asyncio
from pathlib import Path
import sys
from unittest.mock import Mock

import pytest

from app.config import Config
from app.models.registry import ModelRegistry
from app.resources.startup import Resources
from app.resources.worker import EngineWorker


def test_cold_registry_shares_prepared_worker_and_load_estimate(tmp_path):
    cfg = Config(engines_dir=tmp_path)
    resources = Resources(cfg, None)
    resources.entries = [{"name": "homr", "kind": "omr_staff", "provider": "venv", "enabled": True,
                          "installed": True, "version": "0.7", "state": "cold"}]
    resources.model_rows["homr"] = {"model_name": "homr", "kind": "omr_staff", "provider": "venv",
                                    "config_json": '{"adapter":"homr"}'}
    worker = Mock(alive=Mock(return_value=False))
    resources.workers["homr"] = worker
    registry = ModelRegistry(cfg, None, resources)
    registry.estimates["homr"] = {"avg_load_ms": 2500}
    entry = registry.get("homr")
    assert entry.adapter.worker is worker and entry.state == "cold"
    assert registry.get("homr").adapter is entry.adapter
    assert registry.public_view(entry)["expected_seconds"] == 2.5
    assert entry.adapter.folder == tmp_path / "homr"


def test_cancel_during_worker_start_kills_process():
    async def run():
        worker = EngineWorker("never-ready", [sys.executable, "-u", "-c", "import time; time.sleep(60)"])
        task = asyncio.create_task(worker.request({}, asyncio.get_running_loop().time() + 30))
        try:
            for _ in range(100):
                if worker.alive():
                    break
                await asyncio.sleep(.01)
            assert worker.alive()
            pid = worker.proc.pid
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert not worker.alive() and not Path(f"/proc/{pid}").exists()
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await worker.stop()

    asyncio.run(run())
