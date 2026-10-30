"""jeongganbo-omr 가상환경(Python 3.8) 안에서 도는 실행기. 모델 API 서버가 하위 프로세스로 부른다.

    <venv>/bin/python -B jeongganbo_runner.py --repo <repo> [--device cpu|mps] [--warmup] <image>
    <venv>/bin/python -B jeongganbo_runner.py --repo <repo> [--device cpu|mps] --serve
      상주 작업자(2026-09-30, research R2 · SD_04 §8-1): 모델을 한 번 올리고 `@@RESULT@@ {"ready": true}` 를 찍은 뒤,
      표준 입력의 요청 한 줄 {"image": "<경로>"} 마다 결과 한 줄을 찍는다.

마지막 줄에 `@@RESULT@@ {json}` 을 찍는다:
  {"ok": true, "encoding": "<각 줄 · 정간 | · 기호:자리>", "confidence": 0.93, "jeonggans": 240, "scale": 1.0}
  {"ok": false, "error": "..."}
저자 저장소의 JeongganboReader 는 국립국악원 판형(쪽 높이 약 3091px, 칸 폭 85~110px)에 맞춰져 있어
여러 배율로 칸을 찾아 보고 칸이 가장 많이 잡힌 배율로 인식한다. (Python 3.8 문법만 쓴다)
"""
import argparse
import json
import os
import re
import sys
import traceback

PAGE_HEIGHT = 3091
SCALES = (1.0, 0.9, 1.1, 0.8, 1.25, 0.7, 1.4)
# 율명 한 개(옥타브 앞말 · 두 글자 정식 이름 허용). 꾸밈(_…)·자리(:n)는 떼고 본다.
YUL_RE = re.compile(r"^(?:하하배|하배|중청|배|청)?[황대태협고중유임림이남무응](?:종|려|주|선|빈|칙|역)?$")


def has_yulmyeong(texts):
    """정간 인코딩 여러 개에 율명이 하나라도 있나"""
    for text in texts:
        for item in (text or "").split():
            if YUL_RE.match(item.split(":", 1)[0].split("_", 1)[0]):
                return True
    return False


def is_jangdan_gak(author_flag, texts):
    """장단 칸인가 (2026-09-30 SD_01 1.9). 저자 코드는 굵은 테두리 위치로만 장단 칸을 고르는데, 거문고 책처럼
    각마다 구음 칸이 굵은 줄로 나뉜 판형에서는 율명 칸 하나하나가 그 모양이 되어 선율 각이 빠졌다.
    진짜 장단 칸에는 율명이 없으므로, 저자 표시가 있어도 율명이 있으면 선율 각으로 본다."""
    return bool(author_flag) and not has_yulmyeong(texts)


def emit(obj):
    sys.stdout.write("\n@@RESULT@@ " + json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def build_reader(repo, device):
    sys.path.insert(0, repo)
    os.chdir(repo)
    from jngbomr import JeongganboReader

    kwargs = {
        "vocab_txt_fn": "checkpoints/best/tokenizer.txt",
        "model_config_path": "checkpoints/best/config.yaml",
        "model_weights": "checkpoints/best/model.pt",
        "device": "cpu",
    }
    reader = JeongganboReader(run_omr=True, inferencer_kwargs=kwargs)
    if device == "mps":
        import torch

        if torch.backends.mps.is_available():
            reader.omr.device = torch.device("mps")
            reader.omr.model.to(reader.omr.device)
    return reader


def pages_of(result):
    if isinstance(result, tuple):
        return [p for p in result if hasattr(p, "jeonggan_list")]
    return [result]


def detect(reader, img):
    import cv2

    best = (0, None, 1.0)
    h, w = img.shape[:2]
    reader.run_omr = False
    for s in SCALES:
        th = int(PAGE_HEIGHT * s)
        resized = cv2.resize(img, (max(1, int(w * th / h)), th), interpolation=cv2.INTER_AREA if th < h else cv2.INTER_CUBIC)
        try:
            pages = pages_of(reader(resized))
        # 이 배율에서 칸 찾기 실패(저자 코드 assert)하면 다음 배율
        except Exception:  # noqa: BLE001, S112
            continue
        n = sum(len(p.jeonggan_list) for p in pages)
        if n > best[0]:
            best = (n, pages, s)
    reader.run_omr = True
    return best


def run_omr(reader, pages):
    try:
        for p in pages:
            if p.jeonggan_list:
                reader.run_omr_on_page(p)
    except RuntimeError:
        # MPS 에서 안 되는 연산이면 CPU 로 다시
        import torch

        reader.omr.device = torch.device("cpu")
        reader.omr.model.to(reader.omr.device)
        for p in pages:
            if p.jeonggan_list:
                reader.run_omr_on_page(p)


def recognize_one(reader, image):
    """그림 한 장 → 결과 JSON(한 번짜리 실행·상주 작업자 공통)."""
    import cv2

    img = cv2.imread(image)
    if img is None:
        return {"ok": False, "error": "image unreadable"}
    n, pages, scale = detect(reader, img)
    if not pages or n == 0:
        return {"ok": True, "encoding": "", "confidence": None, "jeonggans": 0, "scale": None}
    run_omr(reader, pages)
    from jngbomr import Piece

    piece = Piece(pages)
    lines = []
    confs = []
    for gak in piece.gaks:
        texts = [jg.omr_text or "" for jg in gak.jeonggans]
        if is_jangdan_gak(gak.is_jangdan, texts):
            continue
        for jg in gak.jeonggans:
            c = getattr(jg, "omr_confidence", None)
            if c is not None:
                confs.append(float(c))
        lines.append("|".join(texts))
    return {
        "ok": True,
        "encoding": "\n".join(lines),
        "confidence": (sum(confs) / len(confs)) if confs else None,
        "jeonggans": n,
        "scale": scale,
        "device": str(reader.omr.device),
    }


def serve(reader):
    """상주 작업자: 요청 한 줄마다 결과 한 줄. 한 요청이 실패해도 작업자는 계속 돈다."""
    emit({"ready": True, "device": str(reader.omr.device)})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            emit(recognize_one(reader, os.path.abspath(req["image"])))
        # 저자 코드의 assert 등 무엇이든 결과 JSON 으로 알린다
        except Exception as e:  # noqa: BLE001
            emit({"ok": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-800:]})
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image", nargs="?")
    ap.add_argument("--repo", required=True)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--warmup", action="store_true")
    ap.add_argument("--serve", action="store_true")
    a = ap.parse_args()
    try:
        image = os.path.abspath(a.image) if a.image else None
        reader = build_reader(os.path.abspath(a.repo), a.device)
        if a.serve:
            return serve(reader)
        if a.warmup:
            emit({"ok": True, "warmup": True, "device": str(reader.omr.device)})
            return 0
        res = recognize_one(reader, image)
        emit(res)
        return 3 if res.get("error") == "image unreadable" else 0
    # 저자 코드의 assert 등 무엇이든 결과 JSON 으로 알린다
    except Exception as e:  # noqa: BLE001
        emit({"ok": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-800:]})
        return 2


if __name__ == "__main__":
    sys.exit(main())
