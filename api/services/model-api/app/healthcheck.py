"""공개 계약을 유지하며 Docker는 DB·생존 모델·음원 준비를 모두 확인한다."""
import json
import sys
import urllib.request


def main():
    with urllib.request.urlopen("http://127.0.0.1:9543/v1/health", timeout=5) as response:
        body = json.load(response)
    # 공개 health의 의미를 바꾸지 않고 실제 음원 로딩 완료 표시를 함께 확인한다.
    from pathlib import Path
    marker = Path("/tmp/model-api-ready")
    return 0 if body["status"] == "ok" and body["db"] == "ok" and marker.is_file() else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(1)
