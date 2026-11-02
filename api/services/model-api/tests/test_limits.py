"""#33 한도·접수 예약·읽기/픽셀/압축 상한·시간 제한과 최소권한 전달을 검증한다."""
import asyncio
from dataclasses import replace
from datetime import timedelta
import io
from types import SimpleNamespace
from unittest.mock import AsyncMock
import time
import zipfile

from PIL import Image
import pytest

from app.auth.keys import Caller
from app.bounds import UploadBounds
from app.catalog import load_errors
from app.checks.upload import ResourceLimit, _open_image, _read_mxl
from app.config import Config, load_config
from app.db import utcnow
from app.errors import CATALOG
from app.jobs.limiter import Limiter
from app.routers.omr_common import deadline_from_header
from app.services.uploads import read_files
from app.settings import Settings, SettingsStore
from test_foundation import SHARED
from test_performances import client as client, HEADERS


@pytest.fixture(autouse=True)
def catalog():
    token = CATALOG.set(load_errors(SHARED))
    yield
    CATALOG.reset(token)


def test_exhausted_key_rejected_before_body_and_request(client):
    api, _, db, submit = client
    db.fetchone = AsyncMock(return_value={"is_exhausted": 1, "status": "active", "retry_after_at": utcnow()+timedelta(seconds=61)})
    response = api.post("/v1/performances", headers=HEADERS, content=b"not-multipart")
    assert response.status_code == 429 and int(response.headers["retry-after"]) >= 60
    assert response.json()["error"]["code"] == "RATE_LIMIT_EXCEEDED"
    assert response.json()["error"]["retry_after"] and response.headers["x-request-id"]
    submit.assert_not_called()
    assert not any("INSERT INTO score_request" in sql for sql, _ in db.logs)
    assert db.logs[-1][1][3:5] == ("rejected_limit", "RATE_LIMIT_EXCEEDED")


def test_admission_full_rejected_and_can_be_reused(client):
    api, app, _, submit = client
    leases = [app.state.limiter.admit("recognize", "api") for _ in range(2)]
    response = api.post("/v1/performances", headers=HEADERS)
    assert response.status_code == 429 and response.json()["error"]["code"] == "SERVER_BUSY"
    submit.assert_not_called()
    leases[0].release()
    assert api.post("/v1/performances", headers=HEADERS).status_code == 422
    leases[1].release()
    fresh = app.state.limiter.admit("recognize", "api")
    assert fresh is not None
    fresh.release()


def test_header_size_rejected_before_reading(client):
    api, app, db, submit = client
    app.state.config = replace(app.state.config, max_body_bytes=16)
    response = api.post("/v1/performances", headers=HEADERS | {"Content-Length": "99999"})
    assert response.status_code == 413 and response.json()["error"]["code"] == "UPLOAD_TOO_LARGE"
    submit.assert_not_called()
    # 예약한 호출 기록을 반려로 바꾸며 중복 기록하지 않는다.
    assert any("UPDATE api_call_log" in sql and args[0] == "rejected_file" for sql, args in db.logs)


@pytest.mark.parametrize("value", ["-1", "not-a-number", "9" * 5000])
def test_invalid_content_length_is_common_400(client, value):
    api, _, _, submit = client
    response = api.post("/v1/performances", headers=HEADERS | {"Content-Length": value})
    assert response.status_code == 400 and response.json()["error"]["code"] == "BAD_REQUEST"
    submit.assert_not_called()


@pytest.mark.parametrize("slow", [False, True])
def test_chunked_body_and_read_timeout_stop_before_parser(tmp_path, monkeypatch, slow):
    async def run():
        called, sent, reads = [], [], []

        async def app(scope, receive, send):
            called.append(True)

        async def receive():
            reads.append(True)
            if slow:
                await asyncio.sleep(.2)
            return {"type": "http.request", "body": b"abc", "more_body": True}

        async def send(message):
            sent.append(message)

        monkeypatch.setattr("app.bounds.authenticate", AsyncMock(return_value=Caller(1, "service", "test", None)))
        monkeypatch.setattr("app.bounds.enforce_limits", AsyncMock())
        scope = dict(type="http", method="POST", path="/v1/performances", root_path="", scheme="http", query_string=b"",
                     headers=[], state={}, server=("test",80), client=("test",1),
                     app=SimpleNamespace(state=SimpleNamespace(config=Config(storage_dir=tmp_path, max_body_bytes=4,
                                                                            upload_read_timeout_s=.01))))
        await UploadBounds(app)(scope, receive, send)
        assert not called and sent[0]["status"] == (400 if slow else 413)
        assert len(reads) == (1 if slow else 2)
        assert not list(tmp_path.rglob("tmp*/*"))
    asyncio.run(run())


def test_file_read_has_a_hard_limit():
    class File:
        filename = "huge.png"
        def __init__(self):
            self.read_bytes = 0
        async def read(self, count):
            self.read_bytes += count
            return b"x" * count
    file = File()
    with pytest.raises(Exception) as exc:
        asyncio.run(read_files([file], max_bytes=10))
    assert exc.value.code == "UPLOAD_TOO_LARGE" and file.read_bytes == 11


def test_large_image_rejected_before_pixel_decode(monkeypatch):
    source = io.BytesIO()
    Image.new("RGB", (300, 4000), "white").save(source, "PNG")
    loaded = []
    monkeypatch.setattr(Image.Image, "load", lambda self: loaded.append(True))
    with pytest.raises(ResourceLimit):
        _open_image(source.getvalue())
    assert not loaded  # 확대한 뒤 긴 변 10000px 초과. 압축을 풀기 전에 거절한다.


def test_mxl_uncompressed_limit():
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("score.xml", b"x" * (20 * 1024 * 1024 + 1))
    with pytest.raises(ResourceLimit):
        _read_mxl(data.getvalue())


def test_deadline_header_cannot_extend_server_cap():
    before = time.monotonic()
    assert deadline_from_header("2099-01-01T00:00:00Z", 3, before) == before + 3
    assert deadline_from_header("2000-01-01T00:00:00Z", 3, before) < before


def test_db_timeout_setting_is_capped():
    db = SimpleNamespace(fetch_one=AsyncMock(return_value={"setting_version_id": 1, "timeout_seconds": 99999}),
                         fetch_all=AsyncMock(return_value=[]))
    assert asyncio.run(SettingsStore(db, timeout_max_s=180).load()).timeout_seconds == 180


@pytest.mark.parametrize("name,value", [("MAX_REQUEST_BODY_BYTES", "9999999999"), ("PURGE_INTERVAL_SECONDS", "0"),
    ("UPLOAD_READ_TIMEOUT_SECONDS", "nan"), ("RECOGNITION_TIMEOUT_MAX_SECONDS", "-1")])
def test_invalid_limit_configuration_fails_startup(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError):
        load_config()


def test_resize_does_not_lose_existing_admission():
    limiter = Limiter(Settings(1))
    lease = limiter.admit("render", "api")
    limiter.resize(Settings(2, max_concurrency_render=1))
    lease.release()
    lease.release()  # 두 번 반환해도 처리 자리가 늘어나지 않는다.
    a, b = limiter.admit("render", "api"), limiter.admit("render", "api")
    assert a and b and limiter.admit("render", "api") is None
