"""시험용 합성 이미지 (구조 확인 단위 시험 · 업로드 시험 파일 만들기에 같이 쓴다).

모두 BGR uint8 numpy 배열을 돌려준다. 난수는 seed 로 고정해 결과가 늘 같다.
"""

from __future__ import annotations

import os

import cv2
import numpy as np

WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
KOREAN_FONT_CANDIDATES = [
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
]
YUL = ["황", "태", "중", "임", "남", "청황", "청태", "-"]


def blank(w: int = 1600, h: int = 1200) -> np.ndarray:
    return np.full((h, w, 3), 255, np.uint8)


def staff_image(w: int = 1600, h: int = 1200, n_staves: int = 5, gap: int = 16, notes: bool = True,
                seed: int = 1) -> np.ndarray:
    """오선 n개(+ 음표 머리·기둥·세로줄). notes=False 면 빈 오선지."""
    rng = np.random.default_rng(seed)
    img = blank(w, h)
    x0, x1 = int(w * 0.06), int(w * 0.94)
    top = int(h * 0.1)
    step = (h - 2 * top) // max(1, n_staves)
    for s in range(n_staves):
        y0 = top + s * step
        for i in range(5):
            cv2.line(img, (x0, y0 + i * gap), (x1, y0 + i * gap), BLACK, 2)
        if not notes:
            continue
        # 세로줄(마디줄)
        for bx in np.linspace(x0, x1, 5).astype(int):
            cv2.line(img, (int(bx), y0), (int(bx), y0 + 4 * gap), BLACK, 2)
        # 음표: 줄·칸 위 머리 + 기둥
        for nx in np.arange(x0 + 40, x1 - 20, 55):
            pos = int(rng.integers(-2, 11))  # 반 칸 단위
            cy = y0 + 4 * gap - pos * gap // 2
            cv2.ellipse(img, (int(nx), cy), (gap * 6 // 10, gap * 4 // 10), -20, 0, 360, BLACK, -1)
            cv2.line(img, (int(nx) + gap // 2, cy), (int(nx) + gap // 2, cy - int(3.5 * gap)), BLACK, 2)
    return img


def _put_korean(img: np.ndarray, items: list[tuple[str, int, int, int]]) -> np.ndarray:
    """(글자, x, y, 크기) 목록을 한글 글꼴로 그린다. 글꼴이 없으면 네모 덩어리로 대신한다."""
    font_path = next((p for p in KOREAN_FONT_CANDIDATES if os.path.exists(p)), None)
    if font_path is None:
        for text, x, y, size in items:
            cv2.rectangle(img, (x, y), (x + size * max(1, len(text)) // 2, y + size // 2), BLACK, -1)
        return img
    from PIL import Image, ImageDraw, ImageFont

    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil)
    fonts: dict[int, ImageFont.FreeTypeFont] = {}
    for text, x, y, size in items:
        if size not in fonts:
            fonts[size] = ImageFont.truetype(font_path, size)
        draw.text((x, y), text, fill=(0, 0, 0), font=fonts[size])
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def jeongganbo_image(w: int = 1400, h: int = 2000, n_cols: int = 8, n_rows: int = 12, cell_w: int = 100,
                     cell_h: int = 120, daegang: int = 3, text: bool = True, seed: int = 2) -> np.ndarray:
    """정간보 한 쪽: 오른쪽에서 왼쪽으로 세로 각(열), 각 안에 정간 칸, 대강마다 굵은 가로줄, 칸 안 율명."""
    rng = np.random.default_rng(seed)
    img = blank(w, h)
    total_w = n_cols * cell_w
    right = w - (w - total_w) // 2
    top = (h - n_rows * cell_h) // 2
    items: list[tuple[str, int, int, int]] = []
    for c in range(n_cols):
        xr = right - c * cell_w
        xl = xr - cell_w
        cv2.line(img, (xl, top), (xl, top + n_rows * cell_h), BLACK, 2)
        cv2.line(img, (xr, top), (xr, top + n_rows * cell_h), BLACK, 2)
        for r in range(n_rows + 1):
            y = top + r * cell_h
            thick = 5 if r % daegang == 0 else 2
            cv2.line(img, (xl, y), (xr, y), BLACK, thick)
            if text and r < n_rows:
                name = YUL[int(rng.integers(0, len(YUL)))]
                size = int(cell_h * 0.38) if len(name) == 1 else int(cell_h * 0.28)
                items.append((name, xl + cell_w // 2 - size * len(name) // 2, y + cell_h // 2 - size // 2 - 4, size))
    return _put_korean(img, items) if text else img


def notebook_image(w: int = 1600, h: int = 1200, spacing: int = 36, scribble: bool = True, seed: int = 3) -> np.ndarray:
    """줄 공책: 고른 간격 가로줄 + 왼쪽 여백 세로줄 + 손글씨 같은 선."""
    rng = np.random.default_rng(seed)
    img = blank(w, h)
    for y in range(spacing * 2, h - spacing, spacing):
        cv2.line(img, (0, y), (w, y), (200, 150, 120), 2)
    cv2.line(img, (int(w * 0.1), 0), (int(w * 0.1), h), (80, 80, 220), 2)
    if scribble:
        for y in range(spacing * 2, h - spacing * 2, spacing):
            x = int(w * 0.12)
            pts = []
            while x < w * 0.85:
                pts.append((x, y - int(rng.integers(4, spacing - 8))))
                x += int(rng.integers(8, 20))
            cv2.polylines(img, [np.array(pts, np.int32)], False, BLACK, 2)
    return img


def table_image(w: int = 1600, h: int = 1200, n_cols: int = 6, n_rows: int = 24, seed: int = 4) -> np.ndarray:
    """표: 넓은 칸 격자 + 칸 안 글자 덩어리."""
    rng = np.random.default_rng(seed)
    img = blank(w, h)
    x0, x1, y0, y1 = 60, w - 60, 60, h - 60
    for c in range(n_cols + 1):
        x = x0 + (x1 - x0) * c // n_cols
        cv2.line(img, (x, y0), (x, y1), BLACK, 2)
    for r in range(n_rows + 1):
        y = y0 + (y1 - y0) * r // n_rows
        cv2.line(img, (x0, y), (x1, y), BLACK, 2)
    cw, ch = (x1 - x0) // n_cols, (y1 - y0) // n_rows
    for c in range(n_cols):
        for r in range(n_rows):
            if rng.random() < 0.7:
                cv2.putText(img, f"{int(rng.integers(10, 99999))}", (x0 + c * cw + 10, y0 + r * ch + ch - 12),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, BLACK, 2)
    return img


def square_grid_image(w: int = 1600, h: int = 1200, cell: int = 60) -> np.ndarray:
    """빈 모눈(원고지·모눈종이): 네모 칸만 있고 내용이 없다."""
    img = blank(w, h)
    for x in range(40, w - 40, cell):
        cv2.line(img, (x, 40), (x, h - 40), (120, 120, 120), 1)
    for y in range(40, h - 40, cell):
        cv2.line(img, (40, y), (w - 40, y), (120, 120, 120), 1)
    return img


def blinds_image(w: int = 1600, h: int = 1200, period: int = 40) -> np.ndarray:
    """블라인드: 고른 간격의 굵은 가로 띠와 그림자."""
    img = blank(w, h)
    for y in range(0, h, period):
        cv2.rectangle(img, (0, y), (w, y + period // 3), (90, 90, 90), -1)
        cv2.line(img, (0, y + period // 3 + 2), (w, y + period // 3 + 2), (30, 30, 30), 2)
    return img


def landscape_image(w: int = 1600, h: int = 1200, seed: int = 5) -> np.ndarray:
    """풍경 사진 비슷한 무작위 이미지: 부드러운 잡음 + 하늘·땅 그러데이션 + 나뭇가지 같은 선."""
    rng = np.random.default_rng(seed)
    small = rng.integers(0, 255, (h // 40, w // 40, 3), dtype=np.uint8)
    img = cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
    grad = np.linspace(0, 80, h, dtype=np.float32)[:, None, None]
    img = np.clip(img.astype(np.float32) * 0.6 + grad, 0, 255).astype(np.uint8)
    for _ in range(40):
        p1 = (int(rng.integers(0, w)), int(rng.integers(0, h)))
        p2 = (p1[0] + int(rng.integers(-200, 200)), p1[1] + int(rng.integers(-200, 200)))
        cv2.line(img, p1, p2, (20, 40, 20), int(rng.integers(1, 5)))
    noise = rng.normal(0, 12, img.shape)
    return np.clip(img.astype(np.float32) + noise, 0, 255).astype(np.uint8)


def to_png(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()
