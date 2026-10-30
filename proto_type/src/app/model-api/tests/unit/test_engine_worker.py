"""엔진 상주 작업자 공통 시험 (2026-09-30 C2·C3 — engines/worker.py). 가짜 작업자 스크립트를 쓴다."""

from __future__ import annotations

import asyncio
import sys
import textwrap
import time
from pathlib import Path

import pytest

from app.engines.worker import EngineWorker, WorkerStartError

FAKE = textwrap.dedent('''
    import json, os, sys, time
    mode = sys.argv[1]
    if mode == "noready":
        sys.exit(3)
    print("엔진 잡음 줄")
    print("\\n@@RESULT@@ " + json.dumps({"ready": True, "pid": os.getpid()}), flush=True)
    for line in sys.stdin:
        req = json.loads(line)
        if req.get("sleep"):
            time.sleep(req["sleep"])
        if req.get("die"):
            sys.exit(1)
        print("잡음", flush=True)
        print("@@RESULT@@ " + json.dumps({"ok": True, "echo": req.get("n"), "pid": os.getpid()}), flush=True)
''')


@pytest.fixture
def script(tmp_path: Path) -> Path:
    p = tmp_path / "fake_worker.py"
    p.write_text(FAKE, encoding="utf-8")
    return p


def _worker(script: Path, mode: str = "ok", **kw) -> EngineWorker:
    return EngineWorker("fake", [sys.executable, str(script), mode], **kw)


def _deadline(s: float = 10) -> float:
    return time.monotonic() + s


async def test_start_once_and_reuse_process(script):
    w = _worker(script)
    try:
        await w.start(10)
        r1 = await w.request({"n": 1}, _deadline())
        r2 = await w.request({"n": 2}, _deadline())
        assert r1.data["echo"] == 1 and r2.data["echo"] == 2
        assert r1.data["pid"] == r2.data["pid"] and w.starts == 1  # 같은 프로세스가 두 요청을 받았다
    finally:
        await w.stop()


async def test_busy_returns_none_so_caller_uses_one_off(script):
    w = _worker(script)
    try:
        await w.start(10)
        slow = asyncio.create_task(w.request({"n": 1, "sleep": 0.5}, _deadline()))
        await asyncio.sleep(0.1)
        assert w.busy() and await w.request({"n": 2}, _deadline()) is None
        assert (await slow).data["echo"] == 1
    finally:
        await w.stop()


async def test_deadline_kills_and_next_request_restarts(script):
    w = _worker(script)
    try:
        await w.start(10)
        r = await w.request({"n": 1, "sleep": 5}, _deadline(0.5))
        assert r.timed_out and not w.alive()
        r2 = await w.request({"n": 2}, _deadline())
        assert r2.data["echo"] == 2 and w.starts == 2
    finally:
        await w.stop()


async def test_crash_is_error_then_restarts(script):
    w = _worker(script)
    try:
        await w.start(10)
        r = await w.request({"n": 1, "die": True}, _deadline())
        assert r.error and r.data is None and not w.alive()
        assert (await w.request({"n": 2}, _deadline())).data["echo"] == 2 and w.starts == 2
    finally:
        await w.stop()


async def test_recycles_after_max_requests(script):
    w = _worker(script, max_requests=2)
    try:
        pids = [(await w.request({"n": i}, _deadline())).data["pid"] for i in range(3)]
        assert pids[0] == pids[1] != pids[2] and w.starts == 2
    finally:
        await w.stop()


async def test_start_failure_raises(script):
    w = _worker(script, "noready")
    with pytest.raises(WorkerStartError):
        await w.start(5)
    assert not w.alive()
