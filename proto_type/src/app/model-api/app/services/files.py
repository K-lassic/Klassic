"""결과 파일 내려받기 토큰 (T108) — 짧은 기간만 쓰는 서명 주소.

토큰 = base64url("<request_no>|<format>|<만료 epoch>") + "." + HMAC-SHA256 앞 16바이트(base64url).
서명 키는 config.file_token_secret(SESSION_SECRET 에서 파생). 요청 보관 기간(24시간, G4)은 내려받을 때 따로 본다.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time

from app.config import Config
from app.errors import ApiError

FORMATS = ("musicxml", "midi", "mp3")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def sign(cfg: Config, request_no: str, fmt: str, ttl_s: int | None = None) -> str:
    exp = int(time.time()) + int(ttl_s or cfg.file_token_ttl_s)
    payload = f"{request_no}|{fmt}|{exp}".encode()
    sig = hmac.new(cfg.file_token_secret, payload, hashlib.sha256).digest()[:16]
    return f"{_b64(payload)}.{_b64(sig)}"


def verify(cfg: Config, token: str) -> tuple[str, str]:
    """(request_no, format). 서명이 틀리면 REQUEST_NOT_FOUND, 기간이 지났으면 RESULT_EXPIRED."""
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        payload = _unb64(payload_b64)
        sig = _unb64(sig_b64)
        request_no, fmt, exp = payload.decode().split("|")
    except (ValueError, UnicodeDecodeError) as exc:
        raise ApiError("REQUEST_NOT_FOUND", details={"reason": "잘못된 내려받기 주소"}) from exc
    expected = hmac.new(cfg.file_token_secret, payload, hashlib.sha256).digest()[:16]
    if not hmac.compare_digest(sig, expected) or fmt not in FORMATS:
        raise ApiError("REQUEST_NOT_FOUND", details={"reason": "잘못된 내려받기 주소"})
    if int(exp) < time.time():
        raise ApiError("RESULT_EXPIRED", details={"reason": "내려받기 주소 기간이 지났습니다. 결과를 다시 조회해 새 주소를 받아 주십시오.",
                                                  "request_no": request_no})
    return request_no, fmt
