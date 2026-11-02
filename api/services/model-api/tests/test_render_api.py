"""#31 렌더링 계약·정책·악기 배정·필요 음원 선택·취소 정리를 검증한다."""
import asyncio
from dataclasses import asdict
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock
import time

from fastapi.testclient import TestClient
import mido
import pytest

from app.catalog import load_errors
from app.config import Config
from app.errors import ApiError, CATALOG
from app.main import create_app
from app.jobs.limiter import Limiter, QueueTimeout
from app.settings import Settings
from app.render.errors import RenderError
from app.render.fluidsynth_mp3 import apply_part_presets, plan_groups
from app.render.pool import RenderPool, RenderResult
from app.resources.worker import EngineWorker
from app.services import scoreio
from app.services.arrange import arrange, parse_assignment, render_fonts, render_presets
from app.services.catalog import INSTRUMENTS_DIR
from test_foundation import FakeResources, SHARED
from test_recognition import RecordingDB, XML


@pytest.fixture(autouse=True)
def catalog(monkeypatch):
    monkeypatch.setenv("SHARED_DIR", str(SHARED))
    token = CATALOG.set(load_errors(SHARED))
    instrument_token = INSTRUMENTS_DIR.set(SHARED)
    yield
    INSTRUMENTS_DIR.reset(instrument_token)
    CATALOG.reset(token)


class RenderDB(RecordingDB):
    policy = 0
    policy_reads = 0

    async def fetch_one(self, sql, args=None):
        if "v_mp3_license" in sql:
            self.policy_reads += 1
            return {"api_mp3_allowed": self.policy}
        return await super().fetch_one(sql, args)


@pytest.fixture
def client(tmp_path):
    db = RenderDB()

    async def connect(cfg):
        return db

    app = create_app(Config(shared_dir=SHARED, storage_dir=tmp_path), db_factory=connect, resource_factory=FakeResources)
    with TestClient(app) as api:
        app.state.render_pool = SimpleNamespace(close=AsyncMock(), render=AsyncMock(return_value=RenderResult(
            b"rendered-test-data", "test-renderer", "1.0", {"midi": 1, "mix": 0, "lame": 2})))
        yield api, app, db


@pytest.mark.parametrize("kind", ["mp3", "pdf"])
def test_success_contract_and_no_request_file_storage(client, kind):
    api, app, db = client
    response = api.post(f"/v1/render/{kind}", files={"score": ("score.musicxml", XML)},
                        headers={"X-API-Key": "service-secret"})
    assert response.status_code == 200 and response.content == b"rendered-test-data"
    assert response.headers["content-type"] == ("audio/mpeg" if kind == "mp3" else "application/pdf")
    assert response.headers["x-renderer"] == "test-renderer 1.0" and response.headers["x-request-id"]
    assert db.policy_reads == 0
    assert not [p for p in app.state.config.storage_dir.rglob("*") if p.is_file()]
    assert not any("INSERT INTO score_request" in sql for sql, _ in db.logs)


@pytest.mark.parametrize("key,status", [(None, 401), ("wrong", 401), ("revoked-secret", 403)])
def test_authentication(client, key, status):
    api, app, _ = client
    response = api.post("/v1/render/mp3", files={"score": ("score.musicxml", XML)},
                        headers={"X-API-Key": key} if key else {})
    assert response.status_code == status
    app.state.render_pool.render.assert_not_awaited()


def test_external_policy_withholds_audio_without_renderer_header(client):
    api, app, _ = client
    response = api.post("/v1/render/mp3", files={"score": ("score.musicxml", XML)},
                        headers={"X-API-Key": "external-secret"})
    assert response.status_code == 200 and response.headers["content-type"] == "application/json"
    assert response.json()["mp3_withheld_reason"] == "LICENSE_UNCONFIRMED"
    assert "x-renderer" not in response.headers
    app.state.render_pool.render.assert_not_awaited()


def test_confirmed_external_policy_allows_audio(client):
    api, _, db = client
    db.policy = 1
    response = api.post("/v1/render/mp3", files={"score": ("score.musicxml", XML)},
                        headers={"X-API-Key": "external-secret"})
    assert response.status_code == 200 and response.headers["content-type"] == "audio/mpeg"


@pytest.mark.parametrize("code,status", [("RENDER_FAILED", 502), ("RENDERER_MISSING", 502), ("RENDER_TIMEOUT", 504)])
def test_renderer_error_contract(client, code, status):
    api, app, _ = client
    app.state.render_pool.render.side_effect = ApiError(code)
    response = api.post("/v1/render/pdf", files={"score": ("score.musicxml", XML)},
                        headers={"X-API-Key": "service-secret"})
    assert response.status_code == status and response.json()["error"]["code"] == code


@pytest.mark.parametrize("assignment", ["bad-json", '{"mode":"custom","tracks":1}',
    '{"mode":"custom","tracks":[{"part":true,"instrument":"piano"}]}',
    '{"mode":"custom","tracks":[{"part":0,"instrument":"unknown"}]}',
    '{"mode":"custom","tracks":[{"part":0,"instrument":"piano","sf2_ref":"/etc/passwd"}]}'])
def test_invalid_assignment_is_422(client, assignment):
    api, app, _ = client
    response = api.post("/v1/render/mp3", files={"score": ("score.musicxml", XML)}, data={"instruments": assignment},
                        headers={"X-API-Key": "service-secret"})
    assert response.status_code == 422
    app.state.render_pool.render.assert_not_awaited()


def test_default_and_custom_instruments_have_correct_bank_and_soundfont():
    doc = scoreio.load_score(XML.encode())
    arrange(doc, assignment=parse_assignment(None), codes=None, transpose=0, volume=1)
    fonts = render_fonts(doc)
    assert fonts == ["gugak"] and render_presets(doc, fonts) == [(1, 0)]
    assignment = parse_assignment(json.dumps({"mode": "custom", "tracks": [
        {"part": 0, "instrument": "gayageum"}, {"part": 1, "instrument": "piano"}]}))
    arrange(doc, assignment=assignment, codes=None, transpose=0, volume=1)
    fonts = render_fonts(doc)
    assert fonts == ["gugak", "gm"]
    midi = apply_part_presets(scoreio.to_midi(doc), render_presets(doc, fonts))
    messages = mido.MidiFile(file=io.BytesIO(midi)).tracks[1]
    assert any(m.type == "control_change" and m.control == 0 and m.value == 1 for m in messages)
    assert asdict(assignment)["mode"] == "custom"


def test_midi_percussion_exports_to_musicxml_without_changing_input():
    midi = mido.MidiFile()
    track = mido.MidiTrack()
    midi.tracks.append(track)
    track.append(mido.Message("program_change", channel=9, program=0))
    track.append(mido.Message("note_on", channel=9, note=36, velocity=90))
    track.append(mido.Message("note_off", channel=9, note=36, time=480))
    output = io.BytesIO()
    midi.save(file=output)
    doc = scoreio.load_score(output.getvalue())
    before = len(list(doc.recurse().getElementsByClass("Instrument")))
    xml = scoreio.to_musicxml(doc)
    assert "<unpitched>" in xml and "<midi-unpitched>" in xml
    assert len(list(doc.recurse().getElementsByClass("Instrument"))) == before


def test_default_assignment_preserves_janggu_hit_numbers():
    sample = Path(__file__).resolve().parents[1] / "assets/templates/arirang-semachi-v1.musicxml"
    doc = scoreio.load_score(sample.read_bytes())
    arrange(doc, assignment=parse_assignment(None), codes=None, transpose=0, volume=1)
    midi = mido.MidiFile(file=io.BytesIO(apply_part_presets(scoreio.to_midi(doc), render_presets(doc))))
    hits = {m.note for t in midi.tracks for m in t if m.type == "note_on" and m.channel == 9 and m.velocity > 0}
    assert hits == {36, 38, 42}
    assert any(m.type == "program_change" and m.channel == 9 and m.program == 1 for t in midi.tracks for m in t)


@pytest.mark.parametrize("preset,channel,send", [((1, 0), 0, 72), ((128, 1), 9, 60)])
def test_reverb_feedback_keeps_percussion_level(preset, channel, send):
    from app.render.fluidsynth_mp3 import _set_track_sound
    track = mido.MidiTrack([mido.Message("control_change", channel=channel, control=91, value=0),
                            mido.Message("note_on", channel=channel, note=36, velocity=90)])
    changed = _set_track_sound(track, preset, drums=True)
    assert {m.value for m in changed if m.type == "control_change" and m.control == 91} == {send}


def test_janggu_natural_ring_keeps_hit_timing_and_track_duration():
    from app.render.fluidsynth_mp3 import _set_track_sound
    original = mido.MidiTrack([
        mido.Message("note_on", channel=9, note=36, velocity=100, time=0),
        mido.Message("note_off", channel=9, note=36, time=120),
        mido.Message("note_on", channel=9, note=42, velocity=100, time=120),
        mido.Message("note_on", channel=9, note=42, velocity=0, time=60),
        mido.MetaMessage("end_of_track", time=180)])
    changed = _set_track_sound(original, (128, 1), drums=True)
    elapsed = 0
    hits = []
    for message in changed:
        elapsed += message.time
        if message.type == "note_on" and message.velocity:
            hits.append((message.note, elapsed))
    assert hits == [(36, 0), (42, 240)] and elapsed == 480
    assert not any(m.type == "note_off" or m.type == "note_on" and m.velocity == 0 for m in changed)
    gm = _set_track_sound(original, (128, 0), drums=True)
    assert any(m.type == "note_off" for m in gm)


@pytest.mark.parametrize("fonts,expected", [(["gugak"], {"gugak.sf2"}), (["gm"], {"FluidR3_GM.sf2"}),
                                         (["gugak", "gm"], {"gugak.sf2", "FluidR3_GM.sf2"})])
def test_only_requested_soundfont_groups(monkeypatch, fonts, expected):
    monkeypatch.setattr("app.render.fluidsynth_mp3.gugak_soundfont", lambda: "/fonts/gugak.sf2")
    monkeypatch.setattr("app.render.fluidsynth_mp3.gm_soundfont", lambda: "/fonts/FluidR3_GM.sf2")
    groups = plan_groups(len(fonts) + 1, fonts, [])
    assert {Path(p).name for stack, _, _ in groups for p in stack} == expected
    assert all(len(stack) == 1 for stack, _, _ in groups)


def test_missing_required_soundfont_does_not_silently_substitute(monkeypatch):
    monkeypatch.setattr("app.render.fluidsynth_mp3.gugak_soundfont", lambda: None)
    monkeypatch.setattr("app.render.fluidsynth_mp3.gm_soundfont", lambda: "/fonts/FluidR3_GM.sf2")
    with pytest.raises(RenderError) as error:
        plan_groups(2, ["gugak"], [])
    assert error.value.code == "RENDERER_MISSING"


def test_render_cancel_kills_worker_and_child_cli(tmp_path):
    async def run():
        cfg = Config(shared_dir=SHARED)
        pool = RenderPool(cfg, size=0)
        pidfile = tmp_path / "child.pid"
        code = ("import json,sys,subprocess,time,pathlib; print('@@RESULT@@ {\"ready\":true}',flush=True); "
                "sys.stdin.readline(); p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']); "
                f"pathlib.Path({str(pidfile)!r}).write_text(str(p.pid)); time.sleep(60)")
        worker = EngineWorker("render-cancel", [sys.executable, "-u", "-c", code])
        pool.workers.append(worker)
        pool.free.put_nowait(worker)
        task = asyncio.create_task(pool.render("pdf", b"test", None, time.monotonic() + 10))
        try:
            for _ in range(200):
                if pidfile.exists():
                    break
                await asyncio.sleep(.01)
            assert pidfile.exists()
            child = int(pidfile.read_text())
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert not worker.alive()
            await asyncio.sleep(.05)
            stat = Path(f"/proc/{child}/stat")
            assert not stat.exists() or stat.read_text().split()[2] == "Z"
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await pool.close()

    asyncio.run(run())


def test_render_concurrency_limit_counts_service_and_external_together():
    async def run():
        limiter = Limiter(Settings(1, max_concurrency_render=1))
        async with limiter.slot("render", "web", time.monotonic() + 1):
            with pytest.raises(QueueTimeout):
                async with limiter.slot("render", "api", time.monotonic() + .02):
                    raise AssertionError("렌더링 상한을 초과했습니다")
        assert limiter.stats()["render_running"] == 0

    asyncio.run(run())
