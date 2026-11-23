"""타당성 판정(신뢰 · 주의 · 불신)의 경계와 가중치가 평가 결과와 맞는지 보고, 더 나은 값을 제안한다.

    uv run python -m evalset.calibrate evalset/results/2026-11-18 [결과폴더 …] [--json 제안.json]
    (report.py 를 먼저 돌려 각 폴더에 summary.json 이 있어야 한다)

구조에서의 위치: 서비스가 아니다. report.py 가 남긴 summary.json 만 읽는다. **아무것도 고치지 않는다 — 제안만 출력한다.**
    지금 값은 app/checks/validity.py 의 WEIGHTS(코드)와 설정의 caution · distrust 경계(DB, 기본 0.7 · 0.4)다.
    둘 다 사람이 어림으로 정했다. 이 도구는 "그 값이 실제 정답과 얼마나 맞는가"를 숫자로 보여 준다.

무엇을 '좋은 결과' 로 보나
    좋음  진짜 악보이고 음높이 일치율이 기준(80%) 이상
    나쁨  진짜 악보인데 일치율이 기준 미만  ·  가짜 악보인데 인식되어 나온 것
    (대체로 끝난 항목은 타당성 판정을 거치지 않았으므로 뺀다)

하는 일
    1) 지금 가중치로 점수를 다시 계산해 좋음 · 나쁨이 얼마나 갈리는지 본다 (AUC, 등급별 건수)
    2) 경계 제안   신뢰 경계 = 나쁨의 최고 점수 바로 위 (나쁜 결과가 '신뢰' 로 나가지 않게, SC-016)
                  불신 경계 = 좋음의 최저 점수 바로 아래 (좋은 결과를 '불신' 으로 버리지 않게)
    3) 가중치 제안 가중치 조합을 무작위로 많이 뽑아 좋음 · 나쁨을 가장 잘 가르는 것을 고른다.
                  한 건씩 빼고 고른 뒤 그 한 건을 채점하는 방식(leave-one-out)으로 "새 자료에서도 나은가"를 따로 잰다.

믿어도 되는가
    표본이 작으면 어떤 값을 내놓아도 우연이다. 좋음 · 나쁨이 각각 MIN_PER_CLASS(20)건이 안 되면
    제안에 `reliable: false` 를 달고 경고한다. 지금 평가셋(진짜 14 · 가짜 40)으로는 거의 확실히 그렇다 —
    가짜는 대부분 인식 전에 걸러져 '나쁨' 표본이 몇 건 안 남기 때문이다. 이 도구가 쓸모 있으려면
    실제 사진 · 잘못 인식된 사례를 평가셋에 더 모아야 한다.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

from app.checks.validity import DEFAULT_CAUTION, DEFAULT_DISTRUST, NOTE_COUNT_FULL, WEIGHTS

MIN_PER_CLASS = 20
SEARCH_SAMPLES = 4000
MARGIN = 0.02            # 경계를 표본 점수에서 이만큼 띄운다
LOO_MIN_GAIN = 0.05      # 검증에서 이만큼은 높아야 '나아졌다' 고 말한다
LOO_MIN_AUC = 0.65       # 그리고 제안 자체가 이만큼은 갈라내야 한다


def parts_of(items: dict) -> dict[str, float]:
    """validity_items(응답에 실린 값) → 점수 계산에 들어가는 0..1 값. validity.py 의 check_validity 와 같은 규칙."""
    out: dict[str, float] = {}
    if items.get("note_count") is not None:
        out["note_count"] = min(1.0, float(items["note_count"]) / NOTE_COUNT_FULL)
    for k in ("beat_sum", "range_leap", "yulmyeong_ratio", "engine_confidence"):
        if items.get(k) is not None:
            out[k] = max(0.0, min(1.0, float(items[k])))
    return out


def combine(items: dict, weights: dict[str, float] = WEIGHTS) -> float:
    """항목 값 → 타당성 점수. validity.py 와 같은 식: 가중 평균 × (0.5 + 0.5 × 가장 낮은 항목)."""
    parts = parts_of(items)
    if not parts or not items.get("note_count"):
        return 0.0
    wsum = sum(weights.get(k, 0.0) for k in parts)
    if wsum <= 0:
        return 0.0
    mean = sum(weights.get(k, 0.0) * v for k, v in parts.items()) / wsum
    return round(max(0.0, min(1.0, mean * (0.5 + 0.5 * min(parts.values())))), 4)


def grade(score: float, caution: float, distrust: float) -> str:
    return "trust" if score >= caution else "caution" if score >= distrust else "distrust"


def samples_from(rows: list[dict]) -> list[dict]:
    """채점된 줄 → 보정 표본 [{name, good, items}]. 타당성 판정을 거친(인식된) 항목만."""
    out = []
    for r in rows:
        if r.get("outcome") != "recognized" or not r.get("validity_items"):
            continue
        if r["kind"] == "real":
            if not r.get("pitch"):
                continue                 # 정답이 없으면 좋고 나쁨을 모른다
            good = bool(r.get("normal"))
        else:
            good = False                 # 가짜가 인식되어 나왔으면 나쁜 결과다
        out.append({"name": r["name"], "good": good, "items": r["validity_items"], "reported_grade": r.get("validity_grade")})
    return out


def auc(scores: list[float], labels: list[bool]) -> float | None:
    """좋은 결과의 점수가 나쁜 결과보다 높을 확률 (동점은 0.5). 한쪽이 없으면 None."""
    pos = [s for s, g in zip(scores, labels) if g]
    neg = [s for s, g in zip(scores, labels) if not g]
    if not pos or not neg:
        return None
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return round(wins / (len(pos) * len(neg)), 4)


def suggest_thresholds(scores: list[float], labels: list[bool]) -> dict:
    """신뢰 경계는 나쁨의 최고점 위, 불신 경계는 좋음의 최저점 아래. 둘이 엇갈리면 그 사실을 알린다."""
    good = [s for s, g in zip(scores, labels) if g]
    bad = [s for s, g in zip(scores, labels) if not g]
    out: dict = {"caution": None, "distrust": None, "separable": None}
    if bad:
        out["caution"] = round(min(1.0, max(bad) + MARGIN), 2)
    if good:
        out["distrust"] = round(max(0.0, min(good) - MARGIN), 2)
    if good and bad:
        # 좋음의 최저점이 나쁨의 최고점보다 높으면 한 경계로 완전히 갈린다
        out["separable"] = min(good) > max(bad)
        if out["distrust"] is not None and out["caution"] is not None and out["distrust"] > out["caution"]:
            out["distrust"] = out["caution"]
        # 신뢰 경계를 지키면 '신뢰' 를 못 받는 좋은 결과가 몇 건인가
        out["good_below_caution"] = sum(1 for s in good if s < out["caution"])
        out["bad_above_distrust"] = sum(1 for s in bad if s >= (out["distrust"] or 0))
    return out


def grade_table(samples: list[dict], scores: list[float], caution: float, distrust: float) -> dict:
    table = {g: {"good": 0, "bad": 0} for g in ("trust", "caution", "distrust")}
    for s, score in zip(samples, scores):
        table[grade(score, caution, distrust)]["good" if s["good"] else "bad"] += 1
    return table


def random_weights(rng: random.Random, keys: list[str]) -> dict[str, float]:
    """합이 1 인 가중치를 고르게 뽑는다."""
    raw = [rng.expovariate(1.0) for _ in keys]
    total = sum(raw)
    return {k: round(v / total, 3) for k, v in zip(keys, raw)}


def search_weights(samples: list[dict], keys: list[str], *, n: int = SEARCH_SAMPLES, seed: int = 0) -> tuple[dict[str, float], float | None]:
    """좋음 · 나쁨을 가장 잘 가르는(AUC 가 가장 높은) 가중치. 동률이면 지금 값에 가까운 쪽."""
    rng = random.Random(seed)
    labels = [s["good"] for s in samples]
    current = {k: WEIGHTS[k] for k in keys}
    best_w, best_auc = current, auc([combine(s["items"], current) for s in samples], labels)
    if best_auc is None:
        return current, None

    def dist(w: dict[str, float]) -> float:
        return sum(abs(w[k] - current[k]) for k in keys)

    for _ in range(n):
        w = random_weights(rng, keys)
        a = auc([combine(s["items"], w) for s in samples], labels)
        if a is not None and (a > best_auc + 1e-9 or (abs(a - best_auc) <= 1e-9 and dist(w) < dist(best_w))):
            best_w, best_auc = w, a
    return best_w, best_auc


def leave_one_out(samples: list[dict], keys: list[str], *, n: int = 400, seed: int = 0) -> dict:
    """한 건씩 빼고 가중치를 고른 뒤 그 한 건을 채점한다 — 고른 가중치가 새 자료에서도 나은지 본다."""
    labels = [s["good"] for s in samples]
    held_new, held_cur = [], []
    for i, s in enumerate(samples):
        rest = samples[:i] + samples[i + 1:]
        w, _ = search_weights(rest, keys, n=n, seed=seed + i)
        held_new.append(combine(s["items"], w))
        held_cur.append(combine(s["items"], {k: WEIGHTS[k] for k in keys}))
    return {"auc_current": auc(held_cur, labels), "auc_searched": auc(held_new, labels)}


def calibrate(rows: list[dict], *, caution: float = DEFAULT_CAUTION, distrust: float = DEFAULT_DISTRUST,
              search: int = SEARCH_SAMPLES, seed: int = 0) -> dict:
    samples = samples_from(rows)
    good = sum(s["good"] for s in samples)
    bad = len(samples) - good
    result: dict = {
        "samples": len(samples), "good": good, "bad": bad,
        "reliable": good >= MIN_PER_CLASS and bad >= MIN_PER_CLASS,
        "min_per_class": MIN_PER_CLASS,
        "current": {"weights": dict(WEIGHTS), "caution": caution, "distrust": distrust},
    }
    if not samples:
        return result
    labels = [s["good"] for s in samples]
    scores = [combine(s["items"], WEIGHTS) for s in samples]
    result["current"]["auc"] = auc(scores, labels)
    result["current"]["grades"] = grade_table(samples, scores, caution, distrust)
    # 서버가 실제로 낸 등급과 여기서 다시 계산한 등급이 다르면 설정(경계)이나 코드가 이 도구의 가정과 다른 것이다
    result["current"]["grade_mismatch"] = [
        s["name"] for s, sc in zip(samples, scores)
        if s["reported_grade"] and s["reported_grade"] != grade(sc, caution, distrust)]
    result["scores"] = [{"name": s["name"], "good": s["good"], "score": sc, "items": s["items"]}
                        for s, sc in sorted(zip(samples, scores), key=lambda x: x[1])]
    result["thresholds"] = suggest_thresholds(scores, labels)

    keys = sorted({k for s in samples for k in parts_of(s["items"])})
    if good and bad and len(keys) >= 2:
        w, a = search_weights(samples, keys, n=search, seed=seed)
        new_scores = [combine(s["items"], w) for s in samples]
        result["weights"] = {
            "suggested": w, "auc": a, "keys": keys,
            "thresholds": suggest_thresholds(new_scores, labels),
            "leave_one_out": leave_one_out(samples, keys, seed=seed) if len(samples) <= 200 else None,
        }
    return result


def to_text(r: dict) -> str:
    L = [f"보정 표본 {r['samples']}건 — 좋음 {r['good']} · 나쁨 {r['bad']}"]
    if not r["samples"]:
        return L[0] + "\n타당성 판정을 거친 항목이 없습니다. 먼저 run.py · report.py 를 돌리세요."
    if not r["reliable"]:
        L.append(f"⚠ 표본이 적습니다 (좋음 · 나쁨 각각 {r['min_per_class']}건 이상이어야 믿을 만합니다). "
                 "아래 숫자는 방향만 참고하고 설정을 바꾸는 근거로 쓰지 마세요.")
    c = r["current"]
    L.append(f"\n[지금] 경계 신뢰 {c['caution']} · 불신 {c['distrust']} · 갈라내는 힘(AUC) {c['auc']}")
    for g, label in (("trust", "신뢰"), ("caution", "주의"), ("distrust", "불신")):
        L.append(f"  {label:<3} 좋음 {c['grades'][g]['good']:>3} · 나쁨 {c['grades'][g]['bad']:>3}")
    if c["grade_mismatch"]:
        L.append(f"  서버가 낸 등급과 다시 계산한 등급이 다른 항목 {len(c['grade_mismatch'])}건: {', '.join(c['grade_mismatch'][:5])}"
                 " — 서버의 경계 설정이 위 값과 다른지 확인하세요")
    t = r["thresholds"]
    L.append(f"\n[경계 제안] 신뢰 {t['caution']} · 불신 {t['distrust']}"
             + ("" if t.get("separable") is None else ("  (좋음과 나쁨이 점수로 완전히 갈립니다)" if t["separable"] else "  (좋음과 나쁨의 점수가 겹칩니다)")))
    if t.get("good_below_caution") is not None:
        L.append(f"  이 경계에서 '신뢰' 를 못 받는 좋은 결과 {t['good_below_caution']}건 · '불신' 을 피하는 나쁜 결과 {t['bad_above_distrust']}건")
    w = r.get("weights")
    if w:
        L.append(f"\n[가중치 제안] AUC {c['auc']} → {w['auc']}")
        for k in w["keys"]:
            L.append(f"  {k:<18} {WEIGHTS[k]:.2f} → {w['suggested'][k]:.2f}")
        loo = w.get("leave_one_out")
        if loo:
            # 둘 다 동전 던지기 수준(0.5 근처)이면 조금 높아도 우연이다 — 제안 쪽이 뚜렷이 높고, 그 자체로 쓸 만해야 한다
            better = (loo["auc_searched"] is not None and loo["auc_current"] is not None
                      and loo["auc_searched"] >= loo["auc_current"] + LOO_MIN_GAIN and loo["auc_searched"] >= LOO_MIN_AUC)
            L.append(f"  한 건씩 빼고 다시 고른 검증: 지금 {loo['auc_current']} · 제안 {loo['auc_searched']}  → "
                     + ("새 자료에서도 나아 보입니다" if better else "새 자료에서는 나아진다고 볼 근거가 없습니다 — 지금 가중치를 두세요"))
    return "\n".join(L)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="타당성 판정의 경계 · 가중치를 평가 결과와 견준다 (제안만 한다)")
    ap.add_argument("folders", nargs="+", type=Path, help="report.py 를 돌린 결과 폴더 (여러 개면 합친다)")
    ap.add_argument("--caution", type=float, default=DEFAULT_CAUTION, help="지금 서버의 신뢰 경계")
    ap.add_argument("--distrust", type=float, default=DEFAULT_DISTRUST, help="지금 서버의 불신 경계")
    ap.add_argument("--json", type=Path, help="제안을 JSON 으로도 남긴다")
    args = ap.parse_args(argv)

    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    rows: list[dict] = []
    for folder in args.folders:
        f = folder / "summary.json"
        if not f.exists():
            print(f"{f} 가 없습니다 — 먼저 `python -m evalset.report {folder}` 를 실행하세요.", file=sys.stderr)
            return 2
        rows += json.loads(f.read_text(encoding="utf-8"))["rows"]
    result = calibrate(rows, caution=args.caution, distrust=args.distrust)
    print(to_text(result))
    if args.json:
        args.json.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
