"""처리 설정 판본 읽기 (T030, H5 · BR-OPS-02).

v_current_setting(마지막 판본) + setting_engine_order(staff·jeongganbo·recommend 순서).
요청은 접수 때의 스냅숏(Settings 객체)을 끝까지 쓴다 — 다시 읽어도 처리 중인 요청은 이전 값(UC10 E3).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.db import Database, utcnow


@dataclass(frozen=True)
class Settings:
    version_id: int
    timeout_seconds: int = 180
    max_concurrency_recognize: int = 2
    max_concurrency_render: int = 2
    web_concurrency_share: int = 1
    fallback_enabled: bool = True
    structure_threshold: float | None = None
    grade_caution_boundary: float | None = None
    grade_distrust_boundary: float | None = None
    score_file_max_bytes: int | None = None
    recommend_timeout_ms: int = 3000
    llm_recommend_timeout_ms: int = 20000
    engine_order: dict[str, list[str]] = field(default_factory=dict)

    def order(self, score_type: str) -> list[str]:
        return list(self.engine_order.get(score_type, []))


def _f(value) -> float | None:
    return float(value) if value is not None else None


class SettingsStore:
    def __init__(self, db: Database | None) -> None:
        self.db = db
        self._current: Settings | None = None

    @property
    def current(self) -> Settings:
        if self._current is None:
            # DB 를 못 읽었을 때의 안전값(research R17 임시값과 같다)
            return Settings(version_id=0, engine_order={"recommend": ["rules"]})
        return self._current

    async def load(self) -> Settings:
        assert self.db is not None
        row = await self.db.fetch_one("SELECT * FROM v_current_setting")
        if row is None:
            raise RuntimeError("processing_setting_version 에 판본이 없습니다 (seeds/001_initial.sql 을 넣어 주세요)")
        orders = await self.db.fetch_all(
            "SELECT score_type, engine_name FROM setting_engine_order WHERE setting_version_id = %s "
            "ORDER BY score_type, seq",
            (row["setting_version_id"],),
        )
        engine_order: dict[str, list[str]] = {}
        for o in orders:
            engine_order.setdefault(o["score_type"], []).append(o["engine_name"])
        rec = row.get("max_concurrency_recognize") or row.get("max_concurrency") or 2
        self._current = Settings(
            version_id=int(row["setting_version_id"]),
            timeout_seconds=int(row.get("timeout_seconds") or 180),
            max_concurrency_recognize=int(rec),
            max_concurrency_render=int(row.get("max_concurrency_render") or row.get("max_concurrency") or 2),
            web_concurrency_share=int(row.get("web_concurrency_share") or 1),
            fallback_enabled=bool(row.get("fallback_enabled", True)),
            structure_threshold=_f(row.get("structure_threshold")),
            grade_caution_boundary=_f(row.get("grade_caution_boundary")),
            grade_distrust_boundary=_f(row.get("grade_distrust_boundary")),
            score_file_max_bytes=int(row["score_file_max_bytes"]) if row.get("score_file_max_bytes") else None,
            recommend_timeout_ms=int(row.get("recommend_timeout_ms") or 3000),
            llm_recommend_timeout_ms=int(row.get("llm_recommend_timeout_ms") or 20000),
            engine_order=engine_order,
        )
        return self._current

    async def mark_applied(self) -> None:
        """UC10 E5: 모델 API 서버가 이 판본을 반영했다고 적는다."""
        if self.db is None or self._current is None:
            return
        await self.db.execute(
            "UPDATE processing_setting_version SET api_apply_status = 'applied', api_applied_at = %s "
            "WHERE setting_version_id = %s",
            (utcnow(), self._current.version_id),
        )
