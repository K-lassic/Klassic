"""엔진 쪽 실제 검사 함수(check_upload·check_structure)를 코어 파이프라인에 붙여 본다.

인식 엔진 가상환경이 없어도 되는 경로만: 빈 종이 사진 → 구조 불통과 → 서버 템플릿 대체(엔진을 부르지 않음).
"""

from __future__ import annotations

import pytest
from contract.conftest import key_headers, make_midi, make_png


@pytest.fixture
def real_checks(engines, monkeypatch):
    from app.checks.structure import check_structure
    from app.services import engine_api

    engines.upload_real = True
    monkeypatch.setattr(engine_api, "check_structure", check_structure)
    return engines


async def test_blank_page_is_no_structure_with_real_checks(app_client, real_checks, ext_key):
    r = await app_client.post("/v1/omr/staff", files={"image": ("blank.png", make_png(1200, 900), "image/png")},
                              headers=key_headers(ext_key[0]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["structure_verdict"] == "fail" and body["fallback_reason"] == "NO_SCORE_STRUCTURE"
    assert body["musicxml"] and real_checks.calls == []


async def test_real_upload_check_rejects_small_image(app_client, real_checks, ext_key):
    r = await app_client.post("/v1/omr/staff", files={"image": ("small.png", make_png(400, 250), "image/png")},
                              headers=key_headers(ext_key[0]))
    assert r.status_code == 422 and r.json()["error"]["code"] == "UPLOAD_RESOLUTION_TOO_LOW"


async def test_real_upload_check_accepts_midi_for_recommend(app_client, real_checks, ext_key):
    r = await app_client.post("/v1/recommend", files={"score": ("a.mid", make_midi(), "audio/midi")},
                              headers=key_headers(ext_key[0]))
    assert r.status_code == 200 and r.json()["available"] is True
