"""모델 API 서버 임시 파일 삭제 (T135, BR-RET-01 · SC-006).

주기마다:
1) API 요청(channel 'api') 중 보관 기간(24시간, v_purge_due_requests)이 지난 것 — STORAGE_DIR/api/<번호>/ 를 지우고
   upload_file·score_result·derived_file 의 위치를 비우고 score_request.purged_at 을 적는다.
   웹 요청의 파일은 웹 서비스가 지운다.
2) DB 에 없는 api/ 폴더 중 24시간이 지난 것(중간에 멈춘 요청 찌꺼기).
3) storage/tmp 의 1시간 지난 임시 파일.
(사용자 음원 .sf2 사본 정리는 2026-09-29 US8 삭제로 뺐다 — 사본을 더 받지 않는다.)
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import time

from app.db import Database, utcnow

log = logging.getLogger("model-api.purge")


async def purge_once(db: Database, cfg) -> dict[str, int]:
    counts = {"requests": 0, "orphan_dirs": 0, "tmp_files": 0}
    now = utcnow()
    due = await db.fetch_all(
        "SELECT p.request_id, p.request_no FROM v_purge_due_requests p JOIN score_request r ON r.request_id = p.request_id "
        "WHERE r.channel = 'api'")
    for row in due:
        folder = cfg.api_storage / row["request_no"]
        shutil.rmtree(folder, ignore_errors=True)
        rid = row["request_id"]
        async with db.transaction() as cur:
            await cur.execute("UPDATE upload_file SET deleted_at = %s, storage_uri = NULL WHERE request_id = %s "
                              "AND deleted_at IS NULL", (now, rid))
            await cur.execute("UPDATE score_result SET deleted_at = %s, musicxml_uri = NULL, midi_uri = NULL "
                              "WHERE request_id = %s AND deleted_at IS NULL", (now, rid))
            await cur.execute("UPDATE derived_file SET deleted_at = %s, storage_uri = NULL WHERE request_id = %s "
                              "AND deleted_at IS NULL", (now, rid))
            await cur.execute("UPDATE score_request SET purged_at = %s WHERE request_id = %s", (now, rid))
        counts["requests"] += 1

    cutoff = time.time() - cfg.result_retention_h * 3600
    if cfg.api_storage.is_dir():
        known = {r["request_no"] for r in await db.fetch_all(
            "SELECT request_no FROM score_request WHERE channel = 'api' AND purged_at IS NULL")}
        for folder in cfg.api_storage.iterdir():
            if folder.is_dir() and folder.name not in known and folder.stat().st_mtime < cutoff:
                shutil.rmtree(folder, ignore_errors=True)
                counts["orphan_dirs"] += 1

    tmp = cfg.storage_dir / "tmp"
    if tmp.is_dir():
        for f in tmp.iterdir():
            if f.is_file() and f.stat().st_mtime < time.time() - 3600:
                f.unlink(missing_ok=True)
                counts["tmp_files"] += 1
    return counts


async def purge_loop(app) -> None:
    state = app.state
    while True:
        try:
            if state.db is not None:
                counts = await purge_once(state.db, state.config)
                if any(counts.values()):
                    log.info("정리: %s", counts)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("정리 중 오류")
        await asyncio.sleep(state.config.purge_interval_s)
