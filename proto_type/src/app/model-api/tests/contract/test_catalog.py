"""읽기 엔드포인트 계약 시험 (2026-09-30 조성기 — UC12 A10 · BR-API-07 · BR-SHR-09, tasks T360)."""

from __future__ import annotations

import secrets

from .conftest import key_headers, make_musicxml, q1


def _share_no() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "S-0930-" + "".join(secrets.choice(alphabet) for _ in range(8))


def _insert_share(db, storage, *, title: str, visible: bool = True, taken_down: bool = False,
                  expired: bool = False, example: str | None = None) -> str:
    no = _share_no()
    uri = f"shared/{no}/score.musicxml"
    path = storage / uri
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(make_musicxml(), encoding="utf-8")
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO shared_score (share_no, title, score_type, musicxml_uri, example_id, unshared_at, taken_down_at, "
            "expires_at) VALUES (%s, %s, 'staff', %s, %s, %s, %s, "
            "CURRENT_TIMESTAMP(3) + INTERVAL %s DAY)",
            (no, title, uri, example, None if visible else "2026-09-30 00:00:00",
             "2026-09-30 00:00:00" if taken_down else None, -1 if expired else 3))
    return no


def _cleanup(db, nos: list[str]) -> None:
    with db.cursor() as cur:
        for no in nos:
            cur.execute("DELETE FROM shared_score WHERE share_no = %s", (no,))


async def test_catalog_needs_key(app_client):
    for path in ("/v1/instruments", "/v1/shared-scores", "/v1/shared-scores/S-0930-ABCDEFGH/score"):
        r = await app_client.get(path)
        assert r.status_code == 401, (path, r.text)


async def test_instruments(app_client, ext_key):
    r = await app_client.get("/v1/instruments", headers=key_headers(ext_key[0]))
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert items, "악기 목록이 비었다"
    assert set(items[0]) == {"code", "name", "is_gugak", "is_percussion", "range_low", "range_high"}
    codes = {i["code"]: i for i in items}
    if "gayageum" in codes:
        assert codes["gayageum"]["is_gugak"] is True and codes["gayageum"]["is_percussion"] is False


async def test_shared_scores_list_and_score(app_client, db, ext_key):
    storage = app_client.app.state.config.storage_dir
    shown = _insert_share(db, storage, title="보이는 곡")
    example = _insert_share(db, storage, title="예시 곡", example=f"ex-{secrets.token_hex(3)}")
    hidden = [_insert_share(db, storage, title="거둔 곡", visible=False),
              _insert_share(db, storage, title="내린 곡", taken_down=True),
              _insert_share(db, storage, title="지난 곡", expired=True)]
    try:
        r = await app_client.get("/v1/shared-scores?sort=recent&limit=50", headers=key_headers(ext_key[0]))
        assert r.status_code == 200, r.text
        body = r.json()
        nos = [i["share_no"] for i in body["items"]]
        assert shown in nos and example in nos
        assert not set(hidden) & set(nos)
        item = next(i for i in body["items"] if i["share_no"] == example)
        # 올린 사람 · 요청 번호 없음(BR-SHR-03)
        assert set(item) == {"share_no", "title", "score_type", "likes", "example", "shared_at"}
        assert item["example"] is True and item["title"] == "예시 곡"
        assert next(i for i in body["items"] if i["share_no"] == shown)["example"] is False

        r = await app_client.get(f"/v1/shared-scores/{shown}/score", headers=key_headers(ext_key[0]))
        assert r.status_code == 200, r.text
        assert r.json()["title"] == "보이는 곡" and "<score-partwise" in r.json()["musicxml"]

        for no in hidden + ["S-0930-ZZZZZZZZ", "../etc"]:
            r = await app_client.get(f"/v1/shared-scores/{no}/score", headers=key_headers(ext_key[0]))
            assert r.status_code == 404, (no, r.text)
            assert r.json()["error"]["code"] == "REQUEST_NOT_FOUND"
    finally:
        _cleanup(db, [shown, example, *hidden])


async def test_catalog_calls_are_logged(app_client, db, ext_key):
    raw, key_id = ext_key
    r = await app_client.get("/v1/instruments", headers=key_headers(raw))
    assert r.status_code == 200
    row = q1(db, "SELECT COUNT(*) AS n FROM api_call_log WHERE access_key_id = %s", (key_id,))
    assert row["n"] >= 1  # 시간당 한도에 들어가는 호출로 남는다(BR-API-04)
