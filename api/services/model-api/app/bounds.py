"""#33 구조에서의 위치: HTTP → 인증·접수 예약 → 크기·읽기 시간 제한 → multipart 파서.

큰 본문은 볼륨의 임시 파일로 받고 종료 시 정리한다. 전체를 읽기 전에 인증·한도를 확인한다.
호출 기록·요청 ID는 바깥 로깅 미들웨어가 맡는다. 일반 조회와 서명 다운로드는 제한을 소비하지 않는다.
"""
import asyncio
import tempfile

from starlette.requests import Request

from app.auth.keys import authenticate, call_record
from app.auth.limits import enforce_limits
from app.errors import ApiError, error_response

UPLOAD_PATHS = {"/v1/performances": "recognize", "/v1/omr/staff": "recognize", "/v1/omr/jeongganbo": "recognize",
                "/v1/render/mp3": "render", "/v1/render/pdf": "render", "/v1/internal/upload-check": None}


class UploadBounds:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if scope.get("root_path") and path.startswith(scope["root_path"] + "/"):
            path = path[len(scope["root_path"]):]
        if scope["type"] != "http" or scope.get("method") != "POST" or path not in UPLOAD_PATHS:
            return await self.app(scope, receive, send)
        request = Request(scope)
        cfg = scope["app"].state.config
        try:
            caller = await authenticate(request)
            await enforce_limits(request, caller, UPLOAD_PATHS[path])
            length = request.headers.get("content-length")
            if length is not None:
                if len(length) > 12 or not length.isascii() or not length.isdecimal():
                    raise ApiError("BAD_REQUEST", details={"reason": "invalid_content_length"})
                if int(length) > cfg.max_body_bytes:
                    raise ApiError("UPLOAD_TOO_LARGE", details={"limit": cfg.max_body_bytes})
            temp_dir = cfg.storage_dir / "tmp"
            await asyncio.to_thread(temp_dir.mkdir, parents=True, exist_ok=True)
            with tempfile.SpooledTemporaryFile(max_size=1024 * 1024, dir=temp_dir) as body:
                total = 0
                try:
                    async with asyncio.timeout(cfg.upload_read_timeout_s):
                        while True:
                            message = await receive()
                            if message["type"] == "http.disconnect":
                                raise ApiError("BAD_REQUEST", details={"reason": "upload_disconnected"})
                            chunk = message.get("body", b"")
                            total += len(chunk)
                            if total > cfg.max_body_bytes:
                                raise ApiError("UPLOAD_TOO_LARGE", details={"bytes": total, "limit": cfg.max_body_bytes})
                            await asyncio.to_thread(body.write, chunk)
                            if not message.get("more_body", False):
                                break
                except TimeoutError:
                    raise ApiError("BAD_REQUEST", details={"reason": "upload_read_timeout"}) from None
                await asyncio.to_thread(body.seek, 0)
                remaining = total
                delivered = False

                async def replay():
                    nonlocal remaining, delivered
                    if delivered:
                        return await receive()
                    if remaining:
                        chunk = await asyncio.to_thread(body.read, min(1024 * 1024, remaining))
                        remaining -= len(chunk)
                        delivered = remaining == 0
                        return {"type": "http.request", "body": chunk, "more_body": remaining > 0}
                    delivered = True
                    return {"type": "http.request", "body": b"", "more_body": False}

                await self.app(scope, replay, send)
        except ApiError as exc:
            call_record(request).fail(exc)
            await error_response(exc)(scope, receive, send)
