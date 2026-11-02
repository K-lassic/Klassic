"""#30 격리 DB에서 실제 정간보 사진·PDF 인식과 양방향 종류 불일치를 확인한다.

공개 예제 PDF·오선보 PNG를 base64 자리표시자에 넣어 stdin으로 실행한다.
시험 키·요청·결과 파일만 정리하며 기존 데이터·모델 등록부·가중치는 바꾸지 않는다.
"""
import asyncio
import base64
import hashlib
import json
import secrets
import shutil
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET

from app.checks.pdf import render_pages
from app.config import load_config
from app.db import Database
from app.services.requests import new_request_no

PDF_BASE64 = "__JEONGGANBO_PDF_BASE64__"
STAFF_BASE64 = "__STAFF_BASE64__"


def post(name, data, key=None, request_no=None, kind="jeongganbo", deadline=None):
    boundary = "jeongganbo" + uuid.uuid4().hex
    parts = []
    if request_no:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="request_no"\r\n\r\n{request_no}\r\n'.encode())
    parts += [f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode(),
              data, f"\r\n--{boundary}--\r\n".encode()]
    headers = {"Content-Type": "multipart/form-data; boundary=" + boundary}
    if key:
        headers["X-API-Key"] = key
    if deadline:
        headers["X-Deadline"] = deadline
    request = urllib.request.Request(f"http://127.0.0.1:9543/v1/omr/{kind}", data=b"".join(parts), headers=headers)
    try:
        response = urllib.request.urlopen(request, timeout=210)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        assert response.headers.get("X-Request-ID")
        return response.status, json.load(response)


async def main():
    cfg = load_config()
    if cfg.db_name != "klassic_issue24":
        raise RuntimeError("격리된 klassic_issue24 시험 DB에서만 실행하십시오")
    db = await Database.connect(cfg)
    operator = key_id = session_id = None
    requests = []
    report = {}
    try:
        operator = await db.execute(
            "INSERT INTO operator_account(login_id,password_hash,display_name,disabled_at) VALUES(%s,%s,%s,UTC_TIMESTAMP(3))",
            ("jeongganbo_" + uuid.uuid4().hex[:16], "disabled-test-only", "정간보 인식 시험"))
        raw = secrets.token_urlsafe(32)
        key_id = await db.execute(
            "INSERT INTO access_key(key_kind,key_hash,key_prefix,issued_by) VALUES('service',%s,%s,%s)",
            (hashlib.sha256(raw.encode()).hexdigest(), raw[:8], operator))
        pdf = base64.b64decode(PDF_BASE64)
        photo = render_pages(pdf, limit=1)[0].png
        staff = base64.b64decode(STAFF_BASE64)
        status, body = await asyncio.to_thread(post, "score.png", photo)
        assert status == 401 and body["error"]["code"] == "AUTH_KEY_MISSING"
        report["missing_key"] = status

        for label, name, content in (("photo", "score.png", photo), ("pdf", "score.pdf", pdf)):
            status, body = await asyncio.to_thread(post, name, content, raw)
            assert status == 200 and not body.get("fallback", True), (label, status, body.get("fallback_reason"), body.get("engine"))
            assert body["engine"]["name"] == "jeongganbo-omr" and body["converted_pages"] >= 1
            assert body["validity_items"]["yulmyeong_ratio"] > 0
            assert body["timings_ms"]["jg_convert"] >= 0
            assert ET.fromstring(body["musicxml"]).tag == "score-partwise"
            assert base64.b64decode(body["midi_base64"]).startswith(b"MThd")
            row = await db.fetch_one("SELECT request_id,request_no FROM score_request WHERE request_no=%s", (body["request_no"],))
            rid = row["request_id"]
            requests.append((rid, row["request_no"]))
            evidence = {}
            for table in ("request_page", "engine_attempt", "processing_job", "validity_check_item", "stage_timing"):
                evidence[table] = int((await db.fetch_one(f"SELECT COUNT(*) AS n FROM {table} WHERE request_id=%s", (rid,)))["n"])
                assert evidence[table] > 0, table
            job = await db.fetch_one("SELECT confirmed_score_type FROM processing_job WHERE request_id=%s", (rid,))
            assert job["confirmed_score_type"] == "jeongganbo"
            result = await db.fetch_one("SELECT musicxml_uri,midi_uri FROM score_result WHERE request_id=%s", (rid,))
            assert (cfg.storage_dir / result["musicxml_uri"]).is_file()
            assert (cfg.storage_dir / result["midi_uri"]).is_file()
            assert await db.fetch_one("SELECT * FROM stage_timing WHERE request_id=%s AND stage_code='jg_convert'", (rid,))
            report[label] = {"fallback": False, "grade": body["validity_grade"], "midi": True,
                             "ratio": body["validity_items"]["yulmyeong_ratio"], "timings_ms": body["timings_ms"],
                             "db_rows": evidence}

        session_id = str(uuid.uuid4())
        await db.execute("INSERT INTO anon_session(session_id) VALUES(%s)", (session_id,))
        setting = await db.fetch_one("SELECT setting_version_id FROM v_current_setting")
        no = new_request_no()
        rid = await db.execute("INSERT INTO score_request(request_no,channel,session_id,file_kind,chosen_score_type,route,status,setting_version_id) "
                               "VALUES(%s,'web',%s,'image','jeongganbo','recognize','converting',%s)",
                               (no, session_id, setting["setting_version_id"]))
        requests.append((rid, no))
        await db.execute("INSERT INTO upload_file(request_id,file_no,original_name,size_bytes,image_short_side_px,storage_uri) "
                         "VALUES(%s,1,'type-check.png',%s,700,'smoke-only/web/type-check.png')", (rid, len(staff)))
        for chosen, detected, content in (("jeongganbo", "staff", staff), ("staff", "jeongganbo", photo)):
            status, body = await asyncio.to_thread(post, "wrong.png", content, raw, no, chosen)
            assert status == 200 and body["type_mismatch"] and body["detected_type"] == detected, (chosen, status, body.get("detected_type"))
            assert body["fallback"] and body["musicxml"] is None and body["midi_base64"] is None
            assert await db.fetch_one("SELECT * FROM engine_attempt WHERE request_id=%s", (rid,)) is None
            assert await db.fetch_one("SELECT * FROM score_result WHERE request_id=%s", (rid,)) is None
            assert not (cfg.api_storage / no).exists()
            job = await db.fetch_one("SELECT type_mismatch FROM processing_job WHERE request_id=%s", (rid,))
            assert job["type_mismatch"]
            report[f"{chosen}_detects_{detected}"] = True
        status, body = await asyncio.to_thread(post, "score.png", photo, raw, no, "jeongganbo", "2020-01-01T00:00:00Z")
        assert status == 200 and body["fallback_reason"] == "TIMEOUT"
        report["expired_deadline"] = "TIMEOUT"
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    finally:
        if key_id:
            rows = await db.fetch_all("SELECT request_id,request_no FROM score_request WHERE access_key_id=%s", (key_id,))
            requests += [(r["request_id"], r["request_no"]) for r in rows]
            await db.execute("DELETE FROM api_call_log WHERE access_key_id=%s", (key_id,))
        for rid, no in set(requests):
            for table in ("api_call_log", "engine_attempt", "validity_check_item", "stage_timing", "request_page",
                          "processing_job", "score_result", "upload_file", "score_request"):
                await db.execute(f"DELETE FROM {table} WHERE request_id=%s", (rid,))
            folder = (cfg.api_storage / no).resolve()
            if folder.parent == cfg.api_storage.resolve() and folder.name.startswith("R-") and folder.is_dir():
                shutil.rmtree(folder)
        if session_id:
            await db.execute("DELETE FROM anon_session WHERE session_id=%s", (session_id,))
        if key_id:
            await db.execute("DELETE FROM access_key WHERE key_id=%s", (key_id,))
        if operator:
            await db.execute("DELETE FROM operator_account WHERE operator_id=%s", (operator,))
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
