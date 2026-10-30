"""모델 등록부와 불러오기 상태 (003_model_registry · INTERFACES §6·§6-1·§7).

- 등록부 행은 DB(model_registry)에서, "지금 올라와 있는지"는 이 서버 메모리에서 관리한다.
- 상태: unavailable(설치 안 됨·서버 못 닿음) · cold(설치됨, 아직 안 올림) · loading · ready · failed.
- 불러오기(워밍업) 결과와 걸린 시간은 model_load_event 에 남기고, 예상 시간은 v_model_load_estimate 평균으로 낸다.
- venv 모델은 엔진 쪽 어댑터(app.engines.registry.build_adapter)로 probe·warmup,
  ollama 모델은 /api/ps(올라와 있으면 ready)·빈 generate(불러오기), builtin 은 늘 ready.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.config import Config
from app.db import Database, utcnow
from app.errors import ApiError
from app.models.ollama import OllamaClient, OllamaError
from app.services import engine_api

log = logging.getLogger("model-api.models")

OLLAMA_CACHE_S = 5.0
TAGS_CACHE_S = 60.0


@dataclass
class ModelEntry:
    model_name: str
    kind: str
    provider: str
    display_name: str
    provider_ref: str | None
    config: dict[str, Any]
    enabled: bool
    row: dict[str, Any]
    # 실행 중 상태(메모리)
    state: str = "cold"
    installed: bool = False
    version: str | None = None
    loaded_at: datetime | None = None
    last_load_ms: int | None = None
    error: str | None = None
    adapter: Any = None
    load_id: int | None = None
    load_started_at: datetime | None = None
    load_task: asyncio.Task | None = field(default=None, repr=False)

    @property
    def signature(self) -> tuple:
        return (self.kind, self.provider, self.provider_ref, json.dumps(self.config, sort_keys=True))

    @property
    def ollama_tag(self) -> str:
        ref = (self.provider_ref or "").strip()
        return ref if ":" in ref else f"{ref}:latest"


async def _close_adapter(entry: ModelEntry) -> None:
    close = getattr(entry.adapter, "close", None)
    if close is not None:
        try:
            await close()
        except Exception:
            log.exception("엔진 작업자 정리 실패 %s", entry.model_name)


def _entry_from_row(row: dict[str, Any]) -> ModelEntry:
    try:
        config = json.loads(row["config_json"]) if row.get("config_json") else {}
    except json.JSONDecodeError:
        config = {}
    return ModelEntry(
        model_name=row["model_name"], kind=row["kind"], provider=row["provider"],
        display_name=row["display_name"], provider_ref=row.get("provider_ref"), config=config,
        enabled=bool(row["enabled"]), row=dict(row),
    )


class ModelRegistry:
    def __init__(self, cfg: Config, db: Database | None, ollama: OllamaClient) -> None:
        self.cfg = cfg
        self.db = db
        self.ollama = ollama
        self.entries: dict[str, ModelEntry] = {}
        self.estimates: dict[str, dict[str, Any]] = {}
        self._ollama_checked = 0.0
        self._tags_checked = 0.0
        self._tags: dict[str, dict] = {}
        self.ollama_reachable: bool | None = None
        self.ollama_version: str | None = None
        self._tasks: set[asyncio.Task] = set()
        # 기동 때 데우기가 끝났는가 — 끝나기 전 /v1/health 는 503 loading (2026-09-30 API 점검 A4)
        self.startup_done = False

    # ------------------------------------------------------------------ 읽기
    def get(self, name: str) -> ModelEntry | None:
        return self.entries.get(name)

    def require(self, name: str) -> ModelEntry:
        entry = self.entries.get(name)
        if entry is None:
            raise ApiError("MODEL_NOT_FOUND", details={"model": name})
        return entry

    async def reload(self) -> list[str]:
        """등록부를 DB 에서 다시 읽는다. 바뀌지 않은 모델은 상태를 그대로 둔다. 새로 생기거나 바뀐 이름을 돌려준다."""
        assert self.db is not None
        rows = await self.db.fetch_all("SELECT * FROM model_registry ORDER BY kind, model_name")
        fresh: dict[str, ModelEntry] = {}
        changed: list[str] = []
        for row in rows:
            new = _entry_from_row(row)
            old = self.entries.get(new.model_name)
            if old is not None and old.signature == new.signature:
                # 이름·사용 여부 같은 표시 값만 새로 받는다
                old.display_name, old.enabled, old.row = new.display_name, new.enabled, new.row
                fresh[new.model_name] = old
            else:
                fresh[new.model_name] = new
                changed.append(new.model_name)
        for name, old in self.entries.items():  # 바뀌었거나 없어진 모델의 상주 작업자 정리(2026-09-30 C3)
            if fresh.get(name) is not old:
                await _close_adapter(old)
        self.entries = fresh
        for name in changed:
            await self.probe(self.entries[name])
        await self.refresh_estimates()
        return changed

    async def refresh_estimates(self) -> None:
        if self.db is None:
            return
        rows = await self.db.fetch_all("SELECT * FROM v_model_load_estimate")
        self.estimates = {r["model_name"]: r for r in rows}

    def expected_seconds(self, name: str) -> float | None:
        est = self.estimates.get(name) or {}
        if est.get("avg_load_ms") is not None:
            return round(float(est["avg_load_ms"]) / 1000.0, 1)
        entry = self.entries.get(name)
        if entry is None:
            return None
        if entry.provider == "builtin":
            return 0.0
        hint = entry.config.get("cold_start_hint_s", self.cfg.cold_start_hint_s)
        return float(hint) if hint is not None else None

    # ------------------------------------------------------------------ 확인(probe)
    async def probe(self, entry: ModelEntry) -> None:
        if entry.provider == "builtin":
            entry.installed, entry.state, entry.error = True, "ready", None
            entry.version = self._builtin_version(entry)
            return
        if entry.provider == "ollama":
            await self.refresh_ollama(force=True)
            return
        # venv: 엔진 쪽 어댑터가 설치 여부·버전을 알려 준다
        try:
            entry.adapter = entry.adapter or engine_api.build_adapter(dict(entry.row))
            info = await asyncio.to_thread(entry.adapter.probe)
        except engine_api.EngineModuleMissing as exc:
            entry.installed, entry.state, entry.error = False, "unavailable", f"어댑터 모듈 없음: {exc}"
            return
        except Exception as exc:  # noqa: BLE001
            entry.installed, entry.state, entry.error = False, "unavailable", f"확인 실패: {exc}"
            return
        entry.installed = bool(info.get("installed"))
        entry.version = info.get("version")
        if not entry.installed:
            entry.state, entry.error = "unavailable", info.get("detail") or "설치되지 않음"
        elif entry.state in ("unavailable",):
            entry.state, entry.error = "cold", None

    def _builtin_version(self, entry: ModelEntry) -> str:
        if entry.config.get("adapter", entry.model_name) == "rules":
            from app.recommend.rules import rules_hash

            return rules_hash()
        return "builtin"

    async def probe_all(self) -> None:
        for entry in list(self.entries.values()):
            if entry.provider != "ollama":
                await self.probe(entry)
        await self.refresh_ollama(force=True)

    async def refresh_ollama(self, *, force: bool = False) -> None:
        """/api/ps 에 있으면 ready, 없으면 cold. 서버를 못 닿으면 unavailable(OLLAMA_UNAVAILABLE)."""
        entries = [e for e in self.entries.values() if e.provider == "ollama"]
        now = time.monotonic()
        if not entries and not force:
            return
        if not force and now - self._ollama_checked < OLLAMA_CACHE_S:
            return
        self._ollama_checked = now
        try:
            if force or now - self._tags_checked > TAGS_CACHE_S or not self._tags:
                self._tags = {t.get("name") or t.get("model"): t for t in await self.ollama.tags()}
                self._tags_checked = now
                self.ollama_version = await self.ollama.version()
            loaded = {m.get("name") or m.get("model"): m for m in await self.ollama.ps()}
            self.ollama_reachable = True
        except OllamaError as exc:
            self.ollama_reachable = False
            for e in entries:
                if e.state != "loading":
                    e.state = "unavailable"
                e.error = f"OLLAMA_UNAVAILABLE: {exc}"
            return
        for e in entries:
            tag = e.ollama_tag
            info = self._tags.get(tag)
            e.installed = info is not None
            e.version = f"{tag}@{(info.get('digest') or '')[:8]}" if info else None
            if e.state == "loading":
                continue
            if not e.installed:
                e.state, e.error = "unavailable", f"공유 Ollama 서버에 '{tag}' 모델이 없음(사람이 ollama pull {tag})"
            elif tag in loaded:
                e.state, e.error = "ready", None
            elif e.state != "failed":
                e.state = "cold"

    # ------------------------------------------------------------------ 불러오기
    async def start_load(self, name: str, trigger: str, operator_id: int | None = None) -> tuple[int | None, float | None]:
        """불러오기를 백그라운드로 시작하고 (load_id, 예상 초)를 돌려준다. 이미 불러오는 중이면 그 load_id."""
        entry = self.require(name)
        expected = self.expected_seconds(name)
        if entry.state == "loading" and entry.load_task and not entry.load_task.done():
            return entry.load_id, expected
        load_id = None
        if self.db is not None:
            load_id = await self.db.execute(
                "INSERT INTO model_load_event (model_name, trigger_kind, operator_id, started_at, outcome) "
                "VALUES (%s, %s, %s, %s, 'running')",
                (name, trigger, operator_id, utcnow()),
            )
        entry.load_id = load_id
        entry.state, entry.error, entry.load_started_at = "loading", None, utcnow()
        task = asyncio.create_task(self._run_load(entry, load_id))
        entry.load_task = task
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return load_id, expected

    async def _run_load(self, entry: ModelEntry, load_id: int | None) -> None:
        timeout = float(entry.config.get("load_timeout_s", self.cfg.model_load_timeout_s))
        started = time.monotonic()
        outcome, error = "ok", None
        try:
            if entry.provider == "builtin":
                pass
            elif entry.provider == "ollama":
                await asyncio.wait_for(self.ollama.warmup(entry.ollama_tag), timeout=timeout)
            else:
                entry.adapter = entry.adapter or engine_api.build_adapter(dict(entry.row))
                await asyncio.wait_for(entry.adapter.warmup(timeout), timeout=timeout + 5)
        except TimeoutError:
            outcome, error = "timeout", f"{timeout:.0f}초 안에 불러오지 못함"
        except asyncio.CancelledError:
            outcome, error = "failed", "서버 종료로 중단"
            raise
        except Exception as exc:  # noqa: BLE001
            outcome, error = "failed", str(exc)[:480] or exc.__class__.__name__
        finally:
            elapsed_ms = int((time.monotonic() - started) * 1000)
            entry.load_started_at = None
            if outcome == "ok":
                entry.state, entry.loaded_at, entry.last_load_ms, entry.error = "ready", utcnow(), elapsed_ms, None
                if entry.provider == "ollama":
                    self._ollama_checked = 0.0  # 다음 조회 때 /api/ps 로 다시 확인
            else:
                # 설치가 안 된 모델은 실패가 아니라 '설치 안 됨'으로 보인다
                entry.state = "unavailable" if (entry.provider != "builtin" and not entry.installed) else "failed"
                entry.error = error
            await self._finish_event(load_id, outcome, error)

    async def _finish_event(self, load_id: int | None, outcome: str, error: str | None) -> None:
        if self.db is None or load_id is None:
            return
        try:
            await self.db.execute(
                "UPDATE model_load_event SET outcome = %s, finished_at = %s, error_text = %s WHERE load_id = %s",
                (outcome, utcnow(), error, load_id),
            )
            await self.refresh_estimates()
        except Exception:
            log.exception("model_load_event 마감 실패 load_id=%s", load_id)

    def begin_request_use(self, name: str) -> bool:
        """요청 처리 중 모델을 처음 부를 때. 콜드였으면 loading 으로 바꾸고 True(끝나면 기록한다)."""
        entry = self.entries.get(name)
        if entry is None or entry.state not in ("cold", "failed"):
            return False
        entry.state, entry.load_started_at = "loading", utcnow()
        return True

    async def end_request_use(self, name: str, started_at: datetime, ended_at: datetime, ok: bool,
                              error: str | None = None, timed_out: bool = False) -> None:
        """첫 호출이 끝나면 'request' 불러오기 기록을 남겨 예상 시간을 배우게 한다."""
        entry = self.entries.get(name)
        if entry is None:
            return
        outcome = "ok" if ok else ("timeout" if timed_out else "failed")
        entry.load_started_at = None
        if ok:
            entry.state, entry.loaded_at, entry.error = "ready", ended_at, None
            entry.last_load_ms = int((ended_at - started_at).total_seconds() * 1000)
        else:
            entry.state, entry.error = ("cold" if timed_out else "failed"), error
        if self.db is None:
            return
        try:
            await self.db.execute(
                "INSERT INTO model_load_event (model_name, trigger_kind, started_at, finished_at, outcome, error_text) "
                "VALUES (%s, 'request', %s, %s, %s, %s)",
                (name, started_at, max(ended_at, started_at), outcome,
                 None if ok else (error or outcome)[:480]),
            )
            await self.refresh_estimates()
        except Exception:
            log.exception("request 불러오기 기록 실패 %s", name)

    async def warm_on_startup(self) -> None:
        """서버 시작: 켜진 venv 모델을 하나씩 데운다. Ollama 는 설정이 있을 때만(공유 서버 배려)."""
        try:
            await self._warm_all()
        finally:
            self.startup_done = True

    async def _warm_all(self) -> None:
        for entry in list(self.entries.values()):
            if not entry.enabled or not entry.installed or entry.state == "ready":
                continue
            if entry.provider == "venv" and self.cfg.warm_on_startup or entry.provider == "ollama" and (self.cfg.ollama_warm_on_startup or entry.config.get("warm_on_startup")):
                pass
            else:
                continue
            await self.start_load(entry.model_name, "startup")
            task = entry.load_task
            if task is not None:
                await asyncio.gather(task, return_exceptions=True)  # 한 번에 하나씩(메모리 배려)

    async def shutdown(self) -> None:
        for entry in list(self.entries.values()):
            await _close_adapter(entry)
        for task in list(self._tasks):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)

    # ------------------------------------------------------------------ 응답 모양
    def public_view(self, entry: ModelEntry) -> dict[str, Any]:
        return {
            "name": entry.model_name,
            "display_name": entry.display_name,
            "kind": entry.kind,
            "provider": entry.provider,
            "provider_ref": entry.provider_ref,
            "enabled": entry.enabled,
            "installed": entry.installed,
            "version": entry.version,
            "state": entry.state,
            "loaded_at": entry.loaded_at.isoformat() + "Z" if entry.loaded_at else None,
            "last_load_ms": entry.last_load_ms,
            "expected_seconds": self.expected_seconds(entry.model_name),
            "load_started_at": entry.load_started_at.isoformat() + "Z"
            if entry.state == "loading" and entry.load_started_at else None,
            "elapsed_seconds": int((utcnow() - entry.load_started_at).total_seconds())
            if entry.state == "loading" and entry.load_started_at else None,
            "error": entry.error,
        }

    def missing_kinds(self, kinds: tuple[str, ...] = ("omr_staff", "omr_jeongganbo")) -> list[str]:
        """쓸 수 있는(준비됨·아직 안 데움) 켜진 엔진이 하나도 없는 인식 종류 — /v1/health unavailable 판정(A5)."""
        usable = {e.kind for e in self.entries.values() if e.enabled and e.installed and e.state in ("ready", "cold")}
        return [k for k in kinds if k not in usable]

    def ready_counts(self) -> tuple[int, int]:
        enabled = [e for e in self.entries.values() if e.enabled]
        return sum(1 for e in enabled if e.state == "ready"), len(enabled)
