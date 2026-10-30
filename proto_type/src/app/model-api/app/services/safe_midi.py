"""MIDI 안전 변환 (2026-09-30 조성기 — 11:54·14:04 모델 API 멈춤 원인, SD_04 §8-1 · research R2).

MusicXML 은 엔진이 만든다. MIDI 는 여기서 MusicXML 로 만들되, 처리 루프가 아니라 **별도 프로세스 작업자**
(`engines/runners/midi_runner.py`, `engines/worker.py`)에서 시간 제한을 두고 만든다.

  ① 그대로 변환(NORMAL_S) → ② 넘기거나 실패하면 반복 기호를 일반 마디줄로 바꿔 다시(NO_REPEATS_S)
  → ③ 그래도 실패하면 None — 부르는 쪽은 MIDI 없이 MusicXML 만 준다.

작업자는 WORKERS 개를 돌려 쓴다(모두 쓰는 중이면 빌 때까지 기다린다). 시간을 넘긴 작업자는 끝내고 다음에 다시 띄운다.
"""

from __future__ import annotations

import asyncio
import logging
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from app.engines.worker import EngineWorker

log = logging.getLogger("model-api.safe_midi")
RUNNER = Path(__file__).resolve().parents[1] / "engines" / "runners" / "midi_runner.py"
MODEL_API_DIR = Path(__file__).resolve().parents[2]
NORMAL_S = 15.0
NO_REPEATS_S = 10.0
WORKERS = 2


@dataclass
class MidiResult:
    midi: bytes | None
    mode: str  # normal | no_repeats | failed
    detail: str = ""


class SafeMidi:
    def __init__(self, workers: int = WORKERS, normal_s: float = NORMAL_S, no_repeats_s: float = NO_REPEATS_S,
                 python: str | None = None) -> None:
        self.normal_s = normal_s
        self.no_repeats_s = no_repeats_s
        cmd = [python or sys.executable, "-B", str(RUNNER), "--serve"]
        self.workers = [EngineWorker(f"midi-{i}", cmd, cwd=str(MODEL_API_DIR), max_requests=200) for i in range(workers)]
        self._free: asyncio.Queue[EngineWorker] | None = None

    def _queue(self) -> asyncio.Queue[EngineWorker]:
        if self._free is None:
            self._free = asyncio.Queue()
            for w in self.workers:
                self._free.put_nowait(w)
        return self._free

    async def warm(self, timeout_s: float = 60.0) -> None:
        """기동 때 작업자를 미리 띄운다(music21 올리기). 실패해도 첫 요청 때 다시 띄운다."""
        for w in self.workers:
            try:
                await w.start(timeout_s)
            except Exception as exc:  # noqa: BLE001
                log.warning("MIDI 작업자 미리 띄우기 실패 %s: %s", w.name, exc)

    async def close(self) -> None:
        for w in self.workers:
            await w.stop()

    async def convert(self, musicxml: str, *, deadline_monotonic: float | None = None) -> MidiResult:
        q = self._queue()
        w = await q.get()
        try:
            with tempfile.TemporaryDirectory(prefix="gugak-midi-") as tmp:
                xml_path, out_path = Path(tmp) / "score.musicxml", Path(tmp) / "score.mid"
                xml_path.write_text(musicxml, encoding="utf-8")
                tried = []
                for mode, limit in (("normal", self.normal_s), ("no_repeats", self.no_repeats_s)):
                    end = time.monotonic() + limit
                    if deadline_monotonic is not None:
                        end = min(end, deadline_monotonic)
                    if end <= time.monotonic():
                        tried.append(f"{mode}:no_time")
                        break
                    reply = await w.request({"xml": str(xml_path), "out": str(out_path),
                                             "no_repeats": mode == "no_repeats"}, end)
                    if reply is None:  # 큐로 나눠 주므로 오지 않지만, 오면 다음 단계로
                        tried.append(f"{mode}:busy")
                        continue
                    if reply.data and reply.data.get("ok") and out_path.exists():
                        if mode != "normal":
                            log.warning("MIDI 반복 기호 빼고 변환 %s", ", ".join(tried))
                        return MidiResult(out_path.read_bytes(), mode, ";".join(tried))
                    why = "timeout" if reply.timed_out else (reply.error or (reply.data or {}).get("error") or "failed")
                    tried.append(f"{mode}:{str(why)[:80]}")
                log.warning("MIDI 변환 실패 — MusicXML 만 줌: %s", "; ".join(tried))
                return MidiResult(None, "failed", "; ".join(tried))
        finally:
            q.put_nowait(w)


_default: SafeMidi | None = None


def get_safe_midi() -> SafeMidi:
    global _default
    if _default is None:
        _default = SafeMidi()
    return _default


async def musicxml_to_midi_safe(musicxml: str, *, deadline_monotonic: float | None = None) -> bytes | None:
    """MIDI 또는 None(변환 실패 — MusicXML 만 준다)."""
    return (await get_safe_midi().convert(musicxml, deadline_monotonic=deadline_monotonic)).midi


async def close_safe_midi() -> None:
    global _default
    if _default is not None:
        await _default.close()
        _default = None
