#!/usr/bin/env python3
# =============================================================================
# #19 오류 코드 파일 점검 — errors/common.json · web.json · model.json 을 합쳐 본다
#
#   구조에서의 위치: api/shared 는 backend · model-api · frontend 가 함께 읽는 설정이다.
#     오류 코드를 영역별 파일로 나눠 각자 자기 파일만 고치게 했으므로(같은 파일 동시 수정 방지),
#     세 파일을 합쳤을 때 깨지지 않았는지를 이 스크립트로 확인한다. 바깥 패키지 없이 표준 라이브러리만 쓴다.
#
#   확인하는 것
#     1. 같은 코드가 두 파일에 들어 있지 않다 (중복이면 어느 쪽 값이 쓰일지 모른다)
#     2. gate_codes 항목마다 http · gate · message · fix 가 있다 (응답 모양 — INTERFACES §2)
#     3. --compare <v0.1.1 error-codes.json> 을 주면, 합친 결과의 코드 · 값이 v0.1.1 과 같다
#
#   사용: python api/shared/check_errors.py [--compare proto_type/src/app/shared/error-codes.json]
#   끝 코드: 0 = 통과 · 1 = 문제 있음
# =============================================================================
import argparse
import json
import pathlib
import sys

SECTIONS = ("gate_codes", "fallback_reasons", "status_codes")
FILES = ("common", "web", "model")
GATE_FIELDS = ("http", "gate", "message", "fix")
HERE = pathlib.Path(__file__).resolve().parent


def load(name: str) -> dict:
    return json.loads((HERE / "errors" / f"{name}.json").read_text(encoding="utf-8"))


def merge(parts: dict[str, dict]) -> tuple[dict, list[str]]:
    """세 파일을 합친다. $ 로 시작하는 키는 설명이라 합치지 않는다"""
    merged: dict = {s: {} for s in SECTIONS}
    owner: dict[tuple[str, str], str] = {}
    problems: list[str] = []
    for name, data in parts.items():
        for sec in SECTIONS:
            for code, value in data.get(sec, {}).items():
                if code.startswith("$"):
                    continue
                if (sec, code) in owner:
                    problems.append(f"중복: {sec}.{code} 가 {owner[(sec, code)]}.json 과 {name}.json 에 모두 있다")
                    continue
                owner[(sec, code)] = name
                merged[sec][code] = value
    merged["api_version"] = parts["common"].get("api_version")
    return merged, problems


def check_fields(merged: dict) -> list[str]:
    problems = []
    for code, value in merged["gate_codes"].items():
        missing = [f for f in GATE_FIELDS if f not in value]
        if missing:
            problems.append(f"gate_codes.{code} 에 {', '.join(missing)} 가 없다")
    return problems


def compare(merged: dict, base_path: pathlib.Path) -> list[str]:
    base = json.loads(base_path.read_text(encoding="utf-8"))
    problems = []
    for sec in SECTIONS:
        want = {k: v for k, v in base[sec].items() if not k.startswith("$")}
        got = merged[sec]
        for code in sorted(want.keys() - got.keys()):
            problems.append(f"빠짐: {sec}.{code}")
        for code in sorted(got.keys() - want.keys()):
            problems.append(f"v0.1.1 에 없음(새 코드): {sec}.{code}")
        for code in sorted(want.keys() & got.keys()):
            if want[code] != got[code]:
                problems.append(f"값이 다름: {sec}.{code}")
    if merged["api_version"] != base.get("api_version"):
        problems.append("api_version 이 다름")
    return problems


def main() -> int:
    # Windows 콘솔(cp949)에서도 멈추지 않게 — 출력할 수 없는 글자는 ? 로 바꾼다
    sys.stdout.reconfigure(errors="replace")
    ap = argparse.ArgumentParser(description="api/shared/errors/*.json 점검")
    ap.add_argument("--compare", type=pathlib.Path, help="비교할 v0.1.1 error-codes.json")
    args = ap.parse_args()

    merged, problems = merge({n: load(n) for n in FILES})
    problems += check_fields(merged)
    if args.compare:
        problems += compare(merged, args.compare)

    counts = " · ".join(f"{s} {len(merged[s])}" for s in SECTIONS)
    total = sum(len(merged[s]) for s in SECTIONS)
    print(f"합친 오류 코드: {total}개 ({counts})")
    for p in problems:
        print(f"  - {p}")
    print("통과" if not problems else f"문제 {len(problems)}건")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
