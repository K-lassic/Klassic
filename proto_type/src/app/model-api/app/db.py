"""MariaDB 연결 풀 (aiomysql). 세션 시간대는 UTC(INTERFACES §0 · D-19)."""

from __future__ import annotations

import re
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import aiomysql

from app.config import Config


def utcnow() -> datetime:
    """DB TIMESTAMP(3) 에 넣을 UTC 시각(시간대 없는 값, 밀리초까지)."""
    now = datetime.now(UTC).replace(tzinfo=None)
    return now.replace(microsecond=(now.microsecond // 1000) * 1000)


class Database:
    def __init__(self, pool: aiomysql.Pool) -> None:
        self.pool = pool

    @classmethod
    async def connect(cls, cfg: Config, *, db_name: str | None = None, maxsize: int = 10) -> Database:
        pool = await aiomysql.create_pool(
            host=cfg.db_host, port=cfg.db_port, user=cfg.db_user, password=cfg.db_password,
            db=db_name or cfg.db_name, charset="utf8mb4", autocommit=True, minsize=1, maxsize=maxsize,
            init_command="SET time_zone='+00:00'", connect_timeout=5,
        )
        return cls(pool)

    async def close(self) -> None:
        self.pool.close()
        await self.pool.wait_closed()

    async def fetch_all(self, sql: str, args: Sequence[Any] | None = None) -> list[dict[str, Any]]:
        async with self.pool.acquire() as conn, conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(sql, args)
            return list(await cur.fetchall())

    async def fetch_one(self, sql: str, args: Sequence[Any] | None = None) -> dict[str, Any] | None:
        rows = await self.fetch_all(sql, args)
        return rows[0] if rows else None

    async def execute(self, sql: str, args: Sequence[Any] | None = None) -> int:
        """실행하고 lastrowid(없으면 영향받은 행 수)를 돌려준다."""
        async with self.pool.acquire() as conn, conn.cursor() as cur:
            affected = await cur.execute(sql, args)
            return cur.lastrowid or affected

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[aiomysql.DictCursor]:
        """여러 행을 한꺼번에 쓰거나 모두 되돌린다."""
        async with self.pool.acquire() as conn:
            await conn.begin()
            try:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    yield cur
                await conn.commit()
            except BaseException:
                await conn.rollback()
                raise


# ---------------------------------------------------------------------------
# 마이그레이션 적용 (시험 DB 준비용). mariadb 클라이언트 지시어 DELIMITER 를 직접 처리한다.
# ---------------------------------------------------------------------------

def split_sql_script(text: str) -> list[str]:
    """SQL 파일을 문장 목록으로 나눈다.

    `DELIMITER //` 지시어, 따옴표 안의 구분자, 줄 끝 `-- 주석`을 고려한다(문자 단위로 읽는다).
    """
    statements: list[str] = []
    delimiter = ";"
    buf: list[str] = []
    quote: str | None = None
    for line in text.splitlines():
        if quote is None:
            m = re.match(r"^\s*DELIMITER\s+(\S+)\s*$", line, re.IGNORECASE)
            if m:
                delimiter = m.group(1)
                continue
        i = 0
        while i < len(line):
            ch = line[i]
            if quote:
                buf.append(ch)
                if ch == "\\" and i + 1 < len(line):
                    buf.append(line[i + 1])
                    i += 2
                    continue
                if ch == quote:
                    quote = None
                i += 1
                continue
            if ch in ("'", '"', "`"):
                quote = ch
                buf.append(ch)
                i += 1
                continue
            if line.startswith("--", i):
                break  # 줄 끝까지 주석
            if line.startswith(delimiter, i):
                stmt = "".join(buf).strip()
                if stmt:
                    statements.append(stmt)
                buf = []
                i += len(delimiter)
                continue
            buf.append(ch)
            i += 1
        buf.append("\n")
    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


async def apply_sql_files(db: Database, files: Sequence[Path]) -> None:
    async with db.pool.acquire() as conn, conn.cursor() as cur:
        for path in files:
            for stmt in split_sql_script(path.read_text(encoding="utf-8")):
                await cur.execute(stmt)
