"""jeongganbo-omr 어댑터 (정간보, MALerLab, MIT). T040

가상환경(Python 3.8)에서 runners/jeongganbo_runner.py 를 돌려 정간보 인코딩을 받고,
직접 구현한 변환기(jeongganbo_convert)로 MusicXML·MIDI 를 만든다. 변환 실패 → 'convert_failed'.
폴더 구성(install_jeongganbo.sh): <폴더>/.venv, <폴더>/repo(저장소 + checkpoints/best).
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

from app.engines.base import EngineResult, EngineWarmupError, VenvEngine, run_subprocess
from app.engines.jeongganbo_convert import ConvertError, convert

RUNNER = Path(__file__).resolve().parent / "runners" / "jeongganbo_runner.py"
MARK = "@@RESULT@@ "


def _parse_result(stdout: str) -> dict | None:
    for line in reversed(stdout.splitlines()):
        if line.startswith(MARK):
            try:
                return json.loads(line[len(MARK):])
            except json.JSONDecodeError:
                return None
    return None


class JeongganboEngine(VenvEngine):
    dist_name = ""
    default_folder = "jeongganbo"

    def _python(self) -> Path:
        return self.folder / ".venv" / "bin" / "python"

    def _repo(self) -> Path:
        return self.folder / "repo"

    def entry(self) -> Path | None:
        ok = self._python().exists() and (self._repo() / "checkpoints" / "best" / "model.pt").exists()
        return self._python() if ok else None

    def _cmd(self, *extra: str) -> list[str]:
        return [str(self._python()), "-B", str(RUNNER), "--repo", str(self._repo()),
                "--device", str(self.config.get("device", "cpu")), *extra]

    def warmup_command(self) -> list[str]:
        return self._cmd("--warmup")

    def worker_command(self) -> list[str] | None:
        return self._cmd("--serve")  # 상주 작업자(2026-09-30 C2·C3)

    def worker_cwd(self) -> str:
        return str(self._repo())

    async def warmup(self, timeout_s: float) -> None:
        if self.entry() is None:
            raise EngineWarmupError(f"{self.name}: 설치 안 됨({self.folder})")
        if await self._start_worker(timeout_s):
            return
        r = await run_subprocess(self.warmup_command(), deadline_monotonic=time.monotonic() + timeout_s,
                                 cwd=str(self._repo()))
        res = _parse_result(r.stdout)
        if r.timed_out:
            raise EngineWarmupError(f"{self.name}: 불러오기 시간 초과({timeout_s:.0f}s)")
        if r.returncode != 0 or not res or not res.get("ok"):
            raise EngineWarmupError(f"{self.name}: 불러오기 실패 {(res or {}).get('error') or r.stderr[-300:]}")

    async def recognize(self, image_path: str, deadline_monotonic: float) -> EngineResult:
        t0 = time.monotonic()
        if self.entry() is None:
            return self._result("stopped", "NOT_INSTALLED", t0)
        res = None
        w = self._get_worker()
        reply = await w.request({"image": str(Path(image_path).resolve())}, deadline_monotonic) if w else None
        if reply is not None and reply.timed_out:
            return self._result("timeout", "TIMEOUT", t0)
        if reply is not None and reply.error is None:
            res = reply.data
        else:  # 작업자가 없거나 쓰는 중이거나 고장이면 한 번짜리 하위 프로세스
            r = await run_subprocess(self._cmd(str(Path(image_path).resolve())),
                                     deadline_monotonic=deadline_monotonic, cwd=str(self._repo()))
            if r.timed_out:
                return self._result("timeout", "TIMEOUT", t0)
            res = _parse_result(r.stdout)
            if res is None:
                return self._result("error", f"ENGINE_EXIT_{r.returncode}", t0,
                                    extra={"stderr_tail": r.stderr[-500:]})
        if not res.get("ok"):
            return self._result("error", "ENGINE_ERROR", t0, extra={"error": str(res.get("error"))[:300]})
        encoding = res.get("encoding") or ""
        conf = res.get("confidence")
        extra: dict = {"jeonggans": res.get("jeonggans"), "scale": res.get("scale"), "encoding": encoding}
        if not encoding.strip():
            return self._result("no_notes", "NO_NOTES", t0, confidence=conf, extra=extra)
        c0 = time.monotonic()
        try:
            # 변환기(음 계산·music21)는 처리 루프 밖에서(2026-09-30 SD_04 §8-1)
            xml, midi, ratio = await asyncio.to_thread(convert, encoding)
        except ConvertError as e:
            extra.update(jg_convert_ms=int((time.monotonic() - c0) * 1000), error=str(e)[:300])
            return self._result("convert_failed", "CONVERT_FAILED", t0, confidence=conf, extra=extra)
        extra.update(yulmyeong_ratio=ratio, jg_convert_ms=int((time.monotonic() - c0) * 1000))
        return self._result("success", None, t0, musicxml=xml, midi=midi, confidence=conf, extra=extra)
