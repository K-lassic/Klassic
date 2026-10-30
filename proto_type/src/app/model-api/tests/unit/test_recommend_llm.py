"""LLM 추천 답 검사 (T151). Ollama 는 흉내 낸 클라이언트로 대신한다(실호출 없음)."""

from __future__ import annotations

import json

import httpx
import pytest

from app.models.ollama import OllamaClient
from app.recommend import llm
from app.recommend.features import Features

FEATURES = Features(bpm=62.0, tempo="slow", mode="gyemyeonjo", range_low=57, range_high=74,
                    range="A3–D5 (17반음)", density=1.4, note_count=40)

# 2026-09-29 실호출(gemma3:4b, 고치기 전 프롬프트)에서 받은 답 — 코드는 맞고 label 만 분위기 문구였다
LIVE_Q7_LIKE = {"combinations": [
    {"label": "고요한 계면조", "instruments": ["gayageum", "haegeum", "janggu"], "reason": "고요함을 더합니다."},
    {"label": "몽환적인 거문고 선율", "instruments": ["geomungo", "strings", "flute"], "reason": "몽환적입니다."},
    {"label": "어울림의 대금과 해금", "instruments": ["daegeum", "haegeum", "acoustic_guitar"], "reason": "풍성합니다."},
]}


def _client(reply) -> tuple[OllamaClient, list[dict]]:
    sent: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        sent.append(body)
        content = reply if isinstance(reply, str) else json.dumps(reply, ensure_ascii=False)
        return httpx.Response(200, json={"message": {"role": "assistant", "content": content}, "done": True})

    return OllamaClient("http://ollama.test", transport=httpx.MockTransport(handler), retry_delays=()), sent


# ---------------------------------------------------------------- 좋은 답
def test_label_comes_from_instruments_not_llm_phrase():
    combos = llm.validate_answer(LIVE_Q7_LIKE)
    assert [c["label"] for c in combos] == ["가야금 · 해금 · 장구", "거문고 · 현악 합주 · 플루트",
                                            "대금 · 해금 · 어쿠스틱 기타"]
    assert combos[0]["instruments"] == ["gayageum", "haegeum", "janggu"]
    assert combos[0]["reason"] == "고요함을 더합니다."


def test_duplicates_merged_and_capped_at_three():
    combos = llm.validate_answer({"combinations": [
        {"instruments": ["gayageum", "janggu", "gayageum"]},
        {"instruments": ["janggu", "gayageum"]},  # 같은 조합(순서만 다름)
        {"instruments": ["piri", "janggu"]},
        {"instruments": ["daegeum", "buk"]},
        {"instruments": ["haegeum", "janggu"]},
    ]})
    assert [c["instruments"] for c in combos] == [["gayageum", "janggu"], ["piri", "janggu"], ["daegeum", "buk"]]
    assert all("reason" not in c for c in combos)


def test_reason_trimmed():
    combos = llm.validate_answer({"combinations": [{"instruments": ["gayageum", "janggu"], "reason": " 가" * 300}]})
    assert len(combos[0]["reason"]) == llm.MAX_REASON_CHARS and not combos[0]["reason"].startswith(" ")


# 2026-09-29 황송해 결정: 국악기 없음·선율 악기 없음·타악 2개도 받아 쓴다(예전엔 답 전체를 버렸다)
@pytest.mark.parametrize("codes", [
    ["piano", "violin"],  # 국악기 없음(일반 악기만)
    ["janggu", "buk"],  # 선율 악기 없음(타악만)
    ["gayageum", "janggu", "buk"],  # 타악 2개
])
def test_formerly_rejected_combinations_accepted(codes):
    combos = llm.validate_answer({"combinations": [{"instruments": codes, "reason": "좋습니다"}]})
    assert combos == [{"label": llm.label_of(codes), "instruments": codes, "reason": "좋습니다"}]


def test_prompt_no_longer_demands_gugak_or_melody():
    text = llm.build_prompt(FEATURES)
    assert "국악기를 1개 이상" not in text and "선율 악기를 1개 이상" not in text and "1개까지" not in text
    assert "2~4개" in text


# ---------------------------------------------------------------- 쓸 수 없는 답(부분만 틀려도 통째로 버림)
@pytest.mark.parametrize(("data", "detail"), [
    (["gayageum"], "객체가 아님"),
    ({}, "combinations"),
    ({"combinations": "가야금 · 장구"}, "combinations"),
    ({"combinations": []}, "비어 있음"),
    # 분위기 문구만 있고 악기 목록이 없는 답(Q7 에서 본 이름들)
    ({"combinations": [{"label": "활달한 가야금 연주"}, {"label": "해금과 현악의 조화"},
                       {"label": "다채로운 타악과 피리"}]}, "instruments 목록이 없음"),
    ({"combinations": [{"instruments": ["활달한 가야금 연주"]}]}, "목록에 없는 악기"),
    ({"combinations": [{"instruments": ["가야금", "장구"]}]}, "목록에 없는 악기"),
    ({"combinations": [{"instruments": ["gayageum", "janggu"]}, {"instruments": ["gayageum", "kazoo"]}]}, "kazoo"),
    ({"combinations": [{"instruments": ["gayageum", 3]}]}, "목록에 없는 악기"),
    ({"combinations": [{"instruments": ["gayageum"]}]}, "악기 수 1개"),
    ({"combinations": [{"instruments": ["gayageum", "haegeum", "daegeum", "piri", "janggu"]}]}, "악기 수 5개"),
    ({"combinations": ["gayageum janggu"]}, "객체가 아님"),
])
def test_invalid_answers_rejected(data, detail):
    with pytest.raises(llm.LLMAnswerError, match=detail):
        llm.validate_answer(data)


# ---------------------------------------------------------------- 흉내 낸 Ollama 로 recommend 전체
async def test_recommend_good_answer_sends_schema():
    client, sent = _client(LIVE_Q7_LIKE)
    combos = await llm.recommend(client, "gemma3:4b", FEATURES, num_ctx=4096)
    assert combos[0]["label"] == "가야금 · 해금 · 장구"
    body = sent[0]
    assert body["keep_alive"] == "5m" and body["think"] is False and body["stream"] is False
    assert body["options"]["num_ctx"] == 4096
    schema = body["format"]
    assert schema["required"] == ["combinations"]
    inst = schema["properties"]["combinations"]["items"]["properties"]["instruments"]
    assert inst["minItems"] == 2 and inst["maxItems"] == 4 and "janggu" in inst["items"]["enum"]
    assert "label" not in schema["properties"]["combinations"]["items"]["properties"]
    assert "조합 이름은 쓰지 않습니다" in body["messages"][1]["content"]


@pytest.mark.parametrize("reply", [
    "{\"combinations\": [",  # 깨진 JSON
    "활달한 가야금 연주",  # JSON 이 아닌 글
    {"combinations": [{"label": "다채로운 타악과 피리", "instruments": ["타악", "piri"]}]},
])
async def test_recommend_bad_answer_raises(reply):
    client, _ = _client(reply)
    with pytest.raises(llm.LLMAnswerError):
        await llm.recommend(client, "gemma3:4b", FEATURES)


async def test_recommend_unreachable_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    client = OllamaClient("http://ollama.test", transport=httpx.MockTransport(handler), retry_delays=())
    with pytest.raises(llm.LLMAnswerError, match="Ollama 답 오류"):
        await llm.recommend(client, "gemma3:4b", FEATURES)
