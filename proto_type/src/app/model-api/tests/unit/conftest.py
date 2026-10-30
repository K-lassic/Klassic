"""단위 시험 공통: tests/unit(합성 이미지 모듈)과 app/model-api(app 꾸러미)를 import 경로에 넣는다."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # app/model-api (import app...)
FIXTURES = Path(__file__).resolve().parents[3] / "shared" / "fixtures" / "upload"
