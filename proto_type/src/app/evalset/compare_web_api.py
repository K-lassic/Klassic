"""웹·API 결과 일치 확인 (tasks T139, SC-015): 같은 평가 파일을 웹(/api/requests)과 연주 API(/v1/performances)로 보내
결과 형식(MusicXML·MIDI 유무)과 대체 동작(대체 여부·이유)을 비교한다. 차이 0건이어야 한다.
진짜 악보(real)와 가짜 악보(fake)를 모두 보낸다 — 가짜도 두 쪽이 똑같이 막거나 대체해야 한다. 가짜는 오선보로 보낸다(run.py 와 같음).
    uv run --project ../model-api python compare_web_api.py --key <외부 접근 키> [--sets real,fake]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import httpx

from weblogin import web_client  # 2026-09-29 RBAC: 웹은 로그인해야 쓴다

HERE = Path(__file__).resolve().parent


def web_result(web: str, path: Path, score_type: str | None) -> dict:
    with web_client(web, timeout=30) as c:
        r = c.post("/api/requests", files={"file": (path.name, path.read_bytes())}, data={"score_type": score_type} if score_type else {})
        if r.status_code != 202:
            return {"rejected": r.json()["error"]["code"]}
        no = r.json()["id"]
        while (st := c.get(f"/api/requests/{no}").json())["status"] not in ("completed", "service_down", "expired"):
            time.sleep(1)
        return {"fallback": st["fallback"], "reason": st["fallback_reason"], "has_score": st["status"] == "completed"}


def api_result(api: str, key: str, path: Path, score_type: str | None) -> dict:
    h = {"X-API-Key": key}
    with httpx.Client(base_url=api, timeout=30, headers=h) as c:
        r = c.post("/v1/performances", files={"score": (path.name, path.read_bytes())}, data={"score_type": score_type} if score_type else {})
        if r.status_code != 202:
            return {"rejected": r.json()["error"]["code"]}
        pid = r.json()["id"]
        while (res := c.get(f"/v1/performances/{pid}/result")).status_code == 425:
            time.sleep(1)
        b = res.json()
        return {"fallback": b.get("fallback"), "reason": b.get("fallback_reason"), "has_score": bool(b.get("files", {}).get("musicxml"))}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", required=True)
    ap.add_argument("--web", default="http://127.0.0.1:9523")
    ap.add_argument("--api", default="http://127.0.0.1:9543")
    ap.add_argument("--sets", default="real,fake", help="비교할 묶음(쉼표로): real, fake")
    a = ap.parse_args()
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    diffs = 0
    counts: dict[str, list[int]] = {}
    for set_name in [x.strip() for x in a.sets.split(",") if x.strip()]:
        for item in manifest.get(set_name, []):
            p = HERE / item["file"]
            st = "jeongganbo" if item.get("sheet_kind") == "jeongganbo" else "staff"
            w, x = web_result(a.web, p, st), api_result(a.api, a.key, p, st)
            same = w == x
            diffs += 0 if same else 1
            c = counts.setdefault(set_name, [0, 0])
            c[0] += 1
            c[1] += 0 if same else 1
            print(f"{'같음' if same else '다름'} {item['file']}: web={w} api={x}")
    for set_name, (n, d) in counts.items():
        print(f"  {set_name}: {n}장 중 차이 {d}건")
    print(f"\nSC-015 차이: {diffs}건 (0 이어야 함)")
    return 0 if diffs == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
