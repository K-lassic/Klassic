"""처리 루프 멈춤 감지 (2026-09-30 조성기 — design/SD_04 §8-1 「멈춤 감지」).

2026-09-30 11:54 운영 모델 API 가 CPU 99% 로 처리 루프를 붙잡아 /v1/health 에도 답하지 못했다. 원인 함수를 알 수 없었다.
- 처리 루프 안의 작은 작업이 interval_s 마다 신호(시각)를 남긴다.
- 별도 스레드가 신호를 본다. threshold_s 넘게 끊기면 경고 한 줄 + 루프 스레드의 파이썬 스택 + 처리 중인 요청을 남긴다.
  계속 막혀 있으면 repeat_s 마다 다시 남기고, 풀리면 막혔던 시간을 남긴다.
- 로그에는 함수·파일·줄과 req_id·경로·경과 초만 남긴다(입력 원문·키·토큰 없음 — 경로는 main.safe_path 로 가린 것).
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import threading
import time
import traceback

log = logging.getLogger("model-api.watchdog")
if not log.handlers:
    _h = logging.StreamHandler(sys.stdout)
    _h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(_h)
    log.setLevel(logging.INFO)
    log.propagate = False


class LoopWatchdog:
    def __init__(self, active: dict[str, tuple[str, float]] | None = None, *, interval_s: float | None = None,
                 threshold_s: float | None = None, repeat_s: float | None = None) -> None:
        env = os.environ
        self.interval_s = interval_s or float(env.get("WATCHDOG_INTERVAL_S", "0.5"))
        self.threshold_s = threshold_s or float(env.get("WATCHDOG_THRESHOLD_S", "2.0"))
        self.repeat_s = repeat_s or float(env.get("WATCHDOG_REPEAT_S", "10.0"))
        self.active = active if active is not None else {}  # req_id → (가린 경로, 시작 monotonic)
        self.last_beat = time.monotonic()
        self.loop_thread_id: int | None = None
        self.stalls = 0  # 지금까지 감지한 멈춤 수(시험·상태 확인용)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._beat_task: asyncio.Task | None = None

    async def _beat(self) -> None:
        while True:
            self.last_beat = time.monotonic()
            await asyncio.sleep(self.interval_s)

    def start(self) -> None:
        """처리 루프 안에서 부른다."""
        self.loop_thread_id = threading.get_ident()
        self.last_beat = time.monotonic()
        self._beat_task = asyncio.get_running_loop().create_task(self._beat(), name="watchdog-beat")
        self._thread = threading.Thread(target=self._watch, name="loop-watchdog", daemon=True)
        self._thread.start()

    async def stop(self) -> None:
        self._stop.set()
        if self._beat_task is not None:
            self._beat_task.cancel()
            await asyncio.gather(self._beat_task, return_exceptions=True)
        if self._thread is not None:
            self._thread.join(timeout=2)

    def _stack(self) -> str:
        frame = sys._current_frames().get(self.loop_thread_id) if self.loop_thread_id else None
        if frame is None:
            return "(스택 없음)"
        # 줄 내용(소스 코드)은 빼고 파일:줄 함수만 — 짧고 입력 값이 섞일 수 없다
        return " <- ".join(f"{os.path.basename(f.filename)}:{f.lineno} {f.name}"
                           for f in reversed(traceback.extract_stack(frame)[-15:]))

    def _requests(self, now: float) -> str:
        items = sorted(self.active.items(), key=lambda kv: kv[1][1])[:10]
        return ", ".join(f"{rid} {path} {now - t0:.1f}s" for rid, (path, t0) in items) or "-"

    def _watch(self) -> None:
        stalled_since: float | None = None
        last_report = 0.0
        while not self._stop.wait(self.interval_s):
            now = time.monotonic()
            lag = now - self.last_beat
            if lag > self.threshold_s:
                if stalled_since is None:
                    stalled_since, last_report = self.last_beat, now
                    self.stalls += 1
                    log.warning("event_loop_stalled lag_s=%.1f active=[%s] stack=%s",
                                lag, self._requests(now), self._stack())
                elif now - last_report >= self.repeat_s:
                    last_report = now
                    log.warning("event_loop_still_stalled lag_s=%.1f active=[%s] stack=%s",
                                lag, self._requests(now), self._stack())
            elif stalled_since is not None:
                log.warning("event_loop_recovered stalled_s=%.1f", self.last_beat - stalled_since)
                stalled_since = None
