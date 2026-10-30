"""엔진 첫 활동 확인 (T042, research R22 "첫 활동 판정").

    cd app/model-api && uv run python -m app.engines.selftest <오선보.png> <정간보.png> [--timeout 600] [--json]

DB 없이 시드와 같은 기본 엔진 행(registry.DEFAULT_ROWS)으로 어댑터를 만들고,
오선보 엔진(homr·audiveris)은 오선보 그림으로, 정간보 엔진(jeongganbo-omr)은 정간보 그림으로 한 번씩 돌린다.
엔진 이름·판·결과(outcome)·음 개수·걸린 시간과 구조·타당성 확인 결과를 찍는다. 결과 기록은 app/evalset/FIRST_RUN.md.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

from app.checks.structure import check_structure
from app.checks.validity import check_validity
from app.engines.base import count_notes
from app.engines.registry import DEFAULT_ROWS, build_adapter


async def run_one(row: dict, image: Path, timeout_s: float) -> dict:
    adapter = build_adapter(row)
    score_type = "jeongganbo" if row["kind"] == "omr_jeongganbo" else "staff"
    info = adapter.probe()
    out: dict = {
        "engine": adapter.name, "installed": info["installed"], "version": info.get("version"),
        "image": str(image), "score_type": score_type,
    }
    st = check_structure(image.read_bytes(), score_type, None)
    out["structure"] = {"verdict": st.verdict, "scores": st.scores, "type_mismatch": st.type_mismatch}
    res = await adapter.recognize(str(image), time.monotonic() + timeout_s)
    out.update(outcome=res.outcome, failure_code=res.failure_code, duration_ms=res.duration_ms,
               engine_version=res.engine_version, confidence=res.confidence)
    extra = {k: v for k, v in res.extra.items() if k != "encoding"}
    if "encoding" in res.extra:
        extra["encoding_head"] = str(res.extra["encoding"])[:200]
    out["extra"] = extra
    if res.musicxml:
        out["notes"] = count_notes(res.musicxml)
        v = check_validity(res.musicxml, score_type, engine_confidence=res.confidence, caution_boundary=None,
                           distrust_boundary=None, yulmyeong_ratio=res.extra.get("yulmyeong_ratio"))
        out["validity"] = {"grade": v.grade, "score": v.score, "items": v.items}
    else:
        out["notes"] = 0
    return out


async def main_async(staff: Path, jg: Path, timeout_s: float, only: list[str] | None) -> list[dict]:
    results = []
    for row in DEFAULT_ROWS:
        if only and row["model_name"] not in only:
            continue
        image = jg if row["kind"] == "omr_jeongganbo" else staff
        r = await run_one(row, image, timeout_s)
        results.append(r)
        print(
            f"{r['engine']:15s} ver={r['version'] or '-':32s} installed={r['installed']!s:5s} "
            f"outcome={r['outcome']:14s} code={r['failure_code'] or '-':18s} notes={r['notes']:4d} "
            f"{r['duration_ms'] / 1000:7.1f}s  structure={r['structure']['verdict']}"
            f"  validity={r.get('validity', {}).get('grade', '-')}",
            flush=True,
        )
    return results


def main() -> int:
    ap = argparse.ArgumentParser(description="인식 엔진 첫 활동 확인(T042)")
    ap.add_argument("staff_png", type=Path)
    ap.add_argument("jeongganbo_png", type=Path)
    ap.add_argument("--timeout", type=float, default=600.0, help="엔진 하나당 제한 시간(초)")
    ap.add_argument("--only", nargs="*", help="이 엔진만 (예: homr jeongganbo-omr)")
    ap.add_argument("--json", action="store_true", help="끝에 전체 결과 JSON 을 찍는다")
    a = ap.parse_args()
    for p in (a.staff_png, a.jeongganbo_png):
        if not p.is_file():
            print(f"파일이 없음: {p}", file=sys.stderr)
            return 2
    results = asyncio.run(main_async(a.staff_png, a.jeongganbo_png, a.timeout, a.only))
    if a.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0 if any(r["outcome"] == "success" for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
