"""렌더러 실행 파일 찾기·버전 읽기·하위 프로세스 실행(마감 시각에 프로세스 묶음째 끊기)."""

from __future__ import annotations

import glob
import os
import re
import shutil
import signal
import subprocess
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


def engines_dir() -> Path:
    return Path(os.path.expanduser(os.environ.get("ENGINES_DIR", "~/gugak-engines")))


def _first_executable(cands: list[str | None]) -> str | None:
    for c in cands:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return None


def find_fluidsynth() -> str | None:
    """FLUIDSYNTH_BIN → PATH → ~/gugak-engines/render/bin (팀이 받아 둔 conda 판)."""
    return _first_executable(
        [
            os.environ.get("FLUIDSYNTH_BIN"),
            shutil.which("fluidsynth"),
            "/opt/homebrew/bin/fluidsynth",
            str(engines_dir() / "render" / "bin" / "fluidsynth"),
        ]
    )


def find_lame() -> str | None:
    return _first_executable(
        [
            os.environ.get("LAME_BIN"),
            shutil.which("lame"),
            "/opt/homebrew/bin/lame",
            str(engines_dir() / "render" / "bin" / "lame"),
        ]
    )


def find_musescore() -> str | None:
    """MSCORE_BIN → PATH(mscore·mscore4·musescore) → /Applications/MuseScore*.app."""
    cands: list[str | None] = [os.environ.get("MSCORE_BIN")]
    for name in ("mscore", "mscore4", "mscore3", "musescore", "musescore4"):
        cands.append(shutil.which(name))
    for app in sorted(glob.glob("/Applications/MuseScore*.app"), reverse=True):
        cands.append(os.path.join(app, "Contents", "MacOS", "mscore"))
    return _first_executable(cands)


@lru_cache(maxsize=16)
def tool_version(path: str, pattern: str = r"(\d+\.\d+(?:\.\d+)?)") -> str | None:
    """`<도구> --version` 첫 번째 판 번호. 못 읽으면 None."""
    try:
        out = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=20, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(pattern, (out.stdout or "") + (out.stderr or ""))
    return m.group(1) if m else None


@dataclass
class ProcOutcome:
    returncode: int | None
    stdout: str
    stderr: str
    timed_out: bool
    duration_ms: int


def run_until(cmd: list[str], deadline_monotonic: float, cwd: str | None = None) -> ProcOutcome:
    """동기 실행. 마감 시각이 지나면 프로세스 묶음(process group)째 SIGKILL."""
    t0 = time.monotonic()
    remaining = deadline_monotonic - t0
    if remaining <= 0:
        return ProcOutcome(None, "", "deadline passed before start", True, 0)
    proc = subprocess.Popen(
        cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True
    )
    try:
        out, err = proc.communicate(timeout=remaining)
        return ProcOutcome(proc.returncode, out, err, False, int((time.monotonic() - t0) * 1000))
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        out, err = proc.communicate()
        return ProcOutcome(proc.returncode, out or "", err or "", True, int((time.monotonic() - t0) * 1000))
