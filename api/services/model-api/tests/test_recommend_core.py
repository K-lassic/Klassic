"""#88 규칙 추천의 순수 로직 — 특징 추출(features) · 규칙표(rules). 엔드포인트 · DB · 엔진 없이 돈다."""
import hashlib
import io
import json
from pathlib import Path

import mido
import pytest
import yaml

from app.recommend import features, rules
from app.services import catalog

API = Path(__file__).resolve().parents[3]
SHARED = API / "shared"
TEMPLATES = Path(__file__).resolve().parents[1] / "assets" / "templates"


@pytest.fixture(autouse=True)
def shared_catalog():
    """악기 목록을 저장소의 api/shared 에서 읽게 한다 (설정 · 환경변수와 관계없이)."""
    token = catalog.INSTRUMENTS_DIR.set(SHARED)
    yield
    catalog.INSTRUMENTS_DIR.reset(token)


STEPS = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"]
ALTERS = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]


def musicxml(pitches, bpm=None, drums=False):
    """음높이 목록 → 4분음표가 이어지는 MusicXML. drums=True 면 타악 성부를 하나 더 붙인다."""
    def note(p):
        alter = f"<alter>{ALTERS[p % 12]}</alter>" if ALTERS[p % 12] else ""
        return (f"<note><pitch><step>{STEPS[p % 12]}</step>{alter}<octave>{p // 12 - 1}</octave></pitch>"
                "<duration>1</duration><type>quarter</type></note>")

    tempo = (f'<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>{bpm}</per-minute>'
             f'</metronome></direction-type><sound tempo="{bpm}"/></direction>') if bpm else ""
    attrs = "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
    measures = "".join(
        f'<measure number="{m // 4 + 1}">{attrs + tempo if m == 0 else ""}{"".join(note(p) for p in pitches[m:m + 4])}</measure>'
        for m in range(0, max(len(pitches), 1), 4))
    extra_list = extra_part = ""
    if drums:
        extra_list = ('<score-part id="P2"><part-name>Drums</part-name><score-instrument id="P2-I1"><instrument-name>Drums'
                      '</instrument-name></score-instrument><midi-instrument id="P2-I1"><midi-channel>10</midi-channel>'
                      "<midi-program>1</midi-program></midi-instrument></score-part>")
        hits = "".join('<note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched>'
                       '<duration>1</duration><instrument id="P2-I1"/><type>quarter</type></note>' for _ in range(4))
        extra_part = f'<part id="P2"><measure number="1">{attrs}{hits}</measure></part>'
    return ('<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1">'
            f'<part-name>P</part-name></score-part>{extra_list}</part-list><part id="P1">{measures}</part>{extra_part}'
            "</score-partwise>").encode()


def midi(pitches, bpm=None, drum_hits=0):
    mid = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    if bpm:
        track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=0))
    for p in pitches:
        track.append(mido.Message("note_on", note=p, velocity=80, time=0))
        track.append(mido.Message("note_off", note=p, velocity=0, time=480))
    if drum_hits:
        drums = mido.MidiTrack()
        mid.tracks.append(drums)
        for _ in range(drum_hits):
            drums.append(mido.Message("note_on", channel=9, note=36, velocity=90, time=0))
            drums.append(mido.Message("note_off", channel=9, note=36, velocity=0, time=240))
    out = io.BytesIO()
    mid.save(file=out)
    return out.getvalue()


def scale(tonic, steps, octaves=2, end_on_tonic=True):
    """으뜸음에서 주어진 음정들을 오르내리는 가락."""
    up = [tonic + 12 * o + s for o in range(octaves) for s in sorted(steps)]
    line = up + up[::-1]
    return line + [tonic] if end_on_tonic else line


# ── 빠르기 ─────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("bpm, expected", [(None, "medium"), (40, "slow"), (69.9, "slow"), (70, "medium"),
                                           (110, "medium"), (110.1, "fast"), (200, "fast")])
def test_tempo_class_boundaries(bpm, expected):
    assert features.tempo_class(bpm) == expected


def test_missing_tempo_mark_means_no_bpm_not_120():
    # music21 은 빠르기 표시가 없으면 120 을 지어낸다. 그걸 그대로 쓰면 표시 없는 악보가 전부 '빠름' 이 된다
    f = features.extract(musicxml(scale(67, features.PYEONGJO)))
    assert f.bpm is None and f.tempo == "medium"
    f = features.extract(midi(scale(67, features.PYEONGJO)))
    assert f.bpm is None and f.tempo == "medium"


# ── 선법 ───────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("tonic", range(60, 72))
def test_pentatonic_modes_are_recognised_on_every_tonic(tonic):
    assert features.extract(musicxml(scale(tonic, features.PYEONGJO), bpm=90)).mode == "pyeongjo"
    assert features.extract(musicxml(scale(tonic, features.GYEMYEONJO), bpm=90)).mode == "gyemyeonjo"


def test_chromatic_melody_is_unknown():
    assert features.extract(musicxml(list(range(60, 72)) + [60], bpm=90)).mode == "unknown"


def test_mode_uses_note_lengths_not_counts():
    # 틀 밖의 음이 여러 번 나와도 짧으면 선법을 흐리지 않는다 (꾸밈음 · 경과음)
    weights = {0: 4.0, 2: 3.0, 5: 3.0, 7: 4.0, 9: 3.0, 1: 0.2, 6: 0.2, 11: 0.2}
    assert features.estimate_mode(weights, final_pc=0) == "pyeongjo"
    assert features.estimate_mode({}, None) == "unknown"
    assert features.estimate_mode({0: 0.0}, 0) == "unknown"


# ── 음역 · 밀도 · 타악 제외 ────────────────────────────────────────────────
def test_range_density_and_note_names():
    f = features.extract(musicxml([60, 64, 67, 72], bpm=60))
    assert (f.range_low, f.range_high, f.note_count) == (60, 72, 4)
    assert f.range == "C4–C5 (12반음)"
    assert f.density == 1.0                      # 60 BPM 의 4분음표 = 초당 한 음
    assert f.public()["range_semitones"] == 12
    assert features.note_name(21) == "A0" and features.note_name(61) == "C#4"


def test_percussion_is_ignored_in_both_formats():
    melody = scale(67, features.PYEONGJO)
    for data in (musicxml(melody, bpm=90, drums=True), midi(melody, bpm=90, drum_hits=16)):
        f = features.extract(data)
        assert f.note_count == len(melody)
        assert (f.range_low, f.range_high) == (min(melody), max(melody))


def test_midi_and_musicxml_of_the_same_tune_agree():
    melody = scale(62, features.GYEMYEONJO)
    a, b = features.extract(musicxml(melody, bpm=132)), features.extract(midi(melody, bpm=132))
    assert (a.tempo, a.mode, a.range_low, a.range_high, a.note_count) == (b.tempo, b.mode, b.range_low, b.range_high, b.note_count)
    assert a.tempo == "fast" and a.mode == "gyemyeonjo"
    assert a.bpm == b.bpm == 132.0
    assert a.pitch_seconds.keys() == b.pitch_seconds.keys()


@pytest.mark.parametrize("data", [b"", b"not a score", b"MThd\x00\x00", musicxml([]), midi([]), midi([], drum_hits=4)])
def test_unreadable_or_empty_scores_raise_feature_error(data):
    with pytest.raises(features.FeatureError):
        features.extract(data)


def test_public_shape_matches_contract_keys():
    contract = yaml.safe_load((API / "contracts" / "model-api.yaml").read_text(encoding="utf-8"))
    required = contract["components"]["schemas"]["RecommendationFeatures"]["required"]
    public = features.extract(musicxml(scale(67, features.PYEONGJO), bpm=90)).public()
    assert sorted(public) == sorted(required)
    assert public["tempo_label"] == "보통" and public["mode_label"] == "평조"


# ── 저장소의 실제 악보 ─────────────────────────────────────────────────────
@pytest.mark.parametrize("name", ["arirang-semachi-v1", "jeongganbo-taryeong-gayageum-v1", "minuet-g-v1"])
def test_bundled_templates_give_the_same_features_from_midi_and_musicxml(name):
    xml = features.extract((TEMPLATES / f"{name}.musicxml").read_bytes())
    mid = features.extract((TEMPLATES / f"{name}.mid").read_bytes())
    assert xml.note_count > 10
    assert (xml.mode, xml.range_low, xml.range_high) == (mid.mode, mid.range_low, mid.range_high)
    assert xml.note_count == mid.note_count          # 붙임줄로 이어진 음을 한 음으로 세야 같다
    if xml.bpm is not None:
        assert (xml.bpm, xml.tempo) == (mid.bpm, mid.tempo)


def test_known_gap_tempo_differs_when_musicxml_has_no_tempo_mark():
    """알려진 차이 — 고치지 않고 기록해 둔다.

    타령 · 미뉴에트의 MusicXML 에는 빠르기 표시가 없다 → BPM 없음 → '보통'.
    같은 곡의 MIDI 에는 120 이 적혀 있다(빠르기를 모를 때 MIDI 를 쓰는 쪽이 넣는 기본값) → '빠름'.
    MIDI 의 120 이 '진짜 120' 인지 '모름' 인지는 파일만 보고는 가를 수 없다. 추천 칸이 형식에 따라 달라질 수 있다.
    """
    xml = features.extract((TEMPLATES / "minuet-g-v1.musicxml").read_bytes())
    mid = features.extract((TEMPLATES / "minuet-g-v1.mid").read_bytes())
    assert (xml.bpm, xml.tempo) == (None, "medium")
    assert (mid.bpm, mid.tempo) == (120.0, "fast")


def test_known_limit_western_major_tune_reads_as_pyeongjo():
    """알려진 한계 — 장조 곡(미뉴에트 G장조)도 '평조' 로 나온다. 장음계 7음 중 5음이 평조 틀에 들기 때문이다.

    선법 판별은 국악 5음 음계끼리 가르는 어림 규칙이지 '국악인가 아닌가' 를 가리지 않는다 ([추정], 전공자 확인 전).
    """
    assert features.extract((TEMPLATES / "minuet-g-v1.musicxml").read_bytes()).mode == "pyeongjo"


def test_arirang_is_pyeongjo():
    # 아리랑(경토리)은 솔선법 꼴 5음 음계다
    assert features.extract((TEMPLATES / "arirang-semachi-v1.musicxml").read_bytes()).mode == "pyeongjo"


# ── 규칙표 ─────────────────────────────────────────────────────────────────
def feat(tempo="medium", mode="pyeongjo", pitches=(60, 62, 65, 67, 69)):
    return features.Features(bpm=90.0, tempo=tempo, mode=mode, range_low=min(pitches), range_high=max(pitches),
                             range="-", density=1.0, note_count=len(pitches), pitch_seconds={p: 1.0 for p in pitches})


def test_every_cell_gives_one_to_three_valid_combinations():
    cat = catalog.instruments()
    for tempo in features.TEMPO_LABEL:
        for mode in features.MODE_LABEL:
            combos = rules.recommend(feat(tempo, mode))
            assert 1 <= len(combos) <= rules.MAX_COMBINATIONS, (tempo, mode)
            for c in combos:
                assert set(c) == {"label", "instruments", "reason"} and c["label"]
                assert c["instruments"] and all(code in cat for code in c["instruments"])
                assert len(set(c["instruments"])) == len(c["instruments"])
                assert any(not cat[code].is_percussion for code in c["instruments"]), "선율 악기가 하나는 있어야 한다"


def test_rules_file_only_names_known_gugak_instruments_and_is_complete():
    cat = catalog.instruments()
    table = yaml.safe_load(rules.RULES_PATH.read_text(encoding="utf-8"))["rules"]
    assert set(table) == set(features.TEMPO_LABEL)
    for tempo, row in table.items():
        assert set(row) == set(features.MODE_LABEL), tempo
        for mode, cell in row.items():
            for item in cell:
                unknown = [c for c in item["instruments"] if c not in cat]
                assert unknown == [], (tempo, mode, unknown)
                assert all(cat[c].family == "gugak" for c in item["instruments"]), "국악기 추천이다"
                assert item["label"] and item["reason"]


def test_empty_cell_falls_back_to_default_ensemble():
    (combo,) = rules.recommend(feat("slow", "unknown"))
    assert combo["instruments"] == catalog.default_ensemble() == ["gayageum", "janggu"]
    assert combo["label"] == "가야금 · 장구"
    assert "느림·알 수 없음" in combo["reason"]


def test_unknown_codes_are_dropped_and_empty_combinations_removed():
    cat = catalog.instruments()
    assert rules.clean_combination({"label": "x", "instruments": ["gayageum", "theremin", "gayageum"]}, cat) == {
        "label": "x", "instruments": ["gayageum"], "reason": ""}
    assert rules.clean_combination({"label": "x", "instruments": ["theremin"]}, cat) is None
    assert rules.clean_combination({"instruments": ["daegeum", "janggu"]}, cat)["label"] == "대금 · 장구"


def test_model_version_is_the_rules_file_hash_and_matches_startup():
    expected = hashlib.sha256(rules.RULES_PATH.read_bytes()).hexdigest()[:12]
    assert rules.rules_hash() == expected
    # /v1/models 가 내는 rules 모델의 version 과 같은 파일이어야 한다 (app/resources/startup.py)
    assert rules.RULES_PATH == Path(rules.__file__).resolve().parents[1] / "resources" / "rules.yaml"
    assert 'with_name("rules.yaml")' in (rules.RULES_PATH.parent / "startup.py").read_text(encoding="utf-8")


# ── 음역 순서 ──────────────────────────────────────────────────────────────
def test_range_fit():
    assert rules.range_fit({60: 1.0, 62: 1.0}, 58, 87) == 1.0
    assert rules.range_fit({40: 3.0, 60: 1.0}, 58, 87) == 1.0          # 한 옥타브 올리면 다 들어간다 (52 는 아직 밖 → 두 옥타브)
    assert rules.range_fit({40: 1.0, 100: 1.0}, 58, 70) == 0.5         # 두 옥타브 올리면 낮은 음만 들어간다 — 절반
    assert rules.range_fit({30: 1.0, 100: 1.0}, 58, 70) == 0.0         # 어느 쪽으로 옮겨도 안 들어간다
    assert rules.range_fit({}, 58, 87) == 1.0
    assert rules.range_fit({60: 1.0}, None, None) == 1.0               # 음역을 모르는 악기는 막지 않는다


def test_low_tune_puts_geomungo_first_and_high_tune_puts_daegeum_first():
    """느린 평조 칸: [대금·가야금, 거문고·대금, 해금·가야금]. 낮고 넓은 곡은 거문고 조합이, 높은 곡은 규칙표 순서 그대로."""
    wide_low = feat("slow", "pyeongjo", pitches=tuple(range(36, 73)))             # 거문고 음역(36~72)에 딱 맞는 넓은 가락
    first = rules.recommend(wide_low)[0]
    assert "geomungo" in first["instruments"]
    high = feat("slow", "pyeongjo", pitches=(62, 65, 67, 69, 72, 74, 77))
    assert [c["label"] for c in rules.recommend(high)] == ["정악 관현", "거문고 중심", "해금 가락"]   # 다 들어가면 규칙표 순서


def test_range_ordering_never_adds_or_drops_combinations():
    for pitches in ((30, 31), (100, 108), tuple(range(20, 110, 7))):
        for tempo in features.TEMPO_LABEL:
            for mode in ("pyeongjo", "gyemyeonjo"):
                ranked = rules.recommend(feat(tempo, mode, pitches))
                plain = rules.recommend(feat(tempo, mode, (67,)))
                assert sorted(c["label"] for c in ranked) == sorted(c["label"] for c in plain)


# ── 응답 모양 ──────────────────────────────────────────────────────────────
def test_response_validates_against_the_contract():
    import jsonschema

    contract = yaml.safe_load((API / "contracts" / "model-api.yaml").read_text(encoding="utf-8"))
    schema = {"$ref": "#/components/schemas/RecommendationResponse", "components": contract["components"]}
    for name in ("arirang-semachi-v1", "minuet-g-v1"):
        body = rules.recommend_response(features.extract((TEMPLATES / f"{name}.musicxml").read_bytes()))
        jsonschema.validate(json.loads(json.dumps(body, ensure_ascii=False)), schema)
        assert body["available"] is True and body["model"]["name"] == "rules" and body["model"]["provider"] == "builtin"
        assert all("gugak" == catalog.instruments()[c].family for combo in body["combinations"] for c in combo["instruments"])
