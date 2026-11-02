"""#32 격리 DB에서 외부 키 접수→조회→파일 받기와 실제 엔진·MP3를 확인한다.

SAMPLE_BASE64에는 저장소 공개 오선보 예제만 주입한다. 운영 DB에서는 실행하지 않는다.
새로 만든 시험 키·요청·파일·편성만 정리하며 기존 데이터·라이선스 정책은 바꾸지 않는다.
"""
import asyncio
import base64
import hashlib
import io
import json
from pathlib import Path
import secrets
import shutil
import time
import urllib.error
import urllib.request
import uuid

from PIL import Image

from app.config import load_config
from app.db import Database

SAMPLE_BASE64 = "__SAMPLE_BASE64__"
BASE = "http://127.0.0.1:9543"


def http(path, key=None, data=None, content_type=None):
    # 실제 공개 입구는 /api를 제거해 전달한다. 이 시험은 컨테이너 내부 주소를 직접 사용한다.
    if path.startswith(BASE + "/api/v1/"):
        path = BASE + path[len(BASE + "/api"):]
    headers = {"X-API-Key": key} if key else {}
    if content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(path if path.startswith("http") else BASE + path, data=data, headers=headers)
    try:
        response = urllib.request.urlopen(request, timeout=240)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        assert response.headers.get("X-Request-ID")
        raw = response.read()
        body = json.loads(raw) if "application/json" in response.headers.get("Content-Type", "") else raw
        return response.status, body


def submit(key, images, **options):
    boundary = "perf" + uuid.uuid4().hex
    parts = []
    for name, value in {"score_type": "staff", **options}.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    for name, blob in images:
        parts.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="score"; filename="{name}"\r\nContent-Type: image/png\r\n\r\n'.encode(), blob, b"\r\n"])
    parts.append(f"--{boundary}--\r\n".encode())
    return http("/v1/performances", key, b"".join(parts), "multipart/form-data; boundary=" + boundary)


async def done(no, key):
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        status, body = await asyncio.to_thread(http, f"/v1/performances/{no}", key)
        assert status == 200
        if body["status"] in ("completed", "completed_fallback", "service_down", "expired"):
            return body
        await asyncio.sleep(.3)
    raise AssertionError("연주 시험 마감 초과")


async def main():
    cfg = load_config()
    if cfg.db_name != "klassic_issue24":
        raise RuntimeError("격리 klassic_issue24 DB에서만 실행하십시오")
    db = await Database.connect(cfg)
    keys, requests, report = [], [], {}
    ensembles_before = {r["ensemble_id"] for r in await db.fetch_all("SELECT ensemble_id FROM ensemble")}
    used_ensembles = set()
    folder = Path("/tmp/issue32-review")
    folder.mkdir(exist_ok=True)
    try:
        raw_keys = []
        for _ in range(2):
            raw = secrets.token_urlsafe(32)
            keys.append(await db.execute(
                "INSERT INTO access_key(key_kind,key_hash,key_prefix,application_no,call_limit_per_hour) "
                "VALUES('external',%s,%s,%s,100)",
                (hashlib.sha256(raw.encode()).hexdigest(), raw[:8], "A-" + uuid.uuid4().hex[:16])))
            raw_keys.append(raw)
        primary, other = raw_keys
        sample = base64.b64decode(SAMPLE_BASE64)
        blank = io.BytesIO()
        Image.new("RGB", (700, 700), "white").save(blank, "PNG")
        assert (await asyncio.to_thread(http, "/v1/instruments"))[0] == 401
        status, catalog = await asyncio.to_thread(http, "/v1/instruments", primary)
        assert status == 200 and any(r["code"] == "gayageum" for r in catalog["items"])
        report["instruments"] = len(catalog["items"])
        for label, images, options in (
            ("recognized", [("staff.png", sample)], {"instruments": json.dumps({"mode": "custom", "tracks": [{"part": 0, "instrument": "daegeum"}]}), "transpose_semitones": "2", "volume": "0.7"}),
            ("fallback", [("blank.png", blank.getvalue())], {"instruments": '{"mode":"original"}'}),
            ("partial", [("staff.png", sample), ("blank.png", blank.getvalue())], {}),
        ):
            started = time.monotonic()
            status, accepted = await asyncio.to_thread(submit, primary, images, **options)
            assert status == 202, (label, status, accepted)
            no = accepted["id"]
            requests.append(no)
            assert (await asyncio.to_thread(http, f"/v1/performances/{no}", other))[0] == 404
            status, pending = await asyncio.to_thread(http, f"/v1/performances/{no}/result", primary)
            assert status in (200, 425), (status, pending)
            finished = await done(no, primary)
            assert finished["status"] != "service_down", (label, finished)
            status, result = await asyncio.to_thread(http, f"/v1/performances/{no}/result", primary)
            assert status == 200, (label, status, result)
            assert result["fallback"] == (label == "fallback"), (label, result["fallback_reason"])
            assert result["files"]["musicxml"] and result["files"]["midi"], (label, result)
            assert result["mp3_withheld"] and result["files"]["mp3"] is None
            if label == "recognized":
                assert result["transpose_semitones"] == 2 and result["volume"] == .7
            if label == "partial":
                assert result["notice"]["code"] == "PAGES_PARTIAL" and len(result["pages"]) == 2
            for fmt, prefix in (("musicxml", b"<?xml"), ("midi", b"MThd")):
                status, blob = await asyncio.to_thread(http, result["files"][fmt])
                assert status == 200 and blob.startswith(prefix), (label, fmt, status)
                (folder / f"{label}.{fmt}").write_bytes(blob)
            if label == "recognized":
                assert "대금" in (folder / "recognized.musicxml").read_text()
            row = await db.fetch_one("SELECT request_id FROM score_request WHERE request_no=%s", (no,))
            rid = row["request_id"]
            rows = await db.fetch_all("SELECT format,render_status,failure_reason,storage_uri,ensemble_id FROM v_current_derived_file WHERE request_id=%s", (rid,))
            used_ensembles.update(r["ensemble_id"] for r in rows if r["ensemble_id"] is not None)
            mp3 = next(r for r in rows if r["format"] == "mp3")
            assert mp3["render_status"] == "ready", (label, mp3["failure_reason"])
            data = (cfg.storage_dir / mp3["storage_uri"]).read_bytes()
            assert len(data) > 1000
            (folder / f"{label}.mp3").write_bytes(data)
            report[label] = {"status": result["status"], "pages": result["page_count"],
                             "mp3_bytes": len(data), "completed_ms": round((time.monotonic()-started)*1000)}
            # 이 시험이 만든 완료 요청만 보관 만료로 바꿔 다운로드 시 재검사되는지 확인한다.
            await db.execute("UPDATE score_request SET received_at=received_at-INTERVAL 25 HOUR, completed_at=completed_at-INTERVAL 25 HOUR WHERE request_id=%s", (rid,))
            assert (await asyncio.to_thread(http, result["files"]["midi"]))[0] == 410
        report["ownership_and_expiry"] = True
        (folder / "report.json").write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    finally:
        # 접수 직후 실패한 경우에도 시험 키에 속한 요청을 찾아 종료를 기다린 뒤 정리한다.
        for key_id, raw in zip(keys, locals().get("raw_keys", [])):
            rows = await db.fetch_all("SELECT request_id,request_no FROM score_request WHERE access_key_id=%s", (key_id,))
            for row in rows:
                no, rid = row["request_no"], row["request_id"]
                await done(no, raw)
                selections = await db.fetch_all("SELECT ensemble_id FROM performance_option WHERE request_id=%s "
                    "UNION SELECT ensemble_id FROM instrument_selection WHERE request_id=%s", (rid, rid))
                used_ensembles.update(r["ensemble_id"] for r in selections if r["ensemble_id"] is not None)
                for table in ("api_call_log", "derived_file", "instrument_selection", "performance_option", "engine_attempt",
                              "validity_check_item", "stage_timing", "request_page", "processing_job", "score_result", "upload_file", "score_request"):
                    await db.execute(f"DELETE FROM {table} WHERE request_id=%s", (rid,))
                target = (cfg.api_storage / no).resolve()
                if target.parent == cfg.api_storage.resolve() and target.name.startswith("R-") and target.is_dir():
                    shutil.rmtree(target)
            await db.execute("DELETE FROM api_call_log WHERE access_key_id=%s", (key_id,))
            await db.execute("DELETE FROM access_key WHERE key_id=%s", (key_id,))
        for ensemble_id in used_ensembles - ensembles_before:
            await db.execute("DELETE FROM ensemble WHERE ensemble_id=%s", (ensemble_id,))
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
