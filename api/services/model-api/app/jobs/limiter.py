"""#29 인식 처리 대기: recognize → 이 파일 → 메모리의 실행·대기 카운터.

DB·파일을 저장하지 않고 자리가 날 때까지 기한 안에서 기다린다(T031, FR-017 · SC-003 · G3).

- 인식(recognize)과 렌더링(render)을 따로 센다(v_active_processing 과 같은 나눔).
- 인식 상한 중 웹 몫(web_concurrency_share)은 서비스 키(웹) 요청에, 나머지는 외부 호출자에게 준다(research R17).
  외부 몫이 0 이 되면(상한 = 웹 몫) 외부에도 1 자리를 준다 — 외부 호출이 영영 막히지 않게.
- 자리가 없으면 줄을 서되, 마감(접수 시각 + timeout_seconds 또는 X-Deadline)이 지나면 QueueTimeout.
- 외부 호출의 SERVER_BUSY 판정에 필요한 is_busy를 제공한다. 전체 한도 연결은 #33 범위다.
설정을 다시 읽으면 상한만 바꾼다(이미 들고 있는 자리는 그대로 끝난다).
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from app.settings import Settings


class QueueTimeout(Exception):
    """마감 전에 자리를 얻지 못했다."""


@dataclass
class _Pool:
    capacity: int
    running: int = 0
    waiting: int = 0


class Limiter:
    def __init__(self, settings: Settings) -> None:
        self._cond = asyncio.Condition()
        self._pools: dict[str, _Pool] = {}
        self.resize(settings)

    def resize(self, settings: Settings) -> None:
        rec = max(1, settings.max_concurrency_recognize)
        web = max(1, min(settings.web_concurrency_share, rec))
        caps = {
            "recognize:web": web,
            "recognize:external": max(1, rec - web),
            "render:shared": max(1, settings.max_concurrency_render),
        }
        for key, cap in caps.items():
            pool = self._pools.setdefault(key, _Pool(capacity=cap))
            pool.capacity = cap

    @staticmethod
    def _key(kind: str, channel: str) -> str:
        if kind == "render":
            return "render:shared"  # #31 렌더링 상한은 서비스·외부 호출을 합쳐 적용한다.
        return f"{kind}:{'web' if channel == 'web' else 'external'}"

    def is_busy(self, kind: str, channel: str) -> bool:
        """외부 호출 접수 전에 본다: 자리가 다 찼고 줄도 자리 수만큼 섰으면 바쁨."""
        pool = self._pools[self._key(kind, channel)]
        return pool.running >= pool.capacity and pool.waiting >= pool.capacity

    def stats(self) -> dict[str, int]:
        rec = [p for k, p in self._pools.items() if k.startswith("recognize")]
        ren = [p for k, p in self._pools.items() if k.startswith("render")]
        return {
            "recognize_running": sum(p.running for p in rec),
            "recognize_waiting": sum(p.waiting for p in rec),
            "render_running": sum(p.running for p in ren),
            "render_waiting": sum(p.waiting for p in ren),
        }

    @asynccontextmanager
    async def slot(self, kind: str, channel: str, deadline_monotonic: float | None) -> AsyncIterator[float]:
        """자리를 얻으면 기다린 시간(초)을 넘긴다. 마감이 지나면 QueueTimeout."""
        pool = self._pools[self._key(kind, channel)]
        started = time.monotonic()
        async with self._cond:
            pool.waiting += 1
            try:
                while pool.running >= pool.capacity:
                    remaining = None if deadline_monotonic is None else deadline_monotonic - time.monotonic()
                    if remaining is not None and remaining <= 0:
                        raise QueueTimeout()
                    try:
                        await asyncio.wait_for(self._cond.wait(), timeout=remaining)
                    except TimeoutError:
                        raise QueueTimeout() from None
                pool.running += 1
            finally:
                pool.waiting -= 1
        try:
            yield time.monotonic() - started
        finally:
            async with self._cond:
                pool.running -= 1
                self._cond.notify_all()
