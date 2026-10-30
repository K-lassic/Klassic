"""Verovio 글꼴 경로 — 다른 스레드에서도 PDF 를 만든다(2026-09-29 결함 재발 방지).

Verovio 는 기본 글꼴 경로를 처음 불러온 스레드에만 기억해, 작업 스레드에서 만든 toolkit 이 악보를 읽지 못했다.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest

from app.render import pdf

TEMPLATE = Path(__file__).resolve().parents[3] / "assets" / "templates" / "gutgeori-v1.musicxml"


@pytest.mark.skipif(pdf._verovio_version() is None, reason="verovio 없음")
def test_pdf_renders_in_several_threads_after_version_read() -> None:
    xml = TEMPLATE.read_text(encoding="utf-8")
    results: list[object] = []

    def version() -> None:
        results.append(pdf._verovio_version())

    def render() -> None:
        try:
            results.append(len(pdf._render_verovio(xml, time.monotonic() + 60)))
        except Exception as exc:  # noqa: BLE001
            results.append(exc)

    t = threading.Thread(target=version)
    t.start()
    t.join()
    threads = [threading.Thread(target=render) for _ in range(3)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert isinstance(results[0], str)
    assert all(isinstance(r, int) and r > 1000 for r in results[1:]), results
