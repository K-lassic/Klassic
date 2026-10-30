"""서버 상태·버전 (T034, FR-040 ⑦ · FR-044 · INTERFACES §6). 키 없이 부른다."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request, Response

from app.config import API_VERSION
from app.errors import ApiError, error_body
from app.fallback.template import template_versions
from app.recommend.rules import rules_hash
from app.services import engine_api

router = APIRouter(tags=["상태"])
log = logging.getLogger("model-api.health")


@router.get("/health", summary="서버 상태 (UC11 기본흐름 1)",
            description="200 ok · 200 degraded(DB 끊김) · 503 loading(기동 때 엔진 데우는 중) · 503 unavailable(쓸 인식 엔진 없음)",
            responses={503: {"description": "준비 안 됨 — status loading 또는 unavailable, error.code SERVICE_NOT_READY"}})
async def health(request: Request, response: Response) -> dict:
    state = request.app.state
    db_ok = False
    if state.db is not None:
        try:
            await state.db.fetch_one("SELECT 1 AS ok")
            db_ok = True
        except Exception:  # noqa: BLE001
            db_ok = False
    stats = state.limiter.stats()
    ready, total = state.registry.ready_counts()
    # 상태는 추측이 아니라 실제 값으로(2026-09-30 API 점검 A4·A5): 데우는 중 → loading, 쓸 엔진 없음 → unavailable (둘 다 503)
    missing = state.registry.missing_kinds() if db_ok else []
    if not state.registry.startup_done:
        status = "loading"
    elif missing:
        status = "unavailable"
    else:
        status = "ok" if db_ok else "degraded"
    body = {
        "status": status,
        "api_version": API_VERSION,
        "queue": {
            "recognize_running": stats["recognize_running"],
            "recognize_waiting": stats["recognize_waiting"],
            "render_running": stats["render_running"],
        },
        "settings_version": state.settings.current.version_id or None,
        "models_ready": ready,
        "models_total": total,
        "db": "ok" if db_ok else "unreachable",
    }
    if status in ("loading", "unavailable"):
        response.status_code = 503
        body["missing_kinds"] = missing
        body["error"] = error_body(ApiError("SERVICE_NOT_READY", details={"status": status, "missing_kinds": missing}))["error"]
    return body


@router.get("/versions", summary="엔진 이름·버전과 명세 (UC11 기본흐름 2 · FR-044)")
async def versions(request: Request) -> dict:
    state = request.app.state
    reg = state.registry
    await reg.refresh_ollama()
    engines = [
        {"name": e.model_name, "version": e.version, "kind": e.kind, "provider": e.provider,
         "installed": e.installed, "state": e.state}
        for e in reg.entries.values()
    ]
    try:
        for r in engine_api.renderer_versions():
            kind = r.get("kind")
            engines.append({"name": r.get("name"), "version": r.get("version"),
                            "kind": f"render_{kind}" if kind in ("mp3", "pdf") else kind,
                            "provider": "renderer", "installed": bool(r.get("installed", r.get("version"))),
                            "state": "ready" if r.get("installed", r.get("version")) else "unavailable"})
    except Exception as exc:  # noqa: BLE001
        log.info("renderer_versions 없음: %s", exc)
    try:
        templates = await template_versions(state.db)
    except Exception:  # noqa: BLE001
        templates = []
    return {
        "api_version": API_VERSION,
        "openapi_url": "/v1/openapi.json",
        "engines": engines,
        "templates": templates,
        "rules_hash": rules_hash(),
    }
