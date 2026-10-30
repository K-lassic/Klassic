"""평가셋 일괄 실행 (tasks T138, SC-001·SC-004·SC-012·SC-016·SC-017).

모든 항목을 **웹 API 로 보통 요청처럼** 보내 같은 판정을 받게 하고, eval_run_result 에 요청을 잇는다.
    uv run --project ../model-api python run.py --register   # manifest.json → eval_item
    uv run --project ../model-api python run.py --all        # 등록된 항목을 모두 보내고 지표를 찍는다
DB 접속 정보와 웹 주소는 app/.env 를 읽는다(팀 DB 에 돌릴 때는 .env 가 팀 DB 를 가리키는지 먼저 확인).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx

from weblogin import web_client  # 2026-09-29 RBAC: 웹은 로그인해야 쓴다
import pymysql

HERE = Path(__file__).resolve().parent
APP = HERE.parent


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    f = APP / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def connect(env: dict[str, str]):
    return pymysql.connect(host=env["DB_HOST"], port=int(env["DB_PORT"]), user=env["DB_USER"], password=env["DB_PASSWORD"],
                           database=env["DB_NAME"], charset="utf8mb4", autocommit=True, init_command="SET time_zone='+00:00'")


def register(db) -> int:
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    n = 0
    with db.cursor() as c:
        for item in manifest.get("real", []):
            c.execute("SELECT 1 FROM eval_item WHERE file_uri = %s", (item["file"],))
            if not c.fetchone():
                c.execute("INSERT INTO eval_item (set_kind, sheet_kind, file_uri) VALUES ('real', %s, %s)", (item["sheet_kind"], item["file"]))
                n += 1
        for item in manifest.get("fake", []):
            c.execute("SELECT 1 FROM eval_item WHERE file_uri = %s", (item["file"],))
            if not c.fetchone():
                c.execute("INSERT INTO eval_item (set_kind, fake_label, file_uri) VALUES ('fake', %s, %s)", (item["fake_label"], item["file"]))
                n += 1
    return n


def submit(client: httpx.Client, path: Path, score_type: str | None) -> str | None:
    data = {"score_type": score_type} if score_type else {}
    r = client.post("/api/requests", files={"file": (path.name, path.read_bytes())}, data=data)
    if r.status_code != 202:
        print(f"  반려 {path.name}: {r.status_code} {r.json().get('error', {}).get('code')}")
        return None
    return r.json()["id"]


def wait_done(client: httpx.Client, request_no: str, timeout_s: int) -> dict:
    end = time.time() + timeout_s
    while True:
        st = client.get(f"/api/requests/{request_no}").json()
        if st.get("status") in ("completed", "service_down", "expired"):
            return st
        if time.time() > end:
            return st
        time.sleep(1)


def run_all(db, web_url: str, timeout_s: int) -> None:
    with db.cursor(pymysql.cursors.DictCursor) as c:
        c.execute("SELECT item_id, set_kind, sheet_kind, fake_label, file_uri FROM eval_item ORDER BY item_id")
        items = c.fetchall()
    if not items:
        print("등록된 평가 항목이 없습니다. manifest.json 을 채우고 --register 를 먼저 실행하세요.")
        return
    for it in items:
        path = HERE / it["file_uri"]
        if not path.exists():
            print(f"  파일 없음: {it['file_uri']}")
            continue
        # 세션 한 개에 처리 중 1건(FR-062)이므로 항목마다 새 세션으로 보낸다
        with web_client(web_url, timeout=30) as client:
            score_type = "jeongganbo" if it["sheet_kind"] == "jeongganbo" else "staff"
            no = submit(client, path, score_type if path.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp") else None)
            if not no:
                continue
            st = wait_done(client, no, timeout_s)
        with db.cursor() as c:
            c.execute("SELECT request_id FROM score_request WHERE request_no = %s", (no,))
            rid = c.fetchone()[0]
            c.execute("INSERT INTO eval_run_result (item_id, request_id) VALUES (%s, %s)", (it["item_id"], rid))
        print(f"  {it['file_uri']}: {st.get('status')} route={st.get('route')} reason={st.get('fallback_reason')} grade={st.get('validity_grade')}")
    report(db)


def report(db) -> None:
    with db.cursor(pymysql.cursors.DictCursor) as c:
        c.execute("""SELECT COUNT(*) AS n FROM eval_run_result x JOIN score_request r ON r.request_id = x.request_id
                      WHERE r.status NOT IN ('completed')""")
        no_result = c.fetchone()["n"]
        c.execute("SELECT COUNT(*) AS n FROM v_missing_log")
        missing = c.fetchone()["n"]
        c.execute("SELECT * FROM v_eval_metrics")
        m = c.fetchone()
    print("\n=== 평가 결과 ===")
    print(f"SC-001 결과 없이 끝난 요청: {no_result} (0 이어야 함)")
    print(f"SC-004 기록이 빠진 요청: {missing} (0 이어야 함)")
    print(f"SC-012 정간보 정상 변환 비율: {m['jeongganbo_normal_rate']}")
    print(f"SC-016 가짜 악보가 '신뢰'로 나간 수: {m['fake_passed_as_trust']} (0 이어야 함), 구조 확인에서 걸러진 비율: {m['fake_structure_filter_rate']}")
    print(f"SC-017 진짜 악보 오차단 비율: {m['real_false_block_rate']}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--register", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--timeout", type=int, default=600)
    a = ap.parse_args()
    env = load_env()
    db = connect(env)
    web_url = f"http://127.0.0.1:{env.get('WEB_PORT', '9523')}"
    if a.register:
        print(f"등록: {register(db)}건")
    if a.all:
        register(db)
        # 모든 항목이 127.0.0.1 한 주소에서 나가므로 시간당 접수 상한(FR-062)을 잠시 올렸다가 끝에 되돌린다(quickstart_run.py 와 같은 방식).
        # 운영자 계정은 GUGAK_OPERATOR · GUGAK_OPERATOR_PW 로 받는다. 없으면 상한 그대로 돌리므로 10건 뒤부터 WEB_HOURLY_LIMIT 로 반려된다.
        admin_url = f"http://127.0.0.1:{env.get('ADMIN_PORT', '26101')}"
        op, pw = os.environ.get("GUGAK_OPERATOR"), os.environ.get("GUGAK_OPERATOR_PW")
        saved = None
        if op and pw:
            with httpx.Client(base_url=admin_url, timeout=30) as c:
                c.post("/admin/login", json={"login_id": op, "password": pw}).raise_for_status()
                saved = {"web_hourly_request_cap": c.get("/admin/settings").json()["web_hourly_request_cap"]}
                c.put("/admin/settings", json={"web_hourly_request_cap": 1000}).raise_for_status()
        try:
            run_all(db, web_url, a.timeout)
        finally:
            if saved is not None:
                with httpx.Client(base_url=admin_url, timeout=30) as c:
                    c.post("/admin/login", json={"login_id": op, "password": pw})
                    c.put("/admin/settings", json=saved)
    if a.report:
        report(db)
    return 0


if __name__ == "__main__":
    sys.exit(main())
