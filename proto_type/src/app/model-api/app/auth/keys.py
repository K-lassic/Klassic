"""접근 키 확인 (T033, G2 · FR-045 · FR-055) 과 호출 기록(api_call_log).

- 머리글 X-API-Key 를 SHA-256 으로 바꿔 access_key.key_hash 와 대조한다(원문은 저장하지 않는다, G9).
- 없음 → AUTH_KEY_MISSING, 모름 → AUTH_KEY_INVALID, 폐기 → AUTH_KEY_REVOKED.
- 키가 필요한 모든 호출은 끝날 때 api_call_log 한 행을 남긴다(main.py 미들웨어가 CallRecord 를 읽어 쓴다).
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from datetime import datetime

from fastapi import Request

from app.auth import rbac
from app.db import Database, utcnow
from app.errors import ApiError, call_outcome_for

log = logging.getLogger("model-api.auth")


@dataclass
class Caller:
    key_id: int
    kind: str  # 'service' | 'external'
    prefix: str
    call_limit_per_hour: int | None

    @property
    def is_service(self) -> bool:
        return self.kind == "service"

    @property
    def channel(self) -> str:
        """limiter 몫 나눔용: 서비스 키 = 웹."""
        return "web" if self.is_service else "api"


@dataclass
class CallRecord:
    """이 호출의 기록 한 줄. 처리 중에 채우고 응답 뒤 한 번 쓴다."""

    endpoint: str
    key_id: int | None = None
    outcome: str = "accepted"
    reason_code: str | None = None
    retry_after_at: datetime | None = None
    request_id: int | None = None
    called_at: datetime = field(default_factory=utcnow)

    def fail(self, err: ApiError) -> None:
        self.outcome = call_outcome_for(err.code)
        if self.outcome != "accepted":
            self.reason_code = err.code
        at = err.retry_after_at()
        if self.outcome in ("rejected_limit", "rejected_concurrency") and at is not None:
            self.retry_after_at = at.replace(tzinfo=None)
        # G1: 반려된 호출은 요청을 만들지 않는다(chk_call_no_request_on_reject)
        if self.outcome.startswith("rejected"):
            self.request_id = None


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def call_record(request: Request) -> CallRecord:
    rec = getattr(request.state, "call", None)
    if rec is None:
        route = request.scope.get("route")
        path = getattr(route, "path", None) or request.url.path
        if not path.startswith("/v1"):
            path = "/v1" + path  # 포함된 라우터의 경로 틀에는 /v1 머리가 빠져 있다
        rec = CallRecord(endpoint=f"{request.method} {path}"[:100])
        request.state.call = rec
    return rec


async def authenticate(request: Request) -> Caller:
    """G2 판정. 실패하면 ApiError(AUTH_*) — 미들웨어가 rejected_key 로 기록한다."""
    rec = call_record(request)
    raw = request.headers.get("x-api-key", "").strip()
    if not raw:
        raise ApiError("AUTH_KEY_MISSING")
    db: Database = request.app.state.db
    row = await db.fetch_one(
        "SELECT key_id, key_kind, key_prefix, status, call_limit_per_hour FROM access_key WHERE key_hash = %s",
        (hash_key(raw),),
    )
    if row is None:
        raise ApiError("AUTH_KEY_INVALID")
    rec.key_id = int(row["key_id"])
    if row["status"] != "active":
        raise ApiError("AUTH_KEY_REVOKED")
    caller = Caller(key_id=int(row["key_id"]), kind=row["key_kind"], prefix=row["key_prefix"],
                    call_limit_per_hour=row["call_limit_per_hour"])
    request.state.caller = caller
    # G13 권한표(2026-09-29 RBAC, FR-068): 키 → 역할, 경로 → 유스케이스, role_permission 으로 허용 여부
    role = "service" if caller.is_service else "api_caller"
    uc = rbac.uc_of(request.url.path)
    if uc is None or not rbac.allowed(role, uc, await rbac.permission_table(db)):
        if not caller.is_service and "/internal/" in request.url.path:
            # 내부 경로에 외부 키 — 계약에 적힌 기존 코드를 그대로 쓴다
            raise ApiError("AUTH_SERVICE_KEY_REQUIRED", http=403, details={"reason": "service_key_required"})
        raise ApiError("AUTH_FORBIDDEN", http=403, details={"uc": uc or "unknown", "role": role})
    return caller


async def require_key(request: Request) -> Caller:
    return await authenticate(request)


async def require_service_key(request: Request) -> Caller:
    """내부 엔드포인트는 서비스 전용 키만(계약: 403)."""
    caller = await authenticate(request)
    if not caller.is_service:
        raise ApiError("AUTH_SERVICE_KEY_REQUIRED", http=403, details={"reason": "service_key_required"})
    return caller


async def write_call_log(db: Database, rec: CallRecord) -> None:
    """chk_call_* 제약을 지키며 한 줄 쓴다. 기록 실패가 응답을 망치지 않게 삼킨다."""
    outcome = rec.outcome
    reason = rec.reason_code if outcome != "accepted" else None
    if outcome != "accepted" and not reason:
        reason = "UNKNOWN"
    if outcome == "accepted" and rec.key_id is None:
        return  # 받아들인 호출은 유효 키가 있어야 한다(G2) — 키 없는 공개 호출은 기록하지 않는다
    retry = rec.retry_after_at if outcome in ("rejected_limit", "rejected_concurrency") else None
    if outcome in ("rejected_limit", "rejected_concurrency") and retry is None:
        retry = utcnow()
    request_id = None if outcome.startswith("rejected") else rec.request_id
    try:
        await db.execute(
            "INSERT INTO api_call_log (called_at, endpoint, access_key_id, outcome, reason_code, retry_after_at, request_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (rec.called_at, rec.endpoint[:100], rec.key_id, outcome, reason, retry, request_id),
        )
    except Exception:
        log.exception("api_call_log 기록 실패: %s", rec)
