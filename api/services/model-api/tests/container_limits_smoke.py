"""#33 새 임시 DB·저장소에서 동시 한도·접수 상한·주기 삭제·실제 재시작 복구를 검증한다.

prepare는 중단 지점을 DB에 남기고 잠금을 유지한다. 호스트가 시험 컨테이너를 재시작한 뒤 verify를 실행한다.
시험 키 원문은 메모리에서만 쓰고 출력하지 않는다. 기존 DB·웹 운영 파일은 접근하지 않는다.
"""
import asyncio
from contextlib import asynccontextmanager
import hashlib
import http.client
import json
import os
from pathlib import Path
import secrets
import shutil
import sys
import time
import urllib.error
import urllib.request
import uuid

from app.config import load_config
from app.db import Database
from app.jobs.purge import purge_request, remove_request
from app.services.requests import complete_api_request, create_api_request, new_request_no


def post(key, xml):
    boundary = "limits" + uuid.uuid4().hex
    data = (f'--{boundary}\r\nContent-Disposition: form-data; name="score"; filename="a.musicxml"\r\nContent-Type: application/xml\r\n\r\n'.encode()
            + xml + f'\r\n--{boundary}--\r\n'.encode())
    request = urllib.request.Request("http://127.0.0.1:9543/v1/render/mp3", data=data,
        headers={"X-API-Key": key, "Content-Type": "multipart/form-data; boundary="+boundary})
    try:
        response = urllib.request.urlopen(request, timeout=20)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        return response.status, json.load(response), response.headers.get("Retry-After")


def open_slow(key):
    connection = http.client.HTTPConnection("127.0.0.1", 9543, timeout=10)
    connection.putrequest("POST", "/v1/render/mp3")
    connection.putheader("X-API-Key", key)
    connection.putheader("Content-Length", "200")
    connection.endheaders()
    connection.send(b"x")
    return connection


def oversize(key, cap, chunked=False):
    connection = http.client.HTTPConnection("127.0.0.1", 9543, timeout=10)
    try:
        if chunked:
            connection.request("POST", "/v1/render/mp3", body=iter([b"x"*(cap//2)]*3),
                               headers={"X-API-Key": key}, encode_chunked=True)
        else:
            connection.putrequest("POST", "/v1/render/mp3")
            connection.putheader("X-API-Key", key)
            connection.putheader("Content-Length", str(cap+1))
            connection.endheaders()
        response = connection.getresponse()
        return response.status, json.loads(response.read())
    finally:
        connection.close()


async def cleanup(db, cfg, state):
    targets = list(state.get("web", []))
    for key in state["keys"]:
        targets += [(r["request_id"], r["request_no"], "api") for r in await db.fetch_all(
            "SELECT request_id,request_no FROM score_request WHERE access_key_id=%s", (key,))]
    for rid, no, channel in targets:
        for table in ("api_call_log", "derived_file", "instrument_selection", "performance_option", "engine_attempt",
                      "validity_check_item", "stage_timing", "request_page", "processing_job", "score_result", "upload_file", "score_request"):
            await db.execute(f"DELETE FROM {table} WHERE request_id=%s", (rid,))
        if channel == "api":
            remove_request(cfg, no)
        else:
            path = cfg.storage_dir / "web" / no
            if path.resolve().parent == (cfg.storage_dir / "web").resolve() and path.exists():
                shutil.rmtree(path)
    for key in state["keys"]:
        await db.execute("DELETE FROM api_call_log WHERE access_key_id=%s", (key,))
        await db.execute("DELETE FROM access_key WHERE key_id=%s", (key,))
    if state.get("session"):
        await db.execute("DELETE FROM anon_session WHERE session_id=%s", (state["session"],))
    for no in state.get("orphan_dirs", []):
        remove_request(cfg, no)
    for name in state.get("tmp_files", []):
        (cfg.storage_dir / "tmp" / name).unlink(missing_ok=True)


async def prepare(db, cfg):
    state = {"keys": [], "web": [], "orphan_dirs": [], "tmp_files": [], "report": {}}
    try:
        async def key(limit):
            raw = secrets.token_urlsafe(32)
            kid = await db.execute("INSERT INTO access_key(key_kind,key_hash,key_prefix,application_no,call_limit_per_hour) "
                "VALUES('external',%s,%s,%s,%s)", (hashlib.sha256(raw.encode()).hexdigest(), raw[:8], "T33-"+uuid.uuid4().hex[:16], limit))
            state["keys"].append(kid)
            return raw, kid

        xml = (cfg.assets_dir / "templates/arirang-semachi-v1.musicxml").read_bytes()
        limited, limited_id = await key(1)
        results = await asyncio.gather(*(asyncio.to_thread(post, limited, xml) for _ in range(2)))
        assert sorted(r[0] for r in results) == [200, 429], [r[0] for r in results]
        rejected = next(r for r in results if r[0] == 429)
        assert rejected[1]["error"]["code"] == "RATE_LIMIT_EXCEEDED" and int(rejected[2]) > 0
        calls = await db.fetch_all("SELECT outcome FROM api_call_log WHERE access_key_id=%s", (limited_id,))
        assert sorted(r["outcome"] for r in calls) == ["accepted", "rejected_limit"]
        await db.execute("UPDATE api_call_log SET called_at=called_at-INTERVAL 61 MINUTE WHERE access_key_id=%s AND outcome='accepted'", (limited_id,))
        assert (await asyncio.to_thread(post, limited, xml))[0] == 200
        state["report"]["atomic_quota_and_rolling_hour"] = True
        wide, wide_id = await key(100)
        setting = await db.fetch_one("SELECT setting_version_id,max_concurrency_render FROM v_current_setting")
        slow = [await asyncio.to_thread(open_slow, wide) for _ in range(2 * setting["max_concurrency_render"])]
        try:
            await asyncio.sleep(.2)
            status, body, retry = await asyncio.to_thread(post, wide, xml)
            assert status == 429 and body["error"]["code"] == "SERVER_BUSY" and int(retry) > 0, (status, body)
        finally:
            for connection in slow:
                connection.close()
        await asyncio.sleep(.2)
        assert (await asyncio.to_thread(post, wide, xml))[0] == 200
        for chunked in (False, True):
            status, body = await asyncio.to_thread(oversize, wide, cfg.max_body_bytes, chunked)
            assert status == 413 and body["error"]["code"] == "UPLOAD_TOO_LARGE", (status, body)
        slow_read = await asyncio.to_thread(open_slow, wide)
        try:
            response = await asyncio.to_thread(slow_read.getresponse)
            body = json.loads(response.read())
            assert response.status == 400 and body["error"]["details"]["reason"] == "upload_read_timeout"
        finally:
            slow_read.close()
        state["report"]["admission_body_chunked_timeout"] = True

        template = await db.fetch_one("SELECT template_id FROM fallback_template WHERE holder='api_server' LIMIT 1")
        api_rows = []
        for _ in range(2):
            rid, no, _ = await create_api_request(db, cfg, key_id=wide_id, setting_version_id=setting["setting_version_id"],
                file_kind="image", score_type="staff", original_name="trial.png", data=b"trial", short_edge_px=700)
            api_rows.append((rid, no))
            await complete_api_request(db, cfg, request_id=rid, request_no=no, fallback_reason="no_structure", musicxml=xml.decode(),
                midi=b"MThd-trial", template_id=template["template_id"], origin="fallback")
            await db.execute("INSERT INTO derived_file(request_id,format,basis,render_status,storage_uri) VALUES(%s,'musicxml','original','ready',%s)",
                             (rid, f"api/{no}/result.musicxml"))
        state["expired"], state["fresh"] = api_rows
        session, web_no = str(uuid.uuid4()), new_request_no()
        state["session"] = session
        await db.execute("INSERT INTO anon_session(session_id) VALUES(%s)", (session,))
        web_id = await db.execute("INSERT INTO score_request(request_no,channel,session_id,file_kind,chosen_score_type,route,status,setting_version_id,received_at,completed_at) "
            "VALUES(%s,'web',%s,'image','staff','recognize','completed',%s,UTC_TIMESTAMP(3)-INTERVAL 25 HOUR,UTC_TIMESTAMP(3)-INTERVAL 25 HOUR)",
            (web_no, session, setting["setting_version_id"]))
        state["web"].append((web_id, web_no, "web"))
        web_path = cfg.storage_dir / "web" / web_no
        web_path.mkdir(parents=True)
        (web_path / "original.png").write_bytes(b"keep-web")
        await db.execute("INSERT INTO upload_file(request_id,file_no,original_name,size_bytes,image_short_side_px,storage_uri) VALUES(%s,1,'web.png',8,700,%s)",
                         (web_id, f"web/{web_no}/original.png"))
        for old in (True, False):
            no = new_request_no()
            state["orphan_dirs"].append(no)
            path = cfg.api_storage / no
            path.mkdir()
            (path / "orphan").write_bytes(b"trial")
            if old:
                os.utime(path, (time.time()-25*3600,)*2)
        temp = cfg.storage_dir / "tmp"
        temp.mkdir(exist_ok=True)
        for old in (True, False):
            name = "trial33_" + uuid.uuid4().hex
            state["tmp_files"].append(name)
            path = temp / name
            path.write_bytes(b"trial")
            if old:
                os.utime(path, (time.time()-7200,)*2)

        async with db.advisory_lock("klassic_model_api_purge") as acquired:
            assert acquired
            await db.execute("UPDATE score_request SET received_at=received_at-INTERVAL 25 HOUR,completed_at=completed_at-INTERVAL 25 HOUR WHERE request_id=%s", (api_rows[0][0],))

            class FaultDB:
                @asynccontextmanager
                async def transaction(self):
                    async with db.transaction() as cur:
                        class Cursor:
                            async def execute(self, sql, args):
                                if "UPDATE score_result" in sql:
                                    raise RuntimeError("injected-stop-after-file-delete")
                                await cur.execute(sql, args)
                        yield Cursor()

            try:
                await purge_request(FaultDB(), cfg, *api_rows[0])
            except RuntimeError:
                pass
            row = await db.fetch_one("SELECT r.purged_at,u.storage_uri FROM score_request r JOIN upload_file u ON u.request_id=r.request_id WHERE r.request_id=%s", (api_rows[0][0],))
            assert row["purged_at"] is None and row["storage_uri"] is not None
            assert not (cfg.api_storage / api_rows[0][1]).exists()
            (cfg.storage_dir / "trial33-state.json").write_text(json.dumps(state), encoding="utf-8")
            print(json.dumps(state["report"] | {"interrupted_before_db_commit": True, "ready_for_restart": True}), flush=True)
            await asyncio.sleep(3600)  # 호스트의 컨테이너 재시작으로 이 잠금·프로세스가 종료된다.
    except BaseException:
        # 정상 prepare는 호스트가 컨테이너를 중단한다. 그 외 초기 실패에서는 시험 항목만 정리한다.
        if not (cfg.storage_dir / "trial33-state.json").exists():
            await cleanup(db, cfg, state)
        raise


async def verify(db, cfg):
    state_path = cfg.storage_dir / "trial33-state.json"
    state = json.loads(state_path.read_text())
    try:
        end = time.monotonic()+30
        while time.monotonic() < end:
            row = await db.fetch_one("SELECT purged_at FROM score_request WHERE request_id=%s", (state["expired"][0],))
            if row["purged_at"] is not None:
                break
            await asyncio.sleep(.25)
        assert row["purged_at"] is not None
        for table, columns in (("upload_file", "storage_uri"), ("score_result", "musicxml_uri,midi_uri"), ("derived_file", "storage_uri")):
            rows = await db.fetch_all(f"SELECT {columns},deleted_at FROM {table} WHERE request_id=%s", (state["expired"][0],))
            assert rows and all(all(v is None for k,v in r.items() if k != "deleted_at") and r["deleted_at"] for r in rows)
        for rid, no in (state["fresh"], state["web"][0][:2]):
            assert (await db.fetch_one("SELECT purged_at FROM score_request WHERE request_id=%s", (rid,)))["purged_at"] is None
        assert (cfg.api_storage / state["fresh"][1] / "original.png").exists()
        assert (cfg.storage_dir / "web" / state["web"][0][1] / "original.png").read_bytes() == b"keep-web"
        assert not (cfg.api_storage / state["orphan_dirs"][0]).exists()
        assert (cfg.api_storage / state["orphan_dirs"][1]).exists()
        assert not (cfg.storage_dir / "tmp" / state["tmp_files"][0]).exists()
        assert (cfg.storage_dir / "tmp" / state["tmp_files"][1]).exists()
        print(json.dumps(state["report"] | {"restart_retried_and_purged": True, "all_file_uris_cleared": True,
                         "web_and_fresh_preserved": True, "old_orphan_and_tmp_purged": True}), flush=True)
    finally:
        await cleanup(db, cfg, state)
        state_path.unlink(missing_ok=True)


async def main():
    cfg = load_config()
    if cfg.db_name != "klassic_issue33" or cfg.storage_dir != Path("/storage/issue33"):
        raise RuntimeError("#33 전용 임시 DB·저장 경로에서만 실행하십시오")
    db = await Database.connect(cfg)
    try:
        await (prepare(db, cfg) if sys.argv[-1] == "prepare" else verify(db, cfg))
    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
