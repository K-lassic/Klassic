"""POST /v1/omr/staff · /v1/omr/jeongganbo 계약 시험 (T058 · T057 · T072 · D-18)."""

from __future__ import annotations

import base64
import uuid
from datetime import UTC, datetime, timedelta

from .conftest import key_headers, make_png, q, q1, svc_headers


def _files(name: str = "score.png", data: bytes | None = None):
    return {"image": (name, data or make_png(), "image/png")}


def _web_request(db, score_type: str = "staff", files: int = 1, kind: str = "image") -> str:
    """웹 서비스가 만든 것처럼 score_request(channel web)와 upload_file(file_no 1~files)을 넣는다."""
    sid = str(uuid.uuid4())
    no = "R-0928-W" + uuid.uuid4().hex[:7].upper()
    with db.cursor() as cur:
        cur.execute("INSERT INTO anon_session (session_id) VALUES (%s)", (sid,))
        cur.execute(
            "INSERT INTO score_request (request_no, channel, session_id, file_kind, chosen_score_type, route, status, "
            "setting_version_id) VALUES (%s,'web',%s,%s,%s,'recognize','converting',1)",
            (no, sid, kind, score_type),
        )
        rid = cur.lastrowid
        for n in range(1, files + 1):
            cur.execute("INSERT INTO upload_file (request_id, file_no, original_name, size_bytes, storage_uri) "
                        "VALUES (%s,%s,%s,100,%s)", (rid, n, f"p{n}.png", f"{no}/original{n}.png"))
    return no


async def test_staff_success_external(app_client, db, engines, ext_key):
    raw, key_id = ext_key
    r = await app_client.post("/v1/omr/staff", files=_files(), headers=key_headers(raw))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["api_version"] == "v1"
    assert body["fallback"] is False and body["fallback_reason"] is None
    assert body["structure_verdict"] == "pass" and body["validity_grade"] == "trust"
    assert body["engine"]["name"] == "homr" and body["engine"]["version"] == "fake-1.0"
    assert body["musicxml"].lstrip().startswith("<?xml")
    assert base64.b64decode(body["midi_base64"])[:4] == b"MThd"
    assert set(body["validity_items"]) == {"note_count", "beat_sum", "range_leap", "yulmyeong_ratio", "engine_confidence"}
    assert engines.calls == ["homr"]

    req = q1(db, "SELECT * FROM score_request WHERE request_no = %s", (body["request_no"],))
    assert req["channel"] == "api" and req["access_key_id"] == key_id
    assert req["route"] == "recognize" and req["status"] == "completed" and req["completed_at"]
    rid = req["request_id"]
    job = q1(db, "SELECT * FROM processing_job WHERE request_id = %s", (rid,))
    assert job["structure_verdict"] == "pass" and job["validity_grade"] == "trust" and job["finished_at"]
    attempts = q(db, "SELECT engine_name, outcome FROM engine_attempt WHERE request_id = %s", (rid,))
    assert attempts == [{"engine_name": "homr", "outcome": "success"}]
    stages = {r["stage_code"] for r in q(db, "SELECT stage_code FROM stage_timing WHERE request_id = %s", (rid,))}
    assert {"check", "queue", "structure", "validity"} <= stages
    items = {r["item_code"] for r in q(db, "SELECT item_code FROM validity_check_item WHERE request_id = %s", (rid,))}
    assert {"note_count", "beat_sum", "range_leap", "engine_confidence"} <= items
    result = q1(db, "SELECT origin, fallback_template_id FROM score_result WHERE request_id = %s", (rid,))
    assert result == {"origin": "recognized", "fallback_template_id": None}
    log = q1(db, "SELECT * FROM api_call_log WHERE request_id = %s", (rid,))
    assert log["outcome"] == "accepted" and log["access_key_id"] == key_id and log["endpoint"] == "POST /v1/omr/staff"


async def test_structure_fail_skips_engines_and_returns_template(app_client, db, engines, ext_key):
    engines.structure = "fail"
    r = await app_client.post("/v1/omr/staff", files=_files(), headers=key_headers(ext_key[0]))
    body = r.json()
    assert r.status_code == 200
    assert body["fallback"] is True and body["fallback_reason"] == "NO_SCORE_STRUCTURE"
    assert body["retry_hint"] == "악보 사진을 다시 올려 보십시오."
    assert body["validity_grade"] is None
    assert engines.calls == []  # 구조 불통과면 엔진을 부르지 않는다(BR-ENG-06)
    assert "<score-partwise" in body["musicxml"] and body["midi_base64"]  # 외부 호출자에게는 서버 템플릿
    req = q1(db, "SELECT request_id, route, fallback_reason, status FROM score_request WHERE request_no = %s",
             (body["request_no"],))
    assert (req["route"], req["fallback_reason"], req["status"]) == ("fallback", "no_structure", "completed")
    res = q1(db, "SELECT r.origin, t.holder, t.score_type FROM score_result r JOIN fallback_template t "
                 "ON t.template_id = r.fallback_template_id WHERE r.request_id = %s", (req["request_id"],))
    assert res == {"origin": "fallback", "holder": "api_server", "score_type": "staff"}  # 오선보 요청 → 오선보 대체 악보(BR-FBK-09)
    assert q(db, "SELECT 1 FROM engine_attempt WHERE request_id = %s", (req["request_id"],)) == []


async def test_jeongganbo_fallback_uses_jeongganbo_template(app_client, db, engines, ext_key):
    """(2026-09-30 UC_02 BR-FBK-09) 정간보 요청이 대체되면 정간보 대체 악보(타령 가야금)를 준다."""
    engines.structure = "fail"
    r = await app_client.post("/v1/omr/jeongganbo", files=_files(), headers=key_headers(ext_key[0]))
    body = r.json()
    assert r.status_code == 200 and body["fallback"] is True
    res = q1(db, "SELECT t.name, t.score_type FROM score_result r JOIN fallback_template t ON t.template_id = r.fallback_template_id "
                 "JOIN score_request s ON s.request_id = r.request_id WHERE s.request_no = %s", (body["request_no"],))
    assert res == {"name": "타령 (가야금 정간보)", "score_type": "jeongganbo"}


async def test_engine_order_falls_through(app_client, db, engines, ext_key):
    engines.results = {"homr": [{"outcome": "error", "code": "CRASH"}]}
    r = await app_client.post("/v1/omr/staff", files=_files(), headers=key_headers(ext_key[0]))
    body = r.json()
    assert body["fallback"] is False and body["engine"]["name"] == "audiveris"
    assert [t["name"] for t in body["engine"]["tried"]] == ["homr", "audiveris"]
    rid = q1(db, "SELECT request_id FROM score_request WHERE request_no = %s", (body["request_no"],))["request_id"]
    rows = q(db, "SELECT attempt_no, engine_name, outcome, failure_code FROM engine_attempt WHERE request_id = %s "
                 "ORDER BY attempt_no", (rid,))
    assert [(x["engine_name"], x["outcome"]) for x in rows] == [("homr", "error"), ("audiveris", "success")]
    assert rows[0]["failure_code"] == "CRASH" and rows[1]["failure_code"] is None


async def test_no_notes_stops_engine_order(app_client, engines, ext_key):
    # 가이드 G2: 첫 엔진이 음표 없음이면 다음 엔진을 부르지 않고 바로 대체한다
    for name in ("homr", "audiveris"):
        engines.results[name] = [{"outcome": "no_notes", "code": "NO_NOTES"}]
    body = (await app_client.post("/v1/omr/staff", files=_files(), headers=key_headers(ext_key[0]))).json()
    assert body["fallback"] is True and body["fallback_reason"] == "NO_NOTES"
    assert engines.calls == ["homr"]


async def test_no_notes_after_error_wins_over_error(app_client, engines, ext_key):
    # 가이드 G3: 오류 뒤 음표 없음 → 이유는 음표 없음(오류보다 앞선다)
    engines.results = {"homr": [{"outcome": "error", "code": "CRASH"}],
                       "audiveris": [{"outcome": "no_notes", "code": "NO_NOTES"}]}
    body = (await app_client.post("/v1/omr/staff", files=_files(), headers=key_headers(ext_key[0]))).json()
    assert body["fallback"] is True and body["fallback_reason"] == "NO_NOTES"
    assert engines.calls == ["homr", "audiveris"]
    assert [t["outcome"] for t in body["engine"]["tried"]] == ["error", "no_notes"]


async def test_zero_note_success_is_no_notes(app_client, engines, ext_key):
    engines.note_count = 0
    body = (await app_client.post("/v1/omr/staff", files=_files(), headers=key_headers(ext_key[0]))).json()
    assert body["fallback_reason"] == "NO_NOTES"
    assert all(t["outcome"] == "no_notes" for t in body["engine"]["tried"])


async def test_distrust_falls_back(app_client, db, engines, ext_key):
    engines.grade = "distrust"
    body = (await app_client.post("/v1/omr/staff", files=_files(), headers=key_headers(ext_key[0]))).json()
    assert body["fallback"] is True and body["fallback_reason"] == "UNTRUSTED_RESULT"
    assert body["validity_grade"] == "distrust"
    req = q1(db, "SELECT fallback_reason FROM score_request WHERE request_no = %s", (body["request_no"],))
    assert req["fallback_reason"] == "distrust"


async def test_not_installed_engines_are_skipped(app_client, engines, ext_key):
    reg = app_client.app.state.registry
    for name in ("homr", "audiveris"):
        reg.get(name).installed, reg.get(name).state = False, "unavailable"
    body = (await app_client.post("/v1/omr/staff", files=_files(), headers=key_headers(ext_key[0]))).json()
    assert body["fallback_reason"] == "ENGINE_DOWN"
    assert engines.calls == []


async def test_deadline_in_past_times_out(app_client, engines, ext_key):
    past = (datetime.now(UTC) - timedelta(seconds=5)).isoformat()
    body = (await app_client.post("/v1/omr/staff", files=_files(),
                                  headers=key_headers(ext_key[0], **{"X-Deadline": past}))).json()
    assert body["fallback_reason"] == "TIMEOUT"
    assert engines.calls == []


async def test_web_request_writes_judgement_only_and_no_files(app_client, db, engines):
    no = _web_request(db)
    engines.structure = "fail"
    r = await app_client.post("/v1/omr/staff", files=_files(), data={"request_no": no}, headers=svc_headers())
    body = r.json()
    assert body["request_no"] == no and body["fallback_reason"] == "NO_SCORE_STRUCTURE"
    assert body["musicxml"] is None and body["midi_base64"] is None  # 웹은 자기 템플릿을 쓴다(BR-FBK-02)
    rid = q1(db, "SELECT request_id, route, status FROM score_request WHERE request_no = %s", (no,))
    assert rid["route"] == "recognize" and rid["status"] == "converting"  # 웹 요청 상태는 웹이 쓴다
    assert q1(db, "SELECT structure_verdict FROM processing_job WHERE request_id = %s",
              (rid["request_id"],))["structure_verdict"] == "fail"
    assert q(db, "SELECT 1 FROM score_result WHERE request_id = %s", (rid["request_id"],)) == []
    stages = {x["stage_code"] for x in q(db, "SELECT stage_code FROM stage_timing WHERE request_id = %s",
                                         (rid["request_id"],))}
    assert stages == {"structure"}  # check·queue 는 웹이 쓴다


async def test_web_rerun_after_type_change_is_safe(app_client, db, engines):
    """FR-058: 같은 request_no 로 다른 종류를 다시 부르면 기록을 덮어쓰고 성공은 하나만 남는다."""
    no = _web_request(db, "staff")
    engines.type_mismatch, engines.detected_type = True, "jeongganbo"
    first = (await app_client.post("/v1/omr/staff", files=_files(), data={"request_no": no},
                                   headers=svc_headers())).json()
    assert first["type_mismatch"] is True and first["detected_type"] == "jeongganbo" and first["fallback"] is False
    rid = q1(db, "SELECT request_id FROM score_request WHERE request_no = %s", (no,))["request_id"]
    with db.cursor() as cur:  # 웹이 사용자 답을 적는다
        cur.execute("UPDATE processing_job SET type_answer = 'changed' WHERE request_id = %s", (rid,))
    engines.type_mismatch, engines.detected_type = False, "jeongganbo"
    second = (await app_client.post("/v1/omr/jeongganbo", files=_files(), data={"request_no": no},
                                    headers=svc_headers())).json()
    assert second["fallback"] is False and second["engine"]["name"] == "jeongganbo-omr"
    assert second["validity_items"]["yulmyeong_ratio"] == 0.9
    job = q1(db, "SELECT * FROM processing_job WHERE request_id = %s", (rid,))
    assert job["confirmed_score_type"] == "jeongganbo" and job["type_answer"] == "changed" and job["type_mismatch"] == 1
    attempts = q(db, "SELECT attempt_no, engine_name, outcome, failure_code FROM engine_attempt WHERE request_id = %s "
                     "ORDER BY attempt_no", (rid,))
    assert [(a["engine_name"], a["outcome"], a["failure_code"]) for a in attempts] == [
        ("homr", "error", "SUPERSEDED"), ("jeongganbo-omr", "success", None)]
    stages = {x["stage_code"] for x in q(db, "SELECT stage_code FROM stage_timing WHERE request_id = %s", (rid,))}
    assert {"structure", "jg_convert", "validity"} <= stages


async def test_web_request_unknown_number(app_client, engines):
    r = await app_client.post("/v1/omr/staff", files=_files(), data={"request_no": "R-0101-NOPE0000"},
                              headers=svc_headers())
    assert r.status_code == 404 and r.json()["error"]["code"] == "REQUEST_NOT_FOUND"


async def test_upload_rejected_creates_no_request(app_client, db, engines, ext_key):
    raw, key_id = ext_key
    r = await app_client.post("/v1/omr/staff", files={"image": ("a.txt", b"hello", "text/plain")}, headers=key_headers(raw))
    assert r.status_code == 415
    err = r.json()["error"]
    assert err["code"] == "UPLOAD_UNSUPPORTED_TYPE" and err["gate"] == "G1" and err["fix"]
    log = q1(db, "SELECT outcome, reason_code, request_id FROM api_call_log WHERE access_key_id = %s "
                 "ORDER BY call_id DESC LIMIT 1", (key_id,))
    assert log == {"outcome": "rejected_file", "reason_code": "UPLOAD_UNSUPPORTED_TYPE", "request_id": None}


async def test_midi_sent_to_omr_is_rejected(app_client, engines, ext_key):
    from .conftest import make_midi

    r = await app_client.post("/v1/omr/staff", files={"image": ("a.mid", make_midi(), "audio/midi")},
                              headers=key_headers(ext_key[0]))
    assert r.status_code == 415 and r.json()["error"]["code"] == "UPLOAD_UNSUPPORTED_TYPE"


async def test_cold_engine_first_use_records_request_load(app_client, db, engines, ext_key):
    reg = app_client.app.state.registry
    assert reg.get("homr").state == "cold"
    await app_client.post("/v1/omr/staff", files=_files(), headers=key_headers(ext_key[0]))
    assert reg.get("homr").state == "ready"
    ev = q1(db, "SELECT trigger_kind, outcome, duration_ms FROM model_load_event WHERE model_name = 'homr' "
                "ORDER BY load_id DESC LIMIT 1")
    assert ev["trigger_kind"] == "request" and ev["outcome"] == "ok" and ev["duration_ms"] is not None


# ---------------------------------------------------------------- PDF 입력 (2026-09-29 황송해 결정, UC3 A7 · UC12)
def _pdf_files(name: str = "ok_staff_2p.pdf"):
    from .conftest import FIXTURES

    return {"image": ("score.pdf", (FIXTURES / name).read_bytes(), "application/pdf")}


async def test_pdf_external_all_pages_converted_and_joined(app_client, db, engines, ext_key):
    # 2026-09-29 여러 쪽: PDF 는 모든 쪽을 300dpi 로 바꿔 쪽마다 인식하고, 성공한 쪽을 이어 붙인다
    raw, _ = ext_key
    r = await app_client.post("/v1/omr/staff", files=_pdf_files(), headers=key_headers(raw))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["fallback"] is False and body["file_kind"] == "pdf" and body["pdf_page_count"] == 2
    assert body["page_count"] == 2 and body["converted_pages"] == 2 and body["notice"] is None
    assert [p["outcome"] for p in body["pages"]] == ["converted", "converted"]
    assert [p["source"] for p in body["pages"]] == ["pdf_page", "pdf_page"]
    assert engines.calls == ["homr", "homr"]
    # 쪽마다 12음 × 2쪽 — 이은 악보에 두 쪽의 음이 모두 있다
    assert body["musicxml"].count("<note") == 24 and body["validity_items"]["note_count"] == 24.0
    row = q1(db, "SELECT r.file_kind, r.route, u.pdf_page_count, u.pdf_converted_page, u.file_no FROM score_request r "
                 "JOIN upload_file u ON u.request_id = r.request_id WHERE r.request_no = %s", (body["request_no"],))
    assert row == {"file_kind": "pdf", "route": "recognize", "pdf_page_count": 2, "pdf_converted_page": None,
                   "file_no": 1}
    pages = q(db, "SELECT p.page_no, p.file_no, p.source, p.outcome, p.image_short_side_px FROM request_page p "
                  "JOIN score_request r ON r.request_id = p.request_id WHERE r.request_no = %s ORDER BY p.page_no",
              (body["request_no"],))
    assert [(p["page_no"], p["file_no"], p["source"], p["outcome"]) for p in pages] == [
        (1, 1, "pdf_page", "converted"), (2, 1, "pdf_page", "converted")]
    assert all(p["image_short_side_px"] >= 2000 for p in pages)
    att = q(db, "SELECT a.page_no, a.attempt_no, a.outcome FROM engine_attempt a JOIN score_request r "
                "ON r.request_id = a.request_id WHERE r.request_no = %s ORDER BY a.page_no", (body["request_no"],))
    assert [(a["page_no"], a["attempt_no"], a["outcome"]) for a in att] == [(1, 1, "success"), (2, 1, "success")]


async def test_images_in_upload_order_joined(app_client, db, engines, ext_key):
    # 사진 여러 장은 올린 순서대로 한 쪽씩 — 쪽마다 다른 악보를 돌려 이은 순서를 확인한다
    from .conftest import make_musicxml

    engines.results["homr"] = [{"musicxml": make_musicxml(["C4"] * 4)}, {"musicxml": make_musicxml(["G5"] * 4)},
                               {"musicxml": make_musicxml(["E4"] * 4)}]
    files = [("image", (f"p{i}.png", make_png(1000, 900 + i), "image/png")) for i in range(3)]
    r = await app_client.post("/v1/omr/staff", files=files, headers=key_headers(ext_key[0]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["page_count"] == 3 and body["converted_pages"] == 3 and body["file_kind"] == "image"
    xml = body["musicxml"]
    assert xml.index("<step>C</step>") < xml.index("<step>G</step>") < xml.index("<step>E</step>")
    rows = q(db, "SELECT u.file_no, u.original_name FROM upload_file u JOIN score_request r ON r.request_id = u.request_id "
                 "WHERE r.request_no = %s ORDER BY u.file_no", (body["request_no"],))
    assert [(x["file_no"], x["original_name"]) for x in rows] == [(1, "p0.png"), (2, "p1.png"), (3, "p2.png")]


async def test_partial_failure_drops_page_and_notices(app_client, db, engines, ext_key):
    # 2쪽이 음표 없음 → 그 쪽을 빼고 이어 붙이고 "3쪽 중 2쪽 변환했어요 (못 읽은 쪽: 2쪽)"(PAGES_PARTIAL)
    engines.results["homr"] = [{"outcome": "success"}, {"outcome": "no_notes", "code": "NO_NOTES"},
                               {"outcome": "success"}]
    files = [("image", (f"p{i}.png", make_png(), "image/png")) for i in range(3)]
    r = await app_client.post("/v1/omr/staff", files=files, headers=key_headers(ext_key[0]))
    body = r.json()
    assert body["fallback"] is False and body["converted_pages"] == 2
    assert body["notice"] == {"code": "PAGES_PARTIAL", "message": "3쪽 중 2쪽 변환했습니다 (못 읽은 쪽: 2쪽)",
                              "pages": 3, "converted": 2, "failed_pages": [2]}
    assert [p["outcome"] for p in body["pages"]] == ["converted", "failed", "converted"]
    assert body["pages"][1]["fallback_reason"] == "NO_NOTES"
    assert body["musicxml"].count("<note") == 24
    rows = q(db, "SELECT p.page_no, p.outcome, p.fallback_reason FROM request_page p JOIN score_request r "
                 "ON r.request_id = p.request_id WHERE r.request_no = %s ORDER BY p.page_no", (body["request_no"],))
    assert [(x["outcome"], x["fallback_reason"]) for x in rows] == [
        ("converted", None), ("failed", "recognition_failed"), ("converted", None)]
    req = q1(db, "SELECT route, fallback_reason FROM score_request WHERE request_no = %s", (body["request_no"],))
    assert req == {"route": "recognize", "fallback_reason": None}


async def test_all_pages_failed_is_fallback(app_client, db, engines, ext_key):
    # 모든 쪽 실패 → 지금처럼 대체 템플릿(UC2). '불신' 쪽도 실패로 본다
    engines.structure_seq = ["fail", "fail"]
    files = [("image", (f"p{i}.png", make_png(), "image/png")) for i in range(2)]
    r = await app_client.post("/v1/omr/staff", files=files, headers=key_headers(ext_key[0]))
    body = r.json()
    assert body["fallback"] is True and body["fallback_reason"] == "NO_SCORE_STRUCTURE"
    assert body["converted_pages"] == 0 and body["notice"] is None and engines.calls == []
    engines.grade = "distrust"
    r = await app_client.post("/v1/omr/staff", files=files, headers=key_headers(ext_key[0]))
    body = r.json()
    assert body["fallback"] is True and body["fallback_reason"] == "UNTRUSTED_RESULT"
    assert [p["validity_grade"] for p in body["pages"]] == ["distrust", "distrust"]


async def test_eleven_pages_rejected(app_client, db, engines, ext_key):
    from .conftest import make_pdf

    files = [("image", (f"p{i}.png", make_png(), "image/png")) for i in range(11)]
    r = await app_client.post("/v1/omr/staff", files=files, headers=key_headers(ext_key[0]))
    assert r.status_code == 422 and r.json()["error"]["code"] == "UPLOAD_TOO_MANY_PAGES"
    r = await app_client.post("/v1/omr/staff", files={"image": ("s.pdf", make_pdf(11), "application/pdf")},
                              headers=key_headers(ext_key[0]))
    assert r.status_code == 422 and r.json()["error"]["code"] == "UPLOAD_TOO_MANY_PAGES"
    assert r.json()["error"]["details"]["pdf_page_count"] == 11
    r = await app_client.post("/v1/omr/staff", files={"image": ("s.pdf", make_pdf(10), "application/pdf")},
                              headers=key_headers(ext_key[0]))
    assert r.status_code == 200, r.text
    assert r.json()["page_count"] == 10


async def test_mixed_pdf_and_image_rejected(app_client, db, engines, ext_key):
    pdf = _pdf_files()["image"][1]
    mixed = [("image", ("a.pdf", pdf, "application/pdf")), ("image", ("b.png", make_png(), "image/png"))]
    r = await app_client.post("/v1/omr/staff", files=mixed, headers=key_headers(ext_key[0]))
    assert r.status_code == 422 and r.json()["error"]["code"] == "UPLOAD_TOO_MANY_FILES"
    two_pdf = [("image", ("a.pdf", pdf, "application/pdf")), ("image", ("b.pdf", pdf, "application/pdf"))]
    r = await app_client.post("/v1/omr/staff", files=two_pdf, headers=key_headers(ext_key[0]))
    assert r.status_code == 422 and r.json()["error"]["code"] == "UPLOAD_TOO_MANY_FILES"
    n = q1(db, "SELECT COUNT(*) AS n FROM api_call_log WHERE reason_code = 'UPLOAD_TOO_MANY_FILES' AND request_id IS NULL")
    assert n["n"] >= 2


async def test_pdf_web_request_all_pages(app_client, db, engines):
    no = _web_request(db, kind="pdf")
    r = await app_client.post("/v1/omr/staff", files=_pdf_files(), data={"request_no": no}, headers=svc_headers())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pdf_page_count"] == 2 and body["page_count"] == 2 and body["notice"] is None
    assert body["short_edge_px"] >= 2000 and body["musicxml"].count("<note") == 24
    rows = q(db, "SELECT p.page_no, p.file_no, p.source FROM request_page p JOIN score_request r "
                 "ON r.request_id = p.request_id WHERE r.request_no = %s ORDER BY p.page_no", (no,))
    assert [(x["page_no"], x["file_no"], x["source"]) for x in rows] == [(1, 1, "pdf_page"), (2, 1, "pdf_page")]


async def test_pdf_encrypted_is_corrupted(app_client, engines, ext_key):
    r = await app_client.post("/v1/omr/staff", files=_pdf_files("encrypted.pdf"), headers=key_headers(ext_key[0]))
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "UPLOAD_CORRUPTED" and err["details"]["reason"] == "encrypted"


async def test_internal_upload_check(app_client, engines, ext_key):
    # 웹 서비스가 PDF 를 접수하기 전에 부르는 검사 위임 — 서비스 키만
    files = {"file": ("score.pdf", _pdf_files()["image"][1], "application/pdf")}
    r = await app_client.post("/v1/internal/upload-check", files=files, data={"score_type": "staff"}, headers=svc_headers())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True and body["kind"] == "pdf" and body["pdf_page_count"] == 2
    assert body["page_count"] == 2 and body["short_edge_px"] >= 2000
    assert [p["page_no"] for p in body["pages"]] == [1, 2]
    r = await app_client.post("/v1/internal/upload-check", files=files, headers=svc_headers())
    assert r.status_code == 422 and r.json()["error"]["code"] == "UPLOAD_SCORE_TYPE_REQUIRED"
    r = await app_client.post("/v1/internal/upload-check", files=files, data={"score_type": "staff"},
                              headers=key_headers(ext_key[0]))
    assert r.status_code in (401, 403)
