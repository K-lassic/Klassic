"""계약 시험 공통 준비 — 시험 DB(gugak_test), 가짜 엔진, 가짜 Ollama 서버.

- 시험 DB 는 한 번(세션) 비우고 app/db/migrations/*.sql + seeds/001_initial.sql 을 다시 넣는다.
- 엔진 쪽 함수(app.services.engine_api)는 가짜로 바꾼다 — 계약(INTERNAL_API.md)의 모양만 흉내 낸다.
- Ollama 는 httpx.MockTransport 로 흉내 내고 부른 경로를 모두 적어 둔다(금지 경로 호출이 없는지 확인).
팀 DB 에는 절대 붙지 않는다(127.0.0.1 의 gugak_test 만).
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import secrets
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pymysql
import pytest

MODEL_API = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(MODEL_API))

from app.config import APP_ROOT, load_config
from app.db import split_sql_script

TEST_DB = "gugak_test"
FIXTURES = APP_ROOT / "shared" / "fixtures" / "upload"  # 공용 업로드 시험 파일(PDF 포함, 2026-09-29)
SERVICE_KEY = "gk_test_service_" + "S" * 27


def _connect(cfg, db: str | None = TEST_DB):
    assert cfg.db_host in ("127.0.0.1", "localhost"), "시험은 로컬 개발 DB 에서만 돈다"
    return pymysql.connect(host=cfg.db_host, port=cfg.db_port, user=cfg.db_user, password=cfg.db_password,
                           database=db, charset="utf8mb4", autocommit=True, init_command="SET time_zone='+00:00'",
                           cursorclass=pymysql.cursors.DictCursor)


def sha(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


@pytest.fixture(scope="session")
def base_cfg():
    return load_config()


@pytest.fixture(scope="session")
def test_db(base_cfg):
    """gugak_test 를 비우고 마이그레이션·시드를 다시 넣는다."""
    conn = _connect(base_cfg)
    with conn.cursor() as cur:
        cur.execute("SET FOREIGN_KEY_CHECKS = 0")
        cur.execute("SELECT table_name AS n, table_type AS t FROM information_schema.tables WHERE table_schema = %s",
                    (TEST_DB,))
        objs = cur.fetchall()
        for o in objs:
            if o["t"] == "VIEW":
                cur.execute(f"DROP VIEW IF EXISTS `{o['n']}`")
        for o in objs:
            if o["t"] != "VIEW":
                cur.execute(f"DROP TABLE IF EXISTS `{o['n']}`")
        cur.execute("SET FOREIGN_KEY_CHECKS = 1")
        files = sorted((APP_ROOT / "db" / "migrations").glob("*.sql")) + [APP_ROOT / "db" / "seeds" / "001_initial.sql"]
        for f in files:
            for stmt in split_sql_script(f.read_text(encoding="utf-8")):
                cur.execute(stmt)
        cur.execute(
            "INSERT INTO access_key (key_kind, key_hash, key_prefix, issued_by, status) VALUES ('service', %s, %s, 1, 'active')",
            (sha(SERVICE_KEY), SERVICE_KEY[:8]),
        )
    yield conn
    conn.close()


@pytest.fixture
def db(test_db):
    return test_db


def make_external_key(db, limit: int = 1000, status: str = "active") -> tuple[str, int]:
    raw = "gk_" + secrets.token_urlsafe(32)[:43]
    app_no = "A-" + secrets.token_hex(5).upper()
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO access_key (key_kind, key_hash, key_prefix, application_no, call_limit_per_hour, status, "
            "revoked_at, revoked_by) VALUES ('external', %s, %s, %s, %s, %s, %s, %s)",
            (sha(raw), raw[:8], app_no, limit, status,
             None if status == "active" else "2026-09-28 00:00:00", None if status == "active" else 1),
        )
        return raw, cur.lastrowid


@pytest.fixture
def ext_key(db):
    return make_external_key(db)


# ---------------------------------------------------------------------------- 악보 파일 만들기
def make_musicxml(pitches: list[str] | None = None, bpm: int | None = 90, instrument_name: str | None = "Piano") -> str:
    from music21 import instrument, meter, note, stream, tempo
    from music21.musicxml.m21ToXml import GeneralObjectExporter

    s = stream.Score()
    p = stream.Part()
    if instrument_name:
        inst = instrument.Instrument()
        inst.partName = inst.instrumentName = instrument_name
        inst.midiProgram = 0
        inst.midiChannel = 0
        p.insert(0, inst)
    p.append(meter.TimeSignature("4/4"))
    if bpm:
        p.append(tempo.MetronomeMark(number=bpm))
    for n in pitches or ["C4", "D4", "E4", "G4", "A4", "G4", "E4", "D4", "C4", "D4", "E4", "C4"]:
        p.append(note.Note(n, quarterLength=1))
    s.insert(0, p)
    return GeneralObjectExporter(s).parse().decode("utf-8")


def make_midi(bpm: float = 60.0, pitches: list[int] | None = None, drums_only: bool = False, program: int = 0) -> bytes:
    import pretty_midi

    pm = pretty_midi.PrettyMIDI(initial_tempo=bpm)
    inst = pretty_midi.Instrument(program=program, is_drum=drums_only, name="Piano")
    t = 0.0
    for p in pitches or [57, 60, 62, 64, 67, 64, 62, 60, 57, 60, 57]:
        inst.notes.append(pretty_midi.Note(velocity=90, pitch=p, start=t, end=t + 0.5))
        t += 0.5
    pm.instruments.append(inst)
    buf = io.BytesIO()
    pm.write(buf)
    return buf.getvalue()


def make_png(w: int = 1000, h: int = 900, shade: int = 255) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("L", (w, h), shade).save(buf, format="PNG")
    return buf.getvalue()


def make_pdf(pages: int, w_pt: int = 595, h_pt: int = 842) -> bytes:
    """쪽 수가 pages 인 PDF(쪽마다 A4, 300dpi 로 그리면 짧은 변 약 2480px) — 여러 쪽 시험(2026-09-29)."""
    from PIL import Image

    imgs = [Image.new("RGB", (w_pt, h_pt), (255, 255, 255 - i)) for i in range(pages)]
    buf = io.BytesIO()
    imgs[0].save(buf, format="PDF", save_all=True, append_images=imgs[1:], resolution=72.0)
    return buf.getvalue()


# ---------------------------------------------------------------------------- 가짜 엔진
@dataclass
class FakeEngineWorld:
    """엔진 쪽 함수의 가짜. 시험마다 판정·결과를 바꿔 쓴다."""

    structure: str = "pass"
    structure_seq: list[str] = field(default_factory=list)  # 부를 때마다 앞에서 하나씩(비면 structure) — 여러 쪽 시험
    type_mismatch: bool = False
    detected_type: str | None = None
    grade: str = "trust"
    note_count: float = 12.0
    # 엔진 이름 → 결과 목록(부를 때마다 앞에서 하나씩). 비면 성공
    results: dict[str, list[dict]] = field(default_factory=dict)
    calls: list[str] = field(default_factory=list)
    installed: dict[str, bool] = field(default_factory=dict)
    render_calls: list[tuple] = field(default_factory=list)
    render_fonts: list[list | None] = field(default_factory=list)  # mp3 호출마다 part_fonts(T150)
    render_presets: list[list | None] = field(default_factory=list)  # mp3 호출마다 part_presets(결정 C11)
    render_error: str | None = None
    render_delay: float = 0.0
    upload_real: bool = False


class _RenderError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class FakeAdapter:
    def __init__(self, world: FakeEngineWorld, row: dict) -> None:
        self.world = world
        self.name = row["model_name"]
        self.kind = row["kind"]

    def probe(self) -> dict:
        ok = self.world.installed.get(self.name, True)
        return {"installed": ok, "version": "fake-1.0" if ok else None, "detail": "fake"}

    async def warmup(self, timeout_s: float) -> None:
        await asyncio.sleep(0.01)

    async def recognize(self, image_path: str, deadline_monotonic: float):
        self.world.calls.append(self.name)
        assert Path(image_path).is_file()
        queue = self.world.results.get(self.name) or []
        spec = queue.pop(0) if queue else {"outcome": "success"}
        outcome = spec.get("outcome", "success")
        xml = spec.get("musicxml", make_musicxml()) if outcome == "success" else None
        extra = {"yulmyeong_ratio": 0.9, "jg_convert_ms": 15} if self.kind == "omr_jeongganbo" else {}
        return SimpleNamespace(outcome=outcome, failure_code=None if outcome == "success" else spec.get("code", "E"),
                               musicxml=xml, midi=None, engine_name=self.name, engine_version="fake-1.0",
                               confidence=0.8, duration_ms=5, extra=extra)


@pytest.fixture
def engines(monkeypatch) -> FakeEngineWorld:
    from app.services import engine_api

    world = FakeEngineWorld()

    def check_upload(files, *, score_type, require_score_type, **kw):
        _name, data = files[0]
        # PDF 는 진짜 검사(pypdfium2 변환)를 쓴다 — 2026-09-29 사진·PDF 입력.
        # 여러 파일(2026-09-29 여러 쪽: 사진 여러 장 · 섞기 · 11장)도 진짜 검사로 판정한다
        if world.upload_real or len(files) > 1 or data[:4] == b"%PDF":
            from app.checks.upload import check_upload as real

            return real(files, score_type=score_type, require_score_type=require_score_type, **kw)
        if data[:4] == b"\x89PNG":
            if require_score_type and score_type not in ("staff", "jeongganbo"):
                return SimpleNamespace(ok=False, code="UPLOAD_SCORE_TYPE_REQUIRED", kind="image", short_edge_px=900,
                                       details={})
            return SimpleNamespace(ok=True, code=None, kind="image", short_edge_px=900, details={})
        if data[:4] == b"MThd":
            return SimpleNamespace(ok=True, code=None, kind="midi", short_edge_px=None, details={})
        if b"<score-partwise" in data[:4096]:
            return SimpleNamespace(ok=True, code=None, kind="musicxml", short_edge_px=None, details={})
        return SimpleNamespace(ok=False, code="UPLOAD_UNSUPPORTED_TYPE", kind=None, short_edge_px=None, details={})

    def check_structure(image, chosen, threshold):
        verdict = world.structure_seq.pop(0) if world.structure_seq else world.structure
        return SimpleNamespace(verdict=verdict, type_mismatch=world.type_mismatch,
                               detected_type=world.detected_type, scores={"staff": 0.9, "jeongganbo": 0.1})

    def check_validity(musicxml, score_type, *, engine_confidence, caution_boundary, distrust_boundary,
                       yulmyeong_ratio=None):
        items = {"note_count": world.note_count, "beat_sum": 1.0, "range_leap": 0.1}
        if yulmyeong_ratio is not None:
            items["yulmyeong_ratio"] = yulmyeong_ratio
        return SimpleNamespace(grade=world.grade, items=items, score=0.8)

    def render_mp3(midi, sf2_paths, timeout_s, part_fonts=None, part_presets=None):
        world.render_calls.append(("mp3", len(midi), tuple(sf2_paths)))
        world.render_fonts.append(list(part_fonts) if part_fonts is not None else None)
        world.render_presets.append(list(part_presets) if part_presets is not None else None)
        if world.render_delay:
            import time

            time.sleep(world.render_delay)
        if world.render_error:
            raise _RenderError(world.render_error)
        return b"ID3FAKE-MP3" + midi[:16], "fluidsynth", "2.4-fake"

    def render_pdf(musicxml, timeout_s):
        world.render_calls.append(("pdf", len(musicxml)))
        if world.render_error:
            raise _RenderError(world.render_error)
        return b"%PDF-1.4 fake", "verovio", "6.0-fake"

    monkeypatch.setattr(engine_api, "check_upload", check_upload)
    monkeypatch.setattr(engine_api, "check_structure", check_structure)
    monkeypatch.setattr(engine_api, "check_validity", check_validity)
    monkeypatch.setattr(engine_api, "build_adapter", lambda row: FakeAdapter(world, row))
    monkeypatch.setattr(engine_api, "render_mp3", render_mp3)
    monkeypatch.setattr(engine_api, "render_pdf", render_pdf)
    monkeypatch.setattr(engine_api, "renderer_versions",
                        lambda: [{"name": "fluidsynth", "kind": "mp3", "installed": True, "version": "2.4-fake"}])
    return world


# ---------------------------------------------------------------------------- 가짜 Ollama
FORBIDDEN_OLLAMA = ("/api/pull", "/api/create", "/api/delete", "/api/copy", "/api/push", "/api/stop")


@dataclass
class FakeOllama:
    loaded: list[str] = field(default_factory=list)
    tags: list[dict] = field(default_factory=lambda: [
        {"name": "gemma3:4b", "size": 3_300_000_000, "digest": "a2af6cc3eb7f",
         "details": {"family": "gemma3", "parameter_size": "4.3B"}},
    ])
    chat_reply: Any = None
    unreachable: bool = False
    requests: list[tuple[str, str, dict | None]] = field(default_factory=list)
    on_generate: Callable[[], None] | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        self.requests.append((request.method, request.url.path, body))
        if self.unreachable:
            raise httpx.ConnectError("refused", request=request)
        path = request.url.path
        if path == "/api/version":
            return httpx.Response(200, json={"version": "0.34.0-test"})
        if path == "/api/tags":
            return httpx.Response(200, json={"models": self.tags})
        if path == "/api/ps":
            return httpx.Response(200, json={"models": [{"name": n, "model": n} for n in self.loaded]})
        if path == "/api/generate":
            if body["model"] not in [t["name"] for t in self.tags]:
                return httpx.Response(404, json={"error": "model not found"})
            if body["model"] not in self.loaded:
                self.loaded.append(body["model"])
            return httpx.Response(200, json={"model": body["model"], "response": "", "done": True})
        if path == "/api/chat":
            reply = self.chat_reply if self.chat_reply is not None else {"combinations": []}
            content = reply if isinstance(reply, str) else json.dumps(reply, ensure_ascii=False)
            return httpx.Response(200, json={"message": {"role": "assistant", "content": content}, "done": True})
        return httpx.Response(404, json={"error": "unknown"})

    def forbidden_calls(self) -> list[str]:
        return [p for _, p, _ in self.requests if p in FORBIDDEN_OLLAMA]


@pytest.fixture
def ollama() -> FakeOllama:
    return FakeOllama()


# ---------------------------------------------------------------------------- 앱
def _write_templates(assets: Path) -> None:
    (assets / "templates").mkdir(parents=True, exist_ok=True)
    xml = make_musicxml(["A4", "C5", "D5", "E5", "G5", "E5", "D5", "C5"], bpm=100, instrument_name="가야금")
    from app.services.scoreio import musicxml_to_midi

    # (2026-09-30 UC_02 BR-FBK-09) 종류별 대체 악보 — seeds/011 이 가리키는 파일 이름들
    for stem in ("gutgeori-v1", "arirang-semachi-v1", "minuet-g-v1", "jeongganbo-taryeong-gayageum-v1"):
        (assets / "templates" / f"{stem}.musicxml").write_text(xml, encoding="utf-8")
        (assets / "templates" / f"{stem}.mid").write_bytes(musicxml_to_midi(xml))


@pytest.fixture(scope="session")
def assets_dir(tmp_path_factory) -> Path:
    path = tmp_path_factory.mktemp("assets")
    _write_templates(path)
    return path


@pytest.fixture
async def app_client(test_db, base_cfg, engines, ollama, assets_dir, tmp_path):
    """앱 하나를 시험 DB 로 띄우고 httpx 클라이언트를 준다(수명 주기 포함, 백그라운드 순환은 끔)."""
    from app.config import load_config
    from app.main import create_app

    cfg = load_config(overrides={
        "db_name": TEST_DB, "storage_dir": tmp_path / "storage", "assets_dir": assets_dir,
        "warm_on_startup": False, "ollama_warm_on_startup": False, "service_api_key": SERVICE_KEY,
    })
    app = create_app(cfg, ollama_transport=httpx.MockTransport(ollama.handler), start_background=False)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            client.app = app  # type: ignore[attr-defined]
            yield client
    assert not ollama.forbidden_calls(), f"금지된 Ollama 호출: {ollama.forbidden_calls()}"


def svc_headers(**extra) -> dict:
    return {"X-API-Key": SERVICE_KEY, **extra}


def key_headers(raw: str, **extra) -> dict:
    return {"X-API-Key": raw, **extra}


async def wait_until(predicate: Callable[[], Any], timeout: float = 10.0, interval: float = 0.05):
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while True:
        value = predicate()
        if asyncio.iscoroutine(value):
            value = await value
        if value:
            return value
        if loop.time() > end:
            raise AssertionError("시간 안에 조건이 맞지 않음")
        await asyncio.sleep(interval)


def q(db, sql: str, args=None) -> list[dict]:
    with db.cursor() as cur:
        cur.execute(sql, args)
        return list(cur.fetchall())


def q1(db, sql: str, args=None) -> dict | None:
    rows = q(db, sql, args)
    return rows[0] if rows else None
