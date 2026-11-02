"""엔진 상주 작업자 (2026-09-30 조성기 — API 점검 C2·C3, research R2 · design/SD_04 §8-1).

엔진 가상환경에서 작업자 프로세스 하나를 띄워 모델을 한 번만 올리고, 요청을 한 줄씩 주고받는다.
- 기동: 작업자가 표준 출력에 `@@RESULT@@ {"ready": true, ...}` 를 찍으면 준비 끝.
- 요청: 표준 입력에 JSON 한 줄 → 표준 출력 `@@RESULT@@ {json}` 한 줄(그 밖의 줄은 엔진 잡음으로 보고 넘긴다).
- 한 번에 한 요청. 쓰는 중이면 request() 가 None 을 돌려주고, 부르는 쪽이 예전처럼 한 번짜리 하위 프로세스로 처리한다.
- 마감 시각을 넘기면 프로세스 묶음째 끝낸다(timed_out). 죽었거나 끝낸 작업자는 다음 요청 때 다시 띄운다.
- max_requests 건마다 새로 띄워 오래 도는 프로세스의 메모리가 계속 늘지 않게 한다.
- 이벤트 루프가 바뀌면(시험은 시험마다 새 루프) 옛 루프에 묶인 프로세스 · 잠금을 버리고 새로 띄운다. 운영은 루프 하나라 해당 없음.
"""

from __future__ import annotations

import asyncio
import collections
import json
import logging
import os
import signal
import time
from dataclasses import dataclass

MARK = "@@RESULT@@ "
log = logging.getLogger("model-api.worker")


class WorkerStartError(RuntimeError):
    """작업자를 띄우지 못함(준비 신호 없음·시간 초과·바로 죽음)."""


@dataclass
class WorkerReply:
    data: dict | None  # 작업자가 돌려준 JSON(없으면 None)
    timed_out: bool = False
    error: str | None = None  # 작업자 쪽 문제(죽음·응답 없음)
    stderr_tail: str = ""
    duration_ms: int = 0


class EngineWorker:
    def __init__(self, name: str, cmd: list[str], *, cwd: str | None = None, env: dict[str, str] | None = None,
                 max_requests: int = 100) -> None:
        self.name = name
        self.cmd = cmd
        self.cwd = cwd
        self.env = env
        self.max_requests = max_requests
        self.proc: asyncio.subprocess.Process | None = None
        self.served = 0
        self.starts = 0  # 지금까지 띄운 횟수(시험·상태 확인용)
        self.ready_info: dict = {}
        self._lock = asyncio.Lock()
        self._stderr: collections.deque[str] = collections.deque(maxlen=40)
        self._stderr_task: asyncio.Task | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def _bind_loop(self) -> None:
        """지금 루프에 묶는다. 다른 루프에서 띄운 프로세스는 기다리지 않고 끝내고 잊는다."""
        loop = asyncio.get_running_loop()
        if self._loop is loop:
            return
        if self.proc is not None and self.proc.returncode is None:
            try:
                os.killpg(self.proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        self.proc = None
        self._stderr_task = None
        self._lock = asyncio.Lock()
        self._loop = loop

    # ── 상태 ──
    def alive(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    def busy(self) -> bool:
        return self._lock.locked()

    def stderr_tail(self) -> str:
        return "".join(self._stderr)[-500:]

    # ── 기동·정지 ──
    async def start(self, timeout_s: float) -> None:
        """작업자를 띄우고 준비 신호를 기다린다. 이미 살아 있으면 그대로 둔다."""
        self._bind_loop()
        async with self._lock:
            await self._ensure_started(time.monotonic() + timeout_s)

    async def _ensure_started(self, deadline: float) -> None:
        if self.alive():
            return
        await self._kill()
        self._stderr.clear()
        self.proc = await asyncio.create_subprocess_exec(
            *self.cmd, cwd=self.cwd, env=self.env, stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            start_new_session=True, limit=16 * 1024 * 1024,
        )
        self.starts += 1
        self.served = 0
        self._stderr_task = asyncio.get_running_loop().create_task(self._drain_stderr(self.proc),
                                                                   name=f"worker-stderr-{self.name}")
        try:
            info = await self._read_result(deadline)
        except TimeoutError as exc:
            await self._kill()
            raise WorkerStartError(f"{self.name}: 작업자 준비 시간 초과") from exc
        if info is None or not info.get("ready"):
            tail = self.stderr_tail()
            await self._kill()
            detail = (info or {}).get("error") or tail or "준비 신호 없음"
            raise WorkerStartError(f"{self.name}: 작업자를 띄우지 못함 {str(detail)[-300:]}")
        self.ready_info = info
        log.info("worker_ready name=%s pid=%s", self.name, self.proc.pid)

    async def stop(self) -> None:
        self._bind_loop()
        async with self._lock:
            await self._kill()

    async def _kill(self) -> None:
        proc, self.proc = self.proc, None
        if proc is not None and proc.returncode is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            try:
                await asyncio.wait_for(proc.wait(), timeout=5)
            except TimeoutError:
                pass
        if self._stderr_task is not None:
            self._stderr_task.cancel()
            await asyncio.gather(self._stderr_task, return_exceptions=True)
            self._stderr_task = None

    async def _drain_stderr(self, proc: asyncio.subprocess.Process) -> None:
        assert proc.stderr is not None
        while True:
            line = await proc.stderr.readline()
            if not line:
                return
            self._stderr.append(line.decode("utf-8", errors="replace"))

    async def _read_result(self, deadline: float) -> dict | None:
        """마감까지 `@@RESULT@@` 한 줄을 기다린다. 프로세스가 끝나면 None."""
        assert self.proc is not None and self.proc.stdout is not None
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError
            line = await asyncio.wait_for(self.proc.stdout.readline(), timeout=remaining)
            if not line:
                return None
            text = line.decode("utf-8", errors="replace").strip()
            if text.startswith(MARK.strip()):
                try:
                    return json.loads(text[len(MARK.strip()):].strip())
                except json.JSONDecodeError:
                    return {"ok": False, "error": "작업자 응답을 읽을 수 없음"}

    # ── 요청 ──
    async def request(self, payload: dict, deadline_monotonic: float) -> WorkerReply | None:
        """요청 하나. 작업자가 쓰는 중이면 None(부르는 쪽이 한 번짜리로 처리)."""
        self._bind_loop()
        if self._lock.locked():
            return None
        async with self._lock:
            t0 = time.monotonic()
            try:
                await self._ensure_started(deadline_monotonic)
            except WorkerStartError as exc:
                return WorkerReply(None, error=str(exc), stderr_tail=self.stderr_tail(),
                                   duration_ms=int((time.monotonic() - t0) * 1000))
            except TimeoutError:
                await self._kill()
                return WorkerReply(None, timed_out=True, duration_ms=int((time.monotonic() - t0) * 1000))
            assert self.proc is not None and self.proc.stdin is not None
            try:
                self.proc.stdin.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
                await self.proc.stdin.drain()
                data = await self._read_result(deadline_monotonic)
            except TimeoutError:
                await self._kill()  # 마감을 넘긴 작업은 끝낸다. 다음 요청 때 다시 띄운다
                return WorkerReply(None, timed_out=True, stderr_tail=self.stderr_tail(),
                                   duration_ms=int((time.monotonic() - t0) * 1000))
            except (BrokenPipeError, ConnectionResetError):
                data = None
            except asyncio.CancelledError:
                await self._kill()
                raise
            ms = int((time.monotonic() - t0) * 1000)
            if data is None:
                tail = self.stderr_tail()
                await self._kill()
                return WorkerReply(None, error="작업자가 응답 없이 끝남", stderr_tail=tail, duration_ms=ms)
            self.served += 1
            if self.served >= self.max_requests:
                await self._kill()  # 다음 요청 때 새로 띄운다
            return WorkerReply(data, stderr_tail=self.stderr_tail(), duration_ms=ms)
