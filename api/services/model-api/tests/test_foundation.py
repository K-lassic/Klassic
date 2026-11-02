"""기반 계약·최소권한 인증·기동 장애를 실제 ASGI 앱에서 검증한다."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import Form
from fastapi.testclient import TestClient
import pytest

from app.catalog import load_errors
from app.config import Config
from app.db import Database
from app.main import create_app

SHARED = Path(os.environ["SHARED_TEST_DIR"]) if "SHARED_TEST_DIR" in os.environ else Path(__file__).resolve().parents[3] / "shared"


class FakeDB:
    def __init__(self):
        self.down = False
        self.closed = False
        self.lookups = []
        self.logs = []

    async def fetch_one(self, sql, args=None):
        if self.down:
            raise OSError("secret-db-error")
        if "v_current_setting" in sql:
            return {"setting_version_id": 1}
        if "SELECT 1" in sql:
            return {"ok": 1}
        if "access_key" in sql:
            self.lookups.append(args[0])
            for raw, kind, status in (("service-secret", "service", "active"),
                                      ("external-secret", "external", "active"),
                                      ("revoked-secret", "external", "revoked")):
                if args[0] == hashlib.sha256(raw.encode()).hexdigest():
                    return {"key_id": 1, "key_kind": kind, "key_prefix": "gk_test",
                            "status": status, "call_limit_per_hour": 100}
        return None

    async def fetch_all(self, sql, args=None):
        if self.down:
            raise OSError("secret-db-error")
        if "role_permission" in sql:
            return [{"role_code": "service", "uc_code": "UC10"},
                    {"role_code": "api_caller", "uc_code": "UC13"}]
        return []

    async def execute(self, sql, args=None):
        self.logs.append((sql, args))
        return 1

    async def close(self):
        self.closed = True


class FakeResources:
    def __init__(self, cfg, db):
        self.startup_done = True
        self.soundfonts_ready = True
        self.missing = []
        self.rules_hash = "123456789abc"
        self.closed = False

    async def start(self):
        pass

    def snapshot(self):
        return [{"name": "homr", "version": "0.7.0", "kind": "omr_staff", "provider": "venv",
                 "installed": True, "state": "ready", "enabled": True}]

    def missing_kinds(self):
        return self.missing

    async def close(self):
        self.closed = True


@pytest.fixture
def connected():
    db = FakeDB()

    async def connect(cfg):
        return db

    app = create_app(Config(shared_dir=SHARED), db_factory=connect, resource_factory=FakeResources)

    # 검증용 폼·외부 경로는 테스트 앱에만 등록하고 운영 서버에는 포함하지 않는다.
    @app.post("/v1/test-form")
    async def form(name: str = Form(...)):
        return {"name": name}

    with TestClient(app) as client:
        yield client, app, db
    assert db.closed
    assert app.state.resources.closed


def test_public_health_versions_and_request_id(connected):
    client, _, _ = connected
    response = client.get("/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert len(response.headers["x-request-id"]) == 12
    versions = client.get("/v1/versions").json()
    assert set(versions) == {"api_version", "openapi_url", "engines", "templates", "rules_hash"}
    assert versions["openapi_url"] == "/v1/openapi.json"
    spec = client.get("/v1/openapi.json").json()
    assert spec["paths"]["/v1/internal/settings/reload"]["post"]["security"] == [{"ApiKey": []}]
    assert spec["paths"]["/v1/health"]["get"]["security"] == []


def test_shared_path_override(monkeypatch, tmp_path):
    from app.config import load_config
    monkeypatch.setenv("SHARED_DIR", str(tmp_path))
    assert load_config().shared_dir == tmp_path


@pytest.mark.parametrize("startup,missing,down,status,http", [
    (False, [], False, "loading", 503),
    (True, ["omr_jeongganbo"], False, "unavailable", 503),
    (True, [], True, "degraded", 200),
])
def test_health_contract_states(connected, startup, missing, down, status, http):
    client, app, db = connected
    app.state.resources.startup_done = startup
    app.state.resources.missing = missing
    db.down = down
    response = client.get("/v1/health")
    assert response.status_code == http
    assert response.json()["status"] == status
    if http == 503:
        assert response.json()["error"]["code"] == "SERVICE_NOT_READY"


@pytest.mark.parametrize("raw,http,code", [(None, 401, "AUTH_KEY_MISSING"),
    ("unknown-secret", 401, "AUTH_KEY_INVALID"), ("revoked-secret", 403, "AUTH_KEY_REVOKED"),
    ("external-secret", 403, "AUTH_SERVICE_KEY_REQUIRED")])
def test_internal_key_rejections(connected, raw, http, code):
    client, _, db = connected
    response = client.post("/v1/internal/settings/reload", headers={"X-API-Key": raw} if raw else {})
    assert response.status_code == http
    assert response.json()["error"]["code"] == code
    if raw:
        assert db.lookups[-1] == hashlib.sha256(raw.encode()).hexdigest()
    assert raw is None or raw not in str(db.logs)


def test_service_reload_and_external_role_boundary(connected):
    client, _, _ = connected
    response = client.post("/v1/internal/settings/reload", headers={"X-API-Key": "service-secret"})
    assert response.status_code == 200
    assert response.json() == {"settings_version": 1, "engine_order": {}}
    assert client.post("/v1/performances", headers={"X-API-Key": "service-secret"}).status_code == 403
    assert client.post("/v1/performances", headers={"X-API-Key": "external-secret"}).status_code == 422


@pytest.mark.parametrize("data", [{}, {"name": "ok", "secret-unknown-field": "value"}])
def test_form_validation_uses_common_error_and_omits_input(connected, data):
    response = connected[0].post("/v1/test-form", data=data)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "value" not in response.text


def test_error_logging_redacts_token_query_and_exception(connected, caplog, monkeypatch):
    def broken(*args):
        raise RuntimeError("request-body-secret")

    monkeypatch.setattr("app.services.files.verify", broken)
    client, _, _ = connected
    caplog.set_level("INFO")
    response = client.get("/v1/files/signed-secret?api_key=query-secret")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    # httpx는 시험 요청 URL을 기록하므로 서비스 logger만 대조한다.
    text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("model-api"))
    for secret in ("signed-secret", "query-secret", "request-body-secret"):
        assert secret not in text
        assert secret not in response.text
    assert response.headers["x-request-id"] in text


def test_catalog_all_codes_and_duplicate_rejection(tmp_path):
    catalog = load_errors(SHARED)
    assert sum(len(catalog[k]) for k in ("gate_codes", "fallback_reasons", "status_codes")) == 70
    errors = tmp_path / "errors"
    errors.mkdir()
    for name in ("common", "web", "model"):
        (errors / f"{name}.json").write_text(json.dumps({"gate_codes": {"DUPLICATE": {}}}))
    with pytest.raises(ValueError, match="중복"):
        load_errors(tmp_path)


def test_missing_catalog_fails_startup(tmp_path):
    with pytest.raises(FileNotFoundError), TestClient(create_app(Config(shared_dir=tmp_path))):
        pass


def test_db_retries_are_bounded():
    connect = AsyncMock(side_effect=OSError("database-password"))
    with patch.object(Database, "_connect_once", connect):
        with pytest.raises(RuntimeError, match="재시도 소진"):
            asyncio.run(Database.connect(Config(db_attempts=2, db_retry_seconds=0)))
    assert connect.await_count == 2


def test_db_failure_prevents_serving():
    async def fail(cfg):
        raise RuntimeError("DB 연결 재시도 소진")
    with pytest.raises(RuntimeError, match="재시도 소진"):
        with TestClient(create_app(Config(shared_dir=SHARED), db_factory=fail)):
            pass
