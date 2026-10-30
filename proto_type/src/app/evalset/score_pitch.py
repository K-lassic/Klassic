"""평가셋 인식 결과의 음높이를 정답과 비교한다 (tasks T147).

run.py --all 이 남긴 eval_run_result 중 항목마다 가장 최근 실행을 골라, 결과 MusicXML 의 음높이(MIDI 번호) 순서를
answers.json 의 정답과 비교한다. 일치율 = difflib 시퀀스 유사도(0~1) — 리듬·박자는 보지 않는다(HSH_조합B 와 같은 방식).
정상 변환 판정: 경로 recognize 이고 일치율 0.80 이상.
    uv run --project ../model-api python score_pitch.py            # 표 출력
    uv run --project ../model-api python score_pitch.py --markdown # EVAL_RUN.md 에 붙일 표
"""
from __future__ import annotations

import argparse
import difflib
import json
import sys
from pathlib import Path

import pymysql
from music21 import converter
from run import APP, HERE, connect, load_env

NORMAL_THRESHOLD = 0.80


def pitches_of(xml_path: Path) -> list[int]:
    out: list[int] = []
    for n in converter.parse(str(xml_path)).recurse().notes:
        if n.isChord:
            out.extend(p.midi for p in n.pitches)
        else:
            out.append(n.pitch.midi)
    return out


def resolve(uri: str, storage: Path) -> Path:
    # 대체 템플릿은 app/assets/…, 인식 결과는 STORAGE_DIR/… 에 있다
    return APP / uri if uri.startswith("assets/") else storage / uri


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--markdown", action="store_true")
    a = ap.parse_args()
    env = load_env()
    storage = Path(env.get("STORAGE_DIR", str(APP / "storage")))
    answers = json.loads((HERE / "answers.json").read_text(encoding="utf-8"))["staff"]
    db = connect(env)
    with db.cursor(pymysql.cursors.DictCursor) as c:
        c.execute("""
            SELECT i.file_uri, r.request_no, r.route, r.fallback_reason, j.validity_grade,
                   e.engine_name, cr.musicxml_uri
              FROM eval_item i
              JOIN eval_run_result x ON x.item_id = i.item_id
               AND x.request_id = (SELECT MAX(x2.request_id) FROM eval_run_result x2 WHERE x2.item_id = i.item_id)
              JOIN score_request r ON r.request_id = x.request_id
              LEFT JOIN processing_job j ON j.request_id = r.request_id
              LEFT JOIN v_job_engine e ON e.request_id = r.request_id
              LEFT JOIN v_current_result cr ON cr.request_id = r.request_id
             WHERE i.set_kind = 'real'
             ORDER BY i.file_uri""")
        rows = c.fetchall()
    if not rows:
        print("평가 실행 결과가 없습니다. run.py --all 을 먼저 실행하세요.")
        return 1
    normal = 0
    lines = []
    for row in rows:
        name = Path(row["file_uri"]).name
        want = answers.get(name, {}).get("pitches")
        ratio = None
        got_n = 0
        if want and row["route"] == "recognize" and row["musicxml_uri"]:
            got = pitches_of(resolve(row["musicxml_uri"], storage))
            got_n = len(got)
            ratio = difflib.SequenceMatcher(None, got, want, autojunk=False).ratio()
        ok = ratio is not None and ratio >= NORMAL_THRESHOLD
        normal += ok
        lines.append((name, row["route"], row["fallback_reason"] or "-", row["validity_grade"] or "-",
                      row["engine_name"] or "-", got_n, len(want or []), ratio, ok))
    if a.markdown:
        print("| 파일 | 경로 | 대체 이유 | 등급 | 엔진 | 음 수(인식/정답) | 일치율 | 정상 |")
        print("|---|---|---|---|---|---|---:|:--:|")
        for n, route, reason, grade, eng, g, w, r, ok in lines:
            print(f"| {n} | {route} | {reason} | {grade} | {eng} | {g}/{w} | {'-' if r is None else f'{r:.0%}'} | {'O' if ok else 'X'} |")
    else:
        for n, route, reason, grade, eng, g, w, r, ok in lines:
            print(f"{n:34} {route:10} {reason:14} {grade:9} {eng:10} {g:4}/{w:<4} {'-' if r is None else f'{r:.0%}':>5} {'정상' if ok else ''}")
    print(f"\n정상 변환(recognize + 일치율 {NORMAL_THRESHOLD:.0%} 이상): {normal}/{len(lines)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
