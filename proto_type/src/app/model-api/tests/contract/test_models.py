"""모델 등록부·불러오기·Ollama 클라이언트 계약 시험 (INTERFACES §6 · §6-1 · OLLAMA 설정 참조 §7·§8)."""

from __future__ import annotations

import httpx
import pytest

from app.models.ollama import OllamaClient, OllamaError, is_cloud_tag

from .conftest import FORBIDDEN_OLLAMA, key_headers, q1, svc_headers, wait_until

MODEL_KEYS = {"name", "display_name", "kind", "provider", "provider_ref", "enabled", "installed", "version", "state",
              "loaded_at", "last_load_ms", "expected_seconds", "load_started_at", "elapsed_seconds", "error"}


async def test_list_models_is_public_and_shaped(app_client, ollama):
    r = await app_client.get("/v1/models")  # 키 없음
    assert r.status_code == 200
    models = {m["name"]: m for m in r.json()}
    assert set(models) >= {"homr", "audiveris", "jeongganbo-omr", "rules", "llm-gemma3-4b"}
    for m in models.values():
        assert set(m) == MODEL_KEYS
        assert m["state"] in ("ready", "cold", "loading", "failed", "unavailable")
    assert models["rules"]["state"] == "ready" and models["rules"]["provider"] == "builtin"
    assert models["homr"]["state"] == "cold" and models["homr"]["installed"] is True
    assert models["homr"]["expected_seconds"] == 40.0  # 기록이 없으면 config cold_start_hint_s
    assert models["llm-gemma3-4b"]["state"] == "cold" and models["llm-gemma3-4b"]["installed"] is True


async def test_ollama_ps_means_ready(app_client, ollama):
    ollama.loaded = ["gemma3:4b"]
    app_client.app.state.registry._ollama_checked = 0
    models = {m["name"]: m for m in (await app_client.get("/v1/models")).json()}
    assert models["llm-gemma3-4b"]["state"] == "ready"


async def test_load_endpoint_writes_model_load_event(app_client, db):
    r = await app_client.post("/v1/internal/models/homr/load", json={"operator_id": 1}, headers=svc_headers())
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["load_id"] and body["expected_seconds"] == 40.0
    row = q1(db, "SELECT trigger_kind, operator_id FROM model_load_event WHERE load_id = %s", (body["load_id"],))
    assert row == {"trigger_kind": "admin", "operator_id": 1}
    await wait_until(lambda: q1(db, "SELECT outcome FROM model_load_event WHERE load_id = %s",
                                (body["load_id"],))["outcome"] != "running")
    done = q1(db, "SELECT outcome, finished_at, duration_ms FROM model_load_event WHERE load_id = %s", (body["load_id"],))
    assert done["outcome"] == "ok" and done["finished_at"] and done["duration_ms"] is not None
    models = {m["name"]: m for m in (await app_client.get("/v1/models")).json()}
    assert models["homr"]["state"] == "ready" and models["homr"]["loaded_at"]
    # 기록이 생겼으므로 예상 시간은 평균 불러오기 시간에서 나온다
    est = q1(db, "SELECT avg_load_ms FROM v_model_load_estimate WHERE model_name = 'homr'")
    assert models["homr"]["expected_seconds"] == round(float(est["avg_load_ms"]) / 1000.0, 1)


async def test_loading_state_reports_elapsed(app_client, engines):
    import asyncio

    from .conftest import FakeAdapter

    gate = asyncio.Event()

    async def slow_warmup(self, timeout_s):
        await gate.wait()

    reg = app_client.app.state.registry
    entry = reg.get("audiveris")
    entry.adapter = FakeAdapter(engines, entry.row)
    entry.adapter.warmup = slow_warmup.__get__(entry.adapter)
    await app_client.post("/v1/internal/models/audiveris/load", headers=svc_headers())
    m = {x["name"]: x for x in (await app_client.get("/v1/models")).json()}["audiveris"]
    assert m["state"] == "loading" and m["load_started_at"] and m["elapsed_seconds"] == 0
    gate.set()
    await wait_until(lambda: reg.get("audiveris").state == "ready")


async def test_load_ollama_model_uses_empty_generate(app_client, db, ollama):
    r = await app_client.post("/v1/internal/models/llm-gemma3-4b/load", headers=svc_headers())
    assert r.status_code == 202
    await wait_until(lambda: app_client.app.state.registry.get("llm-gemma3-4b").state == "ready")
    gens = [b for _, p, b in ollama.requests if p == "/api/generate"]
    assert gens == [{"model": "gemma3:4b", "prompt": "", "keep_alive": "5m", "stream": False}]


async def test_internal_endpoints_need_service_key(app_client, ext_key):
    for method, path in (("post", "/v1/internal/models/reload"), ("post", "/v1/internal/models/homr/load"),
                         ("get", "/v1/internal/ollama/available"), ("post", "/v1/internal/settings/reload")):
        r = await getattr(app_client, method)(path, headers=key_headers(ext_key[0]))
        assert r.status_code == 403, path
    r = await app_client.post("/v1/internal/models/nope/load", headers=svc_headers())
    assert r.status_code == 404 and r.json()["error"]["code"] == "MODEL_NOT_FOUND"


async def test_ollama_available_filters_size_and_cloud(app_client, ollama):
    ollama.tags = [
        {"name": "gemma3:4b", "size": 3_300_000_000, "digest": "aa", "details": {"family": "gemma3", "parameter_size": "4.3B"}},
        {"name": "qwen3:8b", "size": 5_200_000_000, "digest": "bb", "details": {"family": "qwen3", "parameter_size": "8.2B"}},
        {"name": "llama3.3:70b", "size": 42_000_000_000, "digest": "cc", "details": {"family": "llama"}},
        {"name": "gpt-oss:120b-cloud", "size": 384, "digest": "dd", "details": {}},
        {"name": "deepseek-v3.1:671b-cloud", "size": 384, "digest": "ee", "details": {}},
        {"name": "kimi:cloud", "size": 100, "digest": "ff", "details": {}},
    ]
    body = (await app_client.get("/v1/internal/ollama/available", headers=svc_headers())).json()
    assert body["ollama"] == "ok" and body["version"] == "0.34.0-test"
    tags = {m["tag"]: m for m in body["models"]}
    assert set(tags) == {"gemma3:4b", "qwen3:8b"}
    assert tags["gemma3:4b"]["registered"] is True and tags["qwen3:8b"]["registered"] is False
    assert tags["qwen3:8b"]["size_gb"] == 5.2 and tags["qwen3:8b"]["family"] == "qwen3"


async def test_ollama_unreachable(app_client, ollama):
    ollama.unreachable = True
    reg = app_client.app.state.registry
    reg._ollama_checked = 0
    models = {m["name"]: m for m in (await app_client.get("/v1/models")).json()}
    assert models["llm-gemma3-4b"]["state"] == "unavailable"
    assert models["llm-gemma3-4b"]["error"].startswith("OLLAMA_UNAVAILABLE")
    r = await app_client.post("/v1/internal/models/llm-gemma3-4b/load", headers=svc_headers())
    assert r.status_code == 502 and r.json()["error"]["code"] == "OLLAMA_UNAVAILABLE"
    body = (await app_client.get("/v1/internal/ollama/available", headers=svc_headers())).json()
    assert body["ollama"] == "unreachable" and body["models"] == []


async def test_reload_picks_up_new_model(app_client, db):
    with db.cursor() as cur:
        cur.execute("DELETE FROM model_registry WHERE model_name = 'llm-qwen3-8b'")
        cur.execute("INSERT INTO model_registry (model_name, kind, provider, display_name, provider_ref, config_json) "
                    "VALUES ('llm-qwen3-8b','recommend','ollama','qwen3 8b','qwen3:8b','{\"adapter\":\"ollama_recommend\"}')")
    try:
        body = (await app_client.post("/v1/internal/models/reload", headers=svc_headers())).json()
        assert "llm-qwen3-8b" in body["changed"]
        names = {m["name"]: m for m in (await app_client.get("/v1/models")).json()}
        # 공유 서버에 없는 태그는 '설치 안 됨'(사람이 ollama pull 해야 함)
        assert names["llm-qwen3-8b"]["state"] == "unavailable" and names["llm-qwen3-8b"]["installed"] is False
    finally:
        with db.cursor() as cur:
            cur.execute("DELETE FROM model_registry WHERE model_name = 'llm-qwen3-8b'")


# ---------------------------------------------------------------- Ollama 클라이언트 규칙(단위)
def _recording(handler):
    seen: list[str] = []

    def wrapped(request: httpx.Request):
        seen.append(request.url.path)
        return handler(request, len(seen))

    return seen, httpx.MockTransport(wrapped)


async def test_client_retries_only_connection_errors():
    def handler(request, n):
        if n < 3:
            raise httpx.ConnectError("down", request=request)
        return httpx.Response(200, json={"message": {"content": '{"combinations": []}'}})

    seen, transport = _recording(handler)
    client = OllamaClient("http://ollama.test", transport=transport, retry_delays=(0.01, 0.02))
    assert await client.chat_json("gemma3:4b", [{"role": "user", "content": "hi"}]) == {"combinations": []}
    assert seen == ["/api/chat"] * 3  # 연결 실패 2번 뒤 성공(3·6초 간격을 시험에서는 줄임)


async def test_client_does_not_retry_http_errors():
    seen, transport = _recording(lambda request, n: httpx.Response(404, json={"error": "model not found"}))
    client = OllamaClient("http://ollama.test", transport=transport, retry_delays=(0.01, 0.02))
    with pytest.raises(OllamaError) as err:
        await client.warmup("nope:1b")
    assert err.value.status == 404 and seen == ["/api/generate"]


async def test_client_gives_up_after_three_connection_failures():
    def handler(request, n):
        raise httpx.ConnectError("down", request=request)

    seen, transport = _recording(handler)
    client = OllamaClient("http://ollama.test", transport=transport, retry_delays=(0.01, 0.02))
    with pytest.raises(OllamaError) as err:
        await client.warmup("gemma3:4b")
    assert err.value.unreachable and len(seen) == 3


async def test_client_refuses_forbidden_paths_and_cloud():
    seen, transport = _recording(lambda request, n: httpx.Response(200, json={}))
    client = OllamaClient("http://ollama.test", transport=transport)
    for path in FORBIDDEN_OLLAMA:
        with pytest.raises(OllamaError):
            await client._request("POST", path, {"model": "x"})
    with pytest.raises(OllamaError):
        await client.warmup("gpt-oss:120b-cloud")
    assert seen == []  # 금지 경로는 보내지도 않는다
    assert is_cloud_tag("kimi:cloud") and is_cloud_tag("gpt-oss:120b-cloud") and not is_cloud_tag("gemma3:4b")


async def test_chat_body_clamps_num_ctx():
    bodies = []

    def handler(request, n):
        import json

        bodies.append(json.loads(request.content))
        return httpx.Response(200, json={"message": {"content": "{}"}})

    _, transport = _recording(handler)
    client = OllamaClient("http://ollama.test", transport=transport)
    await client.chat_json("gemma3:4b", [], num_ctx=32768)
    assert bodies[0]["options"]["num_ctx"] == 8192 and bodies[0]["keep_alive"] == "5m"
    assert bodies[0]["think"] is False and bodies[0]["format"] == "json"
