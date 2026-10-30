"""인식 엔진 어댑터 공통 (T039, research R2).

엔진은 각자 가상환경(~/gugak-engines/<이름>)에 있고, 여기서는 **하위 프로세스로만** 부른다.
- (2026-09-30 C2·C3) worker_command() 가 있는 엔진은 상주 작업자(engines/worker.py)로 모델을 한 번만 올린다.
  작업자가 쓰는 중이거나 고장이면 예전처럼 한 번짜리 하위 프로세스로 처리한다. 설정 config.worker=false 면 상주하지 않는다.
- 마감 시각(deadline_monotonic)이 되면 프로세스 묶음째 SIGKILL → outcome 'timeout'
- 가상환경이 없으면 probe installed=False, recognize → outcome 'stopped' / failure_code 'NOT_INSTALLED'
- 음표가 하나도 없으면 'no_notes'
결과는 늘 MusicXML + MIDI 로 정리하고 engine_name·engine_version 을 붙인다(FR-009·FR-010).
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import signal
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable

from app.engines.worker import EngineWorker, WorkerStartError

log = logging.getLogger("model-api.engines")

OUTCOMES = ("success", "error", "timeout", "stopped", "no_notes", "convert_failed")
VERSION_MAX = 40  # engine_attempt.engine_version VARCHAR(40)


@dataclass
class EngineResult:
    outcome: str  # success|error|timeout|stopped|no_notes|convert_failed (engine_attempt.outcome)
    failure_code: str | None
    musicxml: str | None
    midi: bytes | None
    engine_name: str
    engine_version: str
    confidence: float | None
    duration_ms: int
    extra: dict = field(default_factory=dict)  # 정간보: {'yulmyeong_ratio': float, 'jg_convert_ms': int}


@runtime_checkable
class EngineAdapter(Protocol):
    name: str  # model_registry.model_name

    def probe(self) -> dict: ...  # {'installed': bool, 'version': str|None, 'detail': str}

    async def warmup(self, timeout_s: float) -> None: ...  # 가벼운 시험 실행. 실패하면 예외

    async def recognize(self, image_path: str, deadline_monotonic: float) -> EngineResult: ...


class EngineWarmupError(RuntimeError):
    """불러오기(워밍업) 실패 — 코어가 model_load_event 에 error_text 로 남긴다."""


@dataclass
class ProcResult:
    returncode: int | None
    stdout: str
    stderr: str
    timed_out: bool
    duration_ms: int


async def run_subprocess(
    cmd: list[str], *, deadline_monotonic: float, cwd: str | None = None, env: dict[str, str] | None = None
) -> ProcResult:
    """비동기 하위 프로세스. 새 세션으로 띄워 마감 시각에 자식까지 한꺼번에 끝낸다."""
    t0 = time.monotonic()
    remaining = deadline_monotonic - t0
    if remaining <= 0:
        return ProcResult(None, "", "deadline passed before start", True, 0)
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=remaining)
        timed_out = False
    except (TimeoutError, asyncio.CancelledError) as exc:
        _kill_group(proc.pid)
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=5)
        # 이미 죽인 프로세스의 출력 수거 실패는 무시
        except Exception:  # noqa: BLE001
            out, err = b"", b""
        if isinstance(exc, asyncio.CancelledError):
            raise
        timed_out = True
    return ProcResult(
        proc.returncode,
        out.decode("utf-8", errors="replace"),
        err.decode("utf-8", errors="replace"),
        timed_out,
        int((time.monotonic() - t0) * 1000),
    )


def _kill_group(pid: int) -> None:
    try:
        os.killpg(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def engines_dir() -> Path:
    return Path(os.path.expanduser(os.environ.get("ENGINES_DIR", "~/gugak-engines")))


def resolve_ref(provider_ref: str | None, default_name: str) -> Path:
    """provider_ref(~ 허용) → 엔진 폴더. ENGINES_DIR 이 있으면 '~/gugak-engines/' 앞부분을 바꿔 끼운다."""
    if not provider_ref:
        return engines_dir() / default_name
    ref = provider_ref.strip()
    if "ENGINES_DIR" in os.environ and ref.startswith("~/gugak-engines/"):
        return engines_dir() / ref[len("~/gugak-engines/"):]
    return Path(os.path.expanduser(ref))


def venv_python(folder: Path) -> Path | None:
    """엔진 폴더 안의 파이썬: <폴더>/.venv/bin/python, 폴더 자체가 가상환경이면 <폴더>/bin/python."""
    for cand in (folder / ".venv" / "bin" / "python", folder / "bin" / "python"):
        if cand.exists():
            return cand
    return None


def read_version_stamp(folder: Path) -> str | None:
    """설치 스크립트가 쓴 VERSION 첫 줄."""
    p = folder / "VERSION"
    try:
        line = p.read_text(encoding="utf-8").strip().splitlines()[0].strip()
        return line[:VERSION_MAX] or None
    except (OSError, IndexError):
        return None


def pip_version(python: Path, dist: str) -> str | None:
    """그 가상환경의 꾸러미 판(importlib.metadata). 가져오기 없이 메타데이터만 읽는다."""
    try:
        r = subprocess.run(
            [str(python), "-c", f"import importlib.metadata as m; print(m.version({dist!r}))"],
            capture_output=True, text=True, timeout=30, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    v = r.stdout.strip()
    return v[:VERSION_MAX] if r.returncode == 0 and v else None


def count_notes(musicxml: str) -> int:
    """음(쉼표 제외) 개수. 읽지 못하면 0."""
    try:
        from music21 import converter

        s = converter.parseData(musicxml, format="musicxml")
        return sum(len(n.pitches) for n in s.recurse().notes)
    # 엔진 출력이 이상하면 음 0개로 본다
    except Exception:  # noqa: BLE001
        return 0


def musicxml_to_midi(musicxml: str) -> bytes:
    from music21 import converter
    from music21.midi.translate import streamToMidiFile

    s = converter.parseData(musicxml, format="musicxml")
    return bytes(streamToMidiFile(s).writestr())


def read_musicxml_file(path: Path) -> str:
    """.musicxml/.xml 은 그대로, .mxl 은 압축을 풀어 본문 XML 을 꺼낸다."""
    data = path.read_bytes()
    if path.suffix.lower() == ".mxl" or data[:4] == b"PK\x03\x04":
        from app.checks.upload import _read_mxl

        xml = _read_mxl(data)
        if not xml:
            raise ValueError("mxl 을 풀 수 없음")
        data = xml
    return data.decode("utf-8", errors="replace")


def find_output(folder: Path, stem: str | None = None) -> Path | None:
    """엔진이 만든 MusicXML 찾기(.musicxml > .xml > .mxl, 이름이 같은 것 먼저, 새것 먼저)."""
    cands = [p for p in folder.rglob("*") if p.suffix.lower() in (".musicxml", ".mxl", ".xml") and p.is_file()]
    cands = [p for p in cands if p.parent.name != "META-INF"]
    if not cands:
        return None
    rank = {".musicxml": 0, ".xml": 1, ".mxl": 2}
    cands.sort(key=lambda p: (0 if stem and p.stem.startswith(stem) else 1, rank[p.suffix.lower()], -p.stat().st_mtime))
    return cands[0]


class VenvEngine:
    """가상환경 하나에서 명령 한 번으로 MusicXML 을 내는 엔진의 공통 틀(homr·audiveris)."""

    name: str = "engine"
    dist_name: str = ""  # pip 꾸러미 이름(판 읽기용)
    default_folder: str = ""

    def __init__(self, name: str, folder: Path, config: dict | None = None) -> None:
        self.name = name
        self.folder = folder
        self.config = config or {}
        self._version: str | None = None
        self.worker: EngineWorker | None = None

    # ── 설치 확인 ──
    def entry(self) -> Path | None:
        """실행에 필요한 것(파이썬 등). 없으면 None = 설치 안 됨."""
        return venv_python(self.folder)

    def probe(self) -> dict:
        entry = self.entry()
        if entry is None:
            return {"installed": False, "version": None, "detail": f"설치 안 됨: {self.folder}"}
        if self._version is None:
            self._version = read_version_stamp(self.folder)
            if self._version is None and self.dist_name:
                py = venv_python(self.folder)
                self._version = pip_version(py, self.dist_name) if py else None
        return {"installed": True, "version": self._version, "detail": str(entry)}

    def version(self) -> str:
        return (self.probe().get("version") or "unknown")[:VERSION_MAX]

    # ── 하위 클래스가 채운다 ──
    def build_command(self, image_path: Path, out_dir: Path) -> list[str]:
        raise NotImplementedError

    def warmup_command(self) -> list[str]:
        raise NotImplementedError

    def env(self) -> dict[str, str] | None:
        return None

    # ── 상주 작업자 (2026-09-30 C2·C3) ──
    def worker_command(self) -> list[str] | None:
        """상주 작업자 명령. None 이면 상주하지 않는다(Audiveris 등)."""
        return None

    def worker_cwd(self) -> str:
        return str(self.folder)

    def _get_worker(self) -> EngineWorker | None:
        if self.config.get("worker") is False or self.entry() is None:
            return None
        if self.worker is None:
            cmd = self.worker_command()
            if not cmd:
                return None
            self.worker = EngineWorker(self.name, cmd, cwd=self.worker_cwd(), env=self.env(),
                                       max_requests=int(self.config.get("worker_max_requests", 100)))
        return self.worker

    async def close(self) -> None:
        """작업자 정리(서버 종료·등록부 교체 때)."""
        if self.worker is not None:
            await self.worker.stop()

    async def _start_worker(self, timeout_s: float) -> bool:
        """데우기 = 작업자 기동. 작업자가 없는 엔진이면 False."""
        w = self._get_worker()
        if w is None:
            return False
        try:
            await w.start(timeout_s)
        except WorkerStartError as exc:
            raise EngineWarmupError(str(exc)) from exc
        return True

    async def _execute(self, img: Path, out_dir: Path, work: Path, deadline_monotonic: float) -> ProcResult:
        """엔진 한 번 실행. 작업자가 있으면 작업자로, 바쁘거나 고장이면 한 번짜리 하위 프로세스로."""
        w = self._get_worker()
        if w is not None:
            reply = await w.request({"image": str(img)}, deadline_monotonic)
            if reply is not None and reply.timed_out:
                return ProcResult(None, "", reply.stderr_tail, True, reply.duration_ms)
            if reply is not None and reply.error is None and reply.data is not None:
                ok = bool(reply.data.get("ok"))
                return ProcResult(0 if ok else 1, "", str(reply.data.get("error") or reply.stderr_tail),
                                  False, reply.duration_ms)
            if reply is not None:
                log.warning("worker_failed name=%s error=%s — 한 번짜리로 처리", self.name, reply.error)
        return await run_subprocess(self.build_command(img, out_dir), deadline_monotonic=deadline_monotonic,
                                    cwd=str(work), env=self.env())

    # ── 공통 흐름 ──
    def _result(self, outcome: str, code: str | None, t0: float, **kw) -> EngineResult:
        return EngineResult(
            outcome=outcome, failure_code=code, musicxml=kw.get("musicxml"), midi=kw.get("midi"),
            engine_name=self.name, engine_version=self.version() if self.entry() else "not-installed",
            confidence=kw.get("confidence"), duration_ms=int((time.monotonic() - t0) * 1000),
            extra=kw.get("extra", {}),
        )

    async def warmup(self, timeout_s: float) -> None:
        if self.entry() is None:
            raise EngineWarmupError(f"{self.name}: 설치 안 됨({self.folder})")
        if await self._start_worker(timeout_s):
            return
        r = await run_subprocess(self.warmup_command(), deadline_monotonic=time.monotonic() + timeout_s,
                                 cwd=str(self.folder), env=self.env())
        if r.timed_out:
            raise EngineWarmupError(f"{self.name}: 불러오기 시간 초과({timeout_s:.0f}s)")
        if r.returncode != 0:
            raise EngineWarmupError(f"{self.name}: 불러오기 실패 rc={r.returncode} {r.stderr.strip()[-300:]}")

    async def recognize(self, image_path: str, deadline_monotonic: float) -> EngineResult:
        t0 = time.monotonic()
        if self.entry() is None:
            return self._result("stopped", "NOT_INSTALLED", t0)
        with tempfile.TemporaryDirectory(prefix=f"gugak-{self.name}-") as tmp:
            work = Path(tmp)
            src = Path(image_path)
            img = work / ("input" + src.suffix.lower())
            shutil.copyfile(src, img)
            out_dir = work / "out"
            out_dir.mkdir()
            r = await self._execute(img, out_dir, work, deadline_monotonic)
            if r.timed_out:
                return self._result("timeout", "TIMEOUT", t0)
            out = find_output(work, stem="input")
            if r.returncode != 0 and out is None:
                return self._result("error", f"ENGINE_EXIT_{r.returncode}", t0,
                                    extra={"stderr_tail": r.stderr.strip()[-500:]})
            if out is None:
                return self._result("error", "NO_OUTPUT", t0, extra={"stderr_tail": r.stderr.strip()[-500:]})
            try:
                xml = read_musicxml_file(out)
            # 엔진 출력 파일 문제는 모두 error 로 기록
            except Exception as e:  # noqa: BLE001
                return self._result("error", "OUTPUT_UNREADABLE", t0, extra={"error": str(e)[:300]})
        # 음표 세기·MIDI 는 처리 루프 밖에서(2026-09-30 MIDI 안전 변환 — SD_04 §8-1). MIDI 는 별도 프로세스·시간 제한,
        # 실패해도 인식은 성공이고 MIDI 만 없다(MusicXML 만 준다)
        if await asyncio.to_thread(count_notes, xml) == 0:
            return self._result("no_notes", "NO_NOTES", t0, musicxml=xml)
        from app.services.safe_midi import get_safe_midi

        conv = await get_safe_midi().convert(xml, deadline_monotonic=deadline_monotonic)
        extra = {} if conv.midi else {"midi_unavailable": conv.detail[:300]}
        if conv.mode == "no_repeats":
            extra["midi_mode"] = "no_repeats"
        return self._result("success", None, t0, musicxml=xml, midi=conv.midi, extra=extra)
