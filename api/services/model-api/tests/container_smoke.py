"""분리된 시험 DB에서만 실행: 임시 키로 실제 HTTP·해시 조회·권한을 확인하고 지운다.

예: Get-Content -Raw tests/container_smoke.py | docker compose ... exec -T model-api python -
"""
import asyncio
import hashlib
import json
import secrets
import urllib.error
import urllib.request
import uuid

from app.config import load_config
from app.db import Database


def call(path, raw=None, method="GET"):
    request = urllib.request.Request("http://127.0.0.1:9543" + path, method=method,
                                     headers={"X-API-Key": raw} if raw else {})
    try:
        response = urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        assert response.headers.get("X-Request-ID")
        return response.status, json.load(response)


async def main():
    cfg = load_config()
    if cfg.db_name != "klassic_issue24":
        raise RuntimeError("별도 klassic_issue24 시험 DB에서만 실행하십시오")
    db = await Database.connect(cfg)
    keys, operator = [], None
    try:
        status, health = await asyncio.to_thread(call, "/v1/health")
        assert status == 200 and health["status"] == "ok" and health["db"] == "ok", health
        status, versions = await asyncio.to_thread(call, "/v1/versions")
        assert status == 200 and versions["rules_hash"]
        ready = {e["kind"] for e in versions["engines"] if e["state"] == "ready"}
        assert {"omr_staff", "omr_jeongganbo"} <= ready
        status, body = await asyncio.to_thread(call, "/v1/internal/settings/reload", None, "POST")
        assert status == 401 and body["error"]["code"] == "AUTH_KEY_MISSING"
        operator = await db.execute(
            "INSERT INTO operator_account(login_id,password_hash,display_name,disabled_at) "
            "VALUES(%s,%s,%s,UTC_TIMESTAMP(3))", ("smoke_" + uuid.uuid4().hex[:20], "disabled-test-only", "기반 검증"))
        for kind in ("service", "external"):
            raw = secrets.token_urlsafe(32)
            key_id = await db.execute(
                "INSERT INTO access_key(key_kind,key_hash,key_prefix,application_no,issued_by,call_limit_per_hour) "
                "VALUES(%s,%s,%s,%s,%s,%s)",
                (kind, hashlib.sha256(raw.encode()).hexdigest(), raw[:8],
                 uuid.uuid4().hex[:20] if kind == "external" else None,
                 operator if kind == "service" else None, 10))
            keys.append(key_id)
            status, body = await asyncio.to_thread(call, "/v1/internal/settings/reload", raw, "POST")
            if kind == "service":
                assert status == 200 and body["settings_version"] == 1, body
            else:
                assert status == 403 and body["error"]["code"] == "AUTH_SERVICE_KEY_REQUIRED", body
        status, body = await asyncio.to_thread(call, "/v1/internal/settings/reload", "invalid-smoke-key", "POST")
        assert status == 401 and body["error"]["code"] == "AUTH_KEY_INVALID"
        print(json.dumps({"health": "ok", "models_ready": sorted(ready), "missing_key": 401,
                          "invalid_key": 401, "service_key": 200, "external_internal": 403}))
    finally:
        for key_id in keys:
            await db.execute("DELETE FROM api_call_log WHERE access_key_id=%s", (key_id,))
            await db.execute("DELETE FROM access_key WHERE key_id=%s", (key_id,))
        if operator:
            await db.execute("DELETE FROM operator_account WHERE operator_id=%s", (operator,))
        await db.close()


asyncio.run(main())
