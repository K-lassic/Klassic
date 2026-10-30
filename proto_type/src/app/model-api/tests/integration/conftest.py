"""통합 시험 공통.

- `ollama` 표시 시험은 공유 Ollama 서버를 실제로 부른다. `pytest -m ollama` 로 고를 때만 돈다(평소에는 건너뜀).
- DB·앱 준비는 계약 시험의 준비물을 그대로 쓴다.
"""

from __future__ import annotations

import pytest
from contract.conftest import (  # noqa: F401 — 준비물(fixture) 다시 쓰기
    app_client,
    assets_dir,
    base_cfg,
    db,
    engines,
    ext_key,
    ollama,
    test_db,
)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "ollama: 공유 Ollama 서버를 실제로 부르는 시험(pytest -m ollama 로만 실행)")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if "ollama" in (config.getoption("-m") or ""):
        return
    skip = pytest.mark.skip(reason="공유 Ollama 실호출 — pytest -m ollama 로 실행")
    for item in items:
        if "ollama" in item.keywords:
            item.add_marker(skip)
