"""#33 구조에서의 위치: 공개 API → 키별 DB 한도 예약·메모리 접수 상한 → 호출 기록.

DB 키 행 잠금 안에서 최근 1시간 accepted POST를 검사·예약해 동시 호출의 한도 우회를 막는다.
조회·파일 받기는 횟수를 소비하지 않는다. 반려는 요청 행을 만들지 않고 429와 재시도 시간을 준다.
"""
from app.auth.keys import call_record
from app.db import utcnow
from app.errors import ApiError


def exhausted(row, limit):
    if row and int(row["is_exhausted"]) == 1:
        at = row.get("retry_after_at")
        wait = (at - utcnow()).total_seconds() if at else 60
        raise ApiError("RATE_LIMIT_EXCEEDED", retry_after_s=max(1, wait), details={"call_limit_per_hour": limit})


async def check_quota(request, caller):
    if caller.call_limit_per_hour is None:
        return
    db, rec = request.app.state.db, call_record(request)
    if request.method != "POST":
        exhausted(await db.fetch_one("SELECT is_exhausted, retry_after_at FROM v_key_quota WHERE key_id=%s",
                                     (caller.key_id,)), caller.call_limit_per_hour)
        return
    async with db.transaction() as cur:
        await cur.execute("SELECT key_id FROM access_key WHERE key_id=%s FOR UPDATE", (caller.key_id,))
        await cur.execute("SELECT q.is_exhausted,q.retry_after_at,k.status FROM v_key_quota q "
                          "JOIN access_key k ON k.key_id=q.key_id WHERE q.key_id=%s", (caller.key_id,))
        row = await cur.fetchone()
        if row is None:
            raise ApiError("AUTH_KEY_INVALID")
        if row["status"] != "active":
            raise ApiError("AUTH_KEY_REVOKED")
        exhausted(row, caller.call_limit_per_hour)
        await cur.execute("INSERT INTO api_call_log(called_at,endpoint,access_key_id,outcome) VALUES(%s,%s,%s,'accepted')",
                          (rec.called_at, rec.endpoint[:100], caller.key_id))
        rec.quota_call_id = int(cur.lastrowid)


async def enforce_limits(request, caller, kind):
    if getattr(request.state, "limits_checked", False):
        return
    await check_quota(request, caller)
    if kind is not None and not caller.is_service:
        limiter = request.app.state.limiter
        lease = limiter.admit(kind, caller.channel)
        if lease is None:
            raise ApiError("SERVER_BUSY", retry_after_s=request.app.state.config.busy_retry_after_s,
                           details={"kind": kind, **limiter.stats()})
        request.state.admission = lease
    request.state.limits_checked = True
