"""연주 API·렌더링·삭제 순환 계약 시험 (T104~T108 · T135, UC13 · D-3). 내부 .sf2(T132)는 2026-09-29 US8 삭제.

2026-09-29 황송해 결정(사진·PDF 입력): 연주 API 는 사진·PDF 만 받는다 — MIDI·MusicXML 은 G1 형식 반려(직행 없음).
그래서 악보 내용이 필요한 시험은 사진을 올리고 가짜 인식 엔진이 돌려줄 MusicXML 을 정해 둔다(_engine_returns).
"""

from __future__ import annotations

import json
from contextlib import contextmanager

import pytest

from app.jobs.purge import purge_once
from app.services import files as file_tokens

from .conftest import (
    FIXTURES,
    key_headers,
    make_external_key,
    make_midi,
    make_musicxml,
    make_png,
    q,
    q1,
    svc_headers,
    wait_until,
)

STATUS_KEYS = {"api_version", "id", "status", "status_label", "route", "file_kind", "score_type", "created_at",
               "completed_at", "expires_at", "remaining_seconds", "pdf_page_count", "notice",
               "page_count", "pages"}


def _engine_returns(engines, musicxml: str) -> None:
    """가짜 오선보 인식 엔진(homr)이 이 MusicXML 을 돌려주게 한다"""
    engines.results["homr"] = [{"outcome": "success", "musicxml": musicxml}]


@contextmanager
def license_confirmed(db):
    with db.cursor() as cur:
        cur.execute("UPDATE license_policy SET confirmed = TRUE, decided_by = 1, decided_at = CURRENT_TIMESTAMP(3)")
    try:
        yield
    finally:
        with db.cursor() as cur:
            cur.execute("UPDATE license_policy SET confirmed = FALSE, decided_by = NULL, decided_at = NULL")


def _members(db, ensemble_id) -> list[tuple[str, str]]:
    rows = q(db, "SELECT m.part_role, i.code FROM ensemble_member m JOIN instrument i ON i.instrument_id = m.instrument_id "
                 "WHERE m.ensemble_id = %s ORDER BY m.part_no", (ensemble_id,))
    return [(r["part_role"], r["code"]) for r in rows]


def _midi_with_drums() -> bytes:
    import io

    import pretty_midi

    pm = pretty_midi.PrettyMIDI(initial_tempo=60)
    mel = pretty_midi.Instrument(program=0, name="Piano")
    drums = pretty_midi.Instrument(program=0, is_drum=True, name="Drums")
    for k, p in enumerate([60, 62, 64, 65, 67, 65, 64, 62]):
        mel.notes.append(pretty_midi.Note(velocity=90, pitch=p, start=k * 0.5, end=k * 0.5 + 0.5))
        drums.notes.append(pretty_midi.Note(velocity=90, pitch=38, start=k * 0.5, end=k * 0.5 + 0.25))
    pm.instruments += [mel, drums]
    buf = io.BytesIO()
    pm.write(buf)
    return buf.getvalue()


async def test_default_with_percussion_part_records_default_ensemble(app_client, db, engines, ext_key):
    # 타악 성부가 있으면 가야금 · 장구가 모두 놓이므로 기본 구성 그대로 기록한다
    from app.services import scoreio

    raw, _ = ext_key
    _engine_returns(engines, scoreio.to_musicxml(scoreio.load_score(_midi_with_drums())))
    body = await _submit(app_client, raw)
    await _wait_done(app_client, raw, body["id"])
    rid = q1(db, "SELECT request_id FROM score_request WHERE request_no = %s", (body["id"],))["request_id"]
    sel = q1(db, "SELECT s.ensemble_id, e.ensemble_kind FROM instrument_selection s JOIN ensemble e "
                 "ON e.ensemble_id = s.ensemble_id WHERE s.request_id = %s", (rid,))
    assert sel["ensemble_kind"] == "default"
    assert _members(db, sel["ensemble_id"]) == [("melody", "gayageum"), ("percussion", "janggu")]


async def test_placed_subset_ensemble_is_reused(app_client, db, engines, ext_key):
    # 같은 '놓인 악기' 구성은 새 행을 만들지 않고 다시 쓴다
    raw, _ = ext_key
    ids = []
    for _ in range(2):
        body = await _submit(app_client, raw)
        await _wait_done(app_client, raw, body["id"])
        rid = q1(db, "SELECT request_id FROM score_request WHERE request_no = %s", (body["id"],))["request_id"]
        ids.append(q1(db, "SELECT ensemble_id FROM instrument_selection WHERE request_id = %s", (rid,))["ensemble_id"])
    assert ids[0] == ids[1]


async def _submit(client, raw, *, files=None, data=None):
    r = await client.post("/v1/performances", files=files or {"score": ("song.png", make_png(), "image/png")},
                          data={"score_type": "staff", **(data or {})}, headers=key_headers(raw))
    assert r.status_code == 202, r.text
    return r.json()


async def _wait_done(client, raw, no):
    async def done():
        s = (await client.get(f"/v1/performances/{no}", headers=key_headers(raw))).json()
        return s if s["status"] in ("completed", "completed_fallback", "service_down") else None

    return await wait_until(done, timeout=30)


async def test_image_default_instruments(app_client, db, engines, ext_key):
    raw, _ = ext_key
    first = await _submit(app_client, raw)
    assert set(first) == STATUS_KEYS
    assert first["id"].startswith("R-") and first["status"] in ("received", "converting", "rendering", "completed")
    assert first["route"] == "recognize" and first["file_kind"] == "image" and first["notice"] is None
    status = await _wait_done(app_client, raw, first["id"])
    assert status["status"] == "completed" and status["status_label"] == "완료"

    res = (await app_client.get(f"/v1/performances/{first['id']}/result", headers=key_headers(raw))).json()
    assert res["fallback"] is False and res["structure_verdict"] == "pass" and res["validity_grade"] == "trust"
    assert res["files"]["musicxml"] and res["files"]["midi"]
    # G7: 라이선스 확인 전 → 외부 호출자에게 MP3 를 주지 않는다
    assert res["files"]["mp3"] is None and res["mp3_withheld"] is True
    assert res["mp3_withheld_reason"] == "LICENSE_UNCONFIRMED"
    assert res["instrument_mode"] == "default" and res["original_instruments_unavailable"] is False

    xml = (await app_client.get(res["files"]["musicxml"].replace("http://test", ""))).text
    assert "가야금" in xml  # 기본 국악기 구성(선율 가야금)
    midi = (await app_client.get(res["files"]["midi"].replace("http://test", ""))).content
    assert midi[:4] == b"MThd"

    rid = q1(db, "SELECT request_id FROM score_request WHERE request_no = %s", (first["id"],))["request_id"]
    opt = q1(db, "SELECT instrument_mode, ensemble_id, transpose_semitones, volume_level FROM performance_option "
                 "WHERE request_id = %s", (rid,))
    assert opt == {"instrument_mode": "default", "ensemble_id": None, "transpose_semitones": 0, "volume_level": 100}
    fmt = {r["format"]: r for r in q(db, "SELECT * FROM derived_file WHERE request_id = %s", (rid,))}
    assert fmt["mp3"]["render_status"] == "ready" and fmt["mp3"]["renderer_name"] == "fluidsynth"
    assert fmt["musicxml"]["render_status"] == "ready" and fmt["musicxml"]["renderer_name"] is None
    sel = q1(db, "SELECT s.source, s.ensemble_id, e.ensemble_kind FROM instrument_selection s JOIN ensemble e "
                 "ON e.ensemble_id = s.ensemble_id WHERE s.request_id = %s", (rid,))
    # 타악 성부가 없는 악보 → 장구는 놓이지 않았으니 기록에도 없다(가야금만, 2026-09-29)
    assert sel["source"] == "api_option" and sel["ensemble_kind"] == "custom"
    assert _members(db, sel["ensemble_id"]) == [("melody", "gayageum")]
    assert {r["ensemble_id"] for r in q(db, "SELECT ensemble_id FROM derived_file WHERE request_id = %s", (rid,))} \
        == {sel["ensemble_id"]}
    res_row = q1(db, "SELECT origin, original_ensemble_id FROM score_result WHERE request_id = %s", (rid,))
    # 직행이 없으니 원래 악기 기록도 없다(BR-PLY-04 사용 안 함, 2026-09-29)
    assert res_row["origin"] == "recognized" and res_row["original_ensemble_id"] is None
    stages = {x["stage_code"] for x in q(db, "SELECT stage_code FROM stage_timing WHERE request_id = %s", (rid,))}
    assert "check" in stages


async def test_mp3_when_license_confirmed(app_client, db, engines, ext_key):
    raw, _ = ext_key
    with license_confirmed(db):
        first = await _submit(app_client, raw)
        await _wait_done(app_client, raw, first["id"])
        res = (await app_client.get(f"/v1/performances/{first['id']}/result", headers=key_headers(raw))).json()
        assert res["mp3_withheld"] is False and res["files"]["mp3"]
        mp3 = await app_client.get(res["files"]["mp3"].replace("http://test", ""))
        assert mp3.status_code == 200 and mp3.content.startswith(b"ID3FAKE")
        assert mp3.headers["content-type"] == "audio/mpeg"


async def test_custom_instruments_transpose_volume(app_client, db, engines, ext_key):
    raw, _ = ext_key
    _engine_returns(engines, make_musicxml(["C4", "D4", "E4", "F4"], instrument_name="Violin"))
    body = await _submit(app_client, raw, data={
        "instruments": json.dumps({"mode": "custom", "tracks": [{"part": 0, "instrument": "daegeum"},
                                                                {"part": 1, "instrument": "haegeum"}]}),
        "transpose_semitones": "2", "volume": "0.5"})
    await _wait_done(app_client, raw, body["id"])
    res = (await app_client.get(f"/v1/performances/{body['id']}/result", headers=key_headers(raw))).json()
    assert res["instrument_mode"] == "custom" and res["transpose_semitones"] == 2 and res["volume"] == 0.5
    out = (await app_client.get(res["files"]["musicxml"].replace("http://test", ""))).text
    assert "대금" in out and "해금" in out  # 둘째 성부는 첫 성부 복사(melody_copy)
    assert "<step>D</step>" in out  # C4 → D4 로 조옮김
    rid = q1(db, "SELECT request_id FROM score_request WHERE request_no = %s", (body["id"],))["request_id"]
    opt = q1(db, "SELECT o.instrument_mode, o.volume_level, e.ensemble_kind FROM performance_option o "
                 "JOIN ensemble e ON e.ensemble_id = o.ensemble_id WHERE o.request_id = %s", (rid,))
    assert opt == {"instrument_mode": "explicit", "volume_level": 50, "ensemble_kind": "custom"}


async def test_recommend_mode_uses_recommendation(app_client, db, engines, ext_key):
    raw, _ = ext_key
    body = await _submit(app_client, raw, data={"instruments": json.dumps({"mode": "recommend"})})
    await _wait_done(app_client, raw, body["id"])
    res = (await app_client.get(f"/v1/performances/{body['id']}/result", headers=key_headers(raw))).json()
    assert res["recommend_failed"] is False
    rid = q1(db, "SELECT request_id FROM score_request WHERE request_no = %s", (body["id"],))["request_id"]
    assert q1(db, "SELECT outcome FROM recommendation WHERE request_id = %s", (rid,))["outcome"] == "ok"
    sel = q1(db, "SELECT s.ensemble_id, e.ensemble_kind FROM instrument_selection s JOIN ensemble e "
                 "ON e.ensemble_id = s.ensemble_id WHERE s.request_id = %s", (rid,))
    opt = q1(db, "SELECT o.ensemble_id FROM recommendation_option o JOIN recommendation r "
                 "ON r.recommendation_id = o.recommendation_id WHERE r.request_id = %s AND o.rank_no = 1", (rid,))
    offered = _members(db, opt["ensemble_id"])
    # 타악 성부가 없는 악보 → 추천 첫 조합에서 실제로 놓인 선율 악기만 기록한다(2026-09-29)
    placed = [m for m in offered if m[0] == "melody"]
    assert _members(db, sel["ensemble_id"]) == placed
    assert sel["ensemble_kind"] == ("recommended" if placed == offered else "custom")


async def test_image_structure_fail_is_completed_fallback(app_client, db, engines, ext_key):
    raw, _ = ext_key
    engines.structure = "fail"
    body = await _submit(app_client, raw, files={"score": ("p.png", make_png(), "image/png")},
                         data={"score_type": "staff", "instruments": json.dumps({"mode": "original"})})
    status = await _wait_done(app_client, raw, body["id"])
    assert status["status"] == "completed_fallback" and status["status_label"] == "대체 완료"
    res = (await app_client.get(f"/v1/performances/{body['id']}/result", headers=key_headers(raw))).json()
    assert res["fallback"] is True and res["fallback_reason"] == "NO_SCORE_STRUCTURE"
    assert res["structure_verdict"] == "fail" and res["files"]["musicxml"]
    assert res["original_instruments_unavailable"] is True  # 대체 결과에는 원래 악기가 없다 → 기본 구성
    assert engines.calls == []


async def test_image_recognized_performance(app_client, engines, ext_key):
    raw, _ = ext_key
    body = await _submit(app_client, raw, files={"score": ("p.png", make_png(), "image/png")},
                         data={"score_type": "staff"})
    await _wait_done(app_client, raw, body["id"])
    res = (await app_client.get(f"/v1/performances/{body['id']}/result", headers=key_headers(raw))).json()
    assert res["fallback"] is False and res["engine"] == {"name": "homr", "version": "fake-1.0"}
    assert res["validity_grade"] == "trust" and res["validity_items"]["note_count"] == 12.0


async def test_image_needs_score_type(app_client, engines, ext_key):
    r = await app_client.post("/v1/performances", files={"score": ("p.png", make_png(), "image/png")},
                              headers=key_headers(ext_key[0]))
    assert r.status_code == 422 and r.json()["error"]["code"] == "UPLOAD_SCORE_TYPE_REQUIRED"


async def test_bad_options(app_client, engines, ext_key):
    r = await app_client.post("/v1/performances", files={"score": ("a.png", make_png(), "image/png")},
                              data={"score_type": "staff",
                                    "instruments": json.dumps({"mode": "custom", "tracks": [{"part": 0, "instrument": "kazoo"}]})},
                              headers=key_headers(ext_key[0]))
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    r = await app_client.post("/v1/performances", files={"score": ("a.png", make_png(), "image/png")},
                              data={"score_type": "staff", "transpose_semitones": "13"}, headers=key_headers(ext_key[0]))
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(("name", "make", "mime"), [
    ("song.mid", lambda: make_midi(), "audio/midi"),
    ("song.musicxml", lambda: make_musicxml().encode(), "application/xml"),
])
async def test_midi_musicxml_rejected(app_client, db, engines, ext_key, name, make, mime):
    # 2026-09-29: 연주 API 도 MIDI·MusicXML 을 받지 않는다(G1, 직행 없음) — 요청 행을 만들지 않는다
    before = q1(db, "SELECT COUNT(*) AS n FROM score_request")["n"]
    r = await app_client.post("/v1/performances", files={"score": (name, make(), mime)}, data={"score_type": "staff"},
                              headers=key_headers(ext_key[0]))
    assert r.status_code == 415
    err = r.json()["error"]
    assert err["code"] == "UPLOAD_UNSUPPORTED_TYPE" and err["gate"] == "G1"
    assert err["details"]["allowed"] == ["image", "pdf"] and "PDF" in err["fix"]
    assert q1(db, "SELECT COUNT(*) AS n FROM score_request")["n"] == before


async def test_pdf_all_pages_performance(app_client, db, engines, ext_key):
    # 2026-09-29 여러 쪽: PDF 의 모든 쪽을 300dpi PNG 로 바꿔 쪽마다 인식하고 이어 붙여 연주한다('첫 쪽만' 안내 없음)
    raw, _ = ext_key
    pdf = (FIXTURES / "ok_staff_2p.pdf").read_bytes()
    body = await _submit(app_client, raw, files={"score": ("score.pdf", pdf, "application/pdf")})
    assert body["file_kind"] == "pdf" and body["route"] == "recognize" and body["score_type"] == "staff"
    assert body["pdf_page_count"] == 2 and body["page_count"] == 2 and body["notice"] is None
    status = await _wait_done(app_client, raw, body["id"])
    assert status["status"] == "completed"
    assert [(p["page_no"], p["outcome"]) for p in status["pages"]] == [(1, "converted"), (2, "converted")]
    res = (await app_client.get(f"/v1/performances/{body['id']}/result", headers=key_headers(raw))).json()
    assert res["notice"] is None and res["page_count"] == 2
    assert res["fallback"] is False and res["files"]["musicxml"] and engines.calls == ["homr", "homr"]
    row = q1(db, "SELECT r.file_kind, r.chosen_score_type, u.pdf_page_count, u.pdf_converted_page, "
                 "u.image_short_side_px, u.storage_uri FROM score_request r JOIN upload_file u "
                 "ON u.request_id = r.request_id WHERE r.request_no = %s", (body["id"],))
    assert row["file_kind"] == "pdf" and row["chosen_score_type"] == "staff"
    assert row["pdf_page_count"] == 2 and row["pdf_converted_page"] is None and row["image_short_side_px"] >= 2000
    assert row["storage_uri"].endswith("original.pdf")


async def test_images_partial_failure_performance(app_client, db, engines, ext_key):
    # 사진 3장 중 3쪽이 구조 불통과 → 1·2쪽만 이어 붙여 연주하고 상태·결과에 부분 실패 안내
    raw, _ = ext_key
    engines.structure_seq = ["pass", "pass", "fail"]
    files = [("score", (f"p{i}.png", make_png(), "image/png")) for i in range(3)]
    body = await _submit(app_client, raw, files=files)
    assert body["page_count"] == 3 and body["file_kind"] == "image"
    status = await _wait_done(app_client, raw, body["id"])
    assert status["status"] == "completed"
    assert status["notice"]["message"] == "3쪽 중 2쪽 변환했습니다 (못 읽은 쪽: 3쪽)"
    assert status["pages"][2] | {"engine": None} == {
        "page_no": 3, "file_no": 3, "source": "file", "outcome": "failed", "fallback_reason": "NO_SCORE_STRUCTURE",
        "fallback_message": status["pages"][2]["fallback_message"], "structure_verdict": "fail",
        "validity_grade": None, "engine": None}
    res = (await app_client.get(f"/v1/performances/{body['id']}/result", headers=key_headers(raw))).json()
    assert res["fallback"] is False and res["notice"]["code"] == "PAGES_PARTIAL"
    files_rows = q(db, "SELECT u.file_no FROM upload_file u JOIN score_request r ON r.request_id = u.request_id "
                       "WHERE r.request_no = %s ORDER BY u.file_no", (body["id"],))
    assert [x["file_no"] for x in files_rows] == [1, 2, 3]


async def test_pdf_encrypted_or_broken_rejected(app_client, db, engines, ext_key):
    before = q1(db, "SELECT COUNT(*) AS n FROM score_request")["n"]
    for name in ("encrypted.pdf", "broken.pdf"):
        r = await app_client.post("/v1/performances",
                                  files={"score": (name, (FIXTURES / name).read_bytes(), "application/pdf")},
                                  data={"score_type": "staff"}, headers=key_headers(ext_key[0]))
        assert r.status_code == 422 and r.json()["error"]["code"] == "UPLOAD_CORRUPTED", name
    # (2026-09-30 119번) 반려 기준 300px — 240px 쪽 PDF 는 반려(600px 쪽은 늘려 읽어 통과)
    small = (FIXTURES / "tiny_page.pdf").read_bytes()
    r = await app_client.post("/v1/performances", files={"score": ("s.pdf", small, "application/pdf")},
                              data={"score_type": "staff"}, headers=key_headers(ext_key[0]))
    assert r.status_code == 422 and r.json()["error"]["code"] == "UPLOAD_RESOLUTION_TOO_LOW"
    assert q1(db, "SELECT COUNT(*) AS n FROM score_request")["n"] == before


async def test_result_too_early_is_425(app_client, engines, ext_key):
    raw, _ = ext_key
    engines.render_delay = 1.0
    body = await _submit(app_client, raw)
    r = await app_client.get(f"/v1/performances/{body['id']}/result", headers=key_headers(raw))
    assert r.status_code == 425 and r.json()["status"] in ("received", "converting", "rendering")
    await _wait_done(app_client, raw, body["id"])


async def test_render_failure_keeps_scores(app_client, engines, ext_key):
    raw, _ = ext_key
    engines.render_error = "RENDER_FAILED"
    body = await _submit(app_client, raw)
    await _wait_done(app_client, raw, body["id"])
    res = (await app_client.get(f"/v1/performances/{body['id']}/result", headers=key_headers(raw))).json()
    assert res["render_failure"] == "RENDER_FAILED" and res["files"]["musicxml"] and res["files"]["midi"]


async def test_other_key_cannot_see_request(app_client, db, engines, ext_key):
    body = await _submit(app_client, ext_key[0])
    other, _ = make_external_key(db)
    r = await app_client.get(f"/v1/performances/{body['id']}", headers=key_headers(other))
    assert r.status_code == 404 and r.json()["error"]["code"] == "REQUEST_NOT_FOUND"
    await _wait_done(app_client, ext_key[0], body["id"])


async def test_expired_request(app_client, db, engines, ext_key):
    raw, key_id = ext_key
    body = await _submit(app_client, raw)
    await _wait_done(app_client, raw, body["id"])
    res = (await app_client.get(f"/v1/performances/{body['id']}/result", headers=key_headers(raw))).json()
    with db.cursor() as cur:
        cur.execute("UPDATE score_request SET received_at = received_at - INTERVAL 25 HOUR, "
                    "completed_at = completed_at - INTERVAL 25 HOUR WHERE request_no = %s", (body["id"],))
    s = (await app_client.get(f"/v1/performances/{body['id']}", headers=key_headers(raw))).json()
    assert s["status"] == "expired" and s["remaining_seconds"] == 0
    r = await app_client.get(f"/v1/performances/{body['id']}/result", headers=key_headers(raw))
    assert r.status_code == 410 and r.json()["error"]["code"] == "RESULT_EXPIRED" and r.json()["error"]["gate"] == "G4"
    f = await app_client.get(res["files"]["midi"].replace("http://test", ""))
    assert f.status_code == 410
    log = q1(db, "SELECT outcome, reason_code FROM api_call_log WHERE access_key_id = %s ORDER BY call_id DESC LIMIT 1",
             (key_id,))
    assert log == {"outcome": "expired", "reason_code": "RESULT_EXPIRED"}

    # 삭제 순환: 만료된 API 요청의 파일과 위치를 지운다(T135)
    cfg = app_client.app.state.config
    folder = cfg.api_storage / body["id"]
    assert folder.exists()
    counts = await purge_once(app_client.app.state.db, cfg)
    assert counts["requests"] >= 1 and not folder.exists()
    rid = q1(db, "SELECT request_id, purged_at FROM score_request WHERE request_no = %s", (body["id"],))
    assert rid["purged_at"] is not None
    assert q1(db, "SELECT storage_uri, deleted_at FROM upload_file WHERE request_id = %s",
              (rid["request_id"],))["storage_uri"] is None


async def test_file_token_checks(app_client, engines, ext_key):
    cfg = app_client.app.state.config
    expired = file_tokens.sign(cfg, "R-0101-AAAAAAAA", "midi", ttl_s=-5)
    r = await app_client.get(f"/v1/files/{expired}")
    assert r.status_code == 410 and r.json()["error"]["code"] == "RESULT_EXPIRED"
    good = file_tokens.sign(cfg, "R-0101-AAAAAAAA", "midi")
    tampered = good[:-2] + ("AA" if not good.endswith("AA") else "BB")
    assert (await app_client.get(f"/v1/files/{tampered}")).status_code == 404
    assert (await app_client.get("/v1/files/garbage")).status_code == 404


# ---------------------------------------------------------------- 렌더링 라우터
async def test_render_mp3_and_pdf(app_client, db, engines, ext_key):
    r = await app_client.post("/v1/render/mp3", files={"score": ("a.mid", make_midi(), "audio/midi")},
                              headers=svc_headers())
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg"
    assert r.headers["x-renderer"] == "fluidsynth 2.4-fake"
    # 외부 호출자 + 라이선스 확인 전 → MP3 제외 안내(G7)
    w = await app_client.post("/v1/render/mp3", files={"score": ("a.mid", make_midi(), "audio/midi")},
                              headers=key_headers(ext_key[0]))
    assert w.status_code == 200 and w.json()["mp3_withheld"] is True
    p = await app_client.post("/v1/render/pdf", files={"score": ("a.musicxml", make_musicxml().encode(), "application/xml")},
                              headers=key_headers(ext_key[0]))
    assert p.status_code == 200 and p.content.startswith(b"%PDF") and p.headers["x-renderer"].startswith("verovio")


@pytest.mark.parametrize(("code", "http"), [("RENDER_FAILED", 502), ("RENDERER_MISSING", 502), ("RENDER_TIMEOUT", 504)])
async def test_render_errors(app_client, engines, code, http):
    engines.render_error = code
    r = await app_client.post("/v1/render/pdf", files={"score": ("a.musicxml", make_musicxml().encode(), "application/xml")},
                              headers=svc_headers())
    assert r.status_code == http and r.json()["error"]["code"] == code


