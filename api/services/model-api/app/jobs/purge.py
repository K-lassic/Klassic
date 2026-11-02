"""#33 구조에서의 위치: 서비스 주기 작업 → DB 만료 API 요청 → API 전용 파일·위치 정리.

웹 채널·다른 저장 폴더는 건드리지 않는다. 파일 삭제 후 위치를 한 트랜잭션으로 비우고 purged_at을 마지막에 적는다.
파일·DB 처리 실패나 프로세스 종료로 중단되면 DB 뷰에 남아 다음 주기에 다시 처리된다.
"""
import asyncio
import logging
import re
import shutil
import time

from app.db import utcnow

log = logging.getLogger("model-api.purge")
REQUEST_NO = re.compile(r"R-\d{4}-[A-Z2-9]{8}\Z")


def api_root(cfg):
    root = cfg.api_storage
    if root.is_symlink() or root.resolve().parent != cfg.storage_dir.resolve():
        raise ValueError("API 저장 루트 밖 정리 금지")
    return root


def remove_request(cfg, request_no):
    root = api_root(cfg)
    if not REQUEST_NO.fullmatch(request_no):
        raise ValueError("잘못된 요청 폴더")
    folder = root / request_no
    if folder.is_symlink() or folder.resolve().parent != root.resolve():
        raise ValueError("API 요청 폴더 밖 정리 금지")
    if folder.exists():
        shutil.rmtree(folder)  # 실패는 무시하지 않는다. DB 위치·purged_at을 그대로 남겨 재시도한다.


async def purge_request(db, cfg, rid, no):
    await asyncio.to_thread(remove_request, cfg, no)
    now = utcnow()
    async with db.transaction() as cur:
        await cur.execute("UPDATE upload_file SET deleted_at=%s,storage_uri=NULL WHERE request_id=%s AND deleted_at IS NULL", (now, rid))
        await cur.execute("UPDATE score_result SET deleted_at=%s,musicxml_uri=NULL,midi_uri=NULL "
                          "WHERE request_id=%s AND deleted_at IS NULL", (now, rid))
        await cur.execute("UPDATE derived_file SET deleted_at=%s,storage_uri=NULL WHERE request_id=%s AND deleted_at IS NULL", (now, rid))
        await cur.execute("UPDATE score_request SET purged_at=%s WHERE request_id=%s AND channel='api'", (now, rid))


def orphan_candidates(cfg, known):
    root = api_root(cfg)
    if not root.exists():
        return []
    cutoff = time.time() - cfg.orphan_retention_h * 3600
    return [p.name for p in root.iterdir() if REQUEST_NO.fullmatch(p.name) and p.name not in known
            and not p.is_symlink() and p.is_dir() and p.stat().st_mtime < cutoff]


def clear_tmp(cfg):
    root = cfg.storage_dir / "tmp"
    if root.is_symlink() or root.resolve().parent != cfg.storage_dir.resolve():
        raise ValueError("임시 저장 루트 밖 정리 금지")
    count = 0
    if root.is_dir():
        for path in root.iterdir():
            if not path.is_symlink() and path.is_file() and path.stat().st_mtime < time.time() - 3600:
                path.unlink()
                count += 1
    return count


async def purge_once(db, cfg, *, active=()):
    counts = {"requests": 0, "failed": 0, "orphan_dirs": 0, "tmp_files": 0}
    async with db.advisory_lock("klassic_model_api_purge") as acquired:
        if not acquired:
            return counts
        offset = 0
        while True:
            due = await db.fetch_all(
                "SELECT p.request_id,p.request_no FROM v_purge_due_requests p "
                "JOIN score_request r ON r.request_id=p.request_id WHERE r.channel='api' "
                "ORDER BY p.expires_at,p.request_id LIMIT 200 OFFSET %s", (offset,))
            for row in due:
                if row["request_no"] in active:
                    offset += 1
                    continue
                try:
                    await purge_request(db, cfg, row["request_id"], row["request_no"])
                    counts["requests"] += 1
                except Exception as exc:
                    offset += 1
                    counts["failed"] += 1
                    log.warning("purge_request_failed request_id=%s error_type=%s", row["request_id"], type(exc).__name__)
            if len(due) < 200:
                break
        known = {r["request_no"] for r in await db.fetch_all("SELECT request_no FROM score_request")}
        for no in await asyncio.to_thread(orphan_candidates, cfg, known):
            try:
                # 검사 뒤 접수된 요청도 지우지 않도록 삭제 직전에 DB를 다시 확인한다.
                if await db.fetch_one("SELECT request_id FROM score_request WHERE request_no=%s", (no,)) is None:
                    await asyncio.to_thread(remove_request, cfg, no)
                    counts["orphan_dirs"] += 1
            except Exception as exc:
                counts["failed"] += 1
                log.warning("purge_orphan_failed error_type=%s", type(exc).__name__)
        counts["tmp_files"] = await asyncio.to_thread(clear_tmp, cfg)
    return counts


async def purge_loop(app):
    while True:
        await asyncio.sleep(app.state.config.purge_interval_s)
        try:
            counts = await purge_once(app.state.db, app.state.config, active=set(app.state.performances.tasks))
            if any(counts.values()):
                log.info("purge_complete counts=%s", counts)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.error("purge_failed error_type=%s", type(exc).__name__)
