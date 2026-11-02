"""#30 어댑터·별도 변환 프로세스·정간보 HTTP·종류 불일치를 검증한다."""
import asyncio
import base64
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock
import time

import pytest

from app.checks.structure import judge
from app.engines.base import EngineResult
from app.engines.registry import build_adapter
from app.resources.worker import WorkerReply
from app.services import engine_api
from test_recognition import Registry, XML, photo
from test_recognition import recognition_client as _recognition_client

ENCODING = "황:5|태:5|중:5|-:5\n임:5|남:5|청황:5|-:5"


@pytest.fixture(name="recognition_client")
def shared_recognition_client(tmp_path):
    yield from _recognition_client.__wrapped__(tmp_path)


def make_engine(tmp_path, *, result=None):
    folder = tmp_path / "jeongganbo"
    (folder / ".venv/bin").mkdir(parents=True)
    (folder / ".venv/bin/python").touch()
    (folder / "repo/checkpoints/best").mkdir(parents=True)
    (folder / "repo/checkpoints/best/model.pt").touch()
    (folder / "VERSION").write_text("test-1.0")
    engine = build_adapter({"model_name": "jeongganbo-omr", "provider": "venv",
                            "config_json": '{"adapter":"jeongganbo","device":"mps"}'}, engines_dir=tmp_path)
    engine.worker = SimpleNamespace(busy=lambda: False, stop=AsyncMock(), request=AsyncMock(
        return_value=result if result is not None else WorkerReply({"ok": True, "encoding": ENCODING, "confidence": .9})))
    return engine


def test_adapter_reuses_worker_and_converts_in_separate_process(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PASSWORD", "never-pass")
    monkeypatch.setenv("SERVICE_API_KEY", "never-pass")
    engine = make_engine(tmp_path)

    async def run():
        try:
            result = await engine.recognize(str(tmp_path / "photo.png"), time.monotonic() + 20)
            assert result.outcome == "success" and result.musicxml and result.midi.startswith(b"MThd")
            assert result.extra["yulmyeong_ratio"] == 1 and result.extra["jg_convert_ms"] >= 0
            engine.worker.request.assert_awaited_once()
            assert engine.converter.alive()
            assert not {"DB_PASSWORD", "SERVICE_API_KEY"} & engine.converter.env.keys()
            assert engine._cmd()[-1] == "cpu"  # DB에 남은 macOS 설정을 쓰지 않는다.
        finally:
            await engine.close()
        assert not engine.converter.alive()

    asyncio.run(run())


@pytest.mark.parametrize("data,outcome,code", [
    ({"ok": False}, "error", "ENGINE_ERROR"),
    ({"ok": True, "encoding": ""}, "no_notes", "NO_NOTES"),
    ({"ok": True, "encoding": "황:99"}, "convert_failed", "CONVERT_FAILED"),
])
def test_adapter_failures(tmp_path, data, outcome, code):
    engine = make_engine(tmp_path, result=WorkerReply(data))

    async def run():
        try:
            result = await engine.recognize("ignored.png", time.monotonic() + 20)
            assert (result.outcome, result.failure_code) == (outcome, code)
            assert result.musicxml is None and result.midi is None
        finally:
            await engine.close()

    asyncio.run(run())


def test_busy_worker_times_out_without_spawning_second_model(tmp_path, monkeypatch):
    engine = make_engine(tmp_path)
    engine.worker.busy = lambda: True
    subprocess = AsyncMock(side_effect=AssertionError("모델 중복 실행 금지"))
    monkeypatch.setattr("app.engines.jeongganbo.run_subprocess", subprocess)

    async def run():
        try:
            result = await engine.recognize("ignored.png", time.monotonic() + .03)
            assert result.outcome == "timeout"
            subprocess.assert_not_awaited()
            engine.worker.request.assert_not_awaited()
        finally:
            await engine.close()

    asyncio.run(run())


def test_converter_timeout_is_recorded(tmp_path):
    engine = make_engine(tmp_path)
    engine.converter = SimpleNamespace(busy=lambda: False, stop=AsyncMock(), request=AsyncMock(
        return_value=WorkerReply(None, timed_out=True)))

    async def run():
        try:
            result = await engine.recognize("ignored.png", time.monotonic() + 1)
            assert result.outcome == "timeout" and "jg_convert_ms" in result.extra
        finally:
            await engine.close()

    asyncio.run(run())


class JeongganboRegistry(Registry):
    def __init__(self):
        super().__init__(result=EngineResult("success", None, XML, b"MThd-test", "jeongganbo-omr", "test", .9, 1,
                                            {"yulmyeong_ratio": 1, "jg_convert_ms": 1}))
        self.entry.kind = "omr_jeongganbo"

    def get(self, name):
        return self.entry if name == "jeongganbo-omr" else None


def test_jeongganbo_route_records_type_and_conversion_time(recognition_client, monkeypatch):
    client, app, db = recognition_client
    app.state.registry = JeongganboRegistry()
    app.state.settings._current = replace(app.state.settings.current, engine_order={"jeongganbo": ["jeongganbo-omr"]})
    monkeypatch.setattr(engine_api, "check_structure", lambda *args: SimpleNamespace(
        verdict="pass", type_mismatch=False, detected_type="jeongganbo"))
    monkeypatch.setattr(engine_api, "check_validity", lambda *args, **kwargs: SimpleNamespace(
        grade="trust", items={"note_count": 16, "yulmyeong_ratio": 1}, score=1))
    response = client.post("/v1/omr/jeongganbo", files={"image": ("score.png", photo())},
                           data={"request_no": "R-1102-ABCDEFGH"}, headers={"X-API-Key": "service-secret"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert not body["fallback"] and body["engine"]["name"] == "jeongganbo-omr"
    assert body["validity_items"]["yulmyeong_ratio"] == 1
    assert base64.b64decode(body["midi_base64"]).startswith(b"MThd")
    assert any("INSERT INTO processing_job" in sql and args[1] == "jeongganbo" for sql, args in db.logs)
    assert any("INSERT INTO stage_timing" in sql and args[1] == "jg_convert" for sql, args in db.logs)


@pytest.mark.parametrize("chosen,other", [("staff", "jeongganbo"), ("jeongganbo", "staff")])
def test_type_mismatch_is_returned_without_engine_call(recognition_client, monkeypatch, chosen, other):
    client, app, db = recognition_client
    registry = JeongganboRegistry()
    app.state.registry = registry
    monkeypatch.setattr(engine_api, "check_structure", lambda *args: judge({chosen: .1, other: .9}, chosen, None))
    response = client.post(f"/v1/omr/{chosen}", files={"image": ("wrong-type.png", photo())},
                           data={"request_no": "R-1102-ABCDEFGH"}, headers={"X-API-Key": "service-secret"})
    assert response.status_code == 200
    body = response.json()
    assert body["fallback_reason"] == "NO_SCORE_STRUCTURE"
    assert body["type_mismatch"] and body["detected_type"] == other
    assert body["musicxml"] is None and body["midi_base64"] is None
    registry.adapter.recognize.assert_not_awaited()
    assert not any("INSERT INTO engine_attempt" in sql for sql, _ in db.logs)


@pytest.mark.parametrize("key,status", [(None, 401), ("wrong", 401), ("revoked-secret", 403)])
def test_jeongganbo_authentication(recognition_client, key, status):
    client, _, _ = recognition_client
    response = client.post("/v1/omr/jeongganbo", files={"image": ("score.png", photo())},
                           headers={"X-API-Key": key} if key else {})
    assert response.status_code == status


def test_both_recognition_routes_declare_key_in_openapi(recognition_client):
    client, _, _ = recognition_client
    paths = client.get("/v1/openapi.json").json()["paths"]
    for kind in ("staff", "jeongganbo"):
        assert paths[f"/v1/omr/{kind}"]["post"]["security"] == [{"ApiKey": []}]
    assert paths["/v1/models"]["get"]["security"] == []
