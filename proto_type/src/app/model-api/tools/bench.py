"""모델 API 측정 자 (2026-09-30 API 점검 C1·C8 — design/SD_04 §8-1).

이 파일을 고치면 이전 숫자와 비교할 수 없다. 방법: 첫 5건(워밍업, 첫 요청 따로 기록) 버림 → 100회 순차(정렬해 50·95번째)
→ 동시 10건 × 4회(실패 수·p95). 재기 전 다섯 줄(상태 ok · 중복 서버 없음 · 워밍업 · 워커 수 · 배경 작업)을 결과에 함께 적는다.

    .venv/bin/python tools/bench.py                       # 내부 127.0.0.1:9543 · 외부 https://p3.sumzip.com/api 의 /v1/health
    .venv/bin/python tools/bench.py --url http://127.0.0.1:9543/v1/health --n 100

    .venv/bin/python tools/bench.py --recognize staff:<그림> --recognize jeongganbo:<그림> --n 4
        인식 한 장을 n 번 순서대로(첫 요청 따로, 2~n 번째 평균) — 엔진 상주 전후 비교(2026-09-30 C2·C3).
        키는 명령행으로 받지 않고 app/.env 의 SERVICE_API_KEY 를 읽는다(D8). 개발 DB 에 요청이 n 건 남는다.

/v1/health 측정 방법(measure)은 바꾸지 않는다 — 이전 숫자와 비교하기 위해.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import statistics
import time
import urllib.request

DEFAULT = [("내부", "http://127.0.0.1:9543/v1/health"), ("외부", "https://p3.sumzip.com/api/v1/health")]


def get(url: str) -> tuple[int | str, float]:
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            r.read()
            s: int | str = r.status
    except urllib.error.HTTPError as e:
        s = e.code
    except Exception as e:  # noqa: BLE001
        s = type(e).__name__
    return s, (time.perf_counter() - t) * 1000


def measure(name: str, url: str, n: int = 100, warm: int = 5, conc: int = 10, rounds: int = 4) -> dict:
    first = [get(url)[1] for _ in range(warm)]
    xs = sorted(get(url)[1] for _ in range(n))
    fails, cs = 0, []
    for _ in range(rounds):
        with cf.ThreadPoolExecutor(conc) as ex:
            rs = list(ex.map(get, [url] * conc))
        fails += sum(1 for s, _ in rs if s != 200)
        cs += [d for _, d in rs]
    cs.sort()
    return {
        "구간": name, "url": url, "first_ms": round(first[0], 1),
        "second_ms": round(first[1], 1), "third_ms": round(first[2], 1),
        "w2_5avg_ms": round(statistics.mean(first[1:warm]), 1),
        "p50_ms": round(xs[n // 2 - 1], 1), "p95_ms": round(xs[int(n * 0.95) - 1], 1), "max_ms": round(xs[-1], 1),
        "conc_fail": fails, "conc_total": conc * rounds, "conc_p95_ms": round(cs[int(len(cs) * 0.95) - 1], 1),
        "load_avg": os.getloadavg()[0],
    }


def _service_key() -> str:
    env = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
    with open(env, encoding="utf-8") as f:
        for line in f:
            if line.startswith("SERVICE_API_KEY="):
                return line.split("=", 1)[1].strip().strip("'\"")
    raise SystemExit("SERVICE_API_KEY 없음")


def recognize(kind: str, image: str, n: int, base: str = "http://127.0.0.1:9543") -> dict:
    """인식 한 장을 n 번 순서대로. 첫 요청과 2~n 번째를 나눠 적는다."""
    import mimetypes
    import uuid

    key = _service_key()
    with open(image, "rb") as f:
        data = f.read()
    ctype = mimetypes.guess_type(image)[0] or "application/octet-stream"
    times, grades = [], []
    for _ in range(n):
        b = uuid.uuid4().hex
        body = (f"--{b}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"bench{os.path.splitext(image)[1]}\"\r\n"
                f"Content-Type: {ctype}\r\n\r\n").encode() + data + f"\r\n--{b}--\r\n".encode()
        req = urllib.request.Request(f"{base}/v1/omr/{kind}", data=body, method="POST",
                                     headers={"Content-Type": f"multipart/form-data; boundary={b}", "X-API-Key": key})
        t = time.perf_counter()
        with urllib.request.urlopen(req, timeout=600) as r:
            out = json.loads(r.read())
        times.append((time.perf_counter() - t) * 1000)
        grades.append(out.get("fallback_reason") or out.get("validity_grade"))
    rest = times[1:] or times
    return {"구간": f"인식 {kind}", "image": os.path.basename(image), "n": n,
            "first_ms": round(times[0], 1), "rest_avg_ms": round(statistics.mean(rest), 1),
            "each_ms": [round(x) for x in times], "labels": grades, "load_avg": os.getloadavg()[0]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", action="append", help="잴 주소(여러 번 가능). 없으면 내부·외부 /v1/health")
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--recognize", action="append", help="kind:그림 (kind = staff | jeongganbo)")
    a = ap.parse_args()
    if a.recognize:
        for item in a.recognize:
            kind, image = item.split(":", 1)
            print(json.dumps(recognize(kind, image, a.n if a.n != 100 else 4), ensure_ascii=False))
        return
    targets = [(u, u) for u in a.url] if a.url else DEFAULT
    for name, url in targets:
        print(json.dumps(measure(name, url, n=a.n), ensure_ascii=False))


if __name__ == "__main__":
    main()
