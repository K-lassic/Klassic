"""공통 오류 형식 (FR-048, INTERFACES §2).

{ "error": {code, message, fix, gate, retry_after, details}, "api_version": "v1" }
code·http·gate·message·fix 는 shared/error-codes.json 의 gate_codes 에서 온다.
렌더링 실패 코드(RENDER_*)는 gate_codes 에 없어서 status_codes 문구 + 계약의 502/504 로 만든다.
"""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any

from fastapi.responses import JSONResponse

from app.config import API_VERSION, APP_ROOT

# 계약(model-api.openapi.yaml)의 렌더링 실패 응답: 실패·렌더러 없음 502, 시간 초과 504
_RENDER_HTTP = {"RENDER_FAILED": 502, "RENDERER_MISSING": 502, "RENDER_TIMEOUT": 504}


@lru_cache(maxsize=1)
def error_catalog() -> dict[str, Any]:
    return json.loads((APP_ROOT / "shared" / "error-codes.json").read_text(encoding="utf-8"))


def fallback_catalog() -> dict[str, dict[str, str]]:
    return {k: v for k, v in error_catalog()["fallback_reasons"].items() if not k.startswith("$")}


def status_message(code: str) -> str | None:
    return error_catalog()["status_codes"].get(code)


class ApiError(Exception):
    """처리 중 어디서든 던지면 공통 오류 응답이 된다."""

    def __init__(self, code: str, *, details: dict | None = None, retry_after_s: float | None = None,
                 http: int | None = None, message: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.details = details or {}
        self.retry_after_s = retry_after_s
        entry = error_catalog()["gate_codes"].get(code)
        if entry is not None:
            # api_http: 모델 API 는 웹과 다른 상태를 쓸 때(2026-09-30, contracts/error-codes.md — 예: 악보 종류 누락 422)
            self.http = http or entry.get("api_http") or entry["http"]
            self.gate = entry["gate"]
            self.message = message or entry["message"]
            self.fix = entry["fix"]
        else:
            self.http = http or _RENDER_HTTP.get(code, 500)
            self.gate = None
            self.message = message or status_message(code) or code
            self.fix = "잠시 뒤 다시 시도해 주십시오."

    def retry_after_at(self) -> datetime | None:
        if self.retry_after_s is None:
            return None
        return datetime.now(UTC) + timedelta(seconds=self.retry_after_s)


def error_body(err: ApiError) -> dict[str, Any]:
    at = err.retry_after_at()
    return {
        "error": {
            "code": err.code,
            "message": err.message,
            "fix": err.fix,
            "gate": err.gate,
            "retry_after": at.isoformat().replace("+00:00", "Z") if at else None,
            "details": err.details,
        },
        "api_version": API_VERSION,
    }


def error_response(err: ApiError) -> JSONResponse:
    headers = {}
    if err.retry_after_s is not None:
        headers["Retry-After"] = str(max(1, math.ceil(err.retry_after_s)))
    return JSONResponse(status_code=err.http, content=error_body(err), headers=headers)


def call_outcome_for(code: str) -> str:
    """api_call_log.outcome 값(CHECK chk_call_outcome)으로 바꾼다."""
    if code.startswith("AUTH_"):
        return "rejected_key"
    if code == "RATE_LIMIT_EXCEEDED":
        return "rejected_limit"
    if code == "SERVER_BUSY":
        return "rejected_concurrency"
    if code.startswith("UPLOAD_") or code in ("BAD_REQUEST", "VALIDATION_ERROR"):
        return "rejected_file"
    if code == "RESULT_EXPIRED":
        return "expired"
    if code in ("REQUEST_NOT_FOUND", "MODEL_NOT_FOUND"):
        return "not_found"
    return "accepted"  # 키는 맞았고 처리 중 실패(서버 오류·렌더링 실패 등)


def ceil_seconds(seconds: float) -> int:
    return max(1, math.ceil(seconds))
