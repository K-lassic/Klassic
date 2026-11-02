"""독립 설치 진단: python -m app.engines.selftest [--image /tmp/score.png]."""
import argparse
import asyncio
import json
import time

from app.config import load_config
from app.engines.registry import build_adapter
from app.services.safe_midi import close_safe_midi


async def main():
    parser = argparse.ArgumentParser(description="오선보 엔진 설치·인식 확인")
    parser.add_argument("--image")
    parser.add_argument("--timeout", type=float, default=180)
    args = parser.parse_args()
    cfg = load_config()
    engine = build_adapter({"model_name": "homr", "provider": "venv", "config_json": '{"adapter":"homr"}'},
                           engines_dir=cfg.engines_dir)
    probe = engine.probe()
    report = {"name": "homr", **probe}
    try:
        if args.image and probe["installed"]:
            result = await engine.recognize(args.image, time.monotonic() + args.timeout)
            report.update(outcome=result.outcome, failure_code=result.failure_code,
                          musicxml=bool(result.musicxml), midi=bool(result.midi), duration_ms=result.duration_ms)
        print(json.dumps(report, ensure_ascii=False))
        return 0 if probe["installed"] and report.get("outcome", "success") == "success" else 1
    finally:
        await engine.close()
        await close_safe_midi()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
