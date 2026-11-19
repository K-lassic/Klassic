"""평가셋 일괄 실행 — 목록의 악보를 model-api 에 보내고 응답을 파일로 남긴다.

    uv run python -m evalset.run --base-url http://127.0.0.1:9543/api --out evalset/results/2026-11-18
    (키는 환경변수 EVAL_API_KEY 로만 넘긴다. 명령줄 · 로그 · 결과 파일에 남기지 않는다)

구조에서의 위치: 이 도구 ─▶ model-api `POST /v1/omr/{staff|jeongganbo}` (서비스 키 또는 외부 키) ─▶ 엔진.
    web(backend)을 거치지 않는다. model-api 의 판정(구조 확인 · 타당성 등급 · 대체 이유)과 인식 결과를 그대로 받는다.
    v0.1.1 의 run.py 는 웹으로 보내고 DB(eval_item · eval_run_result)에서 결과를 읽었다. 여기서는 DB 를 읽지 않는다 —
    `RecognitionResult` 응답에 필요한 것(대체 여부 · 등급 · 항목 점수 · MusicXML · 엔진 · 걸린 시간)이 다 들어 있다.

남기는 것 (--out 폴더)
    run.json              실행 정보 — 시작 시각 · 주소 · /v1/models 가 답한 엔진 판 (키는 없다)
    items/<파일이름>.json  항목마다 하나 — 종류 · 응답 상태 · 걸린 시간 · 응답 본문(MusicXML 포함, MIDI 는 뺀다)

주의
    · 요청마다 실제 인식이 돈다 (쪽당 수 초 ~ 수십 초). 54장이면 몇 분에서 십몇 분 걸린다.
    · 외부 키로 돌리면 시간당 요청 한도에 걸린다. 서비스 키로 돌리거나 한도를 잠시 올린다 (v0.1.1 때도 그랬다).
    · 이미 결과가 있는 항목은 건너뛴다. 처음부터 다시 하려면 --force.
    · 실제 서버 DB 에 요청 기록이 남는다 (model-api 가 API 요청으로 기록한다). 운영 DB 말고 시험용 프로젝트에서 돌릴 것.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
# 평가 이미지는 아직 v0.1.1 폴더에 있다 (합성 오선보 14장 + 가짜 40장, 55MB). api/ 로 복사하지 않고 그대로 읽는다.
DEFAULT_IMAGES = HERE.parents[3] / "proto_type" / "src" / "app" / "evalset"
DEFAULT_MANIFEST = HERE / "data" / "manifest.json"

MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".pdf": "application/pdf"}


def load_items(manifest: Path) -> list[dict]:
    """목록 파일 → [{file, kind('real'|'fake'), score_type, label}]"""
    data = json.loads(manifest.read_text(encoding="utf-8"))
    items = []
    for it in data.get("real", []):
        items.append({"file": it["file"], "kind": "real",
                      "score_type": "jeongganbo" if it.get("sheet_kind") == "jeongganbo" else "staff", "label": None})
    for it in data.get("fake", []):
        # 가짜 악보는 사용자가 "오선보"라고 고르고 올린 것으로 친다 (v0.1.1 과 같다)
        items.append({"file": it["file"], "kind": "fake", "score_type": "staff", "label": it.get("fake_label")})
    return items


def slim(body: dict) -> dict:
    """응답에서 큰 값(MIDI)을 빼고 남긴다. MusicXML 은 채점에 필요해 그대로 둔다."""
    out = dict(body)
    if out.get("midi_base64"):
        out["midi_base64"] = None
        out["midi_dropped"] = True
    return out


def send(client: httpx.Client, path: Path, score_type: str) -> dict:
    """한 장 보내고 {status, seconds, body|error} 를 돌려준다. 예외를 던지지 않는다 — 한 장 실패가 전체를 멈추지 않게."""
    started = time.monotonic()
    try:
        r = client.post(f"/v1/omr/{score_type}",
                        files={"image": (path.name, path.read_bytes(), MIME.get(path.suffix.lower(), "application/octet-stream"))})
        seconds = round(time.monotonic() - started, 2)
        try:
            body = r.json()
        except ValueError:
            body = None
        if r.status_code == 200 and isinstance(body, dict):
            return {"status": 200, "seconds": seconds, "body": slim(body)}
        return {"status": r.status_code, "seconds": seconds, "error": (body or {}).get("error") if isinstance(body, dict) else r.text[:300]}
    except httpx.HTTPError as e:
        return {"status": None, "seconds": round(time.monotonic() - started, 2), "error": {"code": type(e).__name__, "message": str(e)[:300]}}


def run(client: httpx.Client, items: list[dict], images: Path, out: Path, *, force: bool = False,
        log=print, wait_on_busy_s: float = 5.0, max_busy_retries: int = 20) -> dict:
    """목록을 차례로 보낸다. {done, skipped, missing, failed} 를 돌려준다."""
    (out / "items").mkdir(parents=True, exist_ok=True)
    counts = {"done": 0, "skipped": 0, "missing": 0, "failed": 0}
    for it in items:
        name = Path(it["file"]).name
        target = out / "items" / f"{name}.json"
        if target.exists() and not force:
            counts["skipped"] += 1
            continue
        path = images / it["file"]
        if not path.is_file():
            log(f"  파일 없음  {it['file']}")
            counts["missing"] += 1
            continue
        result = send(client, path, it["score_type"])
        # 서버가 바쁘면(동시 인식 한도) 잠시 뒤 다시 보낸다. 한도에 걸린 것은 인식 실패가 아니다.
        tries = 0
        while result["status"] in (429, 503) and tries < max_busy_retries:
            tries += 1
            time.sleep(wait_on_busy_s)
            result = send(client, path, it["score_type"])
        record = {**it, "name": name, **result}
        target.write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding="utf-8")
        if result["status"] == 200:
            b = result["body"]
            log(f"  {name:36} {result['seconds']:6.1f}초  " + (f"대체({b.get('fallback_reason')})" if b.get("fallback") else f"인식 등급={b.get('validity_grade')}"))
            counts["done"] += 1
        else:
            log(f"  {name:36} {result['seconds']:6.1f}초  실패 status={result['status']} {result.get('error')}")
            counts["failed"] += 1
    return counts


def describe_server(client: httpx.Client) -> dict:
    """어떤 엔진 판으로 돌았는지 남긴다. 실패해도 실행은 계속한다."""
    try:
        r = client.get("/v1/models")
        if r.status_code == 200:
            return {"models": [{k: m.get(k) for k in ("name", "version", "state", "enabled")} for m in r.json()]}
        return {"models_error": r.status_code}
    except (httpx.HTTPError, ValueError) as e:
        return {"models_error": type(e).__name__}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="평가셋을 model-api 에 보내고 응답을 파일로 남긴다")
    ap.add_argument("--base-url", required=True, help="model-api 주소. 예) http://127.0.0.1:9543/api")
    ap.add_argument("--out", required=True, type=Path, help="결과 폴더")
    ap.add_argument("--images", type=Path, default=DEFAULT_IMAGES, help="real/ · fake/ 가 들어 있는 폴더")
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    ap.add_argument("--only", choices=["real", "fake"], help="한쪽만 돌린다")
    ap.add_argument("--timeout", type=float, default=900, help="한 장의 응답을 기다리는 최대 시간(초)")
    ap.add_argument("--force", action="store_true", help="이미 결과가 있는 항목도 다시 보낸다")
    args = ap.parse_args(argv)

    key = os.environ.get("EVAL_API_KEY", "")
    if not key:
        print("환경변수 EVAL_API_KEY 가 필요합니다 (model-api 서비스 키 또는 외부 키). 명령줄 인자로는 받지 않습니다.", file=sys.stderr)
        return 2

    items = [it for it in load_items(args.manifest) if not args.only or it["kind"] == args.only]
    print(f"평가 항목 {len(items)}개 → {args.base_url}  (결과: {args.out})")
    with httpx.Client(base_url=args.base_url.rstrip("/"), headers={"X-API-Key": key}, timeout=args.timeout) as client:
        args.out.mkdir(parents=True, exist_ok=True)
        meta_file = args.out / "run.json"
        if not meta_file.exists() or args.force:
            meta = {"started_at": datetime.now(UTC).isoformat(timespec="seconds"), "base_url": args.base_url,
                    "manifest": str(args.manifest), "items": len(items), **describe_server(client)}
            meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
        counts = run(client, items, args.images, args.out, force=args.force)
    print(f"보냄 {counts['done']} · 건너뜀(이미 있음) {counts['skipped']} · 파일 없음 {counts['missing']} · 실패 {counts['failed']}")
    print(f"다음: uv run python -m evalset.report {args.out}")
    return 1 if counts["failed"] or counts["missing"] else 0


if __name__ == "__main__":
    sys.exit(main())
