"""평가 실행 결과(run.py 가 남긴 폴더)를 채점해 표와 지표로 만든다. 예전 결과와 견줘 나빠졌으면 알린다.

    uv run python -m evalset.report evalset/results/2026-11-18
    uv run python -m evalset.report evalset/results/2026-11-18 --baseline evalset/results/2026-11-01/summary.json
    uv run python -m evalset.report evalset/results/2026-11-18 --markdown > 결과.md

구조에서의 위치: 서비스가 아니다. run.py 가 남긴 파일만 읽는다 — model-api · DB · 엔진에 닿지 않는다.
    그래서 엔진이 없는 PC 에서도 예전 실행 결과를 다시 채점할 수 있다 (채점 기준을 바꿨을 때 다시 돌릴 필요가 없다).

지표 (v0.1.1 EVAL_RUN.md 와 같은 이름)
    정상 변환        진짜 악보 중 '대체가 아니고 음높이 일치율 80% 이상' 인 것
    SC-017 오차단    진짜 악보인데 인식을 못 하고 대체로 끝난 것
    SC-016 가짜 통과 가짜 악보인데 타당성 등급이 '신뢰' 로 나간 것 (0 이어야 한다)
    가짜 걸러짐      가짜 악보가 대체 · 접수 거절로 끝난 것

--baseline 을 주면 지표가 나빠졌을 때 종료 코드 1 을 낸다 (엔진 판 올림 · 전처리 변경 뒤 회귀 확인용).
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

from evalset.scoring import NORMAL_THRESHOLD, pitches_of_musicxml, score_pitches

HERE = Path(__file__).resolve().parent
DEFAULT_ANSWERS = HERE / "data" / "answers.json"


def load_run(folder: Path) -> list[dict]:
    files = sorted((folder / "items").glob("*.json"))
    return [json.loads(f.read_text(encoding="utf-8")) for f in files]


def outcome_of(rec: dict) -> str:
    """항목 하나가 어떻게 끝났는가: recognized · fallback · rejected · error."""
    if rec.get("status") == 200:
        return "fallback" if (rec.get("body") or {}).get("fallback") else "recognized"
    if rec.get("status") is not None and 400 <= rec["status"] < 500 and rec["status"] not in (401, 403, 429):
        return "rejected"          # 접수 단계에서 거절 (업로드 검사)
    return "error"                 # 서버 오류 · 연결 실패 · 권한 · 한도 — 인식 품질과 관계없는 실패


def score_item(rec: dict, answers: dict, pitch_reader=pitches_of_musicxml) -> dict:
    """항목 하나의 채점 결과 한 줄."""
    body = rec.get("body") or {}
    outcome = outcome_of(rec)
    row = {
        "name": rec["name"], "kind": rec["kind"], "score_type": rec.get("score_type"), "label": rec.get("label"),
        "outcome": outcome, "status": rec.get("status"), "seconds": rec.get("seconds"),
        "fallback_reason": body.get("fallback_reason") or ((rec.get("error") or {}).get("code") if isinstance(rec.get("error"), dict) else None),
        "structure_verdict": body.get("structure_verdict"),
        "validity_grade": body.get("validity_grade"),
        "validity_items": body.get("validity_items") or {},
        "engine": (body.get("engine") or {}).get("name"),
        "engine_version": (body.get("engine") or {}).get("version"),
        "pitch": None, "normal": False,
    }
    if rec["kind"] != "real":
        return row
    answer = answers.get(rec["name"])
    row["piece"] = (answer or {}).get("piece")
    row["variant"] = (answer or {}).get("variant")
    if not answer:
        row["no_answer"] = True
        return row
    got: list[int] = []
    if outcome == "recognized" and body.get("musicxml"):
        try:
            got = pitch_reader(body["musicxml"])
        except Exception as e:          # 읽을 수 없는 MusicXML 도 결과다 — 0점으로 센다
            row["musicxml_error"] = type(e).__name__
    score = score_pitches(got, answer["pitches"])
    row["pitch"] = score.as_dict()
    row["normal"] = outcome == "recognized" and score.normal
    return row


def summarize(rows: list[dict]) -> dict:
    real = [r for r in rows if r["kind"] == "real"]
    fake = [r for r in rows if r["kind"] == "fake"]
    scored = [r for r in real if r["pitch"]]
    recognized = [r for r in scored if r["outcome"] == "recognized"]
    seconds = [r["seconds"] for r in rows if r.get("seconds") is not None and r["outcome"] in ("recognized", "fallback")]

    def rate(n: int, d: int) -> float | None:
        return round(n / d, 4) if d else None

    by_variant: dict[str, dict] = {}
    for r in scored:
        v = by_variant.setdefault(r.get("variant") or "-", {"n": 0, "normal": 0})
        v["n"] += 1
        v["normal"] += int(r["normal"])
    return {
        "real": {
            "n": len(real),
            "scored": len(scored),
            "normal": sum(r["normal"] for r in scored),
            "normal_rate": rate(sum(r["normal"] for r in scored), len(scored)),
            "false_block": sum(r["outcome"] in ("fallback", "rejected") for r in real),
            "false_block_rate": rate(sum(r["outcome"] in ("fallback", "rejected") for r in real), len(real)),
            "mean_ratio_recognized": round(statistics.fmean(r["pitch"]["ratio"] for r in recognized), 4) if recognized else None,
            "shifted": sum(1 for r in recognized if r["pitch"]["best_shift"]),
            "by_variant": by_variant,
            "grades": _count(r["validity_grade"] for r in real if r["outcome"] == "recognized"),
        },
        "fake": {
            "n": len(fake),
            "passed_as_trust": sum(r["outcome"] == "recognized" and r["validity_grade"] == "trust" for r in fake),
            "recognized": sum(r["outcome"] == "recognized" for r in fake),
            "filtered": sum(r["outcome"] in ("fallback", "rejected") for r in fake),
            "filtered_rate": rate(sum(r["outcome"] in ("fallback", "rejected") for r in fake), len(fake)),
            "reasons": _count(r["fallback_reason"] for r in fake if r["outcome"] in ("fallback", "rejected")),
        },
        "errors": sum(r["outcome"] == "error" for r in rows),
        "seconds": {"median": round(statistics.median(seconds), 2), "max": round(max(seconds), 2), "total": round(sum(seconds), 1)} if seconds else None,
        "threshold": NORMAL_THRESHOLD,
    }


def _count(values) -> dict[str, int]:
    out: dict[str, int] = {}
    for v in values:
        out[str(v or "-")] = out.get(str(v or "-"), 0) + 1
    return dict(sorted(out.items()))


# 예전 결과와 견줄 지표: (이름, 경로, 클수록 좋은가)
COMPARE = [
    ("정상 변환", ("real", "normal"), True),
    ("진짜 악보 오차단 (SC-017)", ("real", "false_block"), False),
    ("가짜가 '신뢰' 로 통과 (SC-016)", ("fake", "passed_as_trust"), False),
    ("가짜 걸러짐", ("fake", "filtered"), True),
    ("오류", ("errors",), False),
]


def _get(d: dict, path: tuple[str, ...]):
    for k in path:
        d = d.get(k) if isinstance(d, dict) else None
    return d


def compare(now: dict, base: dict) -> list[dict]:
    """지표마다 {name, before, after, worse}. 항목 수가 다르면 건수 비교는 뜻이 없으므로 그 사실을 함께 돌려준다."""
    out = []
    same_size = _get(now, ("real", "n")) == _get(base, ("real", "n")) and _get(now, ("fake", "n")) == _get(base, ("fake", "n"))
    for name, path, higher_is_better in COMPARE:
        a, b = _get(base, path), _get(now, path)
        worse = None if a is None or b is None else (b < a if higher_is_better else b > a)
        out.append({"name": name, "before": a, "after": b, "worse": bool(worse), "comparable": same_size})
    return out


def regressions(rows: list[dict], base_rows: list[dict]) -> list[str]:
    """예전에는 정상이었는데 지금은 아닌 진짜 악보 — 평균에 묻히지 않게 이름으로 짚는다."""
    was = {r["name"] for r in base_rows if r["kind"] == "real" and r.get("normal")}
    return sorted(r["name"] for r in rows if r["kind"] == "real" and r["name"] in was and not r["normal"])


def pct(x) -> str:
    return "-" if x is None else f"{x * 100:.0f}%"


def to_markdown(rows: list[dict], s: dict, diff: list[dict] | None = None, lost: list[str] | None = None) -> str:
    L = []
    real, fake = s["real"], s["fake"]
    L.append("| 지표 | 결과 | 기준 |")
    L.append("|---|---|---|")
    L.append(f"| 오선보 · 정간보 정상 변환 | **{real['normal']} / {real['scored']}** ({pct(real['normal_rate'])}) | 일치율 {pct(s['threshold'])} 이상 |")
    L.append(f"| SC-017 진짜 악보 오차단 | **{real['false_block']} / {real['n']}** | |")
    L.append(f"| SC-016 가짜 악보가 '신뢰' 로 나간 수 | **{fake['passed_as_trust']} / {fake['n']}** | 0 |")
    L.append(f"| 가짜 악보가 걸러진 수 | {fake['filtered']} / {fake['n']} | |")
    L.append(f"| 오류 (서버 · 연결 · 권한 · 한도) | {s['errors']} | 0 |")
    if s["seconds"]:
        L.append(f"| 한 장 처리 시간 | 중앙 {s['seconds']['median']}초 · 최대 {s['seconds']['max']}초 | |")
    if real["shifted"]:
        L.append(f"| 전체가 통째로 밀린 악보 | {real['shifted']} | 0 — 음자리표 · 조표를 잘못 읽은 것 |")
    L.append("")

    if diff:
        L.append("### 예전 결과와 견줌\n")
        L.append("| 지표 | 예전 | 지금 | |")
        L.append("|---|---:|---:|---|")
        for d in diff:
            mark = "**나빠짐**" if d["worse"] else ""
            L.append(f"| {d['name']} | {d['before']} | {d['after']} | {mark} |")
        if diff and not diff[0]["comparable"]:
            L.append("\n항목 수가 예전과 다르다 — 건수를 그대로 견줄 수 없다.")
        if lost:
            L.append("\n예전에는 정상이었는데 지금은 아닌 악보: " + ", ".join(f"`{n}`" for n in lost))
        L.append("")

    L.append("| 파일 | 끝난 모양 | 대체 이유 | 등급 | 엔진 | 음 수(인식/정답) | 일치율 | 빠짐 · 지어냄 · 틀림 | 밀림 | 정상 |")
    L.append("|---|---|---|---|---|---|---:|---|---:|:--:|")
    for r in rows:
        if r["kind"] != "real":
            continue
        p = r["pitch"]
        if p:
            cells = (f"{p['got']}/{p['want']}", pct(p["ratio"]) if r["outcome"] == "recognized" else "-",
                     f"{p['missing']} · {p['extra']} · {p['wrong']}" if r["outcome"] == "recognized" else "-",
                     f"{p['best_shift']:+d}" if p["best_shift"] else "")
        else:
            cells = ("-", "-", "정답 없음" if r.get("no_answer") else "-", "")
        L.append(f"| {r['name']} | {r['outcome']} | {r['fallback_reason'] or '-'} | {r['validity_grade'] or '-'} | {r['engine'] or '-'} "
                 f"| {cells[0]} | {cells[1]} | {cells[2]} | {cells[3]} | {'O' if r['normal'] else 'X'} |")
    L.append("")
    L.append("| 가짜 악보 | 종류 | 끝난 모양 | 이유 | 등급 |")
    L.append("|---|---|---|---|---|")
    for r in rows:
        if r["kind"] == "fake":
            flag = " **← 통과**" if r["outcome"] == "recognized" and r["validity_grade"] == "trust" else ""
            L.append(f"| {r['name']} | {r['label'] or '-'} | {r['outcome']} | {r['fallback_reason'] or '-'} | {r['validity_grade'] or '-'}{flag} |")
    return "\n".join(L) + "\n"


def build(folder: Path, answers_file: Path = DEFAULT_ANSWERS, pitch_reader=pitches_of_musicxml) -> tuple[list[dict], dict]:
    answers = json.loads(answers_file.read_text(encoding="utf-8"))
    merged = {**answers.get("staff", {}), **answers.get("jeongganbo", {})}
    rows = [score_item(rec, merged, pitch_reader) for rec in load_run(folder)]
    return rows, summarize(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="평가 실행 결과를 채점한다")
    ap.add_argument("folder", type=Path, help="run.py 의 --out 폴더")
    ap.add_argument("--answers", type=Path, default=DEFAULT_ANSWERS)
    ap.add_argument("--baseline", type=Path, help="견줄 예전 summary.json")
    ap.add_argument("--markdown", action="store_true", help="표를 표준 출력으로 (요약 줄 없이)")
    args = ap.parse_args(argv)

    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    rows, summary = build(args.folder, args.answers)
    if not rows:
        print(f"결과가 없습니다: {args.folder / 'items'} — run.py 를 먼저 실행하세요.", file=sys.stderr)
        return 2
    diff = lost = None
    if args.baseline:
        base = json.loads(args.baseline.read_text(encoding="utf-8"))
        diff = compare(summary, base["summary"])
        lost = regressions(rows, base.get("rows", []))

    # 다음 실행이 견줄 수 있게 남긴다. 항목 점수(validity_items)도 함께 — calibrate.py 가 읽는다
    (args.folder / "summary.json").write_text(
        json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    md = to_markdown(rows, summary, diff, lost)
    (args.folder / "REPORT.md").write_text(md, encoding="utf-8")

    if args.markdown:
        print(md)
    else:
        r, f = summary["real"], summary["fake"]
        print(f"정상 변환 {r['normal']}/{r['scored']} · 오차단 {r['false_block']}/{r['n']} · "
              f"가짜 '신뢰' 통과 {f['passed_as_trust']}/{f['n']} · 가짜 걸러짐 {f['filtered']}/{f['n']} · 오류 {summary['errors']}")
        print(f"저장: {args.folder / 'REPORT.md'} · summary.json")
    worse = [d["name"] for d in (diff or []) if d["worse"] and d["comparable"]]
    if worse or lost:
        print("나빠진 지표: " + (", ".join(worse) or "-") + (f" · 정상에서 빠진 악보: {', '.join(lost)}" if lost else ""), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
