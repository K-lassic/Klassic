"""처리 루프 멈춤 감지 시험 (2026-09-30 — design/SD_04 §8-1)."""

from __future__ import annotations

import asyncio
import logging
import time

from app.jobs.watchdog import LoopWatchdog


def _block_loop_for(seconds: float) -> None:
    time.sleep(seconds)  # 처리 루프를 붙잡는 동기 계산 흉내


async def test_stall_is_logged_with_stack_and_active_request(caplog):
    logger = logging.getLogger("model-api.watchdog")
    logger.addHandler(caplog.handler)
    active = {"abc123def456": ("/v1/omr/staff", time.monotonic())}
    wd = LoopWatchdog(active, interval_s=0.05, threshold_s=0.3, repeat_s=10)
    try:
        caplog.set_level(logging.INFO, logger="model-api.watchdog")
        wd.start()
        await asyncio.sleep(0.2)
        _block_loop_for(1.0)
        await asyncio.sleep(0.3)  # 풀린 뒤 recovered 가 찍힐 시간
    finally:
        await wd.stop()
        logger.removeHandler(caplog.handler)
    text = caplog.text
    assert wd.stalls == 1
    assert "event_loop_stalled" in text and "_block_loop_for" in text
    assert "abc123def456 /v1/omr/staff" in text
    assert "event_loop_recovered" in text


async def test_no_warning_when_loop_is_free(caplog):
    logger = logging.getLogger("model-api.watchdog")
    logger.addHandler(caplog.handler)
    wd = LoopWatchdog({}, interval_s=0.05, threshold_s=0.3, repeat_s=10)
    try:
        wd.start()
        await asyncio.sleep(0.8)
    finally:
        await wd.stop()
        logger.removeHandler(caplog.handler)
    assert wd.stalls == 0 and "event_loop_stalled" not in caplog.text
