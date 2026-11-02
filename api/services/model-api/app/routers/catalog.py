"""#32 구조에서의 위치: 외부·서비스 키 호출자 → 목록 API → instrument DB 읽기.

활성 악기와 음역만 반환하고 저장하지 않는다. 공유 악보는 별도 라우터로 확장할 후속 범위다.
"""
from fastapi import APIRouter, Depends, Request

from app.auth.keys import Caller, require_key
from app.auth.limits import enforce_limits
from app.schemas import InstrumentsResponse

router = APIRouter(prefix="/v1", tags=["목록"])


@router.get("/instruments", summary="악기 목록 (UC12 A10)", response_model=InstrumentsResponse)
async def list_instruments(request: Request, caller: Caller = Depends(require_key)) -> dict:
    await enforce_limits(request, caller, None)
    rows = await request.app.state.db.fetch_all(
        "SELECT code, name, family, is_percussion, range_low, range_high FROM instrument "
        "WHERE is_active = 1 AND code IS NOT NULL ORDER BY menu_order IS NULL, menu_order, instrument_id")
    return {"api_version": "v1", "items": [
        {"code": r["code"], "name": r["name"], "is_gugak": r["family"] == "gugak",
         "is_percussion": bool(r["is_percussion"]), "range_low": r["range_low"], "range_high": r["range_high"]}
        for r in rows]}
