"""#30 정간보 엔진 어댑터 (MALerLab, MIT).

구조에서의 위치: recognize → 이 파일 → #24 공유 정간보 작업자 → 별도 변환 작업자.
기존 Python 3.8 엔진·가중치를 읽기 전용으로 재사용하고 MusicXML/MIDI를 반환한다.
DB·영속 파일은 저장하지 않으며 작업자에 서버 비밀값을 넘기지 않는다.
"""
import asyncio
import base64
import json
from pathlib import Path
import sys
import time

from app.engines.base import EngineResult, VenvEngine, run_subprocess
from app.resources.startup import worker_environment
from app.resources.worker import EngineWorker

RUNNER = Path(__file__).resolve().parents[1] / "resources/runners/jeongganbo_runner.py"
MODEL_API_DIR = Path(__file__).resolve().parents[2]


async def _request(worker, payload, deadline):
    while worker.busy():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        await asyncio.sleep(min(.05, remaining))
    return await worker.request(payload, deadline)


class JeongganboEngine(VenvEngine):
    default_folder = "jeongganbo"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.converter = EngineWorker(
            "jeongganbo-convert", [sys.executable, "-B", "-m", "app.resources.runners.jeongganbo_convert_runner"],
            cwd=str(MODEL_API_DIR), env=worker_environment())

    def entry(self):
        python = self.folder / ".venv/bin/python"
        return python if python.exists() and (self.folder / "repo/checkpoints/best/model.pt").exists() else None

    def _cmd(self, *args):
        return [str(self.folder / ".venv/bin/python"), "-B", str(RUNNER), "--repo", str(self.folder / "repo"),
                "--device", "cpu", *args]

    def worker_command(self):
        return self._cmd("--serve")

    def warmup_command(self):
        return self._cmd("--warmup")

    def worker_cwd(self):
        return str(self.folder / "repo")

    async def close(self):
        await super().close()
        await self.converter.stop()

    async def recognize(self, image_path: str, deadline_monotonic: float) -> EngineResult:
        started = time.monotonic()
        if self.entry() is None:
            return self._result("stopped", "NOT_INSTALLED", started)
        worker = self._get_worker()
        if worker:
            reply = await _request(worker, {"image": str(Path(image_path).resolve())}, deadline_monotonic)
            if reply is None or reply.timed_out or time.monotonic() >= deadline_monotonic:
                return self._result("timeout", "TIMEOUT", started)
            result = reply.data if reply.error is None else None
        else:
            proc = await run_subprocess(self._cmd(str(Path(image_path).resolve())),
                                        deadline_monotonic=deadline_monotonic, cwd=self.worker_cwd(), env=self.env())
            if proc.timed_out:
                return self._result("timeout", "TIMEOUT", started)
            result = None
            for line in reversed(proc.stdout.splitlines()):
                if line.startswith("@@RESULT@@ "):
                    try:
                        result = json.loads(line.removeprefix("@@RESULT@@ "))
                    except ValueError:
                        pass
                    break
        if not result or not result.get("ok"):
            return self._result("error", "ENGINE_ERROR", started)
        encoding = result.get("encoding") or ""
        confidence = result.get("confidence")
        if not encoding.strip():
            return self._result("no_notes", "NO_NOTES", started, confidence=confidence)
        converted_at = time.monotonic()
        reply = await _request(self.converter, {"encoding": encoding}, deadline_monotonic)
        extra = {"jg_convert_ms": round((time.monotonic() - converted_at) * 1000)}
        if reply is None or reply.timed_out or time.monotonic() >= deadline_monotonic:
            return self._result("timeout", "TIMEOUT", started, extra=extra)
        data = reply.data if reply.error is None else None
        if not data or not data.get("ok"):
            return self._result("convert_failed", "CONVERT_FAILED", started, confidence=confidence, extra=extra)
        try:
            xml = data["musicxml"]
            midi = base64.b64decode(data["midi_base64"], validate=True)
            extra["yulmyeong_ratio"] = float(data["yulmyeong_ratio"])
        except (KeyError, ValueError, TypeError):
            return self._result("convert_failed", "CONVERT_FAILED", started, extra=extra)
        return self._result("success", None, started, musicxml=xml, midi=midi, confidence=confidence, extra=extra)
