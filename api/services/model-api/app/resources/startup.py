"""기동 시 실제 모델·음원을 로딩한다. 인식 HTTP 경로는 #29·#30에서 연결한다."""
import asyncio
import ctypes
import ctypes.util
import hashlib
import json
import logging
import os
from pathlib import Path
import time

from app.resources.worker import EngineWorker

log = logging.getLogger("model-api.resources")
RUNNERS = Path(__file__).with_name("runners")


def worker_environment():
    # 외부 엔진 프로세스에는 DB 비밀번호·API 키 등 서버 환경변수를 넘기지 않는다.
    allowed = ("PATH", "HOME", "LANG", "LC_ALL", "PYTHONDONTWRITEBYTECODE", "PYTHONUNBUFFERED",
               "XDG_CACHE_HOME", "MPLCONFIGDIR", "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS")
    return {key: os.environ[key] for key in allowed if key in os.environ}


class Soundfonts:
    def __init__(self):
        self.lib = None
        self.settings = None
        self.synth = None

    def load(self, folder: Path):
        self.lib = ctypes.CDLL(ctypes.util.find_library("fluidsynth") or "libfluidsynth.so.3")
        lib = self.lib
        lib.new_fluid_settings.restype = ctypes.c_void_p
        lib.new_fluid_synth.argtypes = [ctypes.c_void_p]
        lib.new_fluid_synth.restype = ctypes.c_void_p
        lib.fluid_synth_sfload.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
        lib.fluid_synth_sfload.restype = ctypes.c_int
        lib.delete_fluid_synth.argtypes = [ctypes.c_void_p]
        lib.delete_fluid_settings.argtypes = [ctypes.c_void_p]
        self.settings = lib.new_fluid_settings()
        if not self.settings:
            raise RuntimeError("FluidSynth 설정 생성 실패")
        self.synth = lib.new_fluid_synth(self.settings)
        if not self.synth:
            raise RuntimeError("FluidSynth 생성 실패")
        for name in ("FluidR3_GM.sf2", "gugak.sf2"):
            path = folder / name
            with path.open("rb") as stream:
                if stream.read(4) != b"RIFF":
                    raise ValueError("사운드폰트가 실제 SF2 파일이 아닙니다 (Git LFS 확인)")
            if lib.fluid_synth_sfload(self.synth, str(path).encode(), 0) < 0:
                raise RuntimeError("사운드폰트 로딩 실패")

    def close(self):
        if self.synth:
            self.lib.delete_fluid_synth(self.synth)
            self.synth = None
        if self.settings:
            self.lib.delete_fluid_settings(self.settings)
            self.settings = None


class Resources:
    def __init__(self, cfg, db):
        self.cfg, self.db = cfg, db
        self.entries = []
        self.workers = {}
        self.startup_done = False
        self.soundfonts_ready = False
        self.soundfonts = Soundfonts()
        self.rules_hash = hashlib.sha256(Path(__file__).with_name("rules.yaml").read_bytes()).hexdigest()[:12]

    async def start(self):
        Path("/tmp/model-api-ready").unlink(missing_ok=True)
        try:
            rows = await self.db.fetch_all("SELECT * FROM model_registry ORDER BY kind, model_name")
            for row in rows:
                entry = {"name": row["model_name"], "kind": row["kind"], "provider": row["provider"],
                         "installed": False, "version": None, "state": "unavailable", "enabled": bool(row["enabled"])}
                self.entries.append(entry)
                if not entry["enabled"]:
                    continue
                if row["provider"] == "builtin" and row["model_name"] == "rules":
                    entry.update(installed=True, state="ready", version=self.rules_hash)
                    continue
                options = json.loads(row.get("config_json") or "{}")
                adapter = options.get("adapter")
                if adapter not in ("homr", "jeongganbo") or row["provider"] != "venv":
                    continue  # Audiveris·Ollama는 이번 발표 기본 실행 대상이 아니다.
                await self._load_engine(entry, row, adapter)
            started = time.monotonic()
            try:
                # 대용량 음원 로딩 중에도 /health와 이벤트 루프가 응답한다.
                await asyncio.to_thread(self.soundfonts.load, self.cfg.soundfonts_dir)
                self.soundfonts_ready = True
            except Exception as exc:
                self.soundfonts.close()
                log.error("soundfonts_failed error_type=%s", type(exc).__name__)
            log.info("soundfonts_load duration_ms=%s ready=%s",
                     round((time.monotonic() - started) * 1000), self.soundfonts_ready)
        except Exception as exc:
            log.error("startup_resources_failed error_type=%s", type(exc).__name__)
        finally:
            self.startup_done = True
        if self.soundfonts_ready and not self.missing_kinds():
            Path("/tmp/model-api-ready").touch()

    async def _load_engine(self, entry, row, adapter):
        started = time.monotonic()
        folder = self.cfg.engines_dir / adapter
        # 기준 DB의 ~/gugak-engines 참조는 새 ENGINES_DIR 아래로 옮겨 해석한다.
        ref = row.get("provider_ref")
        if ref and not ref.startswith("~/gugak-engines/"):
            folder = Path(ref)
            if not folder.is_absolute():
                return
        elif ref:
            folder = self.cfg.engines_dir / ref.removeprefix("~/gugak-engines/")
        python = folder / ".venv/bin/python"
        worker = None
        try:
            entry["version"] = (folder / "VERSION").read_text().strip()
            if not python.exists() or not entry["version"]:
                raise FileNotFoundError("엔진 설치 누락")
            entry.update(installed=True, state="loading")
            cmd = [str(python), "-B", str(RUNNERS / f"{adapter}_runner.py")]
            cwd = None
            if adapter == "jeongganbo":
                cwd = str(folder / "repo")
                cmd += ["--repo", cwd, "--device", self.cfg.jeongganbo_device, "--serve"]
            worker = EngineWorker(entry["name"], cmd, cwd=cwd, env=worker_environment())
            await worker.start(self.cfg.model_load_timeout_s)
            self.workers[entry["name"]] = worker
            entry["state"] = "ready"
        except Exception as exc:
            if worker:
                await worker.stop()
            entry["state"] = "failed" if entry["installed"] else "unavailable"
            log.error("engine_failed model=%s error_type=%s", entry["name"], type(exc).__name__)
        log.info("engine_load model=%s duration_ms=%s state=%s", entry["name"],
                 round((time.monotonic() - started) * 1000), entry["state"])

    def snapshot(self):
        entries = [dict(entry) for entry in self.entries]
        for entry in entries:
            worker = self.workers.get(entry["name"])
            if worker and not worker.alive():
                entry["state"] = "failed"
        return entries

    def missing_kinds(self):
        entries = self.snapshot()
        return [kind for kind in ("omr_staff", "omr_jeongganbo") if not any(
            e["kind"] == kind and e["enabled"] and e["installed"] and e["state"] in ("ready", "cold")
            for e in entries)]

    async def close(self):
        Path("/tmp/model-api-ready").unlink(missing_ok=True)
        for worker in self.workers.values():
            await worker.stop()
        self.soundfonts.close()
