"""연주 API 성부별 음원 · 타악 파트 처리 계약 시험 (T150, T106 메모).

2026-09-29 사진·PDF 입력: 연주 API 는 MusicXML 을 받지 않으므로 사진을 올리고 가짜 인식 엔진이 이 MusicXML 을 돌려주게 한다.
"""

from __future__ import annotations

import json

from .conftest import key_headers, make_musicxml, make_png, svc_headers, wait_until


async def _submit(client, raw, data, engines, xml=None):
    xml = xml or make_musicxml(["C4", "D4", "E4", "F4"], instrument_name="Violin")
    engines.results["homr"] = [{"outcome": "success", "musicxml": xml}]
    return await client.post("/v1/performances", files={"score": ("s.png", make_png(), "image/png")},
                             data={"score_type": "staff", **data}, headers=key_headers(raw))


async def _wait_done(client, raw, no):
    async def done():
        s = (await client.get(f"/v1/performances/{no}", headers=key_headers(raw))).json()
        return s if s["status"] in ("completed", "completed_fallback", "service_down") else None

    return await wait_until(done, timeout=30)


async def test_custom_tracks_render_with_their_own_soundfont(app_client, engines, ext_key):
    raw, _ = ext_key
    tracks = [{"part": 0, "instrument": "ajaeng"}, {"part": 1, "instrument": "cello"},
              {"part": 2, "instrument": "gayageum", "sf2_ref": "FluidR3_GM.sf2"}]
    r = await _submit(app_client, raw, {"instruments": json.dumps({"mode": "custom", "tracks": tracks})}, engines)
    assert r.status_code == 202, r.text
    await _wait_done(app_client, raw, r.json()["id"])
    # 아쟁 = gugak.sf2, 첼로 = FluidR3_GM(악기 목록), 가야금 + sf2_ref = 지정한 GM 음원
    assert engines.render_fonts[-1] == ["gugak", "gm", "gm"]
    # 소리 번호(결정 C11): 아쟁 = gugak.sf2 bank 1 · program 5, 첼로 = GM 번호 그대로, GM 음원으로 돌린 가야금도 GM 번호
    assert engines.render_presets[-1] == [(1, 5), None, None]


async def test_default_mode_does_not_add_percussion_part(app_client, engines, ext_key):
    raw, _ = ext_key
    r = await _submit(app_client, raw, {}, engines)
    assert r.status_code == 202
    await _wait_done(app_client, raw, r.json()["id"])
    assert engines.render_fonts[-1] == ["gugak"]  # 가야금 한 성부뿐 — 장구 파트를 새로 만들지 않는다
    assert engines.render_presets[-1] == [(1, 0)]  # 가야금 = gugak.sf2 bank 1 · program 0 (결정 C11)
    res = (await app_client.get(f"/v1/performances/{r.json()['id']}/result", headers=key_headers(raw))).json()
    xml = (await app_client.get(res["files"]["musicxml"].replace("http://test", ""))).text
    assert "가야금" in xml and "장구" not in xml


async def test_unknown_sf2_ref_is_rejected(app_client, engines, ext_key):
    raw, _ = ext_key
    tracks = [{"part": 0, "instrument": "gayageum", "sf2_ref": "my-upload"}]
    r = await _submit(app_client, raw, {"instruments": json.dumps({"mode": "custom", "tracks": tracks})}, engines)
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert r.json()["error"]["details"]["field"] == "instruments.tracks[0].sf2_ref"


async def test_render_mp3_has_no_user_soundfont(app_client, engines):
    """US8 삭제(2026-09-29): 사용자 음원 받기(/v1/internal/sf2)가 없고, 렌더링의 sf2_ref 는 기본 음원 이름만 된다."""
    sf2 = b"RIFF\x10\x00\x00\x00sfbk" + b"\x00" * 16
    r = await app_client.post("/v1/internal/sf2", data={"session_id": "sess-fonts", "sf2_ref": "mine"},
                              files={"file": ("my.sf2", sf2, "application/octet-stream")}, headers=svc_headers())
    assert r.status_code in (404, 405)
    assert (await app_client.delete("/v1/internal/sf2/sess-fonts", headers=svc_headers())).status_code in (404, 405)
    xml = make_musicxml(["C4", "D4"], instrument_name="Violin").encode()
    bad = json.dumps({"mode": "custom", "tracks": [{"part": 0, "instrument": "daegeum", "sf2_ref": "sf2-7"}]})
    # 사용자 음원 파일(sf2_files)은 선언되지 않은 필드라 조용히 무시하지 않고 거절한다(2026-09-30 API 점검 B3)
    m = await app_client.post("/v1/render/mp3", files={"score": ("a.musicxml", xml, "application/xml"),
                                                       "sf2_files": ("sf2-7.sf2", sf2, "application/octet-stream")},
                              data={"instruments": bad}, headers=svc_headers())
    assert m.status_code == 422 and m.json()["error"]["code"] == "VALIDATION_ERROR"
    assert m.json()["error"]["details"]["errors"] == [{"loc": ["body", "sf2_files"], "msg": "선언되지 않은 필드입니다"}]
    # 모르는 음원 이름(sf2_ref)은 422 VALIDATION_ERROR
    m = await app_client.post("/v1/render/mp3", files={"score": ("a.musicxml", xml, "application/xml")},
                              data={"instruments": bad}, headers=svc_headers())
    assert m.status_code == 422 and m.json()["error"]["details"]["field"] == "instruments.tracks[0].sf2_ref"
    # 기본 음원 이름은 된다
    ok = json.dumps({"mode": "custom", "tracks": [{"part": 0, "instrument": "daegeum", "sf2_ref": "FluidR3_GM.sf2"},
                                                   {"part": 1, "instrument": "cello"}]})
    m = await app_client.post("/v1/render/mp3", files={"score": ("a.musicxml", xml, "application/xml")},
                              data={"instruments": ok}, headers=svc_headers())
    assert m.status_code == 200, m.text
    assert engines.render_fonts[-1] == ["gm", "gm"]
    assert engines.render_calls[-1][2] == ()


async def test_render_mp3_custom_keeps_chosen_instrument(app_client, engines):
    """악기를 지정하면 기본 구성(가야금)으로 덮어쓰지 않는다 — 대금은 gugak, 첼로는 gm."""
    tracks = json.dumps({"mode": "custom", "tracks": [{"part": 0, "instrument": "daegeum"},
                                                      {"part": 1, "instrument": "cello"}]})
    xml = make_musicxml(["C4", "D4"], instrument_name="Violin").encode()
    m = await app_client.post("/v1/render/mp3", files={"score": ("a.musicxml", xml, "application/xml")},
                              data={"instruments": tracks}, headers=svc_headers())
    assert m.status_code == 200, m.text
    assert engines.render_fonts[-1] == ["gugak", "gm"]
    assert engines.render_presets[-1] == [(1, 2), None]  # 대금 bank 1 · program 2, 첼로는 GM 42 그대로(결정 C11)
