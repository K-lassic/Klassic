"""#33 API 전용 만료·고아·임시 파일 정리, 실패 후 재시작과 경로 경계를 검증한다."""
import asyncio
from contextlib import asynccontextmanager
import os
import time

import pytest

from app.config import Config
from app.jobs.purge import clear_tmp, purge_once, remove_request

API = "R-1102-ABCDEFGH"
WEB = "R-1102-BCDEFGHJ"
FRESH = "R-1102-CDEFGHJK"
ORPHAN = "R-1102-DEFGHJKL"
NEW = "R-1102-EFGHJKLM"


class DB:
    def __init__(self):
        self.rows = [{"request_id": 1, "request_no": API, "channel": "api", "expired": True},
                     {"request_id": 2, "request_no": WEB, "channel": "web", "expired": True},
                     {"request_id": 3, "request_no": FRESH, "channel": "api", "expired": False}]
        self.purged = set()
        self.changes = []
        self.fail = False
        self.acquired = True

    @asynccontextmanager
    async def advisory_lock(self, name):
        assert name == "klassic_model_api_purge"
        yield self.acquired

    @asynccontextmanager
    async def transaction(self):
        saved = self.purged.copy(), self.changes.copy()
        try:
            yield self
        except BaseException:
            self.purged, self.changes = saved
            raise

    async def fetch_all(self, sql, args=None):
        if "FROM v_purge_due_requests" in sql:
            assert "r.channel='api'" in sql
            due = [r for r in self.rows if r["channel"] == "api" and r["expired"] and r["request_id"] not in self.purged]
            return due[args[0]:args[0]+200]
        return self.rows

    async def fetch_one(self, sql, args):
        return next((r for r in self.rows if r["request_no"] == args[0]), None)

    async def execute(self, sql, args):
        self.changes.append((sql, args))
        if "SET purged_at" in sql:
            if self.fail:
                raise OSError("simulated-stop-before-commit")
            self.purged.add(args[1])


def folder(root, name, old=False):
    path = root / name
    path.mkdir(parents=True)
    (path / "original.png").write_bytes(b"test-data")
    if old:
        os.utime(path, (time.time()-25*3600,)*2)
    return path


def test_expired_api_only_orphan_tmp_and_fresh_preserved(tmp_path):
    cfg, db = Config(storage_dir=tmp_path), DB()
    api, fresh = folder(cfg.api_storage, API), folder(cfg.api_storage, FRESH, old=True)
    web = folder(tmp_path / "web", WEB, old=True)
    orphan, new = folder(cfg.api_storage, ORPHAN, old=True), folder(cfg.api_storage, NEW)
    temp = tmp_path / "tmp"
    temp.mkdir()
    old_file, new_file = temp / "old", temp / "new"
    old_file.write_bytes(b"old")
    new_file.write_bytes(b"new")
    os.utime(old_file, (time.time()-7200,)*2)
    counts = asyncio.run(purge_once(db, cfg))
    assert counts == {"requests": 1, "failed": 0, "orphan_dirs": 1, "tmp_files": 1}
    assert not api.exists() and not orphan.exists() and not old_file.exists()
    assert fresh.exists() and web.exists() and new.exists() and new_file.exists()
    assert db.purged == {1}


def test_interrupted_after_delete_retried_from_db_with_new_runner(tmp_path):
    cfg, db = Config(storage_dir=tmp_path), DB()
    path = folder(cfg.api_storage, API)
    db.fail = True
    first = asyncio.run(purge_once(db, cfg))
    assert first["failed"] == 1 and not path.exists() and not db.purged and not db.changes
    # 새 실행기는 메모리 완료 목록 없이 동일한 DB 상태만 보고 마무리한다.
    restarted = DB()
    second = asyncio.run(purge_once(restarted, cfg))
    assert second["requests"] == 1 and restarted.purged == {1}


def test_file_delete_failure_does_not_clear_db(tmp_path, monkeypatch):
    cfg, db = Config(storage_dir=tmp_path), DB()
    path = folder(cfg.api_storage, API)
    monkeypatch.setattr("app.jobs.purge.shutil.rmtree", lambda path: (_ for _ in ()).throw(PermissionError()))
    counts = asyncio.run(purge_once(db, cfg))
    assert counts["failed"] == 1 and path.exists() and not db.purged and not db.changes


@pytest.mark.parametrize("name", ["../outside", "/outside", "not-a-request"])
def test_recursive_delete_path_guard(tmp_path, name):
    cfg = Config(storage_dir=tmp_path)
    with pytest.raises(ValueError):
        remove_request(cfg, name)


def test_symlink_cannot_delete_outside_storage(tmp_path):
    cfg = Config(storage_dir=tmp_path / "store")
    outside = folder(tmp_path, "outside")
    cfg.api_storage.mkdir(parents=True)
    link = cfg.api_storage / API
    link.symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        remove_request(cfg, API)
    assert (outside / "original.png").read_bytes() == b"test-data"


def test_other_purge_instance_and_active_job_are_skipped(tmp_path):
    cfg, db = Config(storage_dir=tmp_path), DB()
    path = folder(cfg.api_storage, API)
    db.acquired = False
    assert not any(asyncio.run(purge_once(db, cfg)).values())
    db.acquired = True
    assert asyncio.run(purge_once(db, cfg, active={API}))["requests"] == 0
    assert path.exists() and not db.purged


def age_tree(root):
    for path in [*root.rglob("*"), root]:
        os.utime(path, (time.time()-7200,)*2, follow_symlinks=False)


def test_abandoned_tmp_tree_removed_without_following_symlinks(tmp_path):
    cfg = Config(storage_dir=tmp_path / "store")
    temp = cfg.storage_dir / "tmp"
    old = folder(temp, "klassic-recognize-abandoned")
    nested = folder(old, "nested")
    outside = folder(tmp_path, "outside")
    (nested / "external").symlink_to(outside, target_is_directory=True)
    age_tree(old)
    # 루트의 링크 자체도 정리 대상에서 제외한다.
    direct_link = temp / "external"
    direct_link.symlink_to(outside, target_is_directory=True)
    assert clear_tmp(cfg) == 1
    assert not old.exists() and direct_link.is_symlink()
    assert (outside / "original.png").read_bytes() == b"test-data"
    assert clear_tmp(cfg) == 0  # 재실행해도 안전하다.


def test_tmp_tree_with_recent_nested_file_is_preserved(tmp_path):
    cfg = Config(storage_dir=tmp_path)
    old = folder(tmp_path / "tmp", "gugak-mp3-active")
    nested = folder(old, "nested")
    age_tree(old)
    (nested / "original.png").write_bytes(b"still-active")
    fresh = folder(tmp_path / "tmp", "new-recognition")
    assert clear_tmp(cfg) == 0
    assert old.exists() and fresh.exists()


def test_failed_tmp_tree_does_not_block_other_cleanup(tmp_path, monkeypatch):
    cfg = Config(storage_dir=tmp_path)
    old = folder(tmp_path / "tmp", "failed")
    age_tree(old)
    expired = tmp_path / "tmp" / "expired"
    expired.write_bytes(b"old")
    os.utime(expired, (time.time()-7200,)*2)
    monkeypatch.setattr("app.jobs.purge.shutil.rmtree", lambda path: (_ for _ in ()).throw(PermissionError()))
    assert clear_tmp(cfg) == 1
    assert old.exists() and not expired.exists()
