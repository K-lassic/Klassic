"""접근 키(G2)·호출 한도와 동시 처리(G3)·설정 반영·상태 엔드포인트 계약 시험 (T029~T034 · T105)."""

from __future__ import annotations

import asyncio
import time

import pytest

from app.jobs.limiter import Limiter, QueueTimeout
from app.settings import Settings

from .conftest import key_headers, make_external_key, make_midi, q1, svc_headers

ERROR_KEYS = {"code", "message", "fix", "gate", "retry_after", "details"}


def _score():
    return {"score": ("a.mid", make_midi(), "audio/midi")}


def _last_log(db, key_id=None):
    if key_id is None:
        return q1(db, "SELECT * FROM api_call_log WHERE access_key_id IS NULL ORDER BY call_id DESC LIMIT 1")
    return q1(db, "SELECT * FROM api_call_log WHERE access_key_id = %s ORDER BY call_id DESC LIMIT 1", (key_id,))


async def test_missing_key(app_client, db):
    r = await app_client.post("/v1/recommend", files=_score())
    assert r.status_code == 401
    body = r.json()
    assert body["api_version"] == "v1" and set(body["error"]) == ERROR_KEYS
    assert body["error"]["code"] == "AUTH_KEY_MISSING" and body["error"]["gate"] == "G2"
    log = _last_log(db)
    assert log["outcome"] == "rejected_key" and log["reason_code"] == "AUTH_KEY_MISSING" and log["request_id"] is None


async def test_invalid_key(app_client, db):
    r = await app_client.post("/v1/recommend", files=_score(), headers=key_headers("gk_nope"))
    assert r.status_code == 401 and r.json()["error"]["code"] == "AUTH_KEY_INVALID"
    assert _last_log(db)["reason_code"] == "AUTH_KEY_INVALID"


async def test_revoked_key(app_client, db):
    raw, key_id = make_external_key(db, status="revoked")
    r = await app_client.post("/v1/recommend", files=_score(), headers=key_headers(raw))
    assert r.status_code == 403 and r.json()["error"]["code"] == "AUTH_KEY_REVOKED"
    log = _last_log(db, key_id)
    assert log["outcome"] == "rejected_key" and log["reason_code"] == "AUTH_KEY_REVOKED"


async def test_hourly_limit(app_client, db):
    raw, key_id = make_external_key(db, limit=2)
    for _ in range(2):
        assert (await app_client.post("/v1/recommend", files=_score(), headers=key_headers(raw))).status_code == 200
    r = await app_client.post("/v1/recommend", files=_score(), headers=key_headers(raw))
    assert r.status_code == 429
    err = r.json()["error"]
    assert err["code"] == "RATE_LIMIT_EXCEEDED" and err["gate"] == "G3" and err["retry_after"].endswith("Z")
    assert 3500 <= int(r.headers["Retry-After"]) <= 3600
    log = _last_log(db, key_id)
    assert log["outcome"] == "rejected_limit" and log["retry_after_at"] is not None and log["request_id"] is None
    quota = q1(db, "SELECT calls_last_hour, is_exhausted FROM v_key_quota WHERE key_id = %s", (key_id,))
    assert quota == {"calls_last_hour": 2, "is_exhausted": 1}


async def test_service_key_has_no_hourly_limit(app_client):
    for _ in range(3):
        assert (await app_client.post("/v1/recommend", files=_score(), headers=svc_headers())).status_code == 200


async def test_server_busy(app_client, db, ext_key):
    raw, key_id = ext_key
    pool = app_client.app.state.limiter._pools["recognize:external"]
    pool.running, pool.waiting = pool.capacity, pool.capacity
    try:
        from .conftest import make_png

        r = await app_client.post("/v1/omr/staff", files={"image": ("a.png", make_png(), "image/png")},
                                  headers=key_headers(raw))
    finally:
        pool.running = pool.waiting = 0
    assert r.status_code == 429 and r.json()["error"]["code"] == "SERVER_BUSY"
    assert int(r.headers["Retry-After"]) >= 1
    log = _last_log(db, key_id)
    assert log["outcome"] == "rejected_concurrency" and log["retry_after_at"] is not None


async def test_validation_error_shape(app_client, ext_key):
    r = await app_client.post("/v1/recommend", headers=key_headers(ext_key[0]))
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_unknown_route_shape(app_client):
    r = await app_client.get("/v1/nothing")
    assert r.status_code == 404 and r.json()["error"]["code"] == "REQUEST_NOT_FOUND"


async def test_settings_reload(app_client, db):
    with db.cursor() as cur:
        cur.execute("INSERT INTO processing_setting_version (created_by, timeout_seconds, max_concurrency_recognize, "
                    "max_concurrency_render, web_concurrency_share, recommend_timeout_ms, llm_recommend_timeout_ms) "
                    "SELECT 1, 90, 3, 2, 1, 3000, 20000")
        new_id = cur.lastrowid
        cur.execute("INSERT INTO setting_engine_order (setting_version_id, score_type, seq, engine_name) VALUES "
                    "(%s,'staff',1,'audiveris'),(%s,'recommend',1,'rules')", (new_id, new_id))
    try:
        r = await app_client.post("/v1/internal/settings/reload", headers=svc_headers())
        assert r.status_code == 200
        assert r.json()["settings_version"] == new_id and r.json()["engine_order"]["staff"] == ["audiveris"]
        state = app_client.app.state
        assert state.settings.current.timeout_seconds == 90
        assert state.limiter._pools["recognize:external"].capacity == 2  # 3 - 웹 몫 1
        row = q1(db, "SELECT api_apply_status, api_applied_at FROM processing_setting_version "
                     "WHERE setting_version_id = %s", (new_id,))
        assert row["api_apply_status"] == "applied" and row["api_applied_at"]
        assert (await app_client.get("/v1/health")).json()["settings_version"] == new_id
    finally:
        with db.cursor() as cur:
            cur.execute("DELETE FROM processing_setting_version WHERE setting_version_id = %s", (new_id,))


async def test_health_and_versions(app_client):
    h = (await app_client.get("/v1/health")).json()
    assert h["status"] == "ok" and h["api_version"] == "v1"
    assert set(h["queue"]) == {"recognize_running", "recognize_waiting", "render_running"}
    assert h["models_total"] >= 5 and h["models_ready"] >= 1
    v = (await app_client.get("/v1/versions")).json()
    assert v["openapi_url"] == "/v1/openapi.json" and len(v["rules_hash"]) == 12
    names = {e["name"]: e for e in v["engines"]}
    assert names["homr"]["kind"] == "omr_staff" and names["homr"]["version"] == "fake-1.0"
    assert names["fluidsynth"]["kind"] == "render_mp3"
    # (2026-09-30 UC_02 BR-FBK-09) 종류별 대체 악보: 오선보 2곡 · 정간보 1곡, 굿거리는 끔
    assert sorted(t["id"] for t in v["templates"]) == ["arirang-semachi-v1", "jeongganbo-taryeong-gayageum-v1", "minuet-g-v1"]
    spec = (await app_client.get("/v1/openapi.json")).json()
    assert "/v1/omr/staff" in spec["paths"] and "/v1/performances/{request_no}/result" in spec["paths"]


# ---------------------------------------------------------------- 동시 처리 자리(단위)
async def test_limiter_queue_deadline():
    lim = Limiter(Settings(version_id=1, max_concurrency_recognize=2, web_concurrency_share=1))
    async with lim.slot("recognize", "api", None):
        assert lim.stats()["recognize_running"] == 1
        with pytest.raises(QueueTimeout):
            async with lim.slot("recognize", "api", time.monotonic() + 0.05):
                pass
        # 웹 몫은 따로라 바로 얻는다
        async with lim.slot("recognize", "web", time.monotonic() + 0.05) as waited:
            assert waited < 0.05


async def test_limiter_hands_over_slot():
    lim = Limiter(Settings(version_id=1, max_concurrency_recognize=2, web_concurrency_share=1))
    order: list[str] = []

    async def worker(name: str, hold: float):
        async with lim.slot("recognize", "api", time.monotonic() + 2):
            order.append(name)
            await asyncio.sleep(hold)

    await asyncio.gather(worker("a", 0.05), worker("b", 0.0))
    assert order == ["a", "b"]


# ---- 2026-09-29 RBAC (FR-068 · G13): 키 → 역할(api_caller/service), 경로 → 유스케이스, role_permission ----
async def test_rbac_external_key_on_internal_route(app_client, ext_key):
    r = await app_client.post("/v1/internal/settings/reload", headers=key_headers(ext_key[0]))
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "AUTH_SERVICE_KEY_REQUIRED"


async def test_rbac_role_permission_is_the_source(app_client, db, ext_key):
    """권한표에서 api_caller 의 UC13 을 빼면 연주 API 가 403 AUTH_FORBIDDEN — 코드가 아니라 DB 표가 판정한다."""
    from app.auth import rbac
    with db.cursor() as cur:
        cur.execute("DELETE FROM role_permission WHERE role_code = 'api_caller' AND uc_code = 'UC13'")
    rbac.clear_cache()
    try:
        r = await app_client.post("/v1/performances", headers=key_headers(ext_key[0]), files=_score())
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "AUTH_FORBIDDEN"
        assert r.json()["error"]["details"]["uc"] == "UC13"
    finally:
        with db.cursor() as cur:
            cur.execute("INSERT IGNORE INTO role_permission (role_code, uc_code) VALUES ('api_caller', 'UC13')")
        rbac.clear_cache()
