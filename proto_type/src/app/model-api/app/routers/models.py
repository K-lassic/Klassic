"""모델 등록부 상태·불러오기 (INTERFACES §6 · §6-1 · §7).

- GET /v1/models: 공개(키 없음) — 사용자 화면 "모델 준비 중" 안내와 관리자 '모델' 탭이 읽는다.
- POST /v1/internal/models/reload · /{name}/load · GET /v1/internal/ollama/available: 서비스 키만.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from app.auth.keys import Caller, require_service_key
from app.errors import ApiError
from app.models.ollama import OllamaError

router = APIRouter(tags=["상태"])


@router.get("/models", summary="모델 목록과 준비 상태")
async def list_models(request: Request) -> list[dict]:
    reg = request.app.state.registry
    await reg.refresh_ollama()
    await reg.refresh_estimates()
    return [reg.public_view(e) for e in reg.entries.values()]


@router.post("/internal/models/reload", tags=["내부"], summary="등록부 다시 읽기")
async def reload_models(request: Request, caller: Caller = Depends(require_service_key)) -> dict:
    reg = request.app.state.registry
    changed = await reg.reload()
    # 새로 들어오거나 바뀐 venv 모델은 바로 데워 둔다(첫 사용자가 기다리지 않게). Ollama 는 공유 서버라 관리자가 고른다.
    for name in changed:
        entry = reg.get(name)
        if entry and entry.enabled and entry.provider == "venv" and entry.installed:
            await reg.start_load(name, "reload")
    return {"models": [reg.public_view(e) for e in reg.entries.values()], "changed": changed}


class LoadBody(BaseModel):
    model_config = ConfigDict(extra="forbid")  # 모르는 필드 거절(2026-09-30 API 점검 B3)
    operator_id: int | None = None


@router.post("/internal/models/{name}/load", tags=["내부"], status_code=202, summary="모델 불러오기(워밍업) 시작")
async def load_model(name: str, request: Request, body: LoadBody | None = None,
                     caller: Caller = Depends(require_service_key)) -> JSONResponse:
    reg = request.app.state.registry
    entry = reg.require(name)
    if entry.provider == "ollama":
        await reg.refresh_ollama(force=True)
        if reg.ollama_reachable is False:
            raise ApiError("OLLAMA_UNAVAILABLE", details={"model": name})
    operator_id = body.operator_id if body else None
    if operator_id is None and request.query_params.get("operator_id", "").isdigit():
        operator_id = int(request.query_params["operator_id"])
    load_id, expected = await reg.start_load(name, "admin", operator_id)
    return JSONResponse(status_code=202, content={"load_id": load_id, "expected_seconds": expected,
                                                  "model": reg.public_view(entry)})


@router.get("/internal/ollama/available", tags=["내부"], summary="공유 Ollama 서버에서 등록할 수 있는 모델")
async def ollama_available(request: Request, caller: Caller = Depends(require_service_key)) -> dict:
    reg = request.app.state.registry
    client = reg.ollama
    try:
        version = await client.version()
        models = await client.available_models()
    except OllamaError as exc:
        return {"ollama": "unreachable", "version": None, "models": [], "error": str(exc)[:300]}
    registered = {(e.ollama_tag) for e in reg.entries.values() if e.provider == "ollama"}
    for m in models:
        tag = m["tag"] if ":" in m["tag"] else f"{m['tag']}:latest"
        m["registered"] = tag in registered
    return {"ollama": "ok", "version": version, "models": models}
