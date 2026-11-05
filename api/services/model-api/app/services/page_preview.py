"""여러 쪽 웹 요청의 첫 쪽 미리보기 (2026-11-04 황송해 #181 — 대기 시간 줄이기).

구조에서의 위치: recognize._recognize_pages → 이 파일(메모리) ← GET /v1/internal/omr/preview/{request_no} ← backend 작업자.

4코어에서 homr 작업자를 늘리면 오히려 느려져(api/deploy/README.md 「homr 작업자 2개 시험」) 쪽 병렬 대신,
먼저 변환된 쪽을 요청이 끝나기 전에 backend 가 가져가 화면에 보이게 한다.
- 웹 요청 · 2쪽 이상일 때만 둔다. 가장 먼저 변환된 쪽 하나만 두고, 이후 쪽은 끝난 쪽 수만 센다.
- 요청이 끝나면(run_recognition finally) 지운다. uvicorn 작업자 1개라 프로세스 메모리로 충분하다.
- DB · 파일에 남기지 않는다 — 다시 켜지면 사라지고 화면은 원래대로 전체 결과를 기다린다.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class PagePreview:
    page_no: int
    page_count: int
    musicxml: str
    pages_done: int


_previews: dict[str, PagePreview] = {}
_done: dict[str, int] = {}


def begin(request_no: str) -> None:
    _previews.pop(request_no, None)
    _done[request_no] = 0


def page_done(request_no: str, page_no: int, page_count: int, musicxml: str | None) -> None:
    """쪽 하나가 끝났을 때. 변환된 첫 쪽이면 미리보기로 둔다."""
    if request_no not in _done:
        return
    _done[request_no] += 1
    current = _previews.get(request_no)
    if current is None and musicxml:
        _previews[request_no] = PagePreview(page_no, page_count, musicxml, _done[request_no])
    elif current is not None:
        current.pages_done = _done[request_no]


def get(request_no: str) -> PagePreview | None:
    return _previews.get(request_no)


def end(request_no: str) -> None:
    _previews.pop(request_no, None)
    _done.pop(request_no, None)
