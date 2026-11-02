"""#32 구조에서의 위치: 결과 API·다운로드 API → 이 파일 → 짧은 기간의 HMAC 서명·검증.

토큰 = base64url("<request_no>|<format>|<만료 epoch>") + "." + HMAC-SHA256 앞 16바이트(base64url).
서명 키는 FILE_TOKEN_SECRET 또는 프로세스별 난수다. DB·파일을 저장하지 않으며 보관 만료는 다운로드 때 따로 본다.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import time

from app.config import Config
from app.errors import ApiError

FORMATS = ("musicxml", "midi", "mp3")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", text):
        raise ValueError("잘못된 base64url")
    return base64.b64decode(text + "=" * (-len(text) % 4), altchars=b"-_", validate=True)


def sign(cfg: Config, request_no: str, fmt: str, ttl_s: int | None = None) -> str:
    exp = int(time.time()) + int(cfg.file_token_ttl_s if ttl_s is None else ttl_s)
    payload = f"{request_no}|{fmt}|{exp}".encode()
    sig = hmac.new(cfg.file_token_secret, payload, hashlib.sha256).digest()[:16]
    return f"{_b64(payload)}.{_b64(sig)}"


def verify(cfg: Config, token: str) -> tuple[str, str]:
    """(request_no, format). 서명이 틀리면 REQUEST_NOT_FOUND, 기간이 지났으면 RESULT_EXPIRED."""
    try:
        if len(token) > 256:
            raise ValueError("너무 긴 토큰")
        payload_b64, sig_b64 = token.split(".", 1)
        payload = _unb64(payload_b64)
        sig = _unb64(sig_b64)
        request_no, fmt, exp = payload.decode().split("|")
        if not re.fullmatch(r"R-\d{4}-[A-Z2-9]{8}", request_no) or not exp.isascii() or not exp.isdecimal():
            raise ValueError("잘못된 서명 내용")
        expires = int(exp)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ApiError("REQUEST_NOT_FOUND", details={"reason": "잘못된 내려받기 주소"}) from exc
    expected = hmac.new(cfg.file_token_secret, payload, hashlib.sha256).digest()[:16]
    if not hmac.compare_digest(sig, expected) or fmt not in FORMATS:
        raise ApiError("REQUEST_NOT_FOUND", details={"reason": "잘못된 내려받기 주소"})
    if expires <= time.time():
        raise ApiError("RESULT_EXPIRED", details={"reason": "내려받기 주소 기간이 지났습니다. 결과를 다시 조회해 새 주소를 받아 주십시오.",
                                                  "request_no": request_no})
    return request_no, fmt
