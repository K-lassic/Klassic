"""POST /v1/recommend 계약 시험 (T086 · T087 · T089, INTERFACES §6 · §7)."""

from __future__ import annotations

import pytest

from app.recommend import features as feat
from app.recommend.rules import rules_hash

from .conftest import key_headers, make_midi, make_musicxml, q, q1, svc_headers, wait_until


def _score(data: bytes | None = None, name: str = "song.mid"):
    return {"score": (name, data or make_midi(bpm=60), "audio/midi")}


# ---------------------------------------------------------------- 특징 추출(단위)
@pytest.mark.parametrize(("bpm", "tempo"), [(60, "slow"), (69.9, "slow"), (70, "medium"), (110, "medium"), (111, "fast")])
def test_tempo_classes(bpm, tempo):
    assert feat.tempo_class(bpm) == tempo


def test_mode_estimate_gyemyeonjo_and_pyeongjo():
    # 라선법 꼴(A C D E G, 마지막 A) → 계면조, 솔선법 꼴(G A C D E, 마지막 G) → 평조
    gye = feat.from_midi(make_midi(pitches=[57, 60, 62, 64, 67, 64, 62, 60, 57, 60, 57]))
    pyeong = feat.from_midi(make_midi(pitches=[55, 57, 60, 62, 64, 62, 60, 57, 55, 57, 55]))
    assert gye.mode == "gyemyeonjo" and pyeong.mode == "pyeongjo"
    assert gye.range_low == 57 and gye.range_high == 67 and gye.note_count == 11 and gye.density > 0


def test_features_from_musicxml():
    f = feat.extract(make_musicxml(bpm=120).encode())
    assert f.tempo == "fast" and f.bpm == 120 and f.note_count == 12
    no_tempo = feat.extract(make_musicxml(bpm=None).encode())
    assert no_tempo.bpm is None and no_tempo.tempo == "medium"


# ---------------------------------------------------------------- 엔드포인트
async def test_llm_not_ready_skips_to_rules_and_starts_load(app_client, db, ollama, ext_key):
    assert ollama.loaded == []
    r = await app_client.post("/v1/recommend", files=_score(), headers=key_headers(ext_key[0]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is True and body["pending"] is True and body["reason"] is None
    assert body["model"] == {"name": "rules", "version": rules_hash(), "provider": "builtin"}
    assert 1 <= len(body["combinations"]) <= 3
    assert body["features"]["tempo"] == "slow" and body["features"]["mode"] in ("gyemyeonjo", "pyeongjo", "unknown")
    # 백그라운드 불러오기 = 빈 프롬프트 generate(keep_alive 5m)
    await wait_until(lambda: any(p == "/api/generate" for _, p, _ in ollama.requests))
    gen = next(b for _, p, b in ollama.requests if p == "/api/generate")
    assert gen == {"model": "gemma3:4b", "prompt": "", "keep_alive": "5m", "stream": False}
    reg = app_client.app.state.registry
    await wait_until(lambda: reg.get("llm-gemma3-4b").state == "ready")
    ev = q1(db, "SELECT trigger_kind, outcome FROM model_load_event WHERE model_name = 'llm-gemma3-4b' "
                "ORDER BY load_id DESC LIMIT 1")
    assert ev == {"trigger_kind": "request", "outcome": "ok"}
    assert not any(p == "/api/chat" for _, p, _ in ollama.requests)  # 준비 안 된 모델은 부르지 않았다


async def test_llm_ready_path(app_client, ollama, ext_key):
    ollama.loaded = ["gemma3:4b"]
    ollama.chat_reply = {"combinations": [
        {"label": "느린 계면", "instruments": ["ajaeng", "daegeum", "janggu"], "reason": "슬픈 느낌"},
        {"label": "활달한 가야금 연주", "instruments": ["gayageum", "janggu", "gayageum"], "reason": "밝습니다"},
        {"label": "같은 조합", "instruments": ["janggu", "gayageum"], "reason": "되풀이"},
        {"label": "넷째", "instruments": ["piri", "janggu"]},
        {"label": "다섯째", "instruments": ["haegeum", "janggu"]},
    ]}
    app_client.app.state.registry._ollama_checked = 0
    body = (await app_client.post("/v1/recommend", files=_score(), headers=key_headers(ext_key[0]))).json()
    assert body["available"] is True and body["pending"] is False
    assert body["model"]["name"] == "llm-gemma3-4b" and body["model"]["provider"] == "ollama"
    assert [t["outcome"] for t in body["tried"]] == ["ok"]
    combos = body["combinations"]
    assert len(combos) == 3  # 최대 3개
    assert combos[0] == {"label": "아쟁 · 대금 · 장구", "instruments": ["ajaeng", "daegeum", "janggu"],
                         "reason": "슬픈 느낌"}
    # 중복 코드는 한 번만, 같은 악기 조합은 한 번만, 이름은 LLM 문구가 아니라 악기 이름으로 만든다(T151)
    assert combos[1]["instruments"] == ["gayageum", "janggu"] and combos[1]["label"] == "가야금 · 장구"
    assert combos[2]["instruments"] == ["piri", "janggu"] and combos[2]["label"] == "피리 · 장구"
    chat = next(b for _, p, b in ollama.requests if p == "/api/chat")
    assert chat["keep_alive"] == "5m" and chat["think"] is False
    # format 은 JSON 스키마(악기 코드 enum 으로 묶음)
    item_schema = chat["format"]["properties"]["combinations"]["items"]["properties"]["instruments"]["items"]
    assert "gayageum" in item_schema["enum"] and chat["format"]["properties"]["combinations"]["maxItems"] == 3
    assert chat["options"]["num_ctx"] == 4096 and chat["stream"] is False
    assert "gayageum" in chat["messages"][1]["content"] and "빠르기" in chat["messages"][1]["content"]


@pytest.mark.parametrize(("reply", "detail"), [
    ("이건 JSON 이 아닙니다", "JSON 이 아닌 답"),
    ({"combinations": [{"label": "활달한 가야금 연주"}, {"label": "해금과 현악의 조화"}]}, "instruments"),
    ({"combinations": [{"instruments": ["gayageum", "janggu"]}, {"instruments": ["gayageum", "kazoo"]}]}, "kazoo"),
    ({"combinations": [{"instruments": ["활달한 가야금 연주"]}]}, "목록에 없는 악기"),
    ({"combinations": []}, "비어 있음"),
])
async def test_llm_invalid_answer_falls_to_rules(app_client, ollama, ext_key, reply, detail):
    ollama.loaded = ["gemma3:4b"]
    ollama.chat_reply = reply
    app_client.app.state.registry._ollama_checked = 0
    body = (await app_client.post("/v1/recommend", files=_score(), headers=key_headers(ext_key[0]))).json()
    assert body["available"] is True and body["model"]["name"] == "rules" and body["pending"] is False
    assert body["model"]["provider"] == "builtin" and 1 <= len(body["combinations"]) <= 3
    assert [t["outcome"] for t in body["tried"]] == ["invalid_answer", "ok"]
    assert detail in body["tried"][0]["detail"]


async def test_llm_gugak_less_and_percussion_only_combos_used(app_client, ollama, ext_key):
    # 2026-09-29 황송해 결정: 일반 악기만·타악만의 조합도 버리지 않고 그대로 쓴다
    ollama.loaded = ["gemma3:4b"]
    ollama.chat_reply = {"combinations": [
        {"instruments": ["piano", "violin"], "reason": "밝습니다"},
        {"instruments": ["janggu", "buk"], "reason": "장단만"},
    ]}
    app_client.app.state.registry._ollama_checked = 0
    body = (await app_client.post("/v1/recommend", files=_score(), headers=key_headers(ext_key[0]))).json()
    assert body["model"]["name"] == "llm-gemma3-4b" and [t["outcome"] for t in body["tried"]] == ["ok"]
    assert [c["instruments"] for c in body["combinations"]] == [["piano", "violin"], ["janggu", "buk"]]
    assert body["combinations"][1]["label"] == "장구 · 북"


async def test_recommend_unavailable_when_no_pitched_notes(app_client, ext_key):
    body = (await app_client.post("/v1/recommend", files=_score(make_midi(drums_only=True)),
                                  headers=key_headers(ext_key[0]))).json()
    assert body["available"] is False and body["reason"] == "RECOMMEND_UNAVAILABLE" and body["combinations"] == []


async def test_writes_recommendation_rows_for_request(app_client, db, ext_key):
    # 웹 요청처럼 번호가 있는 요청에 추천 기록을 남긴다
    import uuid

    sid, no = str(uuid.uuid4()), "R-0928-REC" + uuid.uuid4().hex[:5].upper()
    with db.cursor() as cur:
        cur.execute("INSERT INTO anon_session (session_id) VALUES (%s)", (sid,))
        cur.execute("INSERT INTO score_request (request_no, channel, session_id, file_kind, route, status, "
                    "setting_version_id, completed_at) VALUES (%s,'web',%s,'midi','direct','completed',1, "
                    "CURRENT_TIMESTAMP(3))", (no, sid))
    r = await app_client.post("/v1/recommend", files=_score(), data={"request_no": no}, headers=svc_headers())
    body = r.json()
    assert r.status_code == 200 and body["available"] is True
    rid = q1(db, "SELECT request_id FROM score_request WHERE request_no = %s", (no,))["request_id"]
    rec = q1(db, "SELECT * FROM recommendation WHERE request_id = %s", (rid,))
    assert rec["outcome"] == "ok" and rec["model_name"] == "rules" and rec["model_version"] == rules_hash()
    assert rec["feature_tempo"] == "느림" and rec["duration_ms"] is not None
    opts = q(db, "SELECT o.rank_no, e.ensemble_kind FROM recommendation_option o JOIN ensemble e "
                 "ON e.ensemble_id = o.ensemble_id WHERE o.recommendation_id = %s ORDER BY o.rank_no",
             (rec["recommendation_id"],))
    assert [o["rank_no"] for o in opts] == list(range(1, len(body["combinations"]) + 1))
    assert {o["ensemble_kind"] for o in opts} == {"recommended"}
    members = q(db, "SELECT i.code, m.part_role FROM recommendation_option o JOIN ensemble_member m "
                    "ON m.ensemble_id = o.ensemble_id JOIN instrument i ON i.instrument_id = m.instrument_id "
                    "WHERE o.recommendation_id = %s AND o.rank_no = 1 ORDER BY m.part_no", (rec["recommendation_id"],))
    assert [m["code"] for m in members] == body["combinations"][0]["instruments"]
    # 외부 키로는 웹 요청 번호를 쓸 수 없다
    r2 = await app_client.post("/v1/recommend", files=_score(), data={"request_no": no}, headers=key_headers(ext_key[0]))
    assert r2.status_code == 404


async def test_recommend_rejects_image(app_client, ext_key):
    from .conftest import make_png

    r = await app_client.post("/v1/recommend", files={"score": ("a.png", make_png(), "image/png")},
                              headers=key_headers(ext_key[0]))
    assert r.status_code == 415 and r.json()["error"]["code"] == "UPLOAD_UNSUPPORTED_TYPE"
