"""#25: 읽기 전용 엔진 볼륨에서 기존 런타임의 probe·모델 warmup을 검사한다.

서버·DB·키 없이 실행하며 설치·다운로드는 하지 않는다. 상세 결과는 stdout JSON이다.
이 스크립트는 #29의 새 엔진 어댑터 구현을 대신하지 않는다.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import platform
import sys
import time
from pathlib import Path


def fingerprint(root: Path, name: str) -> dict:
    folder = root / name
    files = [folder / "VERSION"]
    if name == "homr":
        site = folder / ".venv/lib/python3.11/site-packages"
        for package, minimum in (("homr", 3), ("rapidocr/models", 3)):
            weights = sorted((site / package).rglob("*.onnx"))
            if len(weights) < minimum:
                raise FileNotFoundError(f"{package}: ONNX 가중치 {minimum}개 이상 필요")
            files.extend(weights)
        files.append(folder / "uv.lock")
    else:
        files.extend(folder / "repo/checkpoints/best" / f for f in
                     ("model.pt", "config.yaml", "tokenizer.txt"))
        files.append(folder / "requirements.lock.txt")

    manifest = {}
    for path in files:
        if path.stat().st_size == 0:
            raise ValueError(f"빈 엔진 파일: {path.relative_to(root)}")
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        manifest[str(path.relative_to(root))] = {
            "bytes": path.stat().st_size, "sha256": digest,
        }
    return manifest


async def check_engine(root: Path, name: str, timeout: float) -> dict:
    started = time.monotonic()
    result = {"engine": name, "ok": False}
    adapter = None
    try:
        # 기존 이미지에 있는 어댑터·별도 프로세스 실행기를 그대로 사용한다.
        from app.engines.homr import HomrEngine
        from app.engines.jeongganbo import JeongganboEngine

        cls = HomrEngine if name == "homr" else JeongganboEngine
        adapter = cls(name, root / name, {"device": "cpu"})
        probe = adapter.probe()
        result["probe"] = probe
        if not probe.get("installed") or not probe.get("version"):
            raise FileNotFoundError(f"{name}: 설치 또는 VERSION 확인 실패")
        result["manifest"] = fingerprint(root, name)
        await adapter.warmup(timeout)
        # warmup은 모델·OCR을 실제로 로딩한 작업자의 ready 응답을 기다린다.
        if adapter.worker is None or not adapter.worker.ready_info.get("ready"):
            raise RuntimeError(f"{name}: 모델 작업자의 준비 신호가 없음")
        result["ready"] = adapter.worker.ready_info
        result["ok"] = True
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        if adapter is not None:
            await adapter.close()
    result["duration_ms"] = round((time.monotonic() - started) * 1000)
    return result


async def main(timeout: float) -> int:
    started = time.monotonic()
    report = {
        "ok": False, "machine": platform.machine(), "python": platform.python_version(),
        "uid": os.getuid(), "engines_dir": os.environ.get("ENGINES_DIR"), "engines": [],
    }
    try:
        if report["machine"] != "x86_64":
            raise RuntimeError("기존 엔진은 Linux/amd64 전용이다")
        if report["uid"] == 0:
            raise RuntimeError("root 대신 uid 1000 사용자로 검사해야 한다")
        root = Path(os.environ["ENGINES_DIR"])
        if not root.is_absolute() or not root.is_dir():
            raise FileNotFoundError("ENGINES_DIR은 마운트된 절대 디렉터리여야 한다")
        report["read_only"] = bool(os.statvfs(root).f_flag & os.ST_RDONLY)
        if not report["read_only"]:
            raise RuntimeError("엔진 볼륨을 읽기 전용으로 마운트해야 한다")
        # 메모리 사용이 겹치지 않게 엔진을 하나씩 로딩·종료한다.
        for name in ("homr", "jeongganbo"):
            result = await check_engine(root, name, timeout)
            report["engines"].append(result)
            print(json.dumps({"engine": name, "ok": result["ok"],
                              "duration_ms": result["duration_ms"]}), flush=True)
        report["ok"] = all(result["ok"] for result in report["engines"])
    except Exception as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
    report["duration_ms"] = round((time.monotonic() - started) * 1000)
    print(json.dumps(report, ensure_ascii=False, sort_keys=True), flush=True)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=float, default=120, help="엔진별 로딩 제한(초)")
    args = parser.parse_args()
    if not 0 < args.timeout <= 600:
        parser.error("--timeout은 0 초과, 600 이하로 지정한다")
    sys.exit(asyncio.run(main(args.timeout)))
