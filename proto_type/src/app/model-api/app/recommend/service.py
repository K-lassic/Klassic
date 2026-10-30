"""추천 순서 걷기와 기록 (T089, FR-007·FR-008 · BR-REC-01 · INTERFACES §6).

설정의 추천 순서(setting_engine_order score_type='recommend')대로 모델을 부른다.
- ollama 모델이 ready 가 아니면 기다리지 않고 건너뛴다 → pending:true + 백그라운드 불러오기 시작.
- ready 인 LLM 은 llm_recommend_timeout_ms, 규칙표는 recommend_timeout_ms 안에 답해야 한다.
- 순서 끝에는 늘 규칙표(rules)가 있다(순서에 없으면 붙인다).
- 실패해도 오류가 아니다: available:false + reason RECOMMEND_UNAVAILABLE(UC12 E7).
recommendation.outcome 값: ok · model_failed · no_response · feature_failed (CHECK chk_rec_outcome).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.db import Database, utcnow
from app.models.registry import ModelRegistry
from app.recommend import llm, rules
from app.recommend.features import MODE_LABEL, TEMPO_LABEL, FeatureError, Features, extract
from app.services.catalog import instruments
from app.settings import Settings

log = logging.getLogger("model-api.recommend")

FEATURE_TIMEOUT_S = 15.0


@dataclass
class RecommendOutcome:
    available: bool
    reason: str | None
    pending: bool
    combinations: list[dict]
    model: dict[str, str] | None
    features: Features | None
    outcome: str
    requested_at: datetime
    responded_at: datetime
    tried: list[dict] = field(default_factory=list)

    def public(self) -> dict[str, Any]:
        return {
            "available": self.available,
            "reason": self.reason,
            "pending": self.pending,
            "combinations": self.combinations,
            "model": self.model,
            "features": self.features.public() if self.features else None,
            "tried": self.tried,
        }


def recommend_order(settings: Settings) -> list[str]:
    order = [n for n in settings.order("recommend")]
    if "rules" in order:
        order.remove("rules")
    return order + ["rules"]


async def run_recommend(registry: ModelRegistry, settings: Settings, data: bytes) -> RecommendOutcome:
    requested_at = utcnow()
    try:
        features = await asyncio.wait_for(asyncio.to_thread(extract, data), timeout=FEATURE_TIMEOUT_S)
    except (FeatureError, TimeoutError) as exc:
        log.info("특징 추출 실패: %s", exc)
        return RecommendOutcome(False, "RECOMMEND_UNAVAILABLE", False, [], None, None, "feature_failed",
                                requested_at, utcnow())

    pending = False
    tried: list[dict] = []
    last_failure = "model_failed"
    for name in recommend_order(settings):
        entry = registry.get(name)
        # 규칙표는 안전판이라 등록부에서 빠지거나 꺼져 있어도 돈다
        if name != "rules" and (entry is None or not entry.enabled or entry.kind != "recommend"):
            continue
        provider = entry.provider if entry else "builtin"
        adapter = (entry.config.get("adapter") if entry else None) or ("rules" if provider == "builtin" else provider)
        started = asyncio.get_running_loop().time()
        if provider == "ollama":
            await registry.refresh_ollama()
            if entry.state != "ready":
                tried.append({"name": name, "outcome": "skipped_not_ready", "state": entry.state})
                if entry.state in ("cold", "failed"):
                    pending = True
                    await registry.start_load(name, "request")
                elif entry.state == "loading":
                    pending = True
                continue
            try:
                combos = await asyncio.wait_for(
                    llm.recommend(registry.ollama, entry.ollama_tag, features, num_ctx=entry.config.get("num_ctx")),
                    timeout=settings.llm_recommend_timeout_ms / 1000.0,
                )
            except TimeoutError:
                combos, last_failure = None, "no_response"
                tried.append({"name": name, "outcome": "timeout"})
            except llm.LLMAnswerError as exc:
                # 답이 깨졌거나 조합 하나라도 규칙에 어긋나면 통째로 버리고 다음(규칙표)으로 (T151)
                combos = None
                tried.append({"name": name, "outcome": "invalid_answer", "detail": str(exc)[:200]})
            if combos:
                tried.append({"name": name, "outcome": "ok", "ms": _ms(started)})
                return RecommendOutcome(True, None, pending, combos,
                                        {"name": name, "version": (entry.version or entry.ollama_tag)[:40],
                                         "provider": "ollama"},
                                        features, "ok", requested_at, utcnow(), tried)
            continue
        if adapter != "rules":
            tried.append({"name": name, "outcome": "unsupported_adapter"})
            continue
        try:
            combos = await asyncio.wait_for(asyncio.to_thread(rules.recommend, features),
                                            timeout=settings.recommend_timeout_ms / 1000.0)
        except TimeoutError:
            last_failure = "no_response"
            tried.append({"name": name, "outcome": "timeout"})
            continue
        except Exception as exc:
            log.exception("규칙표 추천 실패")
            tried.append({"name": name, "outcome": "error", "detail": str(exc)[:200]})
            continue
        tried.append({"name": name, "outcome": "ok", "ms": _ms(started)})
        return RecommendOutcome(True, None, pending, combos,
                                {"name": name, "version": rules.rules_hash(), "provider": "builtin"},
                                features, "ok", requested_at, utcnow(), tried)

    return RecommendOutcome(False, "RECOMMEND_UNAVAILABLE", pending, [], None, features, last_failure,
                            requested_at, utcnow(), tried)


def _ms(started: float) -> int:
    return int((asyncio.get_running_loop().time() - started) * 1000)


async def save_recommendation(db: Database, request_id: int, rec: RecommendOutcome) -> int:
    """recommendation + recommendation_option(→ ensemble 'recommended' + ensemble_member) 를 한 번에 쓴다."""
    f = rec.features
    codes = sorted({c for combo in rec.combinations for c in combo["instruments"]})
    ids: dict[str, int] = {}
    if codes:
        placeholders = ",".join(["%s"] * len(codes))
        rows = await db.fetch_all(f"SELECT instrument_id, code FROM instrument WHERE code IN ({placeholders})", codes)
        ids = {r["code"]: int(r["instrument_id"]) for r in rows}
    catalog = instruments()
    async with db.transaction() as cur:
        await cur.execute(
            "INSERT INTO recommendation (request_id, requested_at, responded_at, outcome, model_name, model_version, "
            "feature_tempo, feature_mode, feature_range, feature_density) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (request_id, rec.requested_at, max(rec.responded_at, rec.requested_at), rec.outcome,
             rec.model["name"] if rec.model else None, rec.model["version"][:40] if rec.model else None,
             TEMPO_LABEL[f.tempo] if f else None, MODE_LABEL[f.mode] if f else None,
             f.range[:40] if f else None, f.density if f else None),
        )
        rec_id = int(cur.lastrowid)
        rank = 0
        for combo in rec.combinations:
            members = [c for c in combo["instruments"] if c in ids]
            if not members:
                continue
            rank += 1
            await cur.execute("INSERT INTO ensemble (ensemble_kind) VALUES ('recommended')")
            ens_id = int(cur.lastrowid)
            for part_no, code in enumerate(members, start=1):
                await cur.execute(
                    "INSERT INTO ensemble_member (ensemble_id, part_no, part_role, instrument_id) VALUES (%s,%s,%s,%s)",
                    (ens_id, part_no, "percussion" if catalog[code].is_percussion else "melody", ids[code]),
                )
            await cur.execute(
                "INSERT INTO recommendation_option (recommendation_id, rank_no, ensemble_id) VALUES (%s,%s,%s)",
                (rec_id, rank, ens_id),
            )
    return rec_id
