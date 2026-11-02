"""별도 시험 DB에서 실제 HTTP·homr·파일·DB 연동을 확인하고 시험 요청을 정리한다.

SAMPLE_BASE64 자리에는 저장소의 공개 오선보 예제 이미지를 넣어 stdin으로 실행한다.
키 원문·응답 원문은 출력하지 않는다.
"""
import asyncio
import base64
import hashlib
import io
import json
import secrets
import shutil
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET

from PIL import Image

from app.config import load_config
from app.db import Database
from app.services.requests import new_request_no

SAMPLE_BASE64 = "__SAMPLE_BASE64__"


def post(files, key=None, request_no=None, deadline=None):
    boundary = "recognize" + uuid.uuid4().hex
    parts = []
    if request_no:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="request_no"\r\n\r\n{request_no}\r\n'.encode())
    for name, content in files:
        parts += [f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode(), content, b"\r\n"]
    parts.append(f"--{boundary}--\r\n".encode())
    headers = {"Content-Type": "multipart/form-data; boundary=" + boundary}
    if key:
        headers["X-API-Key"] = key
    if deadline:
        headers["X-Deadline"] = deadline
    req = urllib.request.Request("http://127.0.0.1:9543/v1/omr/staff", data=b"".join(parts), headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=210)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        assert response.headers.get("X-Request-ID")
        return response.status, json.load(response)


async def main():
    cfg = load_config()
    if cfg.db_name != "klassic_issue24":
        raise RuntimeError("기존 #24/#28 별도 시험 DB에서만 실행하십시오")
    db = await Database.connect(cfg)
    operator, key_id, session_id = None, None, None
    requests = []
    report = {}
    try:
        operator = await db.execute(
            "INSERT INTO operator_account(login_id,password_hash,display_name,disabled_at) VALUES(%s,%s,%s,UTC_TIMESTAMP(3))",
            ("recognize_" + uuid.uuid4().hex[:16], "disabled-test-only", "오선보 인식 시험"))
        raw = secrets.token_urlsafe(32)
        key_id = await db.execute(
            "INSERT INTO access_key(key_kind,key_hash,key_prefix,issued_by) VALUES('service',%s,%s,%s)",
            (hashlib.sha256(raw.encode()).hexdigest(), raw[:8], operator))
        sample = base64.b64decode(SAMPLE_BASE64)
        blank = io.BytesIO()
        Image.new("RGB", (700, 700), "white").save(blank, "PNG")
        status, body = await asyncio.to_thread(post, [("staff.png", sample)])
        assert status == 401 and body["error"]["code"] == "AUTH_KEY_MISSING"
        report["missing_key"] = status
        with urllib.request.urlopen("http://127.0.0.1:9543/v1/models", timeout=10) as response:
            models = json.load(response)
        homr = next(m for m in models if m["name"] == "homr")
        assert homr["installed"] and homr["state"] == "ready"
        assert homr["expected_seconds"] is not None and homr["last_load_ms"] is not None
        report["public_models_ready"] = True

        status, body = await asyncio.to_thread(post, [("staff.png", sample), ("blank.png", blank.getvalue())], raw)
        if body.get("request_no"):
            row = await db.fetch_one("SELECT request_id,request_no FROM score_request WHERE request_no=%s", (body["request_no"],))
            requests.append((row["request_id"], row["request_no"]))
        assert status == 200, ("actual_staff", status, body.get("error", {}).get("code"))
        assert body["fallback"] is False, ("actual_staff_fallback", body["fallback_reason"], body["engine"])
        assert body["converted_pages"] == 1 and body["engine"]["name"] == "homr"
        assert body["page_count"] == 2 and body["notice"]["failed_pages"] == [2]
        assert [p["outcome"] for p in body["pages"]] == ["converted", "failed"]
        assert ET.fromstring(body["musicxml"]).tag == "score-partwise"
        assert base64.b64decode(body["midi_base64"]).startswith(b"MThd")
        rid = requests[-1][0]
        evidence = {}
        for table in ("request_page", "engine_attempt", "processing_job", "validity_check_item", "stage_timing"):
            evidence[table] = int((await db.fetch_one(f"SELECT COUNT(*) AS n FROM {table} WHERE request_id=%s", (rid,)))["n"])
            assert evidence[table] > 0, table
        result = await db.fetch_one("SELECT musicxml_uri,midi_uri FROM score_result WHERE request_id=%s", (rid,))
        assert (cfg.storage_dir / result["musicxml_uri"]).is_file()
        assert (cfg.storage_dir / result["midi_uri"]).is_file()
        report["actual_staff"] = {"fallback": False, "midi": True, "grade": body["validity_grade"],
                                  "engine": body["engine"]["name"], "timings_ms": body["timings_ms"], "db_rows": evidence}

        # 같은 공개 악보를 PDF로 넣어 실제 300dpi 렌더링 → homr 경로까지 검사한다.
        pdf = io.BytesIO()
        with Image.open(io.BytesIO(sample)) as image:
            image.convert("RGB").save(pdf, "PDF", resolution=300)
        status, body = await asyncio.to_thread(post, [("staff.pdf", pdf.getvalue())], raw)
        assert status == 200 and not body.get("fallback", True), ("pdf", status, body.get("fallback_reason"))
        assert body["file_kind"] == "pdf" and body["pdf_page_count"] == 1
        assert body["pages"][0]["source"] == "pdf_page" and body["converted_pages"] == 1
        assert base64.b64decode(body["midi_base64"]).startswith(b"MThd")
        report["actual_pdf"] = {"fallback": False, "midi": True, "timings_ms": body["timings_ms"]}

        status, body = await asyncio.to_thread(post, [("blank.png", blank.getvalue())], raw)
        assert status == 200 and body["fallback_reason"] == "NO_SCORE_STRUCTURE"
        assert body["musicxml"] and base64.b64decode(body["midi_base64"]).startswith(b"MThd")
        assert body.get("service_down") is not True
        report["api_fallback_template_available"] = True

        # 웹이 만든 원본·요청은 수정하지 않고 판정만 남기는지 실제 DB에서 확인한다.
        session_id = str(uuid.uuid4())
        await db.execute("INSERT INTO anon_session(session_id) VALUES(%s)", (session_id,))
        setting = await db.fetch_one("SELECT setting_version_id FROM v_current_setting")
        no = new_request_no()
        rid = await db.execute("INSERT INTO score_request(request_no,channel,session_id,file_kind,chosen_score_type,route,status,setting_version_id) "
                               "VALUES(%s,'web',%s,'image','staff','recognize','converting',%s)",
                               (no, session_id, setting["setting_version_id"]))
        requests.append((rid, no))
        await db.execute("INSERT INTO upload_file(request_id,file_no,original_name,size_bytes,image_short_side_px,storage_uri) "
                         "VALUES(%s,1,'blank.png',%s,700,%s)", (rid, len(blank.getvalue()), "smoke-only/web/blank.png"))
        status, body = await asyncio.to_thread(post, [("blank.png", blank.getvalue())], raw, no)
        assert status == 200 and body["fallback_reason"] == "NO_SCORE_STRUCTURE"
        assert body["musicxml"] is None and body["midi_base64"] is None
        assert await db.fetch_one("SELECT * FROM score_result WHERE request_id=%s", (rid,)) is None
        assert await db.fetch_one("SELECT * FROM engine_attempt WHERE request_id=%s", (rid,)) is None
        assert not (cfg.api_storage / no).exists()
        assert (await db.fetch_one("SELECT outcome FROM request_page WHERE request_id=%s", (rid,)))["outcome"] == "failed"
        report["web_fallback_has_no_result_files_or_engine_attempt"] = True

        status, body = await asyncio.to_thread(post, [("staff.png", sample)], raw, no, "2020-01-01T00:00:00Z")
        assert status == 200 and body["fallback_reason"] == "TIMEOUT"
        assert body["musicxml"] is None
        report["expired_deadline"] = body["fallback_reason"]
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    finally:
        # 시험 키에 연결된 요청도 조회해 실패 중 생성된 API 요청을 놓치지 않는다.
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


asyncio.run(main())
