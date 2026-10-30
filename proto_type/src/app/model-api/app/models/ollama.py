"""공유 Ollama 서버 클라이언트 (OLLAMA 설정 참조 §7·§8, INTERFACES §6-1).

지키는 규칙
- 주소는 OLLAMA_URL(.env). 인증 없음.
- 생성 호출(/api/generate·/api/chat)은 서비스 전체에서 동시 1건(세마포어).
- keep_alive "5m" 고정(-1·더 긴 값 금지), num_ctx 기본 4096·최대 8192, think false, format json.
- 타임아웃 300초(공유 서버라 앞 사람 요청을 기다리는 시간 포함).
- 연결 오류·시간 초과만 3초 → 6초 간격으로 다시 시도(최대 3번). HTTP 4xx·5xx 는 다시 시도하지 않는다.
- 런타임 코드에서 pull·create·delete·copy·push·stop·serve 를 부르지 않는다 — 허용 경로 목록 밖이면 예외.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, ClassVar

import httpx

log = logging.getLogger("model-api.ollama")

KEEP_ALIVE = "5m"
DEFAULT_NUM_CTX = 4096
MAX_NUM_CTX = 8192
TIMEOUT_S = 300.0
RETRY_DELAYS_S = (3.0, 6.0)
MAX_MODEL_BYTES = 10 * 1000**3  # 10GB(§7.5 모델 크기 한도)

# 읽기(GET)와 생성(POST)만 허용. pull/create/delete/copy/push 는 이 목록에 없다.
_ALLOWED = {
    ("GET", "/api/version"),
    ("GET", "/api/tags"),
    ("GET", "/api/ps"),
    ("POST", "/api/generate"),
    ("POST", "/api/chat"),
}


class OllamaError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, unreachable: bool = False) -> None:
        super().__init__(message)
        self.status = status
        self.unreachable = unreachable


def is_cloud_tag(tag: str) -> bool:
    """':cloud' 가 붙었거나 '-cloud' 로 끝나는 모델은 외부 과금이라 쓰지 않는다(§7.3)."""
    name = tag.lower()
    return ":cloud" in name or name.endswith("-cloud") or "-cloud:" in name


def clamp_num_ctx(value: int | None) -> int:
    if not value or value <= 0:
        return DEFAULT_NUM_CTX
    return min(int(value), MAX_NUM_CTX)


class OllamaClient:
    # 생성 호출 동시 1건 — 프로세스(이벤트 루프) 전체에서 하나(클라이언트를 새로 만들어도 공유)
    _generate_locks: ClassVar[dict[int, asyncio.Semaphore]] = {}

    def __init__(self, base_url: str, *, transport: httpx.AsyncBaseTransport | None = None,
                 timeout_s: float = TIMEOUT_S, retry_delays: tuple[float, ...] = RETRY_DELAYS_S) -> None:
        self.base_url = base_url.rstrip("/")
        self._transport = transport
        self.timeout_s = timeout_s
        self.retry_delays = retry_delays

    @classmethod
    def _lock(cls) -> asyncio.Semaphore:
        loop_id = id(asyncio.get_running_loop())
        if loop_id not in cls._generate_locks:
            cls._generate_locks = {loop_id: asyncio.Semaphore(1)}  # 루프가 바뀌면(시험) 새로 만든다
        return cls._generate_locks[loop_id]

    async def _request(self, method: str, path: str, body: dict | None = None, *,
                       timeout_s: float | None = None, retry: bool = True) -> Any:
        if (method, path) not in _ALLOWED:
            raise OllamaError(f"허용하지 않는 Ollama 호출: {method} {path}")
        timeout = httpx.Timeout(timeout_s or self.timeout_s, connect=min(10.0, timeout_s or self.timeout_s))
        delays = self.retry_delays if retry else ()
        attempt = 0
        while True:
            try:
                async with httpx.AsyncClient(base_url=self.base_url, transport=self._transport,
                                             timeout=timeout) as client:
                    resp = await client.request(method, path, json=body)
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.WriteTimeout,
                    httpx.PoolTimeout, httpx.RemoteProtocolError) as exc:
                if attempt >= len(delays):
                    raise OllamaError(f"Ollama 연결 실패: {exc!r}", unreachable=True) from exc
                await asyncio.sleep(delays[attempt])
                attempt += 1
                continue
            if resp.status_code >= 400:
                # 4xx(모델 없음·형식 오류)·5xx 모두 같은 요청을 다시 보내지 않는다
                raise OllamaError(f"Ollama {resp.status_code}: {resp.text[:300]}", status=resp.status_code)
            return resp.json()

    # ---------------------------------------------------------------- 읽기
    async def version(self, *, timeout_s: float = 5.0) -> str:
        data = await self._request("GET", "/api/version", timeout_s=timeout_s, retry=False)
        return str(data.get("version", ""))

    async def tags(self, *, timeout_s: float = 10.0) -> list[dict]:
        data = await self._request("GET", "/api/tags", timeout_s=timeout_s, retry=False)
        return list(data.get("models", []))

    async def ps(self, *, timeout_s: float = 5.0) -> list[dict]:
        data = await self._request("GET", "/api/ps", timeout_s=timeout_s, retry=False)
        return list(data.get("models", []))

    async def available_models(self) -> list[dict]:
        """등록할 수 있는 모델: 10GB 이하·cloud 아님(§7.3·§7.5)."""
        out = []
        for m in await self.tags():
            tag = m.get("name") or m.get("model") or ""
            size = int(m.get("size") or 0)
            if not tag or is_cloud_tag(tag) or size <= 0 or size > MAX_MODEL_BYTES:
                continue
            details = m.get("details") or {}
            out.append({
                "tag": tag,
                "size_gb": round(size / 1000**3, 2),
                "family": details.get("family"),
                "parameter_size": details.get("parameter_size"),
                "digest": (m.get("digest") or "")[:12] or None,
            })
        out.sort(key=lambda x: x["tag"])
        return out

    # ---------------------------------------------------------------- 생성(동시 1건)
    async def warmup(self, model: str) -> None:
        """빈 프롬프트 generate 한 번 = 모델을 메모리에 올린다(§6-1 '불러오기')."""
        if is_cloud_tag(model):
            raise OllamaError("cloud 모델은 쓰지 않습니다")
        async with self._lock():
            await self._request("POST", "/api/generate",
                                {"model": model, "prompt": "", "keep_alive": KEEP_ALIVE, "stream": False})

    async def chat_json(self, model: str, messages: list[dict], *, num_ctx: int | None = None,
                        temperature: float | None = None, schema: dict | None = None) -> dict:
        """JSON 형식 답을 받아 dict 로 돌려준다. JSON 이 깨지면 OllamaError.

        schema 를 주면 format 에 "json" 대신 JSON 스키마를 넣어 답의 모양을 묶는다(Ollama 구조화 출력).
        """
        if is_cloud_tag(model):
            raise OllamaError("cloud 모델은 쓰지 않습니다")
        options: dict[str, Any] = {"num_ctx": clamp_num_ctx(num_ctx)}
        if temperature is not None:
            options["temperature"] = temperature
        body = {"model": model, "messages": messages, "stream": False, "think": False,
                "keep_alive": KEEP_ALIVE, "format": schema or "json", "options": options}
        async with self._lock():
            data = await self._request("POST", "/api/chat", body)
        content = ((data or {}).get("message") or {}).get("content", "")
        try:
            parsed = json.loads(content)
        except (TypeError, json.JSONDecodeError) as exc:
            raise OllamaError(f"JSON 이 아닌 답: {str(content)[:200]}") from exc
        if not isinstance(parsed, dict):
            raise OllamaError("JSON 객체가 아닌 답")
        return parsed
