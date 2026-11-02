"""#32 접수·키 소유권·대체 결과·서명/보관 만료·파일 경계·작업 종료를 검증한다."""
import asyncio
import base64
from datetime import timedelta
from dataclasses import replace
from contextlib import AsyncExitStack
import io
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import time

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from app.catalog import load_errors
from app.config import Config, load_config
from app.db import utcnow
from app.errors import ApiError, CATALOG
from app.jobs.limiter import Limiter
from app.jobs.performance import PerformanceJob, PerformanceRunner, run_performance
from app.main import create_app
from app.services import files
from app.services.arrange import Assignment
from app.settings import Settings
from test_foundation import FakeResources, SHARED
from test_recognition import RecordingDB, XML

NO = "R-1102-ABCDEFGH"
HEADERS = {"X-API-Key": "external-secret"}


@pytest.fixture(autouse=True)
def error_catalog():
    token = CATALOG.set(load_errors(SHARED))
    yield
    CATALOG.reset(token)


def photo():
    buffer = io.BytesIO()
    Image.new("RGB", (700, 900), "white").save(buffer, "PNG")
    return buffer.getvalue()


class PerformanceDB(RecordingDB):
    def __init__(self):
        super().__init__()
        self.row = dict(request_id=42, request_no=NO, channel="api", access_key_id=1,
            file_kind="image", chosen_score_type="staff", route="recognize", fallback_reason=None,
            status="completed", received_at=utcnow(), completed_at=utcnow(), expires_at=utcnow()+timedelta(hours=24),
            remaining_seconds=86400, is_expired=0, stage_label="완료", pdf_page_count=None, file_count=1, key_kind="external")
        self.derived = []
        self.page_rows = []
        self.policy = 0

    async def fetch_one(self, sql, args=None):
        if "FROM score_request" in sql:
            return self.row.copy() if args[0] == NO else None
        if "v_current_derived_file" in sql:
            return next((r for r in self.derived if r["format"] == args[1] and r["render_status"] == "ready"), None)
        if "v_mp3_license" in sql:
            return {"api_mp3_allowed": self.policy}
        if "performance_option" in sql:
            return dict(instrument_mode="default", transpose_semitones=0, volume_level=100)
        if "v_current_result" in sql:
            return {"original_ensemble_id": None}
        return await super().fetch_one(sql, args)

    async def fetch_all(self, sql, args=None):
        if "FROM request_page" in sql:
            return self.page_rows
        if "v_current_derived_file" in sql:
            return self.derived
        if "FROM instrument " in sql:
            return [dict(code="gayageum", name="가야금", family="gugak", is_percussion=0, range_low=48, range_high=84)]
        return await super().fetch_all(sql, args)


@pytest.fixture
def client(tmp_path):
    db = PerformanceDB()

    async def connect(cfg):
        return db

    app = create_app(Config(shared_dir=SHARED, storage_dir=tmp_path), db_factory=connect, resource_factory=FakeResources)
    with TestClient(app) as api:
        submit = Mock()
        app.state.performances.submit = submit
        yield api, app, db, submit


def test_submit_snapshots_order_options_and_closes_files(client, monkeypatch):
    api, app, db, submit = client
    monkeypatch.setattr("app.services.requests.new_request_no", lambda: NO)
    response = api.post("/v1/performances", headers=HEADERS,
        files=[("score", ("one.png", photo())), ("score", ("two.png", photo()))],
        data={"score_type": "staff", "transpose_semitones": "2", "volume": "0.5"})
    assert response.status_code == 202, response.text
    job = submit.call_args.args[0]
    assert job.transpose == 2 and job.volume == .5 and job.settings.version_id == 1
    assert [(p.page_no, p.file_no) for p in job.pages] == [(1, 1), (2, 2)]
    assert all(p.image_path.exists() for p in job.pages)
    assert any("performance_option" in sql and args[-2:] == (2, 50) for sql, args in db.logs)
    assert response.headers["x-request-id"]


@pytest.mark.parametrize("key,status", [(None, 401), ("invalid", 401), ("revoked-secret", 403), ("service-secret", 403)])
def test_auth_cannot_create_work(client, key, status):
    api, _, db, submit = client
    response = api.post("/v1/performances", headers={"X-API-Key": key} if key else {},
                        files={"score": ("one.png", photo())}, data={"score_type": "staff"})
    assert response.status_code == status
    submit.assert_not_called()
    assert not any("INSERT INTO score_request" in sql for sql, _ in db.logs)


@pytest.mark.parametrize("data,extra", [({}, {}), ({"score_type": "staff", "volume": "nan"}, {}),
    ({"score_type": "staff", "transpose_semitones": "13"}, {}),
    ({"score_type": "staff", "unknown": "secret"}, {}),
    ({"score_type": "staff", "instruments": '{"mode":"custom","tracks":[{"instrument":"kazoo"}]}'}, {}),
    ({"score_type": "staff"}, {"score": ("score.mid", b"MThd-test")})])
def test_rejected_input_creates_no_request(client, data, extra):
    api, _, db, submit = client
    response = api.post("/v1/performances", headers=HEADERS, data=data,
                        files=extra or {"score": ("one.png", photo())})
    assert response.status_code in (415, 422), response.text
    assert response.json()["api_version"] == "v1"
    submit.assert_not_called()
    assert not any("INSERT INTO score_request" in sql for sql, _ in db.logs)


@pytest.mark.parametrize("field,value", [("access_key_id", 99), ("channel", "web")])
def test_other_owner_and_web_requests_hidden(client, field, value):
    api, _, db, _ = client
    db.row[field] = value
    for suffix in ("", "/result"):
        assert api.get(f"/v1/performances/{NO}{suffix}", headers=HEADERS).status_code == 404


def test_pending_and_expired_contract(client):
    api, _, db, _ = client
    db.row["status"] = "rendering"
    response = api.get(f"/v1/performances/{NO}/result", headers=HEADERS)
    assert response.status_code == 425 and response.json()["status"] == "rendering"
    db.row["is_expired"] = 1
    assert api.get(f"/v1/performances/{NO}", headers=HEADERS).json()["status"] == "expired"
    assert api.get(f"/v1/performances/{NO}/result", headers=HEADERS).status_code == 410


def add_file(app, db, fmt, data):
    path = app.state.config.api_storage / NO / f"performance.{fmt}"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    db.derived.append(dict(format=fmt, storage_uri=str(path.relative_to(app.state.config.storage_dir)),
        render_status="ready", failure_reason=None, renderer_name=None, renderer_version=None))
    return path


def test_fallback_results_and_signed_download(client):
    api, app, db, _ = client
    db.row.update(route="fallback", fallback_reason="no_structure")
    add_file(app, db, "musicxml", XML.encode())
    add_file(app, db, "midi", b"MThd-test")
    add_file(app, db, "mp3", b"ID3-test")
    result = api.get(f"/v1/performances/{NO}/result", headers=HEADERS).json()
    assert result["status"] == "completed_fallback" and result["fallback_reason"] == "NO_SCORE_STRUCTURE"
    assert result["mp3_withheld"] and result["files"]["mp3"] is None
    response = api.get(result["files"]["musicxml"])
    assert response.status_code == 200 and response.text == XML
    assert response.headers["cache-control"] == "private, no-store"
    db.row["is_expired"] = 1
    assert api.get(result["files"]["musicxml"]).status_code == 410


def test_mp3_policy_rechecked_at_download(client):
    api, app, db, _ = client
    add_file(app, db, "mp3", b"ID3-test")
    db.policy = 1
    result = api.get(f"/v1/performances/{NO}/result", headers=HEADERS).json()
    assert not result["mp3_withheld"]
    assert api.get(result["files"]["mp3"]).content == b"ID3-test"
    db.policy = 0
    assert api.get(result["files"]["mp3"]).status_code == 404


@pytest.mark.parametrize("scheme", ["https", "http"])
def test_forwarded_scheme_in_actual_result_urls(client, scheme):
    from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
    from fastapi import Request

    _, app, db, _ = client
    add_file(app, db, "midi", b"MThd-test")
    command = next(line[4:] for line in (Path(__file__).resolve().parents[1] / "Dockerfile").read_text().splitlines()
                   if line.startswith("CMD "))
    args = json.loads(command)
    assert "--proxy-headers" in args and "--no-proxy-headers" not in args
    trusted = args[args.index("--forwarded-allow-ips") + 1]
    @app.get("/test-only-peer")
    async def peer(request: Request):
        return {"peer": request.client.host}

    proxy = TestClient(ProxyHeadersMiddleware(app, trusted_hosts=trusted), root_path="/api", client=("172.20.0.10", 40000))
    response = proxy.get(f"/v1/performances/{NO}/result", headers=HEADERS | {
        "Host": "klassic.example.test", "X-Forwarded-Proto": scheme, "X-Forwarded-For": "203.0.113.10"})
    assert response.status_code == 200, response.text
    assert response.json()["files"]["midi"].startswith(f"{scheme}://klassic.example.test/api/v1/files/")
    assert proxy.get("/test-only-peer", headers={"X-Forwarded-For": "203.0.113.10"}).json()["peer"] == "203.0.113.10"


@pytest.mark.parametrize("kind", ["missing", "outside", "symlink", "directory_symlink", "other_request"])
def test_download_file_boundary(client, tmp_path, kind):
    api, app, db, _ = client
    path = add_file(app, db, "midi", b"MThd-test")
    if kind == "missing":
        path.unlink()
    else:
        outside = tmp_path / "outside.mid"
        outside.write_bytes(b"private-data")
        if kind == "directory_symlink":
            path.unlink()
            path.parent.rmdir()
            outside_dir = tmp_path / "private"
            outside_dir.mkdir()
            (outside_dir / path.name).write_bytes(b"private-data")
            path.parent.symlink_to(outside_dir, target_is_directory=True)
        elif kind == "other_request":
            outside = app.state.config.api_storage / "R-1102-ZZZZZZZZ" / "result.mid"
            outside.parent.mkdir()
            outside.write_bytes(b"private-data")
            db.derived[0]["storage_uri"] = str(outside)
        elif kind == "symlink":
            path.unlink()
            path.symlink_to(outside)
        else:
            db.derived[0]["storage_uri"] = str(outside)
    token = files.sign(app.state.config, NO, "midi")
    response = api.get(f"/v1/files/{token}")
    assert response.status_code == 410 and b"private-data" not in response.content


def test_instruments_and_openapi_auth(client):
    api, _, _, _ = client
    assert api.get("/v1/instruments").status_code == 401
    assert api.get("/v1/instruments", headers=HEADERS).json()["items"][0]["name"] == "가야금"
    spec = api.get("/v1/openapi.json").json()
    for path in ("/v1/instruments", "/v1/performances", "/v1/performances/{request_no}/result"):
        assert next(iter(spec["paths"][path].values()))["security"] == [{"ApiKey": []}]
    assert spec["paths"]["/v1/files/{token}"]["get"]["security"] == []
    assert "/v1/shared-scores" not in spec["paths"]


def test_token_signature_expiry_secret_and_malformed(monkeypatch):
    token = CATALOG.set(load_errors(SHARED))
    try:
        cfg = Config()
        good = files.sign(cfg, NO, "midi")
        assert files.verify(cfg, good) == (NO, "midi")
        for value in ("bad", good + ".", "x" * 300, good[:-8] + "AAAAAAA", files.sign(Config(), NO, "midi")):
            with pytest.raises(ApiError) as exc:
                files.verify(cfg, value)
            assert exc.value.code == "REQUEST_NOT_FOUND"
        with pytest.raises(ApiError) as exc:
            files.verify(cfg, files.sign(cfg, NO, "midi", ttl_s=-1))
        assert exc.value.code == "RESULT_EXPIRED"
        assert "file_token_secret" not in repr(cfg)
        monkeypatch.setenv("FILE_TOKEN_SECRET", "too-short")
        with pytest.raises(ValueError):
            load_config()
    finally:
        CATALOG.reset(token)


def test_worker_preparation_options_and_real_midi(monkeypatch):
    from app.render.runner import render_job
    monkeypatch.setenv("SHARED_DIR", str(SHARED))
    result = render_job(dict(kind="prepare", score_base64=base64.b64encode(XML.encode()).decode(),
        assignment={"mode": "custom", "tracks": [{"part": 0, "instrument": "daegeum"}]},
        transpose=2, volume=.5, deadline=time.monotonic()+10))
    assert "대금" in result["musicxml"] and "<step>D</step>" in result["musicxml"]
    assert base64.b64decode(result["midi_base64"]).startswith(b"MThd")
    assert result["used"] == ["daegeum"] and result["part_fonts"] == ["gugak"]


def test_shutdown_cancels_and_finalizes_pending_job():
    async def run():
        db = SimpleNamespace(execute=AsyncMock())
        runner = PerformanceRunner(SimpleNamespace(state=SimpleNamespace(db=db)))
        job = SimpleNamespace(request_no=NO, request_id=42)
        with pytest.MonkeyPatch.context() as patch:
            started = asyncio.Event()

            async def slow(state, job):
                started.set()
                await asyncio.sleep(60)

            patch.setattr("app.jobs.performance.run_performance", slow)
            runner.submit(job)
            await started.wait()
            await runner.shutdown()
        assert not runner.tasks
        assert any("status = 'service_down'" in call.args[0] for call in db.execute.call_args_list)
    asyncio.run(run())


@pytest.mark.parametrize("failure", [None, "RENDER_FAILED", "RENDER_TIMEOUT"])
def test_background_render_failure_keeps_downloadable_scores(tmp_path, monkeypatch, failure):
    from app.render.pool import RenderResult

    async def run():
        settings = Settings(1)
        cfg = Config(storage_dir=tmp_path)
        db = SimpleNamespace(execute=AsyncMock(return_value=42))
        pool = SimpleNamespace(prepare=AsyncMock(return_value={"musicxml": XML, "midi_base64": base64.b64encode(b"MThd-test").decode(),
            "used": ["gayageum"], "part_fonts": ["gugak"], "part_presets": [[1, 0]], "timings_ms": {"midi": 1}}),
            render_prepared=AsyncMock(return_value=RenderResult(b"ID3-test", "fluidsynth", "test", {})))
        if failure:
            pool.render_prepared.side_effect = ApiError(failure)
        state = SimpleNamespace(db=db, config=cfg, limiter=Limiter(settings), registry=None, render_pool=pool)
        job = PerformanceJob(42, NO, "api", "image", "staff", b"image", tmp_path / "image.png",
                             Assignment(), None, 0, 1, settings, time.monotonic()+30)
        monkeypatch.setattr("app.jobs.performance.run_recognition", AsyncMock(return_value=SimpleNamespace(
            fallback=False, musicxml=XML, midi=b"MThd-test", fallback_reason=None)))
        monkeypatch.setattr("app.jobs.performance.complete_api_request", AsyncMock())
        monkeypatch.setattr("app.jobs.performance._default_ensemble_id", AsyncMock(return_value=1))
        monkeypatch.setattr("app.jobs.performance.placed_ensemble_id", AsyncMock(return_value=1))
        await run_performance(state, job)
        assert (cfg.api_storage / NO / "performance.musicxml").read_text() == XML
        assert (cfg.api_storage / NO / "performance.mid").read_bytes() == b"MThd-test"
        assert (cfg.api_storage / NO / "performance.mp3").exists() == (failure is None)
        assert any("status = 'completed'" in call.args[0] for call in db.execute.call_args_list)
        if failure:
            assert any(call.args[1] and failure in call.args[1] for call in db.execute.call_args_list)
    asyncio.run(run())


def test_missing_fallback_template_finishes_service_down(tmp_path, monkeypatch):
    from app.fallback.template import TemplateMissing

    async def run():
        settings = Settings(1)
        job = PerformanceJob(42, NO, "api", "image", "staff", b"image", tmp_path / "image.png",
                             Assignment(), None, 0, 1, settings, time.monotonic()+30)
        state = SimpleNamespace(db=SimpleNamespace(execute=AsyncMock()), config=Config(storage_dir=tmp_path),
                                limiter=Limiter(settings), registry=None)
        complete = AsyncMock()
        monkeypatch.setattr("app.jobs.performance.run_recognition", AsyncMock(return_value=SimpleNamespace(
            fallback=True, musicxml=None, midi=None, fallback_reason="no_structure")))
        monkeypatch.setattr("app.jobs.performance.load_template", AsyncMock(side_effect=TemplateMissing()))
        monkeypatch.setattr("app.jobs.performance.complete_api_request", complete)
        await run_performance(state, job)
        assert complete.call_args.kwargs["final_status"] == "service_down"
        assert complete.call_args.kwargs["musicxml"] is None
    asyncio.run(run())


@pytest.mark.parametrize("failure", ["queue_timeout", "RENDER_TIMEOUT", "RENDER_FAILED", "unexpected"])
@pytest.mark.parametrize("midi_available", [True, False])
def test_prepare_failure_still_downloads_recognized_result(client, monkeypatch, failure, midi_available):
    api, app, db, _ = client
    app.state.config = replace(app.state.config, render_timeout_s=.02)
    db.row.update(status="received", completed_at=None)
    original_execute = db.execute

    async def execute(sql, args=None):
        if "INSERT INTO derived_file" in sql:
            db.derived.append(dict(format=args[1], render_status=args[3], storage_uri=args[9],
                failure_reason=args[8], renderer_name=args[4], renderer_version=args[5]))
        if "UPDATE score_request SET status = %s" in sql:
            db.row["status"] = args[0]
        elif "status = 'completed'" in sql:
            db.row.update(status="completed", completed_at=utcnow())
        elif "status = 'service_down'" in sql:
            db.row.update(status="service_down", route="fallback", fallback_reason="recognition_failed")
        return await original_execute(sql, args)

    async def persist(*args, **kwargs):
        folder = app.state.config.api_storage / NO
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "result.musicxml").write_text(kwargs["musicxml"])
        if kwargs["midi"] is not None:
            (folder / "result.mid").write_bytes(kwargs["midi"])

    monkeypatch.setattr(db, "execute", execute)
    monkeypatch.setattr("app.jobs.performance.complete_api_request", persist)
    monkeypatch.setattr("app.jobs.performance.run_recognition", AsyncMock(return_value=SimpleNamespace(
        fallback=False, musicxml=XML, midi=b"MThd-test" if midi_available else None, fallback_reason=None)))
    app.state.render_pool = SimpleNamespace(close=AsyncMock(), prepare=AsyncMock(), render_prepared=AsyncMock())
    if failure != "queue_timeout":
        app.state.render_pool.prepare.side_effect = RuntimeError("must-not-leak") if failure == "unexpected" else ApiError(failure)

    async def run():
        async with AsyncExitStack() as stack:
            if failure == "queue_timeout":
                for _ in range(app.state.settings.current.max_concurrency_render):
                    await stack.enter_async_context(app.state.limiter.slot("render", "api", time.monotonic()+1))
            job = PerformanceJob(42, NO, "api", "image", "staff", b"image", app.state.config.api_storage / NO / "original.png",
                                 Assignment(), None, 0, 1, app.state.settings.current, time.monotonic()+10)
            await PerformanceRunner(app)._run(job)

    api.portal.call(run)
    response = api.get(f"/v1/performances/{NO}/result", headers=HEADERS)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["status"] == "completed" and not result["fallback"]
    assert result["render_failure"] == ("RENDER_TIMEOUT" if failure in ("queue_timeout", "RENDER_TIMEOUT") else "RENDER_FAILED")
    assert api.get(result["files"]["musicxml"]).text == XML
    if midi_available:
        assert api.get(result["files"]["midi"]).content == b"MThd-test"
    else:
        assert result["files"]["midi"] is None
    assert result["files"]["mp3"] is None and "must-not-leak" not in response.text
    app.state.render_pool.render_prepared.assert_not_awaited()
