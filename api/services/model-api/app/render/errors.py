"""#31 렌더러 → 작업자·API의 공통 오류 경계. shared/errors의 상태 코드와 계약의 502·504를 사용한다."""

from __future__ import annotations

RENDER_CODES = ("RENDER_FAILED", "RENDER_TIMEOUT", "RENDERER_MISSING")


class RenderError(Exception):
    """code: RENDER_FAILED | RENDER_TIMEOUT | RENDERER_MISSING"""

    def __init__(self, code: str, detail: str = "") -> None:
        if code not in RENDER_CODES:
            raise ValueError(f"알 수 없는 렌더 오류 코드: {code}")
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail
