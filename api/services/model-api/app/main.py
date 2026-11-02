"""#24·#28·#29 model-api 진입점: 자원·DB·인증을 준비하고 검사·오선보 인식 라우터를 묶는다."""
import asyncio
from contextlib import asynccontextmanager
import logging
import re
import sys
import time
import uuid

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from fastapi.responses import JSONResponse

from app.auth.keys import require_service_key, write_call_log
from app.auth import rbac
from app.catalog import load_errors
from app.checks.api import router as upload_router
from app.checks.upload import read_rules
from app.config import Config, load_config
from app.db import Database
from app.errors import ApiError, CATALOG, error_body, error_response
from app.resources.startup import Resources
from app.settings import SettingsStore
from app.jobs.limiter import Limiter
from app.models.registry import ModelRegistry
from app.routers.models import router as models_router
from app.routers.omr_staff import router as staff_router

logging.basicConfig(level=logging.INFO, stream=sys.stdout,
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("model-api")


async def reject_unknown_fields(request: Request):
    ctype = request.headers.get("content-type", "")
    if not ctype.startswith(("multipart/form-data", "application/x-www-form-urlencoded")):
        return
    dependant = getattr(request.scope.get("route"), "dependant", None)
    if dependant is None:
        return
    allowed, stack = set(), [dependant]
    while stack:
        current = stack.pop()
        allowed.update(p.alias for p in current.body_params)
        stack.extend(current.dependencies)
    form = await request.form()
    unknown = sorted(set(form) - allowed)
    if unknown:
        raise ApiError("VALIDATION_ERROR", details={"errors": [
            {"loc": ["body", name], "msg": "선언되지 않은 필드입니다"} for name in unknown]})


def safe_path(path):
    return re.sub(r"(/v1/files/)[^/?]+", r"\1<token>", path)


def create_app(cfg: Config | None = None, *, db_factory=Database.connect, resource_factory=Resources):
    cfg = cfg or load_config()

    @asynccontextmanager
    async def lifespan(app):
        # 파일·중복 오류 또는 DB 연결 실패는 준비된 척하지 않고 시작을 실패시킨다.
        app.state.catalog = load_errors(cfg.shared_dir)
        app.state.upload_rules = read_rules(cfg.shared_dir)
        app.state.db = await db_factory(cfg)
        resources = None
        warmup = None
        try:
            app.state.settings = SettingsStore(app.state.db)
            await app.state.settings.load()
            rbac.clear_cache()
            resources = resource_factory(cfg, app.state.db)
            app.state.resources = resources
            app.state.registry = ModelRegistry(cfg, app.state.db, resources)
            app.state.limiter = Limiter(app.state.settings.current)
            warmup = asyncio.create_task(resources.start(), name="startup-resources")
            yield
        finally:
            if warmup:
                # 음원 로딩 스레드가 끝나기 전에 synth를 해제하지 않는다.
                await asyncio.gather(warmup, return_exceptions=True)
            if resources:
                await resources.close()
            from app.services.safe_midi import close_safe_midi
            await close_safe_midi()
            await app.state.db.close()

    app = FastAPI(title="K-lassic model-api", version="0.1.1",
                  openapi_url="/v1/openapi.json", docs_url="/v1/docs", redoc_url=None,
                  dependencies=[Depends(reject_unknown_fields)], lifespan=lifespan)
    app.state.config = cfg

    @app.exception_handler(ApiError)
    async def api_error(request, exc):
        if getattr(request.state, "call", None):
            request.state.call.fail(exc)
        return error_response(exc)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return await api_error(request, ApiError("VALIDATION_ERROR", details={"errors": [
            {"loc": list(e.get("loc", [])), "msg": e.get("msg")} for e in exc.errors()]}))

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        code = "REQUEST_NOT_FOUND" if exc.status_code == 404 else "BAD_REQUEST"
        return await api_error(request, ApiError(code, http=exc.status_code))

    @app.middleware("http")
    async def request_log(request, call_next):
        token = CATALOG.set(app.state.catalog)
        req_id = uuid.uuid4().hex[:12]
        request.state.req_id = req_id
        started = time.monotonic()
        try:
            try:
                response = await call_next(request)
            except Exception as exc:
                # 예외 문자열·입력·헤더에 비밀값이 섞일 수 있어 타입만 기록한다.
                log.error("request_failed req_id=%s error_type=%s", req_id, type(exc).__name__)
                err = ApiError("INTERNAL_ERROR")
                if getattr(request.state, "call", None):
                    request.state.call.fail(err)
                response = error_response(err)
            rec = getattr(request.state, "call", None)
            if rec:
                await write_call_log(app.state.db, rec)
            response.headers["X-Request-ID"] = req_id
            log.info("req_id=%s method=%s path=%s status=%s duration_ms=%s", req_id,
                     request.method, safe_path(request.url.path), response.status_code,
                     round((time.monotonic() - started) * 1000))
            return response
        finally:
            CATALOG.reset(token)

    @app.get("/v1/health")
    async def health():
        state, db_ok = app.state, False
        try:
            db_ok = bool(await state.db.fetch_one("SELECT 1 AS ok"))
        except Exception:
            pass
        resources = state.resources
        missing = resources.missing_kinds() if db_ok else []
        if not resources.startup_done:
            status = "loading"
        elif missing:
            status = "unavailable"
        else:
            status = "ok" if db_ok else "degraded"
        entries = resources.snapshot()
        body = {"status": status, "api_version": "v1", "db": "ok" if db_ok else "unreachable",
                "queue": {k: v for k, v in state.limiter.stats().items() if k != "render_waiting"},
                "settings_version": state.settings.current.version_id or None,
                "models_ready": sum(e["state"] == "ready" for e in entries), "models_total": len(entries)}
        if status in ("loading", "unavailable"):
            body["missing_kinds"] = missing
            body["error"] = error_body(ApiError("SERVICE_NOT_READY", details={
                "status": status, "missing_kinds": missing}))["error"]
        return JSONResponse(body, status_code=503 if status in ("loading", "unavailable") else 200)

    @app.get("/v1/versions")
    async def versions():
        resources = app.state.resources
        try:
            rows = await app.state.db.fetch_all(
                "SELECT template_id, name, version FROM fallback_template WHERE holder='api_server' AND is_active=TRUE")
        except Exception:
            rows = []
        return {"api_version": "v1", "openapi_url": "/v1/openapi.json",
                "engines": [{k: v for k, v in entry.items() if k != "enabled"} for entry in resources.snapshot()],
                "templates": [{"id": str(r["template_id"]), "name": r["name"], "version": r["version"]} for r in rows],
                "rules_hash": resources.rules_hash}

    @app.post("/v1/internal/settings/reload", dependencies=[Depends(require_service_key)])
    async def reload_settings():
        settings = await app.state.settings.load()
        app.state.limiter.resize(settings)
        await app.state.settings.mark_applied()
        return {"settings_version": settings.version_id, "engine_order": settings.engine_order}

    app.include_router(upload_router)
    app.include_router(models_router)
    app.include_router(staff_router)

    original_openapi = app.openapi

    def openapi_with_key():
        schema = original_openapi()
        schema.setdefault("components", {})["securitySchemes"] = {
            "ApiKey": {"type": "apiKey", "in": "header", "name": "X-API-Key"}}
        for path, operations in schema.get("paths", {}).items():
            for operation in operations.values():
                if isinstance(operation, dict):
                    operation["security"] = [{"ApiKey": []}] if "/internal/" in path else []
        return schema

    app.openapi = openapi_with_key

    return app


app = create_app()
