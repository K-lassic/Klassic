"""#45 임시 DB·실제 HTTP에서 준비 실패 후 MusicXML/MIDI 다운로드 보존을 확인한다.

오류 주입은 이 시험 프로세스에서만 한다. 인식 단계는 유효한 고정 악보로 대체하며 실제 엔진 검사는 별도로 한다.
운영 서비스에 오류 주입 경로·환경변수를 추가하지 않는다. 시험 키·요청·파일은 정리한다.
"""
import asyncio
from contextlib import AsyncExitStack
from dataclasses import replace
import hashlib
import io
import json
from pathlib import Path
import secrets
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import urllib.error
import urllib.parse
import urllib.request
import uuid
import time

from PIL import Image

from app.catalog import load_errors
from app.config import load_config
from app.db import Database
from app.errors import ApiError, CATALOG
from app.fallback.template import load_template
from app.jobs.limiter import Limiter
from app.jobs.performance import PerformanceJob, PerformanceRunner
from app.jobs.purge import remove_request
from app.services.arrange import Assignment
from app.services.requests import create_api_request
from app.settings import SettingsStore


def get(path, key=None):
    path = urllib.parse.urlsplit(path).path
    if path.startswith("/api/v1/"):
        path = path[len("/api"):]
    request = urllib.request.Request("http://127.0.0.1:9543" + path, headers={"X-API-Key": key} if key else {})
    try:
        response = urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        assert response.headers.get("X-Request-ID")
        data = response.read()
        return response.status, json.loads(data) if "application/json" in response.headers.get("Content-Type", "") else data


async def main():
    cfg = load_config()
    if cfg.db_name != "klassic_issue45" or cfg.storage_dir != Path("/storage/issue45"):
        raise RuntimeError("#45 임시 DB·저장 경로에서만 실행하십시오")
    db = await Database.connect(cfg)
    token = CATALOG.set(load_errors(cfg.shared_dir))
    key_id, report = None, {}
    try:
        settings = await SettingsStore(db).load()
        raw = secrets.token_urlsafe(32)
        key_id = await db.execute("INSERT INTO access_key(key_kind,key_hash,key_prefix,application_no,call_limit_per_hour) "
            "VALUES('external',%s,%s,%s,100)", (hashlib.sha256(raw.encode()).hexdigest(), raw[:8], "T45-"+uuid.uuid4().hex[:16]))
        template = await load_template(db, cfg, "staff")
        picture = io.BytesIO()
        Image.new("RGB", (700,700), "white").save(picture, "PNG")
        cases = [(kind, midi, False) for kind in ("queue_timeout", "RENDER_TIMEOUT", "RENDER_FAILED", "unexpected") for midi in (True, False)]
        cases.append(("RENDER_TIMEOUT", True, True))
        for failure, midi_available, fallback in cases:
            rid, no, _ = await create_api_request(db, cfg, key_id=key_id, setting_version_id=settings.version_id,
                file_kind="image", score_type="staff", original_name="trial.png", data=picture.getvalue(), short_edge_px=700)
            outcome = SimpleNamespace(fallback=fallback, musicxml=None if fallback else template.musicxml,
                midi=template.midi if midi_available and not fallback else None,
                fallback_reason="no_structure" if fallback else None)
            pool = SimpleNamespace(prepare=AsyncMock(), render_prepared=AsyncMock())
            if failure != "queue_timeout":
                pool.prepare.side_effect = RuntimeError("do-not-expose-error-text") if failure == "unexpected" else ApiError(failure)
            state = SimpleNamespace(db=db, config=replace(cfg, render_timeout_s=.02), settings=SimpleNamespace(current=settings),
                                    limiter=Limiter(settings), registry=None, render_pool=pool)
            job = PerformanceJob(rid, no, "api", "image", "staff", picture.getvalue(), cfg.api_storage/no/"original.png",
                                 Assignment(), None, 0, 1, settings, time.monotonic()+5)
            async with AsyncExitStack() as stack:
                if failure == "queue_timeout":
                    for _ in range(settings.max_concurrency_render):
                        await stack.enter_async_context(state.limiter.slot("render", "api", time.monotonic()+5))
                with patch("app.jobs.performance.run_recognition", AsyncMock(return_value=outcome)):
                    await PerformanceRunner(SimpleNamespace(state=state))._run(job)
            status, result = await asyncio.to_thread(get, f"/v1/performances/{no}/result", raw)
            assert status == 200 and result["status"] == ("completed_fallback" if fallback else "completed"), (failure,status,result["status"])
            assert result["fallback"] == fallback
            expected = "RENDER_TIMEOUT" if failure in ("queue_timeout", "RENDER_TIMEOUT") else "RENDER_FAILED"
            assert result["render_failure"] == expected and result["files"]["mp3"] is None
            assert "do-not-expose" not in json.dumps(result)
            status, xml = await asyncio.to_thread(get, result["files"]["musicxml"])
            assert status == 200 and xml.startswith(b"<?xml")
            if midi_available:
                status, midi = await asyncio.to_thread(get, result["files"]["midi"])
                assert status == 200 and midi.startswith(b"MThd")
            else:
                assert result["files"]["midi"] is None
            pool.render_prepared.assert_not_awaited()
            report[f"{failure}/midi={midi_available}/fallback={fallback}"] = "passed"
        print(json.dumps({"prepare_failure_download_cases": len(report), "all_passed": True}, sort_keys=True))
    finally:
        if key_id:
            rows = await db.fetch_all("SELECT request_id,request_no FROM score_request WHERE access_key_id=%s", (key_id,))
            await db.execute("DELETE FROM api_call_log WHERE access_key_id=%s", (key_id,))
            for row in rows:
                for table in ("derived_file", "instrument_selection", "performance_option", "engine_attempt", "validity_check_item",
                              "stage_timing", "request_page", "processing_job", "score_result", "upload_file", "score_request"):
                    await db.execute(f"DELETE FROM {table} WHERE request_id=%s", (row["request_id"],))
                remove_request(cfg, row["request_no"])
            await db.execute("DELETE FROM access_key WHERE key_id=%s", (key_id,))
        CATALOG.reset(token)
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
