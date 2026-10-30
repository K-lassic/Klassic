"""읽기 엔드포인트 — 악기 목록 · 공유 악보 (2026-09-30 조성기 — UC12 A10 · BR-API-07 · UC18 BR-SHR-09).

- GET /v1/instruments: 쓸 수 있는 악기(코드 · 이름 · 국악기 · 타악 · 음역).
- GET /v1/shared-scores: 보이는 공유 악보 목록(v_shared_score_list — 거둠 · 내림 · 보관 끝 제외).
- GET /v1/shared-scores/{share_no}/score: 공유 복사본 MusicXML.
공유 악보 응답에는 올린 사람 · 요청 번호를 넣지 않는다(BR-SHR-03). 접근 키 · UC12 권한 · 시간당 한도를 거친다.
호출자는 악보 + 악기로 POST /v1/render/mp3 를 불러 배경음악을 만들 수 있다(예시: /demo/, SD_02 §7-2).
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request

from app.auth.keys import Caller, require_key
from app.auth.limits import enforce_limits
from app.errors import ApiError

router = APIRouter(tags=["목록"])

SHARE_NO = re.compile(r"^S-\d{4}-[A-Z0-9]{8}$")


def _iso(v) -> str | None:
    return v.isoformat() if v is not None else None


@router.get("/instruments", summary="악기 목록 (UC12 A10)")
async def list_instruments(request: Request, caller: Caller = Depends(require_key)) -> dict:
    await enforce_limits(request, caller, None)
    rows = await request.app.state.db.fetch_all(
        "SELECT code, name, family, is_percussion, range_low, range_high FROM instrument "
        "WHERE is_active = 1 AND code IS NOT NULL ORDER BY menu_order IS NULL, menu_order, instrument_id")
    return {
        "api_version": "v1",
        "items": [{
            "code": r["code"], "name": r["name"], "is_gugak": r["family"] == "gugak",
            "is_percussion": bool(r["is_percussion"]),
            "range_low": r["range_low"], "range_high": r["range_high"],
        } for r in rows],
    }


@router.get("/shared-scores", summary="공유 악보 목록 (UC12 A10 · BR-SHR-09)")
async def list_shared_scores(
    request: Request,
    sort: str = Query("likes", pattern="^(likes|recent)$"),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    caller: Caller = Depends(require_key),
) -> dict:
    await enforce_limits(request, caller, None)
    order = "shared_at DESC, share_id DESC" if sort == "recent" else "like_count DESC, shared_at DESC, share_id DESC"
    rows = await request.app.state.db.fetch_all(
        f"SELECT share_no, title, score_type, shared_at, like_count, is_example FROM v_shared_score_list "
        f"ORDER BY {order} LIMIT %s OFFSET %s", (limit + 1, offset))
    return {
        "api_version": "v1",
        "sort": sort,
        "has_more": len(rows) > limit,
        "items": [{
            "share_no": r["share_no"], "title": r["title"], "score_type": r["score_type"],
            "likes": int(r["like_count"]), "example": bool(r["is_example"]), "shared_at": _iso(r["shared_at"]),
        } for r in rows[:limit]],
    }


@router.get("/shared-scores/{share_no}/score", summary="공유 악보 MusicXML (UC12 A10)", responses={404: {}})
async def get_shared_score(share_no: str, request: Request, caller: Caller = Depends(require_key)) -> dict:
    await enforce_limits(request, caller, None)
    if not SHARE_NO.match(share_no):
        raise ApiError("REQUEST_NOT_FOUND", details={"share_no": share_no})
    state = request.app.state
    row = await state.db.fetch_one(
        "SELECT v.share_no, v.title, v.score_type, s.musicxml_uri FROM v_shared_score_list v "
        "JOIN shared_score s ON s.share_id = v.share_id WHERE v.share_no = %s", (share_no,))
    if row is None or not row["musicxml_uri"]:
        raise ApiError("REQUEST_NOT_FOUND", details={"share_no": share_no})
    root = Path(state.config.storage_dir).resolve()
    path = (root / row["musicxml_uri"]).resolve()
    if root not in path.parents:
        raise ApiError("REQUEST_NOT_FOUND", details={"share_no": share_no})
    try:
        text = await asyncio.to_thread(path.read_text, "utf-8")
    except OSError as exc:
        raise ApiError("REQUEST_NOT_FOUND", details={"share_no": share_no}) from exc
    return {"api_version": "v1", "share_no": row["share_no"], "title": row["title"],
            "score_type": row["score_type"], "musicxml": text}
