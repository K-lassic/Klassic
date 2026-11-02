"""#31 구조에서의 위치: 렌더링 라우터 → 이 파일 → 별도 렌더링 작업자.

기한·취소 시 작업자와 자식 CLI를 같은 프로세스 묶음으로 종료한다. DB 비밀값은 전달하지 않는다.
"""
import asyncio
import base64
from dataclasses import dataclass
from pathlib import Path
import sys
import time

from app.errors import ApiError
from app.resources.startup import worker_environment
from app.resources.worker import EngineWorker


@dataclass
class RenderResult:
    data: bytes
    name: str
    version: str
    timings: dict


class RenderPool:
    def __init__(self, cfg, size=2):
        env = worker_environment() | {"SHARED_DIR": str(cfg.shared_dir), "SOUNDFONTS_DIR": str(cfg.soundfonts_dir),
                                      "ASSETS_DIR": str(cfg.assets_dir), "ENGINES_DIR": str(cfg.engines_dir)}
        cwd = str(Path(__file__).resolve().parents[2])
        self.workers = [EngineWorker(f"render-{i}", [sys.executable, "-B", "-m", "app.render.runner"],
                                     cwd=cwd, env=env, max_requests=50) for i in range(size)]
        self.free = asyncio.Queue()
        for worker in self.workers:
            self.free.put_nowait(worker)

    async def render(self, kind, data, assignment, deadline):
        body = await self._request({"kind": kind, "score_base64": base64.b64encode(data).decode("ascii"),
                                    "assignment": assignment}, deadline)
        return RenderResult(base64.b64decode(body["data_base64"], validate=True), body["name"],
                            body["version"], body["timings_ms"])

    async def prepare(self, data, assignment, transpose, volume, deadline):
        """#32 악기·조옮김·음량 처리를 별도 프로세스에서 수행한다."""
        return await self._request({"kind": "prepare", "score_base64": base64.b64encode(data).decode("ascii"),
                                    "assignment": assignment, "transpose": transpose, "volume": volume}, deadline)

    async def render_prepared(self, prepared, deadline):
        body = await self._request({"kind": "mp3_prepared", "score_base64": prepared["midi_base64"],
                                    "part_fonts": prepared["part_fonts"], "part_presets": prepared["part_presets"]}, deadline)
        return RenderResult(base64.b64decode(body["data_base64"], validate=True), body["name"],
                            body["version"], body["timings_ms"])

    async def _request(self, payload, deadline):
        try:
            worker = await asyncio.wait_for(self.free.get(), timeout=max(0, deadline - time.monotonic()))
        except TimeoutError:
            raise ApiError("RENDER_TIMEOUT") from None
        try:
            payload = payload | {"deadline": deadline}
            reply = await worker.request(payload, deadline)
            if reply is None or reply.timed_out:
                raise ApiError("RENDER_TIMEOUT")
            if reply.error or not reply.data:
                raise ApiError("RENDER_TIMEOUT" if time.monotonic() >= deadline else "RENDER_FAILED")
            body = reply.data
            if not body.get("ok"):
                code = body.get("code")
                raise ApiError(code if code in ("RENDER_FAILED", "RENDER_TIMEOUT", "RENDERER_MISSING", "UPLOAD_CORRUPTED")
                               else "RENDER_FAILED")
            return body
        finally:
            self.free.put_nowait(worker)

    async def close(self):
        for worker in self.workers:
            await worker.stop()
