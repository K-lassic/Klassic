"""MariaDB 연결 풀 (aiomysql). 세션 시간대는 UTC(INTERFACES §0 · D-19)."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime
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
        for attempt in range(cfg.db_attempts):
            try:
                return await cls._connect_once(cfg, db_name=db_name, maxsize=maxsize)
            except (aiomysql.Error, OSError) as exc:
                logging.getLogger("model-api.db").warning(
                    "db_connect_failed attempt=%s error_type=%s", attempt + 1, type(exc).__name__)
                if attempt + 1 == cfg.db_attempts:
                    raise RuntimeError("DB 연결 재시도 소진") from None
                await asyncio.sleep(cfg.db_retry_seconds)
        raise RuntimeError("DB 연결 시도 없음")

    @classmethod
    async def _connect_once(cls, cfg: Config, *, db_name: str | None = None, maxsize: int = 10) -> Database:
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
