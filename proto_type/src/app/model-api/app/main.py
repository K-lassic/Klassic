"""모델 API 서버 (T029, FR-038 · FastAPI + uvicorn, 포트 9543).

- 외부에서는 https://p3.sumzip.com/api/v1/... 로 들어온다(입구 ops/gateway.mjs → 이 서버). uvicorn --root-path /api 라서
  /api/v1/... 와 /v1/...(웹 서비스가 127.0.0.1 로 직접 부를 때) 둘 다 받는다.

- 모든 경로는 /v1 아래, 명세는 /v1/openapi.json.
- 오류는 한 가지 모양(FR-048, shared/error-codes.json) — ApiError·검증 오류·예상 못 한 오류 모두.
- 키가 필요한 호출은 끝날 때 api_call_log 한 줄(G2·G3 판정 근거).
- CORS 는 켜지 않는다(웹 서비스가 서버에서 부른다).
- 시작할 때: DB 풀 → 처리 설정 → 동시 처리 자리 → 모델 등록부(확인) → venv 모델 데우기(Ollama 는 설정했을 때만) → 삭제 순환.
"""

from __future__ import annotations

import asyncio
import contextvars
import logging
import re
import sys
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.auth.keys import write_call_log
from app.config import API_VERSION, Config, load_config
from app.db import Database
from app.errors import ApiError, error_response
from app.jobs.limiter import Limiter
from app.jobs.performance import PerformanceRunner
from app.jobs.purge import purge_loop
from app.jobs.watchdog import LoopWatchdog
from app.models.ollama import OllamaClient
from app.models.registry import ModelRegistry
from app.routers import catalog, health, internal, models, omr_jeongganbo, omr_staff, performances, recommend, render
from app.settings import SettingsStore

log = logging.getLogger("model-api")
# 모든 로그 줄에 요청 번호표(2026-09-30 개선 가이드 D5): 요청 중이면 req_id, 아니면 "-"
REQ_ID: contextvars.ContextVar[str] = contextvars.ContextVar("req_id", default="-")


class _ReqIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.req_id = REQ_ID.get()
        return True


if not log.handlers:
    _base = logging.StreamHandler(sys.stderr)
    _base.setFormatter(logging.Formatter("%(asctime)s %(levelname)s req_id=%(req_id)s %(name)s %(message)s"))
    _base.addFilter(_ReqIdFilter())
    log.addHandler(_base)
    log.setLevel(logging.INFO)
    log.propagate = False
# 요청 로그 한 줄(2026-09-30 API 점검 D5·D6·D7): req_id path status dur_ms input_len (+인식이면 label model_version)
# 입력 원문·파일 이름·쿼리 문자열·키·토큰은 남기지 않는다. uvicorn 기본 접근 로그는 끈다(ecosystem --no-access-log)
access_log = logging.getLogger("model-api.access")
if not access_log.handlers:
    _h = logging.StreamHandler(sys.stdout)
    _h.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    access_log.addHandler(_h)
    access_log.setLevel(logging.INFO)
    access_log.propagate = False
_TOKEN_PATH = re.compile(r"(/v1/files/)[^/?]+")


def safe_path(path: str) -> str:
    """결과 파일 내려받기 경로의 서명 토큰을 가린다."""
    return _TOKEN_PATH.sub(r"\1<token>", path)


def _preload_music21() -> None:
    """music21 첫 가져오기가 1~2초 걸려 추천 3초 제한을 먹지 않게 미리 불러 둔다."""
    try:
        import music21  # noqa: F401
        from music21.musicxml import m21ToXml  # noqa: F401
    except Exception:
        log.exception("music21 미리 불러오기 실패")


async def reject_unknown_fields(request: Request) -> None:
    """폼에 선언하지 않은 필드를 거절한다(2026-09-30 API 점검 B3 — 조용히 무시하지 않는다).

    FastAPI 가 이미 읽어 둔 폼(request.form() 캐시)을 경로가 선언한 File·Form 이름과 대조한다.
    """
    ctype = request.headers.get("content-type", "")
    if not ctype.startswith(("multipart/form-data", "application/x-www-form-urlencoded")):
        return
    route = request.scope.get("route")
    dependant = getattr(route, "dependant", None)
    if dependant is None:
        return
    allowed: set[str] = set()
    stack = [dependant]
    while stack:  # 경로와 그 의존성이 선언한 File·Form 이름
        d = stack.pop()
        allowed.update(p.alias for p in d.body_params)
        stack.extend(d.dependencies)
    form = await request.form()
    unknown = sorted({k for k in form if k not in allowed})
    if unknown:
        raise ApiError("VALIDATION_ERROR", details={"errors": [
            {"loc": ["body", k], "msg": "선언되지 않은 필드입니다"} for k in unknown]})


def create_app(cfg: Config | None = None, *, ollama_transport: httpx.AsyncBaseTransport | None = None,
               start_background: bool = True) -> FastAPI:
    cfg = cfg or load_config()
    active: dict[str, tuple[str, float]] = {}  # 처리 중인 요청 req_id → (가린 경로, 시작) — 멈춤 감지가 읽는다

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        state = app.state
        state.db = None
        try:
            state.db = await Database.connect(cfg)
        except Exception:
            log.exception("DB 연결 실패 — degraded 로 시작합니다")
        state.settings = SettingsStore(state.db)
        if state.db is not None:
            try:
                await state.settings.load()
                await state.settings.mark_applied()
            except Exception:
                log.exception("처리 설정을 읽지 못했습니다(기본값 사용)")
        state.limiter = Limiter(state.settings.current)
        state.ollama = OllamaClient(cfg.ollama_url, transport=ollama_transport)
        state.registry = ModelRegistry(cfg, state.db, state.ollama)
        state.performances = PerformanceRunner(app)
        tasks: list[asyncio.Task] = []
        if state.db is not None:
            try:
                await state.registry.reload()
            except Exception:
                log.exception("모델 등록부를 읽지 못했습니다")
            if start_background:
                tasks.append(asyncio.create_task(state.registry.warm_on_startup(), name="warmup"))
                tasks.append(asyncio.create_task(purge_loop(app), name="purge"))
        if not start_background or state.db is None:
            state.registry.startup_done = True  # 데울 것이 없으면 바로 준비 끝(시험·DB 없음)
        if start_background:
            tasks.append(asyncio.create_task(asyncio.to_thread(_preload_music21), name="music21"))
            # MIDI 안전 변환 작업자 미리 띄우기(2026-09-30 SD_04 §8-1)
            from app.services.safe_midi import get_safe_midi

            tasks.append(asyncio.create_task(get_safe_midi().warm(), name="safe-midi"))
        state.background = tasks
        # 처리 루프 멈춤 감지(2026-09-30 SD_04 §8-1) — 운영 기동 때만(시험은 start_background=False)
        state.watchdog = LoopWatchdog(active) if start_background else None
        if state.watchdog is not None:
            state.watchdog.start()
        try:
            yield
        finally:
            if state.watchdog is not None:
                await state.watchdog.stop()
            from app.services.safe_midi import close_safe_midi

            await close_safe_midi()
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await state.performances.shutdown()
            await state.registry.shutdown()
            if state.db is not None:
                await state.db.close()

    app = FastAPI(
        title="국악보 모델 API 서버",
        version=API_VERSION,
        description="오선보·정간보 인식, 악기 추천, MP3·PDF 렌더링, 연주 요청 (FR-038·FR-040). 오류 형식은 shared/error-codes.json.",
        openapi_url="/v1/openapi.json",
        docs_url="/v1/docs",
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.config = cfg
    app.state.db = None

    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError):
        rec = getattr(request.state, "call", None)
        if rec is not None:
            rec.fail(exc)
        return error_response(exc)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        # 계약 위반은 422(무엇이 왜) — 2026-09-30 API 점검 B2·B4·B5 (웹 서비스는 400 BAD_REQUEST 그대로)
        err = ApiError("VALIDATION_ERROR", details={"errors": [
            {"loc": list(e.get("loc", [])), "msg": e.get("msg")} for e in exc.errors()
        ]})
        return await _api_error(request, err)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        code = "REQUEST_NOT_FOUND" if exc.status_code == 404 else "BAD_REQUEST"
        return await _api_error(request, ApiError(code, http=exc.status_code if exc.status_code >= 400 else None))

    @app.middleware("http")
    async def _call_log(request: Request, call_next):
        try:
            response = await call_next(request)
        except Exception:
            log.exception("처리 중 오류: req_id=%s %s %s", getattr(request.state, "req_id", "-"), request.method,
                          safe_path(request.url.path))
            err = ApiError("INTERNAL_ERROR")
            rec = getattr(request.state, "call", None)
            if rec is not None:
                rec.fail(err)
            response = error_response(err)
        rec = getattr(request.state, "call", None)
        db = getattr(request.app.state, "db", None)
        if rec is not None and db is not None:
            await write_call_log(db, rec)
        return response

    @app.middleware("http")
    async def _request_id(request: Request, call_next):
        """요청마다 번호표(D5) — 응답 머리글 X-Request-ID 와 로그 줄에 같은 번호."""
        req_id = uuid.uuid4().hex[:12]
        request.state.req_id = req_id
        REQ_ID.set(req_id)
        t0 = time.perf_counter()
        active[req_id] = (safe_path(request.url.path), time.monotonic())
        try:
            response = await call_next(request)
        finally:
            active.pop(req_id, None)
        response.headers["X-Request-ID"] = req_id
        extra = getattr(request.state, "log_extra", None) or {}
        access_log.info(
            "req_id=%s method=%s path=%s status=%s dur_ms=%.1f input_len=%s label=%s score=%s model_version=%s",
            req_id, request.method, safe_path(request.url.path), response.status_code,
            (time.perf_counter() - t0) * 1000, request.headers.get("content-length", "-"),
            extra.get("label", "-"), extra.get("score", "-"), extra.get("model_version", "-"))
        return response

    for module in (health, models, internal, omr_staff, omr_jeongganbo, recommend, render, performances, catalog):
        app.include_router(module.router, prefix="/v1", dependencies=[Depends(reject_unknown_fields)])

    def openapi_with_key() -> dict:
        """명세에 X-API-Key 보안 방식을 적는다(계약 securitySchemes.ApiKey). 공개 경로는 security: []."""
        if app.openapi_schema:
            return app.openapi_schema
        from fastapi.openapi.utils import get_openapi

        schema = get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes)
        schema.setdefault("components", {})["securitySchemes"] = {"ApiKey": {
            "type": "apiKey", "in": "header", "name": "X-API-Key",
            "description": "gk_ 로 시작하는 접근 키. 서버는 SHA-256 해시로만 대조한다(FR-055).",
        }}
        schema["security"] = [{"ApiKey": []}]
        public = {"/v1/health", "/v1/versions", "/v1/models", "/v1/files/{token}"}
        for path, ops in schema.get("paths", {}).items():
            if path in public:
                for op in ops.values():
                    op["security"] = []
        schema["servers"] = [{"url": f"http://localhost:{cfg.port}", "description": "모델 API 서버"}]
        app.openapi_schema = schema
        return schema

    app.openapi = openapi_with_key  # type: ignore[method-assign]
    return app


app = create_app()
