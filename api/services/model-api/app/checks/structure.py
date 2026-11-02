"""악보 구조 확인 (T055, FR-057·FR-058, research R16) — OpenCV 규칙 기반.

두 종류 점수(0..1)를 늘 함께 잰다.
- 오선보(staff): 긴 가로줄을 세로 띠별 가로 투영으로 찾고, **간격이 고르고 앞뒤가 떨어진 5줄 묶음**을 센다.
  고른 간격 줄이 끝없이 이어지는 공책·표·블라인드는 5줄 묶음이 생기지 않는다.
  줄을 지운 뒤 묶음 안에 음표 같은 덩어리가 있어야 한다(빈 오선지 거르기). 가는 세로 막대(마디줄)는 세지 않는다.
- 정간보(jeongganbo): 세로·가로 선으로 만든 격자의 칸 중 **크기가 고른 칸**이 세로 열(각)로 여러 칸씩 쌓였는지 보고,
  칸 모양(세로/가로 비), 칸 안 글자(율명) 유무를 곱한다. 넓적한 표 칸·빈 모눈은 낮게 나온다.
사진 보정(T153): 곧은 스캔 기준 오선 점수가 만점이 아니면 ① 가로 투영이 가장 날카로워지는 각도(±8°)를 찾아 곧게 펴고
② 배경(닫힘 연산)과의 차이로 다시 이진화해 한 번 더 잰다(흐림·낮은 대비·그림자). 두 점수 중 큰 쪽을 쓴다.
원근으로 좌우 기울기가 다른 사진은 기존 세로 띠별 분석(8띠)이 흡수한다.
판정: 고른 종류 점수 ≥ 기준 → pass, ≥ 기준×0.6 → ambiguous, 아니면 fail.
다른 종류 점수가 기준 이상이고 고른 종류보다 0.25 이상 높으면 type_mismatch.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

DEFAULT_THRESHOLD = 0.5
AMBIGUOUS_FACTOR = 0.6
MISMATCH_MARGIN = 0.25
MAX_LONG_EDGE = 2000
SKEW_MAX_DEG = 8.0
SKEW_MIN_DEG = 0.25  # 이보다 작은 기울기는 돌리지 않는다
BG_DIFF_MIN = 20  # 배경보다 이만큼 어두우면 잉크(0..255) — 잡음이 크면 median+6·MAD 로 올린다
PHOTO_MAX_INK = 0.25  # 배경 빼기 뒤 잉크가 이보다 많으면(잡음·짙은 무늬) 사진 보정 경로를 쓰지 않는다


@dataclass
class StructureVerdict:
    verdict: str  # 'pass' | 'ambiguous' | 'fail'
    type_mismatch: bool
    detected_type: str | None  # 'staff' | 'jeongganbo' | None
    scores: dict = field(default_factory=dict)  # {'staff': float, 'jeongganbo': float}
    details: dict = field(default_factory=dict)


# ── 공통 전처리 ─────────────────────────────────────────────────────────────────
def _decode_gray(image_bytes: bytes) -> np.ndarray | None:
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    if img is None:
        return None
    if img.dtype != np.uint8:  # 16비트 PNG 등
        img = (img / 257).astype(np.uint8) if img.dtype == np.uint16 else img.astype(np.uint8)
    if img.ndim == 2:
        gray = img
    elif img.shape[2] == 4:
        # 투명 배경(PNG)은 흰 종이 위에 얹어 본다 — 그냥 회색으로 바꾸면 투명 부분이 검게 된다
        alpha = img[:, :, 3:4].astype(np.float32) / 255.0
        rgb = img[:, :, :3].astype(np.float32) * alpha + 255.0 * (1 - alpha)
        gray = cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_BGR2GRAY)
    else:
        gray = cv2.cvtColor(img[:, :, :3], cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    scale = MAX_LONG_EDGE / max(h, w)
    if scale < 1.0:
        gray = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return gray


def _binarize(gray: np.ndarray) -> np.ndarray:
    """잉크 = 255. 조명이 고르지 않은 사진도 견디게 지역 문턱값을 쓴다."""
    h, w = gray.shape
    block = max(15, (min(h, w) // 30) | 1)
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, block, 15)


def _binarize_bg(gray: np.ndarray) -> np.ndarray:
    """배경 빼기 이진화 — 흐리거나 대비가 낮은 사진용. 닫힘 연산으로 가는 선·글자를 지운 배경과 비교한다."""
    k = max(15, (max(gray.shape) // 100) | 1)
    bg = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    diff = cv2.subtract(bg, gray)
    med = float(np.median(diff))
    mad = float(np.median(np.abs(diff.astype(np.float32) - med)))
    thr = max(BG_DIFF_MIN, med + 6 * mad)
    return ((diff > thr) * 255).astype(np.uint8)


def _rotate(img: np.ndarray, deg: float) -> np.ndarray:
    h, w = img.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), deg, 1.0)
    return cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def _estimate_skew(ink: np.ndarray) -> float:
    """가로 투영의 행간 차이 제곱합이 가장 큰 각도(도). 뚜렷한 가로 구조가 없으면 0."""
    h, w = ink.shape
    s = min(1.0, 800 / max(h, w))
    small = cv2.resize(ink, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA)

    def sharp(deg: float) -> float:
        prof = (_rotate(small, deg) if deg else small).astype(np.float32).sum(axis=1)
        return float((np.diff(prof) ** 2).sum())

    base = sharp(0.0)
    best_deg, best = 0.0, base
    for deg in np.arange(-SKEW_MAX_DEG, SKEW_MAX_DEG + 0.01, 1.0):  # 거칠게
        v = sharp(float(deg))
        if v > best:
            best_deg, best = float(deg), v
    coarse = best_deg
    for deg in np.arange(coarse - 0.75, coarse + 0.76, 0.25):  # 곱게
        v = sharp(float(deg))
        if v > best:
            best_deg, best = float(deg), v
    if best < base * 1.05:  # 빈 종이·잡음처럼 날카로움 차이가 거의 없으면 돌리지 않는다
        return 0.0
    return best_deg


def _runs(mask_1d: np.ndarray) -> list[tuple[int, int]]:
    """참 구간 [시작, 끝) 목록."""
    padded = np.concatenate([[0], mask_1d.astype(np.int8), [0]])
    d = np.diff(padded)
    return list(zip(np.where(d == 1)[0].tolist(), np.where(d == -1)[0].tolist()))


# ── 오선보 ─────────────────────────────────────────────────────────────────────
def _five_groups(centers: list[float], height: int) -> list[tuple[float, float, float]]:
    """(첫 줄 y, 끝 줄 y, 간격). 5줄 간격이 고르고, 바로 앞·뒤 줄과는 간격의 1.8배 이상 떨어져야 한다."""
    out: list[tuple[float, float, float]] = []
    n = len(centers)
    i = 0
    min_gap = max(3.0, height * 0.003)
    max_gap = height * 0.05
    while i + 4 < n:
        c = centers[i : i + 5]
        gaps = np.diff(c)
        g = float(gaps.mean())
        if min_gap <= g <= max_gap and float(np.abs(gaps - g).max()) <= 0.2 * g + 1.0:
            prev_gap = c[0] - centers[i - 1] if i > 0 else float("inf")
            next_gap = centers[i + 5] - c[4] if i + 5 < n else float("inf")
            if prev_gap > 1.8 * g and next_gap > 1.8 * g:
                out.append((c[0], c[4], g))
                i += 5
                continue
        i += 1
    return out


def staff_score(ink: np.ndarray) -> tuple[float, dict]:
    h, w = ink.shape
    klen = max(15, w // 30)
    hmask = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((1, klen), np.uint8))
    hmask_v = cv2.dilate(hmask, np.ones((3, 1), np.uint8))  # 조금 기울어진 줄도 한 줄로
    n_strips = 8
    group_counts: list[int] = []
    line_counts: list[int] = []
    best_groups: list[tuple[float, float, float]] = []
    for s in range(n_strips):
        x0, x1 = w * s // n_strips, w * (s + 1) // n_strips
        prof = (hmask_v[:, x0:x1] > 0).mean(axis=1)
        centers = [(a + b - 1) / 2 for a, b in _runs(prof >= 0.45)]
        groups = _five_groups(centers, h)
        group_counts.append(len(groups))
        if centers:
            line_counts.append(len(centers))
        if len(groups) > len(best_groups):
            best_groups = groups
    counts = sorted(group_counts)
    n_groups = counts[(len(counts) * 3) // 4]  # 여백 띠를 빼고 보는 윗사분위
    detail: dict = {"staff_groups": n_groups, "long_lines": int(np.median(line_counts)) if line_counts else 0}
    if n_groups == 0:
        return 0.0, detail
    lines = max(detail["long_lines"], 5 * n_groups)
    cover = (5 * n_groups) / lines

    # 줄을 지운 뒤 오선 묶음 안의 기호(음표 머리·기둥·쉼표·음자리표) 덩어리 수
    clean = cv2.bitwise_and(ink, cv2.bitwise_not(cv2.dilate(hmask, np.ones((5, 1), np.uint8))))
    n_lbl, _lbl, stats, cent = cv2.connectedComponentsWithStats(clean, connectivity=8)
    symbols = 0
    for y_top, y_bot, g in best_groups:
        lo, hi = y_top - 2.5 * g, y_bot + 2.5 * g
        for k in range(1, n_lbl):
            area, bh = stats[k, cv2.CC_STAT_AREA], stats[k, cv2.CC_STAT_HEIGHT]
            bw = stats[k, cv2.CC_STAT_WIDTH]
            if bw <= max(3.0, 0.35 * g) and bh >= 2.5 * g:
                continue  # 가는 세로 막대(마디줄·시작줄)는 음표가 아니다 — 빈 오선지+마디줄 거르기(T153)
            if lo <= cent[k][1] <= hi and area >= 0.3 * g * g and bh <= 9 * g:
                symbols += 1
    per_staff = symbols / max(1, len(best_groups))
    content = min(1.0, per_staff / 4.0)
    group_factor = 1.0 if n_groups >= 2 else 0.8
    score = group_factor * (0.4 + 0.6 * cover) * (0.1 + 0.9 * content)
    detail.update(cover=round(cover, 3), symbols_per_staff=round(per_staff, 1))
    return float(min(1.0, score)), detail


def _staff_score_photo(gray: np.ndarray, ink: np.ndarray) -> tuple[float, dict]:
    """사진 보정 경로: 기울기를 펴고 배경 빼기 이진화로 오선 점수를 다시 잰다."""
    deg = _estimate_skew(ink)
    g = _rotate(gray, deg) if abs(deg) >= SKEW_MIN_DEG else gray
    ink_bg = _binarize_bg(g)
    if (ink_bg > 0).mean() > PHOTO_MAX_INK:
        return 0.0, {"staff_groups": 0, "photo_skipped": "ink_too_dense"}
    score, detail = staff_score(ink_bg)
    detail.update(deskew_deg=round(deg, 2), binarize="background")
    return score, detail


# ── 정간보 ─────────────────────────────────────────────────────────────────────
def _cluster_1d(values: list[float], tol: float) -> list[list[int]]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    clusters: list[list[int]] = []
    for i in order:
        if clusters and values[i] - values[clusters[-1][-1]] <= tol:
            clusters[-1].append(i)
        else:
            clusters.append([i])
    return clusters


def jeongganbo_score(ink: np.ndarray) -> tuple[float, dict]:
    h, w = ink.shape
    vmask = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((max(15, h // 25), 1), np.uint8))
    hmask = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((1, max(10, w // 60)), np.uint8))
    grid = cv2.dilate(cv2.bitwise_or(vmask, hmask), np.ones((3, 3), np.uint8))
    n_lbl, _lbl, stats, _c = cv2.connectedComponentsWithStats(cv2.bitwise_not(grid), connectivity=4)
    boxes = []
    for k in range(1, n_lbl):
        x, y, bw, bh, _area = stats[k]
        if x == 0 or y == 0 or x + bw >= w or y + bh >= h:
            continue  # 바깥 여백
        if bw < w / 80 or bh < h / 120 or bw > w / 2 or bh > h / 3:
            continue
        boxes.append((x, y, bw, bh))
    detail: dict = {"cells": len(boxes)}
    if len(boxes) < 8:
        return 0.0, detail
    arr = np.array(boxes, dtype=np.float64)
    wm, hm = float(np.median(arr[:, 2])), float(np.median(arr[:, 3]))
    regular = arr[(np.abs(arr[:, 2] / wm - 1) <= 0.3) & (np.abs(arr[:, 3] / hm - 1) <= 0.5)]
    reg_frac = len(regular) / len(arr)
    aspect = hm / wm
    if 0.5 <= aspect <= 2.2:
        aspect_factor = 1.0
    elif aspect < 0.5:
        aspect_factor = (aspect / 0.5) ** 2
    else:
        aspect_factor = (2.2 / aspect) ** 2

    # 세로 열(각)로 묶기: x 중심이 가까운 칸끼리
    xc = (regular[:, 0] + regular[:, 2] / 2).tolist()
    cols = [c for c in _cluster_1d(xc, 0.3 * wm) if len(c) >= 3]
    per_col = float(np.median([len(c) for c in cols])) if cols else 0.0
    col_factor = min(1.0, len(cols) / 3)
    stack_factor = float(np.clip((per_col - 3) / 5, 0.0, 1.0))  # 한 열에 8칸 이상이면 만점
    count_factor = min(1.0, len(regular) / 24)

    # 칸 안 글자: 격자를 지운 잉크가 칸 안쪽에 있는 칸 비율
    clean = cv2.bitwise_and(ink, cv2.bitwise_not(grid))
    filled = 0
    for x, y, bw, bh in regular.astype(int):
        mx, my = int(bw * 0.15), int(bh * 0.15)
        roi = clean[y + my : y + bh - my, x + mx : x + bw - mx]
        if roi.size and (roi > 0).mean() > 0.01:
            filled += 1
    filled_frac = filled / len(regular) if len(regular) else 0.0
    content = min(1.0, filled_frac / 0.25)

    score = count_factor * reg_frac * aspect_factor * col_factor * stack_factor * (0.1 + 0.9 * content)
    detail.update(
        regular_cells=len(regular), aspect=round(aspect, 2), columns=len(cols), cells_per_column=per_col,
        filled=round(filled_frac, 2),
    )
    return float(min(1.0, score)), detail


# ── 판정 ───────────────────────────────────────────────────────────────────────
def judge(scores: dict[str, float], chosen_type: str, threshold: float | None) -> StructureVerdict:
    thr = DEFAULT_THRESHOLD if threshold is None else float(threshold)
    other_type = "jeongganbo" if chosen_type == "staff" else "staff"
    chosen = scores.get(chosen_type, 0.0)
    other = scores.get(other_type, 0.0)
    if chosen >= thr:
        verdict = "pass"
    elif chosen >= thr * AMBIGUOUS_FACTOR:
        verdict = "ambiguous"
    else:
        verdict = "fail"
    mismatch = other >= thr and other >= chosen + MISMATCH_MARGIN
    best_type = max(scores, key=lambda k: scores[k]) if scores else None
    detected = best_type if best_type is not None and scores[best_type] >= thr * AMBIGUOUS_FACTOR else None
    return StructureVerdict(verdict=verdict, type_mismatch=mismatch, detected_type=detected, scores=scores)


def check_structure(image_bytes: bytes, chosen_type: str, threshold: float | None) -> StructureVerdict:
    gray = _decode_gray(image_bytes)
    if gray is None:
        return StructureVerdict("fail", False, None, {"staff": 0.0, "jeongganbo": 0.0}, {"error": "decode"})
    ink = _binarize(gray)
    s_staff, d_staff = staff_score(ink)
    if s_staff < 1.0:
        s_photo, d_photo = _staff_score_photo(gray, ink)
        if s_photo > s_staff:
            s_staff, d_staff = s_photo, d_photo
    s_jg, d_jg = jeongganbo_score(ink)
    scores = {"staff": round(s_staff, 4), "jeongganbo": round(s_jg, 4)}
    v = judge(scores, chosen_type, threshold)
    v.details = {"staff": d_staff, "jeongganbo": d_jg}
    return v
