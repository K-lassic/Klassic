"""웹 시험 클라이언트 로그인 (2026-09-29 RBAC, FR-066·067 — 웹 기능은 로그인해야 쓴다).

시험 스크립트(quickstart_run.py · run.py · compare_web_api.py)가 쓰는 고정 시험 계정 하나에 로그인한 httpx 클라이언트를 만든다.
계정이 없으면 처음 한 번만 가입한다(같은 주소 시간당 가입 상한 5를 반복 실행으로 넘지 않게).
비밀번호는 app/.env 의 SESSION_SECRET 에서 만들어 파일에 적지 않는다. 개인 개발 DB 에만 쓴다.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import httpx

APP = Path(__file__).resolve().parents[1]
EMAIL = "evalset-bot@example.kr"


def _secret() -> str:
    for line in (APP / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("SESSION_SECRET="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("app/.env 에 SESSION_SECRET 이 없습니다")


def _password() -> str:
    return "ev-" + hashlib.sha256(("evalset-bot:" + _secret()).encode()).hexdigest()[:24]


class _WebClient(httpx.Client):
    """with 문에 들어갈 때 시험 계정으로 로그인한다(httpx 는 이미 쓴 클라이언트로 다시 with 에 들어갈 수 없다)."""

    def __enter__(self) -> "_WebClient":
        super().__enter__()
        r = self.post("/api/auth/login", json={"email": EMAIL, "password": _password()})
        if r.status_code == 401:
            r = self.post("/api/auth/signup", json={"email": EMAIL, "password": _password(), "name": "평가 시험 계정"})
        if r.status_code not in (200, 201):
            raise SystemExit(f"시험 계정 로그인 실패: {r.status_code} {r.text[:200]}")
        return self

    def __exit__(self, *exc) -> None:
        # (2026-10-01 황송해 209번) 한 계정 한 곳 로그인 — 끝나면 로그아웃해야 다음 실행이 다시 로그인할 수 있다
        try:
            self.post("/api/auth/logout")
        except httpx.HTTPError:
            pass
        super().__exit__(*exc)


def web_client(base_url: str, timeout: float = 60) -> _WebClient:
    """로그인한 웹 클라이언트. `with web_client(...) as c:` 로 쓴다."""
    return _WebClient(base_url=base_url, timeout=timeout)
