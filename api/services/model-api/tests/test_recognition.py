"""쪽별 인식·부분 실패·기한·인증·웹 파일 경계를 검증한다."""
import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
import io
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
import time
import xml.etree.ElementTree as ET

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from app.auth import rbac
from app.catalog import load_errors
from app.checks.structure import check_structure
from app.checks.validity import check_validity
from app.config import Config
from app.engines.base import EngineResult
from app.engines.registry import build_adapter
from app.errors import CATALOG
from app.jobs.limiter import Limiter
from app.main import create_app
from app.services import engine_api
from app.services.join import join_musicxml
from app.services.recognize import PageInput, RecognizeInput, run_recognition
from app.settings import Settings
from test_foundation import FakeDB, FakeResources, SHARED

XML = ('<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name>'
       '</score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions>'
       '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
       '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>'
       '</measure></part></score-partwise>')


@pytest.fixture(autouse=True)
def catalog():
    token = CATALOG.set(load_errors(SHARED))
    yield
    CATALOG.reset(token)


class RecordingDB(FakeDB):
    lastrowid = 42

    @asynccontextmanager
    async def transaction(self):
        yield self

    async def fetchone(self):
        return await super().fetchone()

    async def fetch_one(self, sql, args=None):
        if "FROM score_request" in sql:
            return {"request_id": 42, "request_no": "R-1102-ABCDEFGH"} if args[0] == "R-1102-ABCDEFGH" else None
        return await super().fetch_one(sql, args)

    async def fetch_all(self, sql, args=None):
        rows = await super().fetch_all(sql, args)
        if "role_permission" in sql:
            rows += [{"role_code": role, "uc_code": "UC12"} for role in ("service", "api_caller")]
        return rows


class Registry:
    def __init__(self, result=None, installed=True, state="ready"):
        self.adapter = SimpleNamespace(recognize=AsyncMock(return_value=result or EngineResult(
            "success", None, XML, b"MThd-test", "homr", "0.7", None, 1)))
        self.entry = SimpleNamespace(enabled=True, kind="omr_staff", installed=installed, state=state,
                                     adapter=self.adapter, version="0.7", row={})

    def get(self, name):
        return self.entry if name == "homr" else None

    def begin_request_use(self, name):
        return False

    async def close(self):
        pass


def input_pages(tmp_path, count=1):
    return [PageInput(i, i, "file", b"image", tmp_path / f"page{i}.png", 700) for i in range(1, count + 1)]


def setup_pipeline(tmp_path, monkeypatch, *, count=1):
    monkeypatch.setattr(engine_api, "check_structure", lambda *args: SimpleNamespace(
        verdict="pass", type_mismatch=False, detected_type="staff"))
    monkeypatch.setattr(engine_api, "check_validity", lambda *args, **kwargs: SimpleNamespace(
        grade="trust", items={"note_count": 16, "beat_sum": 1, "range_leap": 1}, score=1))
    settings = Settings(1, engine_order={"staff": ["homr"]})
    inp = RecognizeInput(42, "R-1102-ABCDEFGH", "staff", input_pages(tmp_path, count), True,
                         time.monotonic() + 10, settings)
    return RecordingDB(), Registry(), inp


def test_success_writes_page_attempt_job_and_validity(tmp_path, monkeypatch):
    db, registry, inp = setup_pipeline(tmp_path, monkeypatch)
    out = asyncio.run(run_recognition(db, Limiter(inp.settings), registry, inp))
    assert not out.fallback and out.musicxml == XML and out.converted_pages == 1
    for table in ("request_page", "engine_attempt", "processing_job", "validity_check_item", "stage_timing"):
        assert any(f"INSERT INTO {table}" in sql for sql, _ in db.logs), table
    assert registry.adapter.recognize.await_count == 1
    assert out.response(files=(out.musicxml, out.midi))["pages"][0]["outcome"] == "converted"


def test_structure_failure_never_calls_engine(tmp_path, monkeypatch):
    db, registry, inp = setup_pipeline(tmp_path, monkeypatch)
    monkeypatch.setattr(engine_api, "check_structure", lambda *args: SimpleNamespace(
        verdict="fail", type_mismatch=False, detected_type=None))
    out = asyncio.run(run_recognition(db, Limiter(inp.settings), registry, inp))
    assert out.fallback_code == "NO_SCORE_STRUCTURE"
    registry.adapter.recognize.assert_not_awaited()
    assert not any("INSERT INTO engine_attempt" in sql for sql, _ in db.logs)


@pytest.mark.parametrize("failure,code", [("no_notes", "NO_NOTES"), ("error", "RECOGNITION_FAILED"),
                                        ("stopped", "ENGINE_DOWN")])
def test_engine_failures_are_fallbacks(tmp_path, monkeypatch, failure, code):
    db, registry, inp = setup_pipeline(tmp_path, monkeypatch)
    registry.adapter.recognize.return_value = EngineResult(failure, "TEST", None, None, "homr", "0.7", None, 1)
    out = asyncio.run(run_recognition(db, Limiter(inp.settings), registry, inp))
    assert out.fallback_code == code and out.musicxml is None


def test_uninstalled_engine_is_diagnosed(tmp_path, monkeypatch):
    db, registry, inp = setup_pipeline(tmp_path, monkeypatch)
    registry.entry.installed = False
    out = asyncio.run(run_recognition(db, Limiter(inp.settings), registry, inp))
    assert out.fallback_code == "ENGINE_DOWN"
    assert out.tried[0]["failure_code"] == "NOT_INSTALLED"
    registry.adapter.recognize.assert_not_awaited()


def test_engine_deadline_cancels_and_records_timeout(tmp_path, monkeypatch):
    db, registry, inp = setup_pipeline(tmp_path, monkeypatch)
    cancelled = []

    async def slow(*args):
        try:
            await asyncio.sleep(1)
        finally:
            cancelled.append(True)

    registry.adapter.recognize.side_effect = slow
    inp.deadline_mono = time.monotonic() + .1
    out = asyncio.run(run_recognition(db, Limiter(inp.settings), registry, inp))
    assert out.fallback_code == "TIMEOUT" and cancelled
    assert any("INSERT INTO engine_attempt" in sql and "timeout" in args for sql, args in db.logs)


def test_partial_pages_keep_input_order(tmp_path, monkeypatch):
    db, registry, inp = setup_pipeline(tmp_path, monkeypatch, count=3)
    calls = iter(["pass", "fail", "pass"])
    monkeypatch.setattr(engine_api, "check_structure", lambda *args: SimpleNamespace(
        verdict=next(calls), type_mismatch=False, detected_type="staff"))
    monkeypatch.setattr("app.services.safe_midi.musicxml_to_midi_safe", AsyncMock(return_value=b"MThd"))
    out = asyncio.run(run_recognition(db, Limiter(inp.settings), registry, inp))
    assert not out.fallback and out.converted_pages == 2
    assert out.notice["failed_pages"] == [2]
    assert [p.page_no for p in out.pages] == [1, 2, 3]
    assert len(ET.fromstring(out.musicxml).findall("part/measure")) == 2
    assert out.validity_items["note_count"] == 32


def test_distrust_is_not_recognition_success(tmp_path, monkeypatch):
    db, registry, inp = setup_pipeline(tmp_path, monkeypatch)
    monkeypatch.setattr(engine_api, "check_validity", lambda *args, **kwargs: SimpleNamespace(
        grade="distrust", items={"note_count": 16}, score=.1))
    out = asyncio.run(run_recognition(db, Limiter(inp.settings), registry, inp))
    assert out.fallback_code == "UNTRUSTED_RESULT" and out.musicxml is None


def test_join_preserves_note_order():
    other = XML.replace("<step>C</step>", "<step>D</step>")
    root = ET.fromstring(join_musicxml([XML, other]))
    assert [n.text for n in root.findall("part/measure/note/pitch/step")] == ["C", "D"]


def test_blank_structure_and_empty_notes():
    output = io.BytesIO()
    Image.new("RGB", (700, 700), "white").save(output, "PNG")
    assert check_structure(output.getvalue(), "staff", None).verdict == "fail"
    no_notes = XML.replace("<pitch><step>C</step><octave>4</octave></pitch>", "<rest/>")
    verdict = check_validity(no_notes, "staff", engine_confidence=None,
                             caution_boundary=None, distrust_boundary=None)
    assert verdict.grade == "distrust" and verdict.items["note_count"] == 0


def test_adapter_missing_install_and_environment(tmp_path, monkeypatch):
    adapter = build_adapter({"model_name": "homr", "provider": "venv", "config_json": '{"adapter":"homr"}'},
                            engines_dir=tmp_path)
    assert not adapter.probe()["installed"]
    monkeypatch.setenv("DB_PASSWORD", "never-pass")
    monkeypatch.setenv("SERVICE_API_KEY", "never-pass")
    assert "DB_PASSWORD" not in adapter.env() and "SERVICE_API_KEY" not in adapter.env()
    assert asyncio.run(adapter.recognize("missing.png", time.monotonic() + 1)).failure_code == "NOT_INSTALLED"


@pytest.fixture
def recognition_client(tmp_path):
    db = RecordingDB()

    async def connect(cfg):
        return db

    cfg = Config(shared_dir=SHARED, storage_dir=tmp_path, assets_dir=Path(__file__).resolve().parents[1] / "assets")
    app = create_app(cfg, db_factory=connect, resource_factory=FakeResources)
    with TestClient(app) as client:
        app.state.settings._current = replace(app.state.settings.current, engine_order={"staff": ["homr"]})
        app.state.registry = Registry(installed=False)
        rbac.clear_cache()
        yield client, app, db


def photo():
    out = io.BytesIO()
    Image.new("RGB", (700, 700), "white").save(out, "PNG")
    return out.getvalue()


@pytest.mark.parametrize("key,status,code", [(None, 401, "AUTH_KEY_MISSING"),
                                           ("wrong", 401, "AUTH_KEY_INVALID"),
                                           ("revoked-secret", 403, "AUTH_KEY_REVOKED")])
def test_recognition_authentication(recognition_client, key, status, code):
    client, _, _ = recognition_client
    response = client.post("/v1/omr/staff", files={"image": ("a.png", photo())},
                           headers={"X-API-Key": key} if key else {})
    assert response.status_code == status and response.json()["error"]["code"] == code


def test_web_fallback_never_returns_or_stores_files(recognition_client):
    client, app, db = recognition_client
    response = client.post("/v1/omr/staff", data={"request_no": "R-1102-ABCDEFGH"},
                           files=[("image", ("a.png", photo())), ("image", ("b.png", photo()))],
                           headers={"X-API-Key": "service-secret"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["fallback"] and body["page_count"] == 2
    assert body["musicxml"] is None and body["midi_base64"] is None
    assert not [p for p in app.state.config.storage_dir.rglob("*") if p.is_file()]
    assert not any("INSERT INTO score_request" in sql or "INSERT INTO score_result" in sql for sql, _ in db.logs)


def test_unknown_web_request_does_not_create_new_request(recognition_client):
    client, _, db = recognition_client
    response = client.post("/v1/omr/staff", data={"request_no": "missing"},
                           files={"image": ("a.png", photo())}, headers={"X-API-Key": "service-secret"})
    assert response.status_code == 404
    assert not any("INSERT INTO score_request" in sql for sql, _ in db.logs)


def test_pdf_renders_all_pages_in_order(recognition_client):
    from test_upload_check import pdf

    client, _, _ = recognition_client
    response = client.post("/v1/omr/staff", data={"request_no": "R-1102-ABCDEFGH"},
                           files={"image": ("two.pdf", pdf(2, size=160))},
                           headers={"X-API-Key": "service-secret"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["file_kind"] == "pdf" and body["pdf_page_count"] == body["page_count"] == 2
    assert [(p["page_no"], p["file_no"], p["source"]) for p in body["pages"]] == [
        (1, 1, "pdf_page"), (2, 1, "pdf_page")]


def test_models_public_contract():
    db = FakeDB()

    async def connect(cfg):
        return db

    app = create_app(Config(shared_dir=SHARED), db_factory=connect, resource_factory=FakeResources)
    with TestClient(app) as client:
        response = client.get("/v1/models")
    assert response.status_code == 200
    row = response.json()[0]
    assert row["name"] == "homr" and row["state"] == "ready"
    assert {"installed", "enabled", "expected_seconds", "elapsed_seconds", "load_started_at", "error"} <= row.keys()
    assert "config_json" not in row and "password" not in response.text


def test_first_converted_page_is_previewed_while_running(tmp_path, monkeypatch):
    # 2026-11-04 #181 여러 쪽 웹 요청은 먼저 변환된 쪽을 끝나기 전에 내준다. 1쪽이 실패하면 2쪽, 끝나면 지운다
    from app.services import page_preview

    db, registry, inp = setup_pipeline(tmp_path, monkeypatch, count=3)
    calls = iter(["fail", "pass", "pass"])
    monkeypatch.setattr(engine_api, "check_structure", lambda *args: SimpleNamespace(
        verdict=next(calls), type_mismatch=False, detected_type="staff"))
    monkeypatch.setattr("app.services.safe_midi.musicxml_to_midi_safe", AsyncMock(return_value=b"MThd"))
    seen = []

    async def recognize(*args):
        p = page_preview.get(inp.request_no)
        seen.append(p and replace(p))  # 그때 값으로 남긴다(같은 객체를 뒤에 고친다)
        return EngineResult("success", None, XML, b"MThd-test", "homr", "0.7", None, 1)

    registry.adapter.recognize.side_effect = recognize
    out = asyncio.run(run_recognition(db, Limiter(inp.settings), registry, inp))
    assert not out.fallback and out.converted_pages == 2
    assert seen[0] is None  # 2쪽 엔진을 부를 때 아직 변환된 쪽이 없다(1쪽은 구조 실패)
    assert (seen[1].page_no, seen[1].page_count, seen[1].pages_done, seen[1].musicxml) == (2, 3, 2, XML)
    assert page_preview.get(inp.request_no) is None


def test_single_page_or_api_request_has_no_preview(tmp_path, monkeypatch):
    from app.services import page_preview

    for count, is_web in ((1, True), (2, False)):
        db, registry, inp = setup_pipeline(tmp_path, monkeypatch, count=count)
        inp.is_web = is_web
        monkeypatch.setattr("app.services.safe_midi.musicxml_to_midi_safe", AsyncMock(return_value=b"MThd"))
        seen = []

        async def recognize(*args):
            seen.append(page_preview.get(inp.request_no))
            return EngineResult("success", None, XML, b"MThd-test", "homr", "0.7", None, 1)

        registry.adapter.recognize.side_effect = recognize
        asyncio.run(run_recognition(db, Limiter(inp.settings), registry, inp))
        assert seen and all(p is None for p in seen)


def test_preview_endpoint_is_service_key_only(recognition_client):
    from app.services import page_preview

    client, _, _ = recognition_client
    no = "R-1104-PREVIEW1"
    assert client.get(f"/v1/internal/omr/preview/{no}", headers={"X-API-Key": "service-secret"}).json()["preview"] is None
    page_preview.begin(no)
    page_preview.page_done(no, 1, 4, XML)
    try:
        body = client.get(f"/v1/internal/omr/preview/{no}", headers={"X-API-Key": "service-secret"}).json()
        assert body["preview"] == {"page_no": 1, "page_count": 4, "pages_done": 1, "musicxml": XML}
        external = client.get(f"/v1/internal/omr/preview/{no}", headers={"X-API-Key": "external-secret"})
        assert external.status_code == 403
    finally:
        page_preview.end(no)
