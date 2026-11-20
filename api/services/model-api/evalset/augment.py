"""깨끗한 악보 그림을 일부러 망가뜨려 '어려운 평가셋' 을 만든다 — 기울임 · 원근 · 흐림 · 잡음 · 그림자 · 저해상도 · JPEG.

    uv run python -m evalset.augment --out evalset/results/aug
    EVAL_API_KEY=… uv run python -m evalset.run --base-url … --images evalset/results/aug \
        --manifest evalset/results/aug/manifest.json --out evalset/results/aug-run
    uv run python -m evalset.report evalset/results/aug-run --answers evalset/results/aug/answers.json

구조에서의 위치: 서비스가 아니다. 그림 파일만 읽고 쓴다. model-api · DB · 엔진에 닿지 않는다.

왜 필요한가
    지금 평가셋의 오선보 14장은 v0.1.1 에서 전부 100% 였다. 다 맞는 시험지로는 엔진이 조금 나빠져도 보이지 않는다.
    정답이 있는 깨끗한 악보 6장(S01~S05 · S14)을 **세기를 올려 가며** 망가뜨리면, 정답은 그대로 쓰면서
    "어느 정도 기울어지면 못 읽는가 · 어느 해상도부터 틀리는가" 를 잴 수 있다. report.py 가 변형별 정상 변환 수를 표로 낸다.
    v0.1.1 의 S06~S13(기울임 3도 · 그림자 · 원근 · 흐림 …)은 한 번 손으로 만든 것이라 세기가 한 가지뿐이다.

되풀이된다
    같은 --seed 면 같은 그림이 나온다 (잡음 포함). 만든 그림은 저장소에 올리지 않는다 — 필요할 때 다시 만든다.

한계
    합성한 망가짐이다. 실제 휴대폰 사진의 구겨짐 · 손가락 · 반사 · 초점 흐림을 대신하지 못한다.
    여기서 잘 읽는다고 실제 사진을 잘 읽는다는 뜻은 아니다. 반대로 여기서 못 읽으면 실제 사진에서도 못 읽을 가능성이 높다.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
DEFAULT_SOURCE = HERE / "data"  # data/real 의 깨끗한 악보를 원본으로 쓴다 (#145 에서 proto_type 밖으로 옮김)
DEFAULT_ANSWERS = HERE / "data" / "answers.json"

# 종류 → 세기 1 · 2 · 3 의 값. 1 은 "조금 신경 쓰이는 정도", 3 은 "사람이 봐도 불편한 정도".
LEVELS: dict[str, tuple[float, float, float]] = {
    "rotate": (1.5, 3.0, 6.0),          # 기울임(도)
    "persp": (0.02, 0.04, 0.08),        # 원근 — 위쪽 두 모서리를 안으로 당기는 비율
    "blur": (1.0, 2.0, 3.5),            # 가우시안 흐림 반지름(px)
    "noise": (8.0, 16.0, 30.0),         # 밝기 잡음의 표준편차(0~255)
    "shadow": (0.25, 0.45, 0.65),       # 한쪽 가장자리가 어두워지는 정도(0 = 그대로, 1 = 검정)
    "lowres": (1000, 800, 600),         # 짧은 변 화소 수로 줄인다
    "jpeg": (50, 30, 15),               # JPEG 품질
}
KIND_LABEL = {"rotate": "기울임", "persp": "원근", "blur": "흐림", "noise": "잡음", "shadow": "그림자",
              "lowres": "저해상도", "jpeg": "JPEG 압축"}
PAPER = (255, 255, 255)


def _perspective_coeffs(src: list[tuple[float, float]], dst: list[tuple[float, float]]) -> list[float]:
    """PIL Image.transform(PERSPECTIVE) 가 받는 계수 8개. dst 의 점이 src 의 점에서 오도록 푼다."""
    rows, rhs = [], []
    for (x, y), (u, v) in zip(dst, src):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        rhs += [u, v]
    return np.linalg.solve(np.array(rows, dtype=float), np.array(rhs, dtype=float)).tolist()


def rotate(img: Image.Image, degrees: float, rng: np.random.Generator) -> Image.Image:
    sign = 1 if rng.random() < 0.5 else -1
    return img.rotate(sign * degrees, resample=Image.BICUBIC, expand=True, fillcolor=PAPER)


def perspective(img: Image.Image, amount: float, rng: np.random.Generator) -> Image.Image:
    w, h = img.size
    dx = amount * w
    # 위쪽이 멀어진 것처럼(책상 위 악보를 비스듬히 찍은 모양). 좌우 중 어느 쪽이 더 당겨질지는 씨앗이 정한다
    left, right = (dx, dx * 0.4) if rng.random() < 0.5 else (dx * 0.4, dx)
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    dst = [(left, 0), (w - right, 0), (w, h), (0, h)]
    return img.transform((w, h), Image.PERSPECTIVE, _perspective_coeffs(src, dst), resample=Image.BICUBIC, fillcolor=PAPER)


def blur(img: Image.Image, radius: float, rng: np.random.Generator) -> Image.Image:
    return img.filter(ImageFilter.GaussianBlur(radius))


def noise(img: Image.Image, sd: float, rng: np.random.Generator) -> Image.Image:
    a = np.asarray(img, dtype=np.float32)
    # 화소마다가 아니라 밝기 하나(세 채널 같은 값)로 흔든다 — 종이 사진의 잡음은 색 잡음보다 밝기 잡음이 크다
    a = a + rng.normal(0.0, sd, size=a.shape[:2])[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")


def shadow(img: Image.Image, strength: float, rng: np.random.Generator) -> Image.Image:
    w, h = img.size
    a = np.asarray(img, dtype=np.float32)
    # 한쪽에서 반대쪽으로 서서히 밝아지는 그림자. 방향은 씨앗이 정한다
    angle = rng.uniform(0, 2 * np.pi)
    yy, xx = np.mgrid[0:h, 0:w]
    ramp = (xx / max(w - 1, 1) - 0.5) * np.cos(angle) + (yy / max(h - 1, 1) - 0.5) * np.sin(angle)
    ramp = (ramp - ramp.min()) / max(float(ramp.max() - ramp.min()), 1e-9)          # 0(어두운 쪽) ~ 1(밝은 쪽)
    gain = 1.0 - strength * (1.0 - ramp)
    return Image.fromarray(np.clip(a * gain[..., None], 0, 255).astype(np.uint8), "RGB")


def lowres(img: Image.Image, short_edge: float, rng: np.random.Generator) -> Image.Image:
    w, h = img.size
    scale = short_edge / min(w, h)
    if scale >= 1:
        return img
    return img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.BICUBIC)


def jpeg(img: Image.Image, quality: float, rng: np.random.Generator) -> Image.Image:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=int(quality))
    return Image.open(io.BytesIO(buf.getvalue())).convert("RGB")


TRANSFORMS = {"rotate": rotate, "persp": perspective, "blur": blur, "noise": noise, "shadow": shadow,
              "lowres": lowres, "jpeg": jpeg}


def apply(img: Image.Image, kind: str, level: int, seed: int) -> Image.Image:
    """그림 하나를 한 가지로 망가뜨린다. 같은 (그림, 종류, 세기, 씨앗)이면 같은 결과."""
    if kind not in TRANSFORMS:
        raise ValueError(f"모르는 변형: {kind} (있는 것: {', '.join(TRANSFORMS)})")
    if level not in (1, 2, 3):
        raise ValueError("세기는 1 · 2 · 3 중 하나입니다")
    rng = np.random.default_rng([seed, list(TRANSFORMS).index(kind), level])
    return TRANSFORMS[kind](img.convert("RGB"), LEVELS[kind][level - 1], rng)


def clean_sources(source_dir: Path, answers: dict) -> list[tuple[Path, dict]]:
    """정답이 있고 variant 가 'clean' 인 그림들 (S01~S05 · S14)."""
    out = []
    for name, answer in sorted(answers.items()):
        path = source_dir / "real" / name
        if answer.get("variant") == "clean" and path.is_file():
            out.append((path, answer))
    return out


def generate(source_dir: Path, out_dir: Path, answers: dict, *, kinds: list[str], levels: list[int], seed: int = 0,
             log=print) -> dict:
    """망가뜨린 그림 · manifest.json · answers.json 을 out_dir 에 쓴다. {images, sources} 를 돌려준다."""
    sources = clean_sources(source_dir, answers)
    if not sources:
        raise FileNotFoundError(f"깨끗한 원본을 찾지 못했습니다: {source_dir / 'real'} (answers 의 variant='clean' 인 파일)")
    (out_dir / "real").mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []
    new_answers: dict[str, dict] = {}
    for path, answer in sources:
        img = Image.open(path).convert("RGB")
        stem = path.stem.replace("_clean", "")
        # 원본도 함께 넣는다 — 같은 실행 안에서 '망가뜨리기 전' 과 견줄 기준이 된다
        variants = [("clean", 0, img)] + [(k, lv, apply(img, k, lv, seed)) for k in kinds for lv in levels]
        for kind, level, out_img in variants:
            suffix = ".jpg" if kind == "jpeg" else ".png"
            name = f"{stem}__{kind}{level if level else ''}{suffix}"
            if kind == "jpeg":
                out_img.save(out_dir / "real" / name, format="JPEG", quality=int(LEVELS["jpeg"][level - 1]))
            else:
                out_img.save(out_dir / "real" / name, format="PNG", optimize=False)
            manifest.append({"file": f"real/{name}", "sheet_kind": "staff"})
            new_answers[name] = {"piece": answer.get("piece"), "pitches": answer["pitches"],
                                 "variant": "clean" if kind == "clean" else f"{kind}{level}", "source": path.name}
        log(f"  {path.name} → {len(variants)}장")
    (out_dir / "manifest.json").write_text(json.dumps({
        "$comment": f"augment.py 가 만든 목록 (seed={seed}, kinds={kinds}, levels={levels}). 손으로 고치지 말 것 — 다시 만들면 덮어쓴다.",
        "real": manifest, "fake": []}, ensure_ascii=False, indent=1), encoding="utf-8")
    (out_dir / "answers.json").write_text(json.dumps({"staff": new_answers}, ensure_ascii=False), encoding="utf-8")
    return {"images": len(manifest), "sources": len(sources)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="깨끗한 악보 그림을 망가뜨려 어려운 평가셋을 만든다")
    ap.add_argument("--out", required=True, type=Path, help="만든 그림 · manifest.json · answers.json 을 둘 폴더")
    ap.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="real/ 이 들어 있는 원본 폴더")
    ap.add_argument("--answers", type=Path, default=DEFAULT_ANSWERS)
    ap.add_argument("--kinds", nargs="+", default=list(TRANSFORMS), choices=list(TRANSFORMS))
    ap.add_argument("--levels", nargs="+", type=int, default=[1, 2, 3], choices=[1, 2, 3])
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)

    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    answers = json.loads(args.answers.read_text(encoding="utf-8"))["staff"]
    try:
        made = generate(args.source, args.out, answers, kinds=args.kinds, levels=args.levels, seed=args.seed)
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        return 2
    print(f"원본 {made['sources']}장 → {made['images']}장 ({args.out})")
    print("변형: " + " · ".join(f"{KIND_LABEL[k]}({k})" for k in args.kinds) + f" × 세기 {args.levels}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
