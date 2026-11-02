"""#45 CI용 실제 ASGI 응답을 읽기 전용 model-api 계약 YAML과 JSON Schema로 대조한다.

외부 엔진·DB 없이 수행한다. 실제 엔진 시험은 container_*.py로 별도 실행하며 자동 건너뜀으로 숨기지 않는다.
"""
from dataclasses import replace
from datetime import timedelta
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from jsonschema import Draft202012Validator, FormatChecker
import pytest
from referencing import Registry as SchemaRegistry, Resource
from referencing.jsonschema import DRAFT202012
import yaml

from app.db import utcnow
from app.catalog import load_errors
from app.engines.base import EngineResult
from app.errors import ApiError, CATALOG
from app.services import engine_api
from test_jeongganbo import JeongganboRegistry
import test_performances
from test_performances import HEADERS, NO, add_file, photo
from test_recognition import recognition_client as recognition_client, Registry, XML
import test_render_api
from test_foundation import SHARED

performance_client = test_performances.client
render_client = test_render_api.client

URI = "urn:klassic:model-api"
SERVICE = {"X-API-Key": "service-secret"}


@pytest.fixture(autouse=True)
def error_catalog():
    token = CATALOG.set(load_errors(SHARED))
    yield
    CATALOG.reset(token)


@pytest.fixture(scope="module")
def contract():
    path = Path(os.environ["CONTRACT_TEST_PATH"]) if "CONTRACT_TEST_PATH" in os.environ else Path(__file__).resolve().parents[3] / "contracts/model-api.yaml"
    spec = yaml.safe_load(path.read_text(encoding="utf-8"))
    registry = SchemaRegistry().with_resource(URI, Resource.from_contents(spec, default_specification=DRAFT202012))
    return spec, registry


def check(contract, path, method, response, expected):
    spec, registry = contract
    assert response.status_code == expected, response.text
    entry = spec["paths"][path][method]["responses"][str(expected)]
    if "$ref" in entry:
        pointer = entry["$ref"]
        entry = spec["components"]["responses"][pointer.rsplit("/", 1)[-1]]
    else:
        escaped = path.replace("~", "~0").replace("/", "~1")
        pointer = f"#/paths/{escaped}/{method}/responses/{expected}"
    media = response.headers["content-type"].split(";", 1)[0]
    assert media in entry["content"]
    assert len(response.headers["x-request-id"]) == 12
    if media == "application/json":
        schema = {"$ref": URI + pointer + "/content/application~1json/schema"}
        Draft202012Validator(schema, registry=registry, format_checker=FormatChecker()).validate(response.json())
    if expected == 429:
        assert int(response.headers["retry-after"]) >= 1
        assert response.json()["error"]["retry_after"]
    return response


@pytest.mark.parametrize("path", ["/v1/health", "/v1/versions", "/v1/models", "/v1/instruments"])
def test_public_and_catalog_success(contract, performance_client, path):
    api, _, _, _ = performance_client
    check(contract, path, "get", api.get(path, headers=HEADERS if path.endswith("instruments") else {}), 200)


@pytest.mark.parametrize("startup,missing,db_down,status", [(False, [], False, 503), (True, ["omr_staff"], False, 503),
                                                          (True, [], True, 200)])
def test_health_loading_unavailable_degraded(contract, performance_client, startup, missing, db_down, status):
    api, app, db, _ = performance_client
    app.state.resources.startup_done, app.state.resources.missing, db.down = startup, missing, db_down
    check(contract, "/v1/health", "get", api.get("/v1/health"), status)


@pytest.mark.parametrize("path,field", [("/v1/performances", "score"), ("/v1/omr/staff", "image"),
    ("/v1/omr/jeongganbo", "image"), ("/v1/render/mp3", "score"), ("/v1/render/pdf", "score"),
    ("/v1/internal/upload-check", "file")])
@pytest.mark.parametrize("key,status", [(None, 401), ("invalid", 401), ("revoked-secret", 403)])
def test_key_failures(contract, performance_client, path, field, key, status):
    api, _, _, _ = performance_client
    response = api.post(path, files={field: ("score.png", photo())}, headers={"X-API-Key": key} if key else {})
    check(contract, path, "post", response, status)


@pytest.mark.parametrize("path", ["/v1/performances", "/v1/omr/staff", "/v1/omr/jeongganbo", "/v1/render/mp3", "/v1/render/pdf"])
def test_missing_required_file(contract, performance_client, path):
    api, _, _, _ = performance_client
    check(contract, path, "post", api.post(path, headers=HEADERS if path == "/v1/performances" else SERVICE), 422)


def test_performance_submit_status_result_and_file(contract, performance_client, monkeypatch):
    api, app, db, _ = performance_client
    monkeypatch.setattr("app.services.requests.new_request_no", lambda: NO)
    check(contract, "/v1/performances", "post", api.post("/v1/performances", headers=HEADERS,
        files={"score": ("score.png", photo())}, data={"score_type": "staff"}), 202)
    add_file(app, db, "musicxml", XML.encode())
    add_file(app, db, "midi", b"MThd-test")
    check(contract, "/v1/performances/{request_no}", "get", api.get(f"/v1/performances/{NO}", headers=HEADERS), 200)
    result = check(contract, "/v1/performances/{request_no}/result", "get",
                   api.get(f"/v1/performances/{NO}/result", headers=HEADERS), 200).json()
    check(contract, "/v1/files/{token}", "get", api.get(result["files"]["midi"]), 200)


@pytest.mark.parametrize("case,status", [("type", 422), ("size", 413), ("format", 415)])
def test_upload_rejections(contract, performance_client, case, status):
    api, app, _, _ = performance_client
    if case == "size":
        app.state.config = replace(app.state.config, max_body_bytes=16)
    response = api.post("/v1/performances", headers=HEADERS, data={"score_type": "staff", "volume": "wrong" if case == "type" else "1"},
                        files={"score": ("bad.txt", b"text")} if case == "format" else {"score": ("score.png", photo())})
    check(contract, "/v1/performances", "post", response, status)


@pytest.mark.parametrize("state,status", [("pending", 425), ("expired", 410), ("other_key", 404)])
def test_result_state_failures(contract, performance_client, state, status):
    api, _, db, _ = performance_client
    if state == "pending":
        db.row["status"] = "rendering"
    elif state == "expired":
        db.row["is_expired"] = 1
    else:
        db.row["access_key_id"] = 99
    check(contract, "/v1/performances/{request_no}/result", "get",
          api.get(f"/v1/performances/{NO}/result", headers=HEADERS), status)


@pytest.mark.parametrize("busy", [False, True])
def test_quota_and_concurrency(contract, performance_client, busy):
    api, app, db, _ = performance_client
    leases = []
    if busy:
        leases = [app.state.limiter.admit("recognize", "api") for _ in range(2)]
    else:
        db.fetchone = AsyncMock(return_value={"status": "active", "is_exhausted": 1, "retry_after_at": utcnow()+timedelta(seconds=60)})
    try:
        check(contract, "/v1/performances", "post", api.post("/v1/performances", headers=HEADERS), 429)
    finally:
        for lease in leases:
            lease.release()


@pytest.mark.parametrize("kind", ["staff", "jeongganbo"])
@pytest.mark.parametrize("outcome", ["success", "uninstalled", "timeout", "conversion_failed"])
def test_recognition_outcomes(contract, recognition_client, monkeypatch, kind, outcome):
    api, app, _ = recognition_client
    registry = Registry() if kind == "staff" else JeongganboRegistry()
    app.state.registry = registry
    name = "homr" if kind == "staff" else "jeongganbo-omr"
    app.state.settings._current = replace(app.state.settings.current, engine_order={kind: [name]})
    monkeypatch.setattr(engine_api, "check_structure", lambda *args: SimpleNamespace(
        verdict="pass", type_mismatch=False, detected_type=kind))
    monkeypatch.setattr(engine_api, "check_validity", lambda *args, **kwargs: SimpleNamespace(
        grade="trust", items={"note_count": 16, "beat_sum": 1, "range_leap": 1, "yulmyeong_ratio": 1}, score=1))
    if outcome == "uninstalled":
        registry.entry.installed = False
    elif outcome == "conversion_failed":
        registry.adapter.recognize.return_value = EngineResult("error", "CONVERSION_FAILED", None, None, name, "test", None, 1)
    headers = SERVICE | ({"X-Deadline": "2000-01-01T00:00:00Z"} if outcome == "timeout" else {})
    response = check(contract, f"/v1/omr/{kind}", "post", api.post(f"/v1/omr/{kind}", headers=headers,
        files={"image": ("score.png", photo())}, data={"request_no": NO}), 200)
    assert response.json()["fallback"] == (outcome != "success")


def test_internal_upload_check(contract, performance_client, monkeypatch):
    api, _, db, _ = performance_client
    fetch_all = db.fetch_all

    async def permissions(sql, args=None):
        rows = await fetch_all(sql, args)
        return rows + [{"role_code": "service", "uc_code": "UC3"}] if "role_permission" in sql else rows

    monkeypatch.setattr(db, "fetch_all", permissions)
    check(contract, "/v1/internal/upload-check", "post", api.post("/v1/internal/upload-check", headers=SERVICE,
        files={"file": ("score.png", photo())}, data={"score_type": "staff"}), 200)


def test_external_mp3_license_response(contract, render_client):
    api, _, _ = render_client
    response = check(contract, "/v1/render/mp3", "post", api.post("/v1/render/mp3", headers=HEADERS,
        files={"score": ("score.musicxml", XML)}), 200)
    assert response.json()["mp3_withheld"] and "x-renderer" not in response.headers


@pytest.mark.parametrize("kind", ["mp3", "pdf"])
@pytest.mark.parametrize("code,status", [("RENDERER_MISSING", 502), ("RENDER_FAILED", 502), ("RENDER_TIMEOUT", 504)])
def test_rendering_failures(contract, render_client, kind, code, status):
    api, app, _ = render_client
    app.state.render_pool.render.side_effect = ApiError(code)
    check(contract, f"/v1/render/{kind}", "post", api.post(f"/v1/render/{kind}", headers=SERVICE,
          files={"score": ("score.musicxml", XML)}), status)


@pytest.mark.parametrize("kind", ["mp3", "pdf"])
def test_binary_rendering_success(contract, render_client, kind):
    api, _, _ = render_client
    response = check(contract, f"/v1/render/{kind}", "post", api.post(f"/v1/render/{kind}", headers=SERVICE,
          files={"score": ("score.musicxml", XML)}), 200)
    assert response.headers["x-renderer"]
