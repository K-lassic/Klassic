"""모델 API 권한 판정 (FR-068, design/UC_00 §4-1 · SD_01 P7 7.6 · G13, 2026-09-29 RBAC).

접근 키 → 역할(`api_caller`, 서비스 전용 키면 `service`), 경로 → 유스케이스, 허용 여부는 DB `role_permission` 만 본다.
키가 필요한 경로(require_key·require_service_key)에서만 부른다 — health·versions·models·files 는 키가 없다.
"""

from __future__ import annotations

import re
import time

from app.db import Database

# 외부 주소(https://p3.sumzip.com/api/v1/...)로 들어오면 uvicorn --root-path /api 때문에 경로 앞에 /api 가 붙는다
_ROUTES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^(/api)?/v1/(omr/(staff|jeongganbo)|recommend|render/(mp3|pdf))$"), "UC12"),
    # 읽기 엔드포인트(2026-09-30 조성기 — UC12 A10 · BR-API-07): 악기 목록 · 공유 악보 목록 · 공유 악보 MusicXML
    (re.compile(r"^(/api)?/v1/(instruments|shared-scores(/[^/]+/score)?)$"), "UC12"),
    (re.compile(r"^(/api)?/v1/performances(/[^/]+(/result)?)?$"), "UC13"),
    (re.compile(r"^(/api)?/v1/internal/upload-check$"), "UC3"),
    (re.compile(r"^(/api)?/v1/internal/settings/reload$"), "UC10"),
    (re.compile(r"^(/api)?/v1/internal/(models/.+|ollama/available)$"), "UC14"),
)
_CACHE_S = 60.0
_cache: tuple[float, dict[str, set[str]]] | None = None


def uc_of(path: str) -> str | None:
    for rx, uc in _ROUTES:
        if rx.match(path):
            return uc
    return None


def allowed(role: str, uc: str, table: dict[str, set[str]]) -> bool:
    return uc in table.get(role, set())


async def permission_table(db: Database) -> dict[str, set[str]]:
    """role_permission 전체(60초 캐시)."""
    global _cache
    if _cache is not None and time.monotonic() - _cache[0] < _CACHE_S:
        return _cache[1]
    rows = await db.fetch_all("SELECT role_code, uc_code FROM role_permission")
    table: dict[str, set[str]] = {}
    for r in rows:
        table.setdefault(r["role_code"], set()).add(r["uc_code"])
    _cache = (time.monotonic(), table)
    return table


def clear_cache() -> None:
    global _cache
    _cache = None
