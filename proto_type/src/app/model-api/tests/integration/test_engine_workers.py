"""실제 엔진 상주 작업자 시험 (2026-09-30 C2·C3). 엔진이 설치돼 있을 때만 돈다(~/gugak-engines).

작업자 결과가 한 번짜리 실행(예전 방식)과 같은지, 두 번째 요청이 같은 프로세스에서 처리되는지 본다.
"""

from __future__ import annotations

import re
import time
from pathlib import Path

import pytest

from app.config import APP_ROOT
from app.engines.homr import HomrEngine
from app.engines.jeongganbo import JeongganboEngine

ENGINES = Path.home() / "gugak-engines"
STAFF = APP_ROOT / "evalset" / "real" / "S01_clean_arirang.png"
JG = APP_ROOT / "shared" / "fixtures" / "upload" / "ok_jeongganbo.png"


def _norm(xml: str | None) -> str | None:
    """music21 이 실행마다 무작위로 만드는 성부 id(P + 32자리)를 맞춰 놓는다 — 예전 한 번짜리 실행끼리도 다르다."""
    return re.sub(r"P[0-9a-f]{32}", "P-id", xml) if xml else xml


async def _compare(make, image: Path):
    one_off = make({"worker": False})
    worker = make({})
    if worker.entry() is None or not image.exists():
        pytest.skip("엔진 또는 시험 그림 없음")
    try:
        await worker.warmup(120)
        a = await one_off.recognize(str(image), time.monotonic() + 300)
        b = await worker.recognize(str(image), time.monotonic() + 300)
        pid = worker.worker.proc.pid
        c = await worker.recognize(str(image), time.monotonic() + 300)
        assert worker.worker.proc.pid == pid and worker.worker.starts == 1
    finally:
        await worker.close()
    assert a.outcome == b.outcome == c.outcome == "success"
    assert _norm(a.musicxml) == _norm(b.musicxml) == _norm(c.musicxml)
    return a, b, c


async def test_jeongganbo_worker_matches_one_off():
    a, b, _ = await _compare(lambda cfg: JeongganboEngine("jeongganbo-omr", ENGINES / "jeongganbo", cfg), JG)
    assert a.extra.get("encoding") == b.extra.get("encoding") and a.confidence == b.confidence


async def test_homr_worker_matches_one_off():
    await _compare(lambda cfg: HomrEngine("homr", ENGINES / "homr", cfg), STAFF)
