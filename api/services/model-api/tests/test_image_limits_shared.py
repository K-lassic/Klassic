"""#33 사진 제한·안내가 웹과 같은 shared 기준이며 원본·인식 정책을 바꾸지 않는지 검증한다."""
from copy import deepcopy
import io

from PIL import Image
import pytest
from unittest.mock import AsyncMock

from app.catalog import load_errors
from app.auth import rbac
from app.checks.upload import check_upload, read_rules
from app.errors import ApiError, CATALOG, error_body
from test_foundation import SHARED
from test_performances import client as client


def png(width, height):
    output = io.BytesIO()
    # 해상도 경계 시험은 회색조를 써서 RGB 작업 메모리와 구분한다.
    with Image.new('L', (width, height), 255) as image:
        image.save(output, 'PNG')
    return output.getvalue()


@pytest.mark.parametrize('width,height,ok', [
    (8000, 5000, True), (8000, 5001, False), (8000, 6000, False),
    (10000, 700, True), (10001, 700, False), (300, 3000, True), (300, 4000, False),
])
def test_same_dimensions_as_web(width, height, ok):
    verdict = check_upload([('sized.png', png(width, height))], rules=read_rules(SHARED),
                           score_type='staff', require_score_type=True, render_pdf=False)
    assert verdict.ok is ok
    if not ok:
        assert verdict.code == 'UPLOAD_TOO_LARGE'
        assert verdict.details == {'reason': 'image_pixels', 'max_pixels': 40000000, 'max_edge': 10000,
                                   'width': width, 'height': height, 'after_upscale': min(width, height) < 650}


def test_configured_bounds_are_used_before_decode(monkeypatch):
    rules = deepcopy(read_rules(SHARED))
    rules['kinds']['image'].update(max_pixels=800000, max_edge_px=2000)
    data = png(1000, 900)
    def forbidden(self, *args, **kwargs):
        raise AssertionError('상한 초과 사진을 디코딩하면 안 됩니다')
    monkeypatch.setattr(Image.Image, 'load', forbidden)
    verdict = check_upload([('small.png', data)], rules=rules, score_type='staff', require_score_type=True)
    assert verdict.code == 'UPLOAD_TOO_LARGE'
    assert verdict.details['max_pixels'] == 800000 and verdict.details['max_edge'] == 2000


def test_page_and_messages_distinguish_pixels_from_bytes():
    verdict = check_upload([('ok.png', png(700, 700)), ('large.png', png(8000, 6000))],
                           rules=read_rules(SHARED), score_type='staff', require_score_type=True,
                           multi_page=True, render_pdf=False)
    assert verdict.details['page'] == 2
    token = CATALOG.set(load_errors(SHARED))
    try:
        error = error_body(ApiError(verdict.code, details=verdict.details))['error']
        assert '4000만 화소' in error['message'] and '10000px' in error['message']
        assert '해상도' not in ApiError('UPLOAD_TOO_LARGE', details={'limit': 20971520}).message
        long = ApiError('UPLOAD_TOO_LARGE', details={**verdict.details, 'after_upscale': True})
        assert '쪽별로 나누어' in long.message
    finally:
        CATALOG.reset(token)


@pytest.mark.parametrize('path,field,key', [
    ('/v1/omr/staff', 'image', 'service-secret'),
    ('/v1/omr/jeongganbo', 'image', 'service-secret'),
    ('/v1/performances', 'score', 'external-secret'),
    ('/v1/internal/upload-check', 'file', 'service-secret'),
])
def test_http_rejects_before_creating_request(client, monkeypatch, path, field, key):
    api, _, db, _ = client
    # 기존 외부 API fixture에는 내부 검사(UC3) 권한이 없으므로 실제 서비스 키 권한을 추가한다.
    original_fetch = db.fetch_all
    async def permissions(sql, args=None):
        rows = await original_fetch(sql, args)
        return rows + [{'role_code': 'service', 'uc_code': 'UC3'}] if 'role_permission' in sql else rows
    monkeypatch.setattr(db, 'fetch_all', permissions)
    rbac.clear_cache()
    omr_create = AsyncMock(side_effect=AssertionError('화소 초과 요청을 저장하면 안 됩니다'))
    performance_create = AsyncMock(side_effect=AssertionError('화소 초과 요청을 저장하면 안 됩니다'))
    monkeypatch.setattr('app.routers.omr_common.create_api_request', omr_create)
    monkeypatch.setattr('app.routers.performances.create_api_request', performance_create)
    fields = {} if path.startswith('/v1/omr/') else {'score_type': 'staff'}
    response = api.post(path, headers={'X-API-Key': key}, data=fields,
                           files=[(field, ('large.png', png(8000, 6000), 'image/png'))])
    assert response.status_code == 413
    error = response.json()['error']
    assert error['code'] == 'UPLOAD_TOO_LARGE' and '4000만 화소' in error['message']
    assert response.headers['x-request-id']
    omr_create.assert_not_called()
    performance_create.assert_not_called()
