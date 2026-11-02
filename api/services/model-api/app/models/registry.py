"""#29·#30 모델 등록부: 인식·상태 라우터 → 이 파일 → DB 등록 정보·#24 공유 작업자.

작업자·상태는 메모리에서 재사용하고 예상 시간은 DB 로딩 이력에서 읽는다.
"""
from dataclasses import dataclass
from datetime import datetime
import json

from app.engines.registry import build_adapter


@dataclass
class ModelEntry:
    model_name: str
    kind: str
    provider: str
    enabled: bool
    installed: bool
    state: str
    version: str | None
    row: dict
    adapter: object = None


class ModelRegistry:
    def __init__(self, cfg, db, resources):
        self.cfg, self.db, self.resources = cfg, db, resources
        self.entries = {}
        self.estimates = {}

    def get(self, name):
        snapshot = next((e for e in self.resources.snapshot() if e["name"] == name), None)
        if snapshot is None:
            return None
        row = dict(getattr(self.resources, "model_rows", {}).get(name, {}))
        row.setdefault("model_name", name)
        row.setdefault("kind", snapshot["kind"])
        row.setdefault("provider", snapshot["provider"])
        entry = self.entries.get(name)
        if entry is None:
            entry = ModelEntry(name, row["kind"], row["provider"], bool(snapshot["enabled"]),
                               bool(snapshot["installed"]), snapshot["state"], snapshot["version"], row)
            self.entries[name] = entry
        entry.enabled, entry.installed = bool(snapshot["enabled"]), bool(snapshot["installed"])
        entry.state, entry.version, entry.row = snapshot["state"], snapshot["version"], row
        if entry.adapter is None and entry.installed and entry.kind in ("omr_staff", "omr_jeongganbo") and entry.provider == "venv":
            try:
                entry.adapter = build_adapter(row, engines_dir=self.cfg.engines_dir)
            except ValueError:
                pass
        if entry.adapter is not None:
            # 기동 때 올린 모델을 재사용한다. 별도 모델 프로세스를 중복 생성하지 않는다.
            entry.adapter.worker = getattr(self.resources, "workers", {}).get(name) or entry.adapter.worker
        return entry

    def begin_request_use(self, name):
        entry = self.get(name)
        return bool(entry and entry.state not in ("ready", "loading"))

    async def end_request_use(self, name, started, ended, *, ok, error=None, timed_out=False):
        for item in self.resources.entries:
            if item["name"] == name:
                item["state"] = "ready" if ok else "failed"

    async def refresh_estimates(self):
        try:
            rows = await self.db.fetch_all("SELECT * FROM v_model_load_estimate")
            self.estimates = {row["model_name"]: row for row in rows}
        except Exception:
            pass  # 현재 작업자 상태는 계속 제공하며 DB 실패는 health에서 별도로 표시한다.

    def public_view(self, entry):
        row = entry.row
        try:
            options = json.loads(row.get("config_json") or "{}")
        except (TypeError, ValueError):
            options = {}
        info = getattr(self.resources, "load_info", {}).get(entry.model_name, {})
        estimate = self.estimates.get(entry.model_name, {}).get("avg_load_ms")
        expected = round(float(estimate) / 1000, 1) if estimate is not None else options.get("cold_start_hint_s", 30)
        if entry.provider == "builtin":
            expected = 0
        started = info.get("started_at") if entry.state == "loading" else None
        elapsed = max(0, int((datetime.utcnow() - started).total_seconds())) if started else None
        return {
            "name": entry.model_name, "display_name": row.get("display_name", entry.model_name),
            "kind": entry.kind, "provider": entry.provider, "provider_ref": row.get("provider_ref"),
            "enabled": entry.enabled, "installed": entry.installed, "version": entry.version,
            "state": entry.state, "loaded_at": info.get("loaded_at"), "last_load_ms": info.get("last_load_ms"),
            "expected_seconds": expected, "load_started_at": started.isoformat() + "Z" if started else None,
            "elapsed_seconds": elapsed, "error": info.get("error"),
        }

    async def public_models(self):
        await self.refresh_estimates()
        return [self.public_view(self.get(e["name"])) for e in self.resources.snapshot()]

    async def close(self):
        for entry in self.entries.values():
            if entry.adapter is not None:
                await entry.adapter.close()
