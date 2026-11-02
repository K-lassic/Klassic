"""#19의 세 오류 파일을 앱별로 읽는다. 중복 코드·설명 키를 처리한다."""
import json
from pathlib import Path


def load_errors(shared_dir: Path) -> dict:
    catalog = {"api_version": "v1", "gate_codes": {}, "fallback_reasons": {}, "status_codes": {}}
    seen = set()
    for name in ("common", "web", "model"):
        data = json.loads((shared_dir / "errors" / f"{name}.json").read_text(encoding="utf-8"))
        if data.get("api_version", "v1") != "v1":
            raise ValueError("지원하지 않는 오류 API 판본")
        for group in ("gate_codes", "fallback_reasons", "status_codes"):
            for code, entry in data.get(group, {}).items():
                if code.startswith("$"):
                    continue
                key = (group, code)
                if key in seen:
                    raise ValueError(f"중복 오류 코드: {code}")
                seen.add(key)
                catalog[group][code] = entry
    return catalog
