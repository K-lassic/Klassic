"""분리된 시험 DB·실제 HTTP에서 업로드 검사를 확인한다. 요청·작업 행은 늘어나면 안 된다."""
import asyncio
import hashlib
import io
import json
import secrets
import urllib.error
import urllib.request
import uuid

from PIL import Image
import pypdfium2 as pdfium

from app.config import load_config
from app.db import Database


def image(edge):
    output = io.BytesIO()
    Image.new("RGB", (edge, edge), "white").save(output, "PNG")
    return output.getvalue()


def pdf(pages):
    doc = pdfium.PdfDocument.new()
    try:
        for _ in range(pages):
            page = doc.new_page(200, 300)
            page.close()
        output = io.BytesIO()
        doc.save(output)
        return output.getvalue()
    finally:
        doc.close()


def post(files, key=None, score_type="staff"):
    boundary = "uploadcheck" + uuid.uuid4().hex
    parts = []
    if score_type is not None:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="score_type"\r\n\r\n{score_type}\r\n'.encode())
    for name, content in files:
        parts += [f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode(), content, b"\r\n"]
    parts.append(f"--{boundary}--\r\n".encode())
    headers = {"Content-Type": "multipart/form-data; boundary=" + boundary}
    if key:
        headers["X-API-Key"] = key
    req = urllib.request.Request("http://127.0.0.1:9543/v1/internal/upload-check",
                                 data=b"".join(parts), headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        assert response.headers.get("X-Request-ID")
        return response.status, json.load(response)


async def counts(db):
    names = ("score_request", "request_page", "processing_job", "engine_attempt", "validity_check_item")
    return {name: (await db.fetch_one(f"SELECT COUNT(*) AS n FROM {name}"))["n"] for name in names}


async def main():
    cfg = load_config()
    if cfg.db_name != "klassic_issue24":
        raise RuntimeError("기존 #24/#28 별도 시험 DB에서만 실행하십시오")
    db = await Database.connect(cfg)
    operator, key_id = None, None
    try:
        before = await counts(db)
        operator = await db.execute(
            "INSERT INTO operator_account(login_id,password_hash,display_name,disabled_at) VALUES(%s,%s,%s,UTC_TIMESTAMP(3))",
            ("upload_" + uuid.uuid4().hex[:16], "disabled-test-only", "업로드 검사 시험"))
        raw = secrets.token_urlsafe(32)
        key_id = await db.execute(
            "INSERT INTO access_key(key_kind,key_hash,key_prefix,issued_by) VALUES('service',%s,%s,%s)",
            (hashlib.sha256(raw.encode()).hexdigest(), raw[:8], operator))
        valid = image(700)
        cases = [
            ("missing_key", [("ok.png", valid)], None, "staff", 401, "AUTH_KEY_MISSING"),
            ("photo", [("ok.png", valid)], raw, "staff", 200, None),
            ("small_photo", [("small.png", image(600))], raw, "staff", 200, None),
            ("two_page_pdf", [("score.pdf", pdf(2))], raw, "staff", 200, None),
            ("unsupported", [("text.txt", b"text")], raw, "staff", 415, "UPLOAD_UNSUPPORTED_TYPE"),
            ("broken_pdf", [("broken.pdf", b"%PDF-broken")], raw, "staff", 422, "UPLOAD_CORRUPTED"),
            ("eleven_page_pdf", [("eleven.pdf", pdf(11))], raw, "staff", 422, "UPLOAD_TOO_MANY_PAGES"),
            ("tiny_photo", [("tiny.png", image(250))], raw, "staff", 422, "UPLOAD_RESOLUTION_TOO_LOW"),
            ("missing_score_type", [("ok.png", valid)], raw, None, 422, "UPLOAD_SCORE_TYPE_REQUIRED"),
            ("large_photo", [("big.png", valid + b"\0" * (21 * 1024 * 1024))], raw, "staff", 413, "UPLOAD_TOO_LARGE"),
        ]
        report = {}
        for label, files, key, score_type, expected_status, expected_code in cases:
            status, body = await asyncio.to_thread(post, files, key, score_type)
            assert status == expected_status, (label, status)
            if expected_code:
                assert body["error"]["code"] == expected_code, label
            elif label == "two_page_pdf":
                assert body["page_count"] == body["pdf_page_count"] == 2
            report[label] = status
        assert await counts(db) == before, "검사 전용 경로가 요청·작업 DB 행을 만들었습니다"
        report["request_and_job_rows_unchanged"] = True
        print(json.dumps(report, sort_keys=True))
    finally:
        if key_id:
            await db.execute("DELETE FROM api_call_log WHERE access_key_id=%s", (key_id,))
            await db.execute("DELETE FROM access_key WHERE key_id=%s", (key_id,))
        if operator:
            await db.execute("DELETE FROM operator_account WHERE operator_id=%s", (operator,))
        await db.close()


asyncio.run(main())
