"""엔진 어댑터(T039·T040) — 등록부 행 → 어댑터, 설치 안 됨, 시간 초과(프로세스 묶음 끊기), 음 없음, 정간보 흐름."""

import asyncio
import os
import sys
import time
from pathlib import Path

import pytest

from app.engines import base
from app.engines.base import EngineResult, VenvEngine, run_subprocess
from app.engines.jeongganbo import JeongganboEngine, _parse_result
from app.engines.registry import DEFAULT_ROWS, UnknownAdapterError, build_adapter

FIXTURE_XML = Path(__file__).resolve().parents[3] / "shared" / "fixtures" / "upload" / "ok.musicxml"


def test_build_adapter_from_rows(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ENGINES_DIR", str(tmp_path))
    for row in DEFAULT_ROWS:
        a = build_adapter(row)
        assert a.name == row["model_name"]
        assert str(a.folder).startswith(str(tmp_path))  # ENGINES_DIR 로 바꿔 끼움
    a = build_adapter({"model_name": "x", "provider": "venv", "provider_ref": "~/somewhere/x",
                       "config_json": {"adapter": "homr"}})
    assert a.folder == Path(os.path.expanduser("~/somewhere/x"))


@pytest.mark.parametrize("row", [
    {"model_name": "r", "provider": "builtin", "provider_ref": None, "config_json": '{"adapter":"rules"}'},
    {"model_name": "z", "provider": "venv", "provider_ref": "~/x", "config_json": '{"adapter":"nope"}'},
    {"model_name": "z", "provider": "venv", "provider_ref": "~/x", "config_json": "not json"},
])
def test_build_adapter_rejects(row) -> None:
    with pytest.raises(UnknownAdapterError):
        build_adapter(row)


async def test_not_installed_is_stopped(tmp_path) -> None:
    for row in DEFAULT_ROWS:
        a = build_adapter({**row, "provider_ref": str(tmp_path / "missing")})
        info = a.probe()
        assert info["installed"] is False and info["version"] is None
        r = await a.recognize(str(FIXTURE_XML), time.monotonic() + 5)
        assert (r.outcome, r.failure_code) == ("stopped", "NOT_INSTALLED")
        with pytest.raises(base.EngineWarmupError):
            await a.warmup(1)


async def test_subprocess_deadline_kills_group() -> None:
    # 자식이 손자를 띄워도 마감 시각에 묶음째 끝나야 한다
    code = "import subprocess,time; subprocess.Popen(['sleep','30']); time.sleep(30)"
    t0 = time.monotonic()
    r = await run_subprocess([sys.executable, "-c", code], deadline_monotonic=t0 + 0.7)
    assert r.timed_out
    assert time.monotonic() - t0 < 5


async def test_deadline_already_passed() -> None:
    r = await run_subprocess(["true"], deadline_monotonic=time.monotonic() - 1)
    assert r.timed_out and r.returncode is None


class FakeEngine(VenvEngine):
    """가짜 엔진: 파이썬 한 줄로 출력 폴더에 MusicXML 을 쓰거나 잠든다."""

    def __init__(self, folder: Path, script: str) -> None:
        super().__init__("fake", folder, {})
        self.script = script

    def entry(self):
        return Path(sys.executable)

    def probe(self) -> dict:
        return {"installed": True, "version": "0.0-test", "detail": ""}

    def build_command(self, image_path: Path, out_dir: Path) -> list[str]:
        return [sys.executable, "-c", self.script, str(image_path), str(out_dir)]

    def warmup_command(self) -> list[str]:
        return [sys.executable, "-c", "print('ok')"]


async def test_success_no_notes_timeout_error(tmp_path) -> None:
    img = tmp_path / "a.png"
    img.write_bytes(b"x")
    ok_xml = FIXTURE_XML.read_text(encoding="utf-8")
    write = "import sys,pathlib; pathlib.Path(sys.argv[2],'input.musicxml').write_text(open(sys.argv[3]).read())"

    ok = FakeEngine(tmp_path, write.replace("sys.argv[3]", repr(str(FIXTURE_XML))))
    r = await ok.recognize(str(img), time.monotonic() + 30)
    assert isinstance(r, EngineResult)
    assert r.outcome == "success" and r.failure_code is None
    assert r.midi and r.midi[:4] == b"MThd" and r.engine_version == "0.0-test"
    await ok.warmup(10)

    rest_xml = ok_xml.split("<note")[0] + "</part></score-partwise>"  # 음 없는 악보
    rest_file = tmp_path / "rest.musicxml"
    rest_file.write_text(rest_xml)
    r = await FakeEngine(tmp_path, write.replace("sys.argv[3]", repr(str(rest_file)))).recognize(
        str(img), time.monotonic() + 30)
    assert (r.outcome, r.failure_code) == ("no_notes", "NO_NOTES")

    r = await FakeEngine(tmp_path, "import time; time.sleep(30)").recognize(str(img), time.monotonic() + 0.5)
    assert (r.outcome, r.failure_code) == ("timeout", "TIMEOUT")

    r = await FakeEngine(tmp_path, "import sys; sys.exit(3)").recognize(str(img), time.monotonic() + 30)
    assert (r.outcome, r.failure_code) == ("error", "ENGINE_EXIT_3")


def test_jeongganbo_result_parse() -> None:
    assert _parse_result('noise\n@@RESULT@@ {"ok": true, "encoding": "황:5"}\n') == {"ok": True, "encoding": "황:5"}
    assert _parse_result("nothing") is None


async def test_jeongganbo_flow_with_fake_runner(tmp_path, monkeypatch) -> None:
    """가상환경 대신 가짜 실행기로 정간보 흐름(인코딩 → 변환 → yulmyeong_ratio)을 본다."""
    folder = tmp_path / "jeongganbo"
    (folder / "repo" / "checkpoints" / "best").mkdir(parents=True)
    (folder / "repo" / "checkpoints" / "best" / "model.pt").write_bytes(b"")
    (folder / ".venv" / "bin").mkdir(parents=True)
    py = folder / ".venv" / "bin" / "python"
    os.symlink(sys.executable, py)
    fake = tmp_path / "runner.py"
    fake.write_text(
        "import json,sys\nimg=sys.argv[-1]\n"
        "enc={'good':'황:5|태:5|중:5|-:5\\n임:5|남:5|청황:5|-:5','empty':'','bad':'리:5|로:5'}[open(img).read()]\n"
        "print('@@RESULT@@ '+json.dumps({'ok':True,'encoding':enc,'confidence':0.9,'jeonggans':8}))\n"
    )
    monkeypatch.setattr("app.engines.jeongganbo.RUNNER", fake)
    eng = JeongganboEngine("jeongganbo-omr", folder, {"device": "cpu"})
    assert eng.probe()["installed"]
    for kind, expect in [("good", "success"), ("empty", "no_notes"), ("bad", "convert_failed")]:
        img = tmp_path / f"{kind}.png"
        img.write_text(kind)
        r = await eng.recognize(str(img), time.monotonic() + 60)
        assert r.outcome == expect, (kind, r)
        if expect == "success":
            assert r.extra["yulmyeong_ratio"] == 1.0 and "jg_convert_ms" in r.extra
            assert r.confidence == 0.9 and r.midi[:4] == b"MThd"
        if expect == "convert_failed":
            assert r.failure_code == "CONVERT_FAILED"


def test_real_engines_probe_only() -> None:
    """설치된 실제 엔진은 probe 만 한다(판을 읽을 수 있어야 함). 설치 안 된 곳에서는 건너뛴다."""
    found = 0
    for row in DEFAULT_ROWS:
        info = build_adapter(row).probe()
        if info["installed"]:
            found += 1
            assert info["version"], row["model_name"]
    if found == 0:
        pytest.skip("~/gugak-engines 에 설치된 엔진이 없음")


def test_asyncio_available() -> None:
    assert asyncio.get_event_loop_policy() is not None

