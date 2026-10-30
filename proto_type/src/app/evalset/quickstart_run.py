"""quickstart §6 동작 확인 시나리오 Q1~Q17 (+ Q18 PDF 올리기, 2026-09-29) 을 켜 둔 서버에 차례로 돌린다 (tasks T144).

    cd app/model-api && GUGAK_OPERATOR=<아이디> GUGAK_OPERATOR_PW=<비밀번호> \\
      uv run python ../evalset/quickstart_run.py [--stop-model-api] [--dev-db]

  --stop-model-api  Q3 에서 `pm2 stop model-api` 로 모델 API 서버를 잠시 멈췄다가 다시 켠다
  --dev-db          Q17(24시간 만료)을 위해 app/.env 의 DB 에서 접수 시각을 25시간 앞으로 옮긴다 — 개발 DB 에서만 쓴다
결과는 app/evalset/QUICKSTART_RUN.md 에 적는다. 브라우저가 필요한 Q8(강제 종료 뒤 복원)은 frontend/tests/e2e/us6_restore.md 로 사람이 한다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx

from weblogin import web_client  # 2026-09-29 RBAC: 웹은 로그인해야 쓴다
import pymysql

HERE = Path(__file__).resolve().parent
APP = HERE.parent
FIX = APP / "shared" / "fixtures" / "upload"
sys.path.insert(0, str(APP / "model-api"))
from tests.unit.synth_images import notebook_image, to_png

WEB = "http://127.0.0.1:9523"
ADMIN = "http://127.0.0.1:26101"
API = "http://127.0.0.1:9543"
results: list[tuple[str, str, bool, str]] = []


def record(q: str, title: str, ok: bool, detail: str) -> None:
    results.append((q, title, ok, detail))
    print(f"[{'통과' if ok else '실패'}] {q} {title} — {detail}")


def env() -> dict[str, str]:
    out = {}
    for line in (APP / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def upload(c: httpx.Client, name: str, data: bytes, score_type: str | None = None) -> httpx.Response:
    return c.post("/api/requests", files={"file": (name, data)}, data={"score_type": score_type} if score_type else {})


def wait(c: httpx.Client, no: str, timeout: float = 240) -> dict:
    end = time.time() + timeout
    seen_wait = None
    while True:
        st = c.get(f"/api/requests/{no}").json()
        if st.get("model_wait"):
            seen_wait = st["model_wait"]
        if st["status"] in ("completed", "service_down", "expired") or time.time() > end:
            st["_seen_model_wait"] = seen_wait
            return st
        time.sleep(1)


def tiny_sf2() -> bytes:
    b = bytearray(64)
    b[0:4] = b"RIFF"
    b[4:8] = (56).to_bytes(4, "little")
    b[8:12] = b"sfbk"
    return bytes(b)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stop-model-api", action="store_true")
    ap.add_argument("--dev-db", action="store_true")
    a = ap.parse_args()
    started = dt.datetime.now().astimezone()
    # 모든 요청이 127.0.0.1 한 주소에서 나가므로 시간당 접수 상한(FR-062)을 잠시 올렸다가 끝에 되돌린다
    op, pw = os.environ.get("GUGAK_OPERATOR"), os.environ.get("GUGAK_OPERATOR_PW")
    saved_cap = None
    if op and pw:
        with httpx.Client(base_url=ADMIN, timeout=30) as c:
            c.post("/admin/login", json={"login_id": op, "password": pw})
            cur = c.get("/admin/settings").json()
            saved_cap = {k: cur.get(k) for k in ("web_hourly_request_cap", "apply_rate_limit_count")}
            # 키 신청 빈도 제한(G11)도 같은 주소라 잠시 올리고, Q12 직전에 원래 값으로 되돌려 확인한다
            c.put("/admin/settings", json={"web_hourly_request_cap": 1000, "apply_rate_limit_count": 1000})
    try:
        return run(a, started)
    finally:
        if saved_cap is not None:
            with httpx.Client(base_url=ADMIN, timeout=30) as c:
                c.post("/admin/login", json={"login_id": op, "password": pw})
                c.put("/admin/settings", json=saved_cap)


def run(a: argparse.Namespace, started: dt.datetime) -> int:

    # ---- Q1 오선보 이미지 → 악보·연주 구성·MusicXML·MIDI --------------------------------------------
    with web_client(WEB, timeout=60) as c:
        r = upload(c, "ok_staff.png", (FIX / "ok_staff.png").read_bytes(), "staff")
        st = wait(c, r.json()["id"])
        score = c.get(f"/api/requests/{st['id']}/score")
        xml = c.get(f"/api/requests/{st['id']}/original/musicxml")
        mid = c.get(f"/api/requests/{st['id']}/original/midi")
        ok = st["status"] == "completed" and score.status_code == 200 and xml.status_code == 200 and mid.status_code == 200
        eng = st.get("engine") or {}
        record("Q1", "오선보 이미지 → 악보", ok and st["route"] == "recognize",
               f"경로 {st['route']} · 등급 {st.get('validity_grade')} · 엔진 {eng.get('name')} {eng.get('version')} · "
               f"대체 {st.get('fallback_reason')} · 파트 {len(score.json().get('scoredoc', {}).get('parts', [])) if score.status_code == 200 else '-'}개"
               + (f" · 모델 준비 표시 봄({st['_seen_model_wait']['display_name']})" if st.get("_seen_model_wait") else ""))
        q1_no = st["id"]

        # Q7 추천 (같은 결과로)
        rec = c.get(f"/api/requests/{q1_no}/recommendation").json()
        ch = c.put(f"/api/requests/{q1_no}/instrument-choice", json={"mode": "recommend", "recommendation_index": 0}) if rec.get("available") else None
        record("Q7", "추천 국악기 조합", rec.get("available") is True or rec.get("reason") == "RECOMMEND_UNAVAILABLE",
               f"추천 {'있음' if rec.get('available') else '없음'} · 모델 {(rec.get('model') or {}).get('name')} · "
               f"대기 {rec.get('pending')} · 조합 {[x['label'] for x in rec.get('combinations', [])]}"
               + (f" · 선택 기록 {ch.status_code}" if ch is not None else ""))

        # Q9 편집 → MIDI·MusicXML 바로, MP3·PDF 렌더링
        ops = [{"op": "transpose", "semitones": 2}, {"op": "change_instrument", "part": 0, "instrument": "haegeum"}]
        fmt_status = {}
        for f in ["midi", "musicxml", "mp3", "pdf"]:
            t = c.post(f"/api/requests/{q1_no}/exports", json={"format": f, "edit_ops": ops, "instruments": {"mode": "default"}}).json()
            end = time.time() + 180
            while t["status"] in ("queued", "rendering") and time.time() < end:
                time.sleep(1)
                t = c.get(f"/api/requests/{q1_no}/exports/{t['id']}").json()
            size = len(c.get(t["download_url"]).content) if t.get("download_url") else 0
            fmt_status[f] = f"{t['status']}({t.get('failure_reason') or t.get('renderer') or ''}, {size}B)"
        ok9 = all(fmt_status[k].startswith("ready") for k in ("midi", "musicxml", "mp3", "pdf"))  # 2026-09-29: MP3·PDF 실패도 잡는다
        record("Q9", "편집 후 내려받기", ok9, " · ".join(f"{k} {v}" for k, v in fmt_status.items()))

    # ---- Q2 정간보 ---------------------------------------------------------------------------------
    with web_client(WEB, timeout=60) as c:
        r = upload(c, "ok_jeongganbo.png", (FIX / "ok_jeongganbo.png").read_bytes(), "jeongganbo")
        st = wait(c, r.json()["id"])
        record("Q2", "정간보 이미지", st["status"] == "completed",
               f"경로 {st['route']} · 등급 {st.get('validity_grade')} · 대체 {st.get('fallback_reason')} (합성 이미지 — 결과 품질 판단 불가)")

    # ---- Q4 공책 사진을 오선보로 → 구조 없음 대체 ---------------------------------------------------------
    with web_client(WEB, timeout=60) as c:
        r = upload(c, "notebook.png", to_png(notebook_image()), "staff")
        st = wait(c, r.json()["id"])
        record("Q4", "공책 사진 → 대체", st["route"] == "fallback" and st["fallback_reason"] in ("NO_SCORE_STRUCTURE", "UNTRUSTED_RESULT"),
               f"대체 {st['fallback_reason']} · 안내 '{st.get('retry_hint')}'")

    # ---- Q5 접수 전 반려 ------------------------------------------------------------------------------
    codes = {}
    with web_client(WEB, timeout=60) as c:
        for name, st_type in [("text.txt", "staff"), ("broken.png", "staff"), ("small_600.png", "staff"), ("big_25mb.png", "staff")]:
            codes[name] = upload(c, name, (FIX / name).read_bytes(), st_type).json().get("error", {}).get("code")
        two = c.post("/api/requests", files=[("file", ("a.png", (FIX / "ok_staff.png").read_bytes())), ("file", ("b.png", (FIX / "ok_staff.png").read_bytes()))], data={"score_type": "staff"})
        codes["두 파일"] = two.json().get("error", {}).get("code")
    want = {"text.txt": "UPLOAD_UNSUPPORTED_TYPE", "broken.png": "UPLOAD_CORRUPTED", "small_600.png": "UPLOAD_RESOLUTION_TOO_LOW",
            "big_25mb.png": "UPLOAD_TOO_LARGE", "두 파일": "UPLOAD_TOO_MANY_FILES"}
    record("Q5", "잘못된 파일 반려", codes == want, str(codes))

    # ---- Q6 웹 MIDI·MusicXML 반려 (2026-09-29 황송해 결정: 사진·PDF 만 — 웹·연주 API 모두 MIDI·MusicXML 반려, Q11 참고) ----
    with web_client(WEB, timeout=60) as c:
        r6 = upload(c, "ok.mid", (FIX / "ok.mid").read_bytes(), "staff")
        err6 = r6.json().get("error", {})
        r6x = upload(c, "ok.musicxml", (FIX / "ok.musicxml").read_bytes(), "staff")
        err6x = r6x.json().get("error", {})
    record("Q6", "웹 MIDI·MusicXML 반려(사진·PDF 만 받음)",
           r6.status_code == 415 and err6.get("code") == "UPLOAD_UNSUPPORTED_TYPE" and err6.get("gate") == "G1"
           and r6x.status_code == 415 and err6x.get("code") == "UPLOAD_UNSUPPORTED_TYPE",
           f".mid HTTP {r6.status_code} · .musicxml HTTP {r6x.status_code} · {err6.get('code')} · '{err6.get('message')}' · 고치는 방법 '{err6.get('fix')}'")

    # ---- Q18 PDF 올리기 (2026-09-29 황송해 결정: 여러 쪽 PDF 는 첫 쪽만 변환 · 손상·암호는 G1 반려) -----------------
    with web_client(WEB, timeout=60) as c:
        r18 = upload(c, "ok_staff_2p.pdf", (FIX / "ok_staff_2p.pdf").read_bytes(), "staff")
        st18 = wait(c, r18.json()["id"]) if r18.status_code == 202 else {}
        enc18 = upload(c, "encrypted.pdf", (FIX / "encrypted.pdf").read_bytes(), "staff")
        enc_err = enc18.json().get("error", {})
    notice18 = (st18.get("notice") or {}).get("message")
    record("Q18", "PDF 올리기(웹) — 첫 쪽만 변환 안내 · 암호 PDF 반려",
           r18.status_code == 202 and st18.get("status") == "completed" and st18.get("file_kind") == "pdf"
           and notice18 == "PDF 첫 쪽만 변환했어요 (전체 2쪽)" and enc18.status_code == 422 and enc_err.get("code") == "UPLOAD_CORRUPTED",
           f"요청 {st18.get('id')} {st18.get('status')} · 경로 {st18.get('route')} · 대체 {st18.get('fallback_reason')} · 안내 '{notice18}' · "
           f"암호 PDF HTTP {enc18.status_code} {enc_err.get('code')}")

    # ---- Q10 사용자 음원 — 제거됨(US8 삭제, 2026-09-29 황송해 결정) ------------------------------------
    # 사용자 .sf2 올리기가 없어졌는지만 본다: /api/sf2 는 404, 악기 목록에 custom 이 없고, [나가기]는 그대로 된다.
    with web_client(WEB, timeout=60) as c:
        inst = c.get("/api/instruments").json()
        up = c.post("/api/sf2", files={"file": ("a.sf2", tiny_sf2())}).status_code
        end = c.post("/api/session/end").status_code
    record("Q10", "사용자 음원 — 제거됨(US8 삭제)", up == 404 and "custom" not in inst and end == 204,
           f".sf2 올리기 {up}(404 여야 함) · 악기 목록 custom {'있음' if 'custom' in inst else '없음'} · 나가기 {end}")

    # ---- Q11~Q13 API활용: 키 신청 → 연주 API → 오류 ----------------------------------------------------
    email = f"qs-{int(time.time())}@example.kr"
    form = {"name": "시연 개발자", "organization": "3팀 시연", "contact_email": email, "purpose": "quickstart 확인", "consent": True}
    with web_client(WEB, timeout=60) as c:
        docs = c.get("/api/api-docs").json()
        key_r = c.post("/api/key-applications", json=form)
        key = key_r.json().get("api_key")
    with httpx.Client(base_url=API, timeout=60, headers={"X-API-Key": key or ""}) as c:
        # 2026-09-29: 연주 API 도 사진·PDF 만 받는다 — .mid 는 형식 반려(G1), 연주는 여러 쪽 PDF 로(첫 쪽만 변환 안내)
        mid11 = c.post("/v1/performances", files={"score": ("ok.mid", (FIX / "ok.mid").read_bytes())}, data={"score_type": "staff"})
        mid_err = mid11.json().get("error", {})
        t0 = time.time()
        p = c.post("/v1/performances", files={"score": ("ok_staff_2p.pdf", (FIX / "ok_staff_2p.pdf").read_bytes())},
                   data={"score_type": "staff"})
        pid = p.json().get("id")
        notice11 = (p.json().get("notice") or {}).get("message")
        while (res := c.get(f"/v1/performances/{pid}/result")).status_code == 425 and time.time() - t0 < 180:
            time.sleep(1)
        body = res.json()
        files = body.get("files", {})
        # 모델 API 는 --root-path /api 로 떠서(2026-09-29 입구 도입) 파일 주소가 /api/v1/... 이다. 입구를 거치지 않고
        # 모델 API 에 바로 받을 때는 앞의 /api 를 뗀다(외부 https://p3.sumzip.com/api/v1/files/... 는 입구가 뗀다).
        midi_url = files.get("midi")
        dl = c.get(httpx.URL(midi_url).path.removeprefix("/api")).status_code if midi_url else None
    record("Q11", "키 신청 → 연주 API(PDF) · MIDI 반려",
           key_r.status_code == 201 and res.status_code == 200 and dl == 200
           and mid11.status_code == 415 and mid_err.get("code") == "UPLOAD_UNSUPPORTED_TYPE"
           and notice11 == "PDF 첫 쪽만 변환했어요 (전체 2쪽)",
           f"메뉴 서버 {docs.get('server_status')}/{docs.get('spec_source')} 엔드포인트 {len(docs.get('endpoints', []))}개 · 키 {key[:8] if key else None}… · "
           f".mid HTTP {mid11.status_code} {mid_err.get('code')} · PDF 요청 {pid} {body.get('status')} · 안내 '{notice11}' · "
           f"MP3 제외 {body.get('mp3_withheld')} · MIDI 받기 {dl} · {time.time() - t0:.1f}초")
    op, pw = os.environ.get("GUGAK_OPERATOR"), os.environ.get("GUGAK_OPERATOR_PW")
    if op and pw:
        with httpx.Client(base_url=ADMIN, timeout=30) as ac:
            ac.post("/admin/login", json={"login_id": op, "password": pw})
            ac.put("/admin/settings", json={"apply_rate_limit_count": 3})
    with web_client(WEB, timeout=60) as c:
        codes12 = [c.post("/api/key-applications", json=form).status_code for _ in range(3)]
        last = c.post("/api/key-applications", json=form).json().get("error", {})
    record("Q12", "신청 빈도 제한", last.get("code") == "APPLICATION_RATE_LIMITED" and bool(last.get("retry_after")),
           f"2~4번째 {codes12}, 5번째 {last.get('code')} · 다시 신청 {last.get('retry_after')}")
    with httpx.Client(base_url=API, timeout=30) as c:
        nokey = c.post("/v1/recommend", files={"score": ("a.mid", (FIX / "ok.mid").read_bytes())})
        bad = c.post("/v1/recommend", headers={"X-API-Key": "gk_" + "x" * 43}, files={"score": ("a.mid", b"x")})
    record("Q13", "키 없음·틀린 키", nokey.status_code == 401 and bad.status_code == 401,
           f"키 없음 {nokey.status_code} {nokey.json()['error']['code']} · 틀린 키 {bad.status_code} {bad.json()['error']['code']} (폐기·한도 초과는 자동 시험 test_auth_limits 로 확인)")

    # ---- Q15 관리자: 로그인·지표·처리 시간 제한 바꾸기 -------------------------------------------------------
    op, pw = os.environ.get("GUGAK_OPERATOR"), os.environ.get("GUGAK_OPERATOR_PW")
    if op and pw:
        with httpx.Client(base_url=ADMIN, timeout=30) as c:
            login = c.post("/admin/login", json={"login_id": op, "password": pw})
            m = c.get("/admin/metrics").json()
            before = c.get("/admin/settings").json()
            put = c.put("/admin/settings", json={"timeout_seconds": before["timeout_seconds"] + 1}).json()
            with web_client(WEB, timeout=60) as w:
                new_no = upload(w, "ok_staff.png", (FIX / "ok_staff.png").read_bytes(), "staff").json()["id"]
                wait(w, new_no)  # 웹은 주소마다 처리 중 1건(G12) — 끝나야 다음 올리기(Q14)가 된다
            stamped = c.get(f"/admin/jobs/{new_no}").json()
            c.put("/admin/settings", json={"timeout_seconds": before["timeout_seconds"]})
            audit = c.get("/admin/audit").json()["items"]
            models = c.get("/admin/models").json()
        states = {x["model_name"]: x["state"] for x in models["items"]}
        record("Q15", "관리자 로그인·설정 반영", login.status_code == 200 and put["setting_version_id"] > before["setting_version_id"]
               and any(h["field_name"] == "timeout_seconds" for h in audit),
               f"지표 전체 이미지 요청 {m['scopes']['all']['image_requests']}건 · 새 판본 {put['setting_version_id']} 반영 {put['api_apply_status']} · "
               f"새 요청 {new_no} 기록됨 {stamped.get('request_no') == new_no} · 모델 상태 {states}")
    else:
        record("Q15", "관리자", False, "GUGAK_OPERATOR·GUGAK_OPERATOR_PW 가 없어 건너뜀")

    # ---- Q14 웹·API 결과 일치 (평가셋이 없어 공유 시험 이미지 2장으로) ---------------------------------------
    diffs = []
    # 웹은 사진만 받으므로(2026-09-29) MIDI 대신 정간보 시험 이미지로 비교한다
    for name, stype in [("ok_staff.png", "staff"), ("ok_jeongganbo.png", "jeongganbo")]:
        with web_client(WEB, timeout=60) as w:
            wst = wait(w, upload(w, name, (FIX / name).read_bytes(), stype).json()["id"])
        with httpx.Client(base_url=API, timeout=60, headers={"X-API-Key": key or ""}) as c:
            pid = c.post("/v1/performances", files={"score": (name, (FIX / name).read_bytes())}, data={"score_type": stype} if stype else {}).json()["id"]
            while (res := c.get(f"/v1/performances/{pid}/result")).status_code == 425:
                time.sleep(1)
            ab = res.json()
        wv = (wst["route"] == "fallback", wst.get("fallback_reason"))
        av = (bool(ab.get("fallback")), ab.get("fallback_reason"))
        if wv != av:
            diffs.append(f"{name}: web {wv} api {av}")
    record("Q14", "웹·API 결과 일치(시험 이미지 2장)", not diffs, "차이 0건" if not diffs else "; ".join(diffs))

    # ---- Q3 모델 API 서버 멈춤 → 엔진 중단 대체 -------------------------------------------------------------
    if a.stop_model_api:
        subprocess.run(["pm2", "stop", "model-api"], capture_output=True, check=False)
        try:
            with web_client(WEB, timeout=60) as c:
                t0 = time.time()
                st = wait(c, upload(c, "ok_staff.png", (FIX / "ok_staff.png").read_bytes(), "staff").json()["id"])
                took = time.time() - t0
                mid = c.get(f"/api/requests/{st['id']}/original/midi").status_code
            record("Q3", "모델 API 멈춤 → 대체", st["fallback_reason"] == "ENGINE_DOWN" and mid == 200,
                   f"대체 {st['fallback_reason']} · {took:.1f}초 · MIDI 받기 {mid}")
        finally:
            subprocess.run(["pm2", "start", "model-api"], capture_output=True, check=False)
            time.sleep(8)
    else:
        record("Q3", "모델 API 멈춤", False, "--stop-model-api 없이 실행해 건너뜀")

    # ---- Q16 평가셋 일괄 실행 ----------------------------------------------------------------------------
    # run.py --all 이 남긴 항목별 가장 최근 실행으로 판정한다(이 스크립트가 평가셋을 다시 돌리지는 않는다)
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    n_manifest = len(manifest.get("real", [])) + len(manifest.get("fake", []))
    e = env()
    db = pymysql.connect(host=e["DB_HOST"], port=int(e["DB_PORT"]), user=e["DB_USER"], password=e["DB_PASSWORD"],
                         database=e["DB_NAME"], autocommit=True)
    with db.cursor(pymysql.cursors.DictCursor) as cur:
        cur.execute("""
            SELECT i.set_kind, r.status, r.route, r.fallback_reason, j.validity_grade
              FROM eval_item i
              JOIN eval_run_result x ON x.item_id = i.item_id
               AND x.request_id = (SELECT MAX(x2.request_id) FROM eval_run_result x2 WHERE x2.item_id = i.item_id)
              JOIN score_request r ON r.request_id = x.request_id
              LEFT JOIN processing_job j ON j.request_id = r.request_id""")
        rows = cur.fetchall()
        cur.execute("SELECT COUNT(*) AS n FROM v_missing_log")
        missing = cur.fetchone()["n"]
    db.close()
    real = [r for r in rows if r["set_kind"] == "real"]
    fake = [r for r in rows if r["set_kind"] == "fake"]
    no_result = sum(r["status"] != "completed" for r in rows)
    fake_trust = sum(r["validity_grade"] == "trust" for r in fake)
    real_blocked = sum(r["fallback_reason"] in ("no_structure", "distrust") for r in real)
    ok16 = n_manifest > 0 and len(rows) >= n_manifest and no_result == 0 and missing == 0 and fake_trust == 0
    record("Q16", "평가셋 일괄 실행", ok16,
           f"manifest {n_manifest}개 중 실행 결과 {len(rows)}개(진짜 {len(real)} · 가짜 {len(fake)}) · 결과 없음 {no_result} · "
           f"기록 빠짐 {missing} · 가짜 '신뢰' {fake_trust} · 진짜 오차단 {real_blocked}/{len(real)} "
           "(평가는 run.py --all, 음높이는 score_pitch.py — EVAL_RUN.md)")

    # ---- Q17 24시간 만료 -------------------------------------------------------------------------------
    if a.dev_db:
        e = env()
        if e.get("DB_HOST") not in ("127.0.0.1", "localhost"):
            record("Q17", "만료", False, "팀 DB 로 보여 건너뜀(--dev-db 는 개발 DB 에서만)")
        else:
            db = pymysql.connect(host=e["DB_HOST"], port=int(e["DB_PORT"]), user=e["DB_USER"], password=e["DB_PASSWORD"],
                                 database=e["DB_NAME"], autocommit=True)
            with db.cursor() as cur:
                cur.execute("UPDATE score_request SET received_at = received_at - INTERVAL 25 HOUR, "
                            "completed_at = completed_at - INTERVAL 25 HOUR WHERE request_no = %s", (q1_no,))
            with web_client(WEB, timeout=30) as c:
                # 같은 세션이 아니므로 소유 확인에서 404 가 먼저 난다 — 보관 기간 판정은 DB 뷰로 본다
                pass
            with db.cursor() as cur:
                cur.execute("SELECT is_expired FROM v_request_retention r JOIN score_request q ON q.request_id = r.request_id WHERE q.request_no = %s", (q1_no,))
                expired = cur.fetchone()[0]
            record("Q17", "24시간 만료", expired == 1, f"{q1_no} 만료 판정 {expired} (화면 문구·410 은 자동 시험 jobs.test 로 확인)")
    else:
        record("Q17", "만료", False, "--dev-db 없이 실행해 건너뜀")

    record("Q8", "강제 종료 뒤 편집 복원", False, "브라우저가 필요 — frontend/tests/e2e/us6_restore.md 점검표로 사람이 확인")

    # ---- 결과 적기 --------------------------------------------------------------------------------------
    order = [f"Q{i}" for i in range(1, 19)]
    rows = sorted(results, key=lambda r: order.index(r[0]))
    lines = [
        "# quickstart 동작 확인 결과 (tasks T144)", "",
        f"- 실행: {started:%Y-%m-%d %H:%M} ~ {dt.datetime.now().astimezone():%H:%M} · 서버: pm2(web 9523 · admin 26101 · model-api 9543 · 입구 9503) · DB: app/.env ({env().get('DB_NAME')})",
        "- 평가셋 15종이 아직 없어 이미지는 shared/fixtures/upload 의 합성 이미지를 썼다. 인식 품질(정확도)은 이 결과로 판단하지 않는다.", "",
        "| # | 시나리오 | 결과 | 내용 |", "|---|---|---|---|",
    ] + [f"| {q} | {t} | {'통과' if ok else '미확인·실패'} | {d.replace('|', '/')} |" for q, t, ok, d in rows]
    (HERE / "QUICKSTART_RUN.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n{sum(1 for r in rows if r[2])}/{len(rows)} 통과 → {HERE / 'QUICKSTART_RUN.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
