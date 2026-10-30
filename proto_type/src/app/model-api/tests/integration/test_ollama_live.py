"""공유 Ollama 서버 실호출 한 번 (OLLAMA 설정 참조 §8.1 6단계 '실제 호출 1회로 확인').

pytest -m ollama 로만 돈다. 되풀이하지 않는다(생성 호출 한 번 + 읽기 몇 번). keep_alive 는 5m.
"""

from __future__ import annotations

import pytest

from app.config import load_config
from app.models.ollama import OllamaClient
from app.recommend import llm
from app.recommend.features import Features
from app.services.catalog import label_of

pytestmark = pytest.mark.ollama


async def test_live_gemma3_recommend_once():
    cfg = load_config()
    client = OllamaClient(cfg.ollama_url)
    version = await client.version()
    assert version
    tags = {m["tag"] for m in await client.available_models()}
    assert "gemma3:4b" in tags
    features = Features(bpm=62.0, tempo="slow", mode="gyemyeonjo", range_low=57, range_high=74,
                        range="A3–D5 (17반음)", density=1.4, note_count=40)
    combos = await llm.recommend(client, "gemma3:4b", features, num_ctx=4096)
    print("live combos:", combos)
    assert 1 <= len(combos) <= 3
    for c in combos:
        # 이름은 LLM 문구가 아니라 악기 이름으로 만든다(T151). 검사를 못 넘으면 recommend 가 LLMAnswerError
        assert c["instruments"] and c["label"] == label_of(c["instruments"])
    loaded = {m.get("name") for m in await client.ps()}
    assert "gemma3:4b" in loaded  # 방금 불렀으므로 올라와 있다(keep_alive 5m 뒤 서버가 내린다)
