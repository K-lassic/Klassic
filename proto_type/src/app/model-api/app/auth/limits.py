"""호출 한도와 동시 처리 한도 (T105, G3 · FR-046 · BR-API-04).

- 키별 호출 한도: v_key_quota(최근 1시간 창, 결정 대기 Q1 임시안 '시간당'). 서비스 전용 키는 한도가 NULL 이라 통과.
- 전체 동시 처리: jobs/limiter.py 의 자리·줄 상태. 외부 호출만 SERVER_BUSY 로 돌려보낸다
  (웹 요청은 웹 서비스가 G12·대기열을 가지므로 여기서는 마감까지 줄을 세운다).
- 거절하면 retry_after(ISO) + Retry-After(초) 머리글. api_call_log 는 미들웨어가 rejected_limit/_concurrency 로 쓴다.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import Request

from app.auth.keys import Caller
from app.db import Database, utcnow
from app.errors import ApiError


async def check_quota(db: Database, caller: Caller) -> None:
    if caller.call_limit_per_hour is None:
        return
    row = await db.fetch_one(
        "SELECT is_exhausted, retry_after_at, remaining_this_hour FROM v_key_quota WHERE key_id = %s",
        (caller.key_id,),
    )
    if row and int(row["is_exhausted"]) == 1:
        at: datetime | None = row["retry_after_at"]
        wait = (at - utcnow()).total_seconds() if at else 60.0
        raise ApiError("RATE_LIMIT_EXCEEDED", retry_after_s=max(1.0, wait),
                       details={"call_limit_per_hour": caller.call_limit_per_hour})


def check_concurrency(request: Request, caller: Caller, kind: str) -> None:
    if caller.is_service:
        return
    limiter = request.app.state.limiter
    if limiter.is_busy(kind, caller.channel):
        raise ApiError("SERVER_BUSY", retry_after_s=float(request.app.state.config.busy_retry_after_s),
                       details={"kind": kind, **limiter.stats()})


async def enforce_limits(request: Request, caller: Caller, kind: str | None) -> None:
    """처리 엔드포인트 앞에서 부른다: 호출 한도 → 동시 처리 순서(계약 설명 순서)."""
    await check_quota(request.app.state.db, caller)
    if kind is not None:
        check_concurrency(request, caller, kind)
