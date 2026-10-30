"""Ollama LLM 추천 (등록부 provider 'ollama', adapter 'ollama_recommend').

뽑은 특징과 쓸 수 있는 악기 코드(국악기 먼저)를 한국어 프롬프트로 주고
{"combinations":[{"instruments":[코드],"reason"}]} JSON 을 받는다(format 에 JSON 스키마를 넣어 모양을 묶는다).

T151 — 답 검사(validate_answer)
- 조합 이름(label)은 LLM 에게 받지 않고 악기 코드로 만든다(label_of: "가야금 · 장구", 계약 예시와 같은 꼴).
  LLM 이 지은 이름은 '활달한 가야금 연주' 같은 분위기 문구가 되어 조합 이름으로 쓸 수 없었다.
- 조합마다: 악기 목록에 있는 코드만, 중복 뺀 뒤 2~4개.
  (2026-09-29 황송해 결정: '국악기 1개 이상'·'선율 악기 1개 이상'·'타악 1개까지' 규칙은 뺐다 —
   일반 악기만의 조합(piano·violin)도, 타악만의 조합(janggu·buk)도 그대로 쓴다.)
- 조합이 하나라도 이 규칙을 어기거나 JSON 이 깨지면 답 전체를 버린다(LLMAnswerError) → 다음 모델(규칙표)로 넘어간다.
- 같은 악기 조합이 되풀이되면 한 번만 쓰고, 최대 3개(MAX_COMBINATIONS)까지만 쓴다.
"""

from __future__ import annotations

import logging
from typing import Any

from app.models.ollama import OllamaClient, OllamaError
from app.recommend.features import MODE_LABEL, TEMPO_LABEL, Features
from app.recommend.rules import MAX_COMBINATIONS
from app.services.catalog import gugak_first_codes, instruments, label_of

log = logging.getLogger("model-api.recommend.llm")

MIN_INSTRUMENTS = 2
MAX_INSTRUMENTS = 4
MAX_REASON_CHARS = 200

SYSTEM_PROMPT = (
    "당신은 한국 전통 음악(국악) 편성 전문가입니다. 주어진 악보 특징에 어울리는 악기 조합을 추천합니다. "
    "반드시 JSON 객체 하나로만 답합니다."
)


class LLMAnswerError(ValueError):
    """LLM 답을 추천으로 쓸 수 없다(모양·악기 코드 문제). 메시지는 기록(tried.detail)에 남긴다."""


def response_schema() -> dict[str, Any]:
    """Ollama format 에 넣는 JSON 스키마. 악기 코드는 목록(enum)으로 묶는다."""
    return {
        "type": "object",
        "properties": {
            "combinations": {
                "type": "array",
                "minItems": 1,
                "maxItems": MAX_COMBINATIONS,
                "items": {
                    "type": "object",
                    "properties": {
                        "instruments": {
                            "type": "array",
                            "minItems": MIN_INSTRUMENTS,
                            "maxItems": MAX_INSTRUMENTS,
                            "items": {"type": "string", "enum": gugak_first_codes()},
                        },
                        "reason": {"type": "string"},
                    },
                    "required": ["instruments", "reason"],
                },
            },
        },
        "required": ["combinations"],
    }


def build_prompt(features: Features) -> str:
    cat = instruments()
    lines = []
    for code in gugak_first_codes():
        inst = cat[code]
        kind = "국악기" if inst.family == "gugak" else "기타 악기"
        role = "타악" if inst.is_percussion else "선율"
        lines.append(f"- {code}: {inst.name_ko} ({kind}, {role})")
    bpm = f"{features.bpm:g} BPM" if features.bpm else "표시 없음"
    return (
        f"다음 악보에 어울리는 악기 조합을 최대 {MAX_COMBINATIONS}개 추천해 주세요.\n\n"
        "[악보 특징]\n"
        f"- 빠르기: {TEMPO_LABEL[features.tempo]} ({bpm})\n"
        f"- 선법: {MODE_LABEL[features.mode]}\n"
        f"- 음역: {features.range}\n"
        f"- 음표 밀도: 초당 {features.density:g}개\n\n"
        "[쓸 수 있는 악기 코드] (국악기를 먼저 고려하세요)\n" + "\n".join(lines) + "\n\n"
        "[규칙]\n"
        "- instruments 에는 위 목록의 영문 코드만 씁니다. 한글 이름이나 설명 문구를 넣지 않습니다.\n"
        f"- 조합마다 악기는 {MIN_INSTRUMENTS}~{MAX_INSTRUMENTS}개입니다. 같은 악기를 두 번 넣지 않습니다.\n"
        "- 조합 이름은 쓰지 않습니다.\n"
        "- reason 은 한국어 한 문장(쉬운 말, \"~합니다\" 로 끝나는 합쇼체)입니다.\n\n"
        '[답 형식]\n{"combinations":[{"instruments":["gayageum","janggu"],"reason":"이유"}]}'
    )


def _check_combination(no: int, item: Any) -> dict:
    if not isinstance(item, dict):
        raise LLMAnswerError(f"{no}번째 조합이 객체가 아님")
    raw = item.get("instruments")
    if not isinstance(raw, list) or not raw:
        raise LLMAnswerError(f"{no}번째 조합에 instruments 목록이 없음")
    cat = instruments()
    codes: list[str] = []
    for code in raw:
        if not isinstance(code, str) or code not in cat:
            raise LLMAnswerError(f"{no}번째 조합에 목록에 없는 악기 {str(code)[:40]!r}")
        if code not in codes:
            codes.append(code)
    if not MIN_INSTRUMENTS <= len(codes) <= MAX_INSTRUMENTS:
        raise LLMAnswerError(f"{no}번째 조합의 악기 수 {len(codes)}개(허용 {MIN_INSTRUMENTS}~{MAX_INSTRUMENTS})")
    out: dict[str, Any] = {"label": label_of(codes), "instruments": codes}
    reason = item.get("reason")
    if isinstance(reason, str) and reason.strip():
        out["reason"] = reason.strip()[:MAX_REASON_CHARS]
    return out


def validate_answer(data: Any) -> list[dict]:
    """LLM 답 전체를 검사한다. 하나라도 어긋나면 LLMAnswerError(부분만 쓰지 않는다)."""
    if not isinstance(data, dict):
        raise LLMAnswerError("JSON 객체가 아님")
    items = data.get("combinations")
    if not isinstance(items, list) or not items:
        raise LLMAnswerError("combinations 목록이 없거나 비어 있음")
    combos: list[dict] = []
    for no, item in enumerate(items, start=1):
        combo = _check_combination(no, item)
        if sorted(combo["instruments"]) not in [sorted(c["instruments"]) for c in combos]:
            combos.append(combo)
    return combos[:MAX_COMBINATIONS]


async def recommend(client: OllamaClient, model_tag: str, features: Features, *,
                    num_ctx: int | None = None) -> list[dict]:
    """쓸 수 있는 조합 1~3개. 호출 실패·JSON 깨짐·모양 어긋남은 LLMAnswerError."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": build_prompt(features)}]
    try:
        data = await client.chat_json(model_tag, messages, num_ctx=num_ctx, temperature=0.3,
                                      schema=response_schema())
    except OllamaError as exc:
        log.warning("LLM 추천 실패(%s): %s", model_tag, exc)
        raise LLMAnswerError(f"Ollama 답 오류: {str(exc)[:160]}") from exc
    try:
        return validate_answer(data)
    except LLMAnswerError as exc:
        log.warning("LLM 추천 답을 쓸 수 없음(%s): %s", model_tag, exc)
        raise
