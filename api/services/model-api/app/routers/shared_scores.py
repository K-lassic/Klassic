"""#93 구조에서의 위치: 외부·서비스 키 → 공유 목록·악보 API → DB 공개 뷰·읽기 전용 공유 파일.

거둠·내림·만료된 악보는 제외하고 작성자·원 요청·파일 위치는 반환하지 않는다.
"""
import asyncio
from datetime import UTC

from fastapi import APIRouter, Depends, Query, Request

from app.auth.keys import Caller, require_key
from app.auth.limits import enforce_limits
from app.errors import ApiError
from app.schemas import SharedScoreResponse, SharedScoresResponse
from app.services.shared_scores import SHARE_NO, read_shared

router = APIRouter(prefix='/v1', tags=['목록'])


@router.get('/shared-scores', response_model=SharedScoresResponse, summary='공유 악보 목록 (UC12 A10)')
async def list_shared(request: Request, sort: str = Query('likes', pattern='^(likes|recent)$'),
                      limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0),
                      caller: Caller = Depends(require_key)):
    await enforce_limits(request, caller, None)
    order = 'v.shared_at DESC, v.share_id DESC' if sort == 'recent' else 'v.like_count DESC, v.shared_at DESC, v.share_id DESC'
    rows = await request.app.state.db.fetch_all(
        'SELECT v.share_no,v.title,v.score_type,v.shared_at,v.like_count,v.is_example FROM v_shared_score_list v '
        'JOIN shared_score s ON s.share_id=v.share_id WHERE s.purged_at IS NULL '
        f'ORDER BY {order} LIMIT %s OFFSET %s', (limit + 1, offset))
    return {'api_version': 'v1', 'sort': sort, 'has_more': len(rows) > limit, 'items': [
        {'share_no': r['share_no'], 'title': r['title'], 'score_type': r['score_type'],
         'likes': int(r['like_count']), 'example': bool(r['is_example']),
         'shared_at': r['shared_at'].replace(tzinfo=UTC).isoformat() if r['shared_at'] else None}
        for r in rows[:limit]]}


@router.get('/shared-scores/{share_no}/score', response_model=SharedScoreResponse, summary='공유 악보 MusicXML (UC12 A10)')
async def get_shared(share_no: str, request: Request, caller: Caller = Depends(require_key)):
    await enforce_limits(request, caller, None)
    if not SHARE_NO.fullmatch(share_no):
        raise ApiError('REQUEST_NOT_FOUND')
    state = request.app.state
    row = await state.db.fetch_one(
        'SELECT v.share_no,v.title,v.score_type,s.musicxml_uri FROM v_shared_score_list v '
        'JOIN shared_score s ON s.share_id=v.share_id WHERE v.share_no=%s AND s.purged_at IS NULL', (share_no,))
    if not row or not row['musicxml_uri']:
        raise ApiError('REQUEST_NOT_FOUND')
    try:
        xml = await asyncio.to_thread(read_shared, state.config.shared_scores_dir, share_no, row['musicxml_uri'])
    except (OSError, ValueError) as exc:
        raise ApiError('REQUEST_NOT_FOUND') from exc
    return {'api_version': 'v1', 'share_no': row['share_no'], 'title': row['title'],
            'score_type': row['score_type'], 'musicxml': xml}
