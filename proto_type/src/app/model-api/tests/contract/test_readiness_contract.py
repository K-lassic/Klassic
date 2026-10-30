"""API 서버 점검 개선 시험 (2026-09-30 조성기 — design/SD_04 §8-1 · 계약 model-api.openapi.yaml).

A4·A5 상태를 사실대로 · B2~B5·B7 계약 위반 422 · B3 모르는 필드 거절 · B1·B10 선언 필드만 · D5 번호표 · D6·D7 로그.
"""

from __future__ import annotations

import logging

import pytest

from .conftest import key_headers, make_png

DECLARED = {"api_version", "request_no", "fallback", "fallback_reason", "fallback_message", "retry_hint",
            "structure_verdict", "type_mismatch", "detected_type", "validity_grade", "validity_items", "musicxml",
            "midi_base64", "midi_available", "engine", "timings_ms", "page_count", "converted_pages", "pages", "notice", "file_kind",
            "pdf_page_count", "short_edge_px", "service_down"}


def _one(name: str = "s.png"):
    return {"image": (name, make_png(), "image/png")}


async def test_health_loading_is_503(app_client):
    reg = app_client.app.state.registry
    reg.startup_done = False
    try:
        r = await app_client.get("/v1/health")
        assert r.status_code == 503
        body = r.json()
        assert body["status"] == "loading" and body["error"]["code"] == "SERVICE_NOT_READY"
    finally:
        reg.startup_done = True
    r = await app_client.get("/v1/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


async def test_health_without_engines_is_503(app_client):
    reg = app_client.app.state.registry
    saved = {n: (e.installed, e.state) for n, e in reg.entries.items()}
    try:
        for e in reg.entries.values():
            if e.kind == "omr_staff":
                e.installed, e.state = False, "unavailable"
        r = await app_client.get("/v1/health")
        assert r.status_code == 503
        assert r.json()["status"] == "unavailable" and r.json()["missing_kinds"] == ["omr_staff"]
    finally:
        for n, (inst, st) in saved.items():
            reg.entries[n].installed, reg.entries[n].state = inst, st


@pytest.mark.parametrize("case", ["missing", "unknown", "typo", "type", "range", "empty_file", "no_file"])
async def test_contract_violations_are_422(app_client, engines, ext_key, case):
    h = key_headers(ext_key[0])
    if case == "missing":
        r = await app_client.post("/v1/omr/staff", data={"request_no": "x"}, headers=h)
    elif case == "unknown":
        r = await app_client.post("/v1/omr/staff", files=_one(), data={"unknown_field": "1"}, headers=h)
    elif case == "typo":
        r = await app_client.post("/v1/omr/staff", files=_one(), data={"request_noo": "1"}, headers=h)
    elif case == "type":
        r = await app_client.post("/v1/performances", files={"score": ("a.png", make_png(), "image/png")},
                                  data={"score_type": "staff", "transpose_semitones": "abc"}, headers=h)
    elif case == "range":
        r = await app_client.post("/v1/performances", files={"score": ("a.png", make_png(), "image/png")},
                                  data={"score_type": "staff", "volume": "-1"}, headers=h)
    elif case == "empty_file":
        r = await app_client.post("/v1/omr/staff", files={"image": ("e.png", b"", "image/png")}, headers=h)
    else:
        r = await app_client.post("/v1/omr/staff", files={"other": ("x", b"", "text/plain")}, headers=h)
    assert r.status_code == 422, (case, r.text)
    assert r.json()["error"]["code"] == "VALIDATION_ERROR" and r.json()["error"]["details"]["errors"]


async def test_success_has_declared_fields_only_and_request_id(app_client, engines, ext_key):
    r = await app_client.post("/v1/omr/staff", files=_one(), headers=key_headers(ext_key[0]))
    assert r.status_code == 200, r.text
    assert set(r.json()) == DECLARED
    assert len(r.headers["X-Request-ID"]) == 12


async def test_error_also_has_request_id(app_client, ext_key):
    r = await app_client.post("/v1/omr/staff", headers=key_headers(ext_key[0]))
    assert r.status_code == 422 and len(r.headers["X-Request-ID"]) == 12


async def test_access_log_has_no_input_text_or_token(app_client, engines, ext_key, caplog):
    logger = logging.getLogger("model-api.access")
    logger.addHandler(caplog.handler)
    try:
        caplog.set_level(logging.INFO, logger="model-api.access")
        r = await app_client.post("/v1/omr/staff", files=_one("SECRET-NAME-XYZ.png"), headers=key_headers(ext_key[0]))
        await app_client.get("/v1/files/abcdefTOKEN123456")
    finally:
        logger.removeHandler(caplog.handler)
    text = caplog.text
    assert f"req_id={r.headers['X-Request-ID']}" in text and "path=/v1/omr/staff" in text and "status=200" in text
    assert "SECRET-NAME-XYZ" not in text and "abcdefTOKEN123456" not in text and "/v1/files/<token>" in text
    assert ext_key[0] not in text


# ---------------------------------------------------------------- MIDI 안전 변환 (2026-09-30 SD_04 §8-1)
async def _no_midi(*_a, **_k):
    return None


async def test_midi_failure_serves_musicxml_only(app_client, db, engines, ext_key, monkeypatch):
    from app.services import safe_midi

    monkeypatch.setattr(safe_midi, "musicxml_to_midi_safe", _no_midi)
    r = await app_client.post("/v1/omr/staff", files=_one(), headers=key_headers(ext_key[0]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["fallback"] is False and body["musicxml"].lstrip().startswith("<?xml")
    assert body["midi_available"] is False and body["midi_base64"] is None
    from .conftest import q1

    row = q1(db, "SELECT s.musicxml_uri, s.midi_uri FROM score_result s JOIN score_request r ON r.request_id = s.request_id "
                 "WHERE r.request_no = %s", (body["request_no"],))
    assert row["musicxml_uri"] and row["midi_uri"] is None


async def test_performance_is_musicxml_based_and_survives_midi_failure(app_client, engines, ext_key, monkeypatch):
    from app.services import safe_midi

    from .test_performance_fonts import _submit, _wait_done

    monkeypatch.setattr(safe_midi, "musicxml_to_midi_safe", _no_midi)
    r = await _submit(app_client, ext_key[0], {}, engines)
    assert r.status_code == 202, r.text
    s = await _wait_done(app_client, ext_key[0], r.json()["id"])
    assert s["status"] == "completed"
    res = (await app_client.get(f"/v1/performances/{r.json()['id']}/result", headers=key_headers(ext_key[0]))).json()
    assert res["files"].get("musicxml") and not res["files"].get("midi")  # MusicXML 만, MP3 는 렌더링 실패로
    assert engines.render_calls == []  # MIDI 가 없으면 MP3 를 렌더링하지 않는다
