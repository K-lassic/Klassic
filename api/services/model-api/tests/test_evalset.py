"""평가 도구(evalset/) 시험 — 채점 · 일괄 실행 · 보고 · 보정.

구조에서의 위치: 서비스 코드가 아니라 도구의 시험이다. 엔진 · DB · 실제 model-api 없이 돈다.
    일괄 실행은 httpx 의 가짜 전송(MockTransport)으로 model-api 응답을 흉내 낸다.
    보고 · 보정은 임시 폴더에 가짜 실행 결과를 만들어 돌린다.
"""
import json
from pathlib import Path

import httpx
import pytest

from evalset import calibrate, report, run, scoring

DATA = Path(run.__file__).resolve().parent / "data"


def musicxml(pitches, chord_at=()):
    """음높이 목록 → 4분음표가 이어지는 최소 MusicXML. chord_at 의 자리는 앞 음과 화음으로 묶는다."""
    steps = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"]
    alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]
    notes = []
    for i, p in enumerate(pitches):
        alter = f"<alter>{alters[p % 12]}</alter>" if alters[p % 12] else ""
        chord = "<chord/>" if i in chord_at else ""
        notes.append(f"<note>{chord}<pitch><step>{steps[p % 12]}</step>{alter}<octave>{p // 12 - 1}</octave></pitch>"
                     "<duration>1</duration><type>quarter</type></note>")
    measures, per = [], 4
    for m in range(0, max(len(notes), 1), per):
        attrs = ("<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>"
                 "<clef><sign>G</sign><line>2</line></clef></attributes>") if m == 0 else ""
        measures.append(f'<measure number="{m // per + 1}">{attrs}{"".join(notes[m:m + per])}</measure>')
    return ('<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1">'
            f'<part-name>P</part-name></score-part></part-list><part id="P1">{"".join(measures)}</part></score-partwise>')


ARIRANG = [67, 69, 67, 72, 74, 72, 74, 76, 74, 72, 69, 72, 69, 67, 69, 67, 64, 62, 64, 67]


# ── 채점 ───────────────────────────────────────────────────────────────────
def test_identical_sequences_score_full():
    s = scoring.score_pitches(ARIRANG, ARIRANG)
    assert (s.ratio, s.recall, s.precision) == (1.0, 1.0, 1.0)
    assert (s.matched, s.missing, s.extra, s.wrong, s.best_shift) == (len(ARIRANG), 0, 0, 0, 0)
    assert s.normal


def test_missing_extra_wrong_are_counted_separately():
    want = ARIRANG
    assert scoring.score_pitches(want[:10] + want[12:], want).missing == 2          # 두 음을 빠뜨림
    extra = scoring.score_pitches(want[:10] + [50, 51] + want[10:], want)           # 없는 음 둘을 지어냄
    assert (extra.extra, extra.missing, extra.wrong) == (2, 0, 0)
    wrong = scoring.score_pitches(want[:5] + [want[5] + 1] + want[6:], want)        # 한 음을 반음 높게 읽음
    assert (wrong.wrong, wrong.octave_errors, wrong.missing, wrong.extra) == (1, 0, 0, 0)
    octave = scoring.score_pitches(want[:5] + [want[5] + 12] + want[6:], want)      # 한 음을 옥타브 높게
    assert (octave.wrong, octave.octave_errors) == (1, 1)


def test_ratio_matches_v011_definition():
    import difflib

    got, want = ARIRANG[:14] + [60], ARIRANG
    assert scoring.similarity(got, want) == difflib.SequenceMatcher(None, got, want, autojunk=False).ratio()
    assert scoring.NORMAL_THRESHOLD == 0.80


def test_empty_recognition_is_zero_not_perfect():
    s = scoring.score_pitches([], ARIRANG)
    assert (s.ratio, s.recall, s.precision, s.missing, s.normal) == (0.0, 0.0, 0.0, len(ARIRANG), False)
    assert scoring.score_pitches([], []).ratio == 0.0


@pytest.mark.parametrize("shift", [12, -12, 2, -3])
def test_whole_score_shift_is_detected(shift):
    # 음자리표 · 조표를 통째로 잘못 읽으면 일치율은 바닥인데, 전체를 옮기면 그대로 맞는다
    s = scoring.score_pitches([p + shift for p in ARIRANG], ARIRANG)
    assert s.ratio < 0.5 and not s.normal
    assert s.best_shift == -shift and s.shifted_ratio == 1.0


def test_no_shift_reported_for_ordinary_errors():
    noisy = ARIRANG[:3] + [61] + ARIRANG[4:15]
    assert scoring.score_pitches(noisy, ARIRANG).best_shift == 0
    assert scoring.score_pitches([60, 62, 64], [71, 65, 69, 62, 77]).best_shift == 0   # 서로 관계없는 두 목록


def test_pitches_of_musicxml_expands_chords_and_skips_rests():
    xml = musicxml([60, 64, 67, 72], chord_at={1, 2})
    assert sorted(scoring.pitches_of_musicxml(xml)) == [60, 64, 67, 72]
    with_rest = xml.replace("</measure>", "<note><rest/><duration>1</duration></note></measure>", 1)
    assert len(scoring.pitches_of_musicxml(with_rest)) == 4
    assert scoring.pitches_of_musicxml(musicxml(ARIRANG)) == ARIRANG


# ── 평가셋 자료 ────────────────────────────────────────────────────────────
def test_every_real_item_has_an_answer():
    items = run.load_items(DATA / "manifest.json")
    answers = json.loads((DATA / "answers.json").read_text(encoding="utf-8"))["staff"]
    real = [Path(i["file"]).name for i in items if i["kind"] == "real"]
    assert len(real) == 14 and sum(i["kind"] == "fake" for i in items) == 40
    assert [n for n in real if n not in answers] == []
    assert all(a["pitches"] and all(0 <= p <= 127 for p in a["pitches"]) for a in answers.values())
    assert len({Path(i["file"]).name for i in items}) == len(items)        # 결과 파일 이름이 겹치지 않는다


def test_manifest_images_exist_where_run_looks_for_them():
    if not run.DEFAULT_IMAGES.is_dir():
        pytest.skip("평가 이미지 폴더(proto_type)가 없다")
    missing = [i["file"] for i in run.load_items(DATA / "manifest.json") if not (run.DEFAULT_IMAGES / i["file"]).is_file()]
    assert missing == []


# ── 일괄 실행 (가짜 model-api) ─────────────────────────────────────────────
def recognized(pitches, grade="trust", items=None):
    return {"api_version": "v1", "request_no": "R1", "fallback": False, "validity_grade": grade,
            "validity_items": items or {"note_count": float(len(pitches)), "beat_sum": 1.0, "range_leap": 1.0},
            "musicxml": musicxml(pitches), "midi_base64": "AAAA", "midi_available": True,
            "engine": {"name": "homr", "version": "0.7.0", "tried": []}, "timings_ms": {}, "page_count": 1, "converted_pages": 1}


def fallback(reason="no_structure"):
    return {"api_version": "v1", "request_no": "R2", "fallback": True, "fallback_reason": reason,
            "engine": {"name": None, "version": None, "tried": []}, "page_count": 1, "converted_pages": 0}


@pytest.fixture()
def images(tmp_path):
    folder = tmp_path / "images"
    (folder / "real").mkdir(parents=True)
    (folder / "fake").mkdir()
    for name in ("real/S01.png", "real/S02.jpg", "fake/F01.png"):
        (folder / name).write_bytes(b"\x89PNG fake bytes")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({
        "real": [{"file": "real/S01.png", "sheet_kind": "staff"}, {"file": "real/S02.jpg", "sheet_kind": "jeongganbo"},
                 {"file": "real/S99_missing.png", "sheet_kind": "staff"}],
        "fake": [{"file": "fake/F01.png", "fake_label": "백지"}]}), encoding="utf-8")
    return folder, manifest


def fake_server(handler):
    seen = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request, len(seen))

    client = httpx.Client(base_url="http://model-api.test/api", headers={"X-API-Key": "sekret-key"},
                          transport=httpx.MockTransport(wrapped))
    return client, seen


def test_run_sends_each_item_to_the_right_endpoint_and_saves_slim_records(images, tmp_path):
    folder, manifest = images

    def handler(request, n):
        if request.url.path.endswith("/v1/omr/jeongganbo"):
            return httpx.Response(200, json=fallback("ENGINE_DOWN"))
        if b"F01.png" in request.content:
            return httpx.Response(422, json={"error": {"code": "UPLOAD_NOT_A_SCORE", "message": "악보가 아닙니다"}})
        return httpx.Response(200, json=recognized(ARIRANG))

    client, seen = fake_server(handler)
    out = tmp_path / "out"
    counts = run.run(client, run.load_items(manifest), folder, out, log=lambda s: None)
    assert counts == {"done": 2, "skipped": 0, "missing": 1, "failed": 1}
    assert [r.url.path for r in seen] == ["/api/v1/omr/staff", "/api/v1/omr/jeongganbo", "/api/v1/omr/staff"]
    assert all(r.headers["X-API-Key"] == "sekret-key" for r in seen)
    assert b'name="image"; filename="S01.png"' in seen[0].content

    s01 = json.loads((out / "items" / "S01.png.json").read_text(encoding="utf-8"))
    assert s01["kind"] == "real" and s01["status"] == 200 and s01["body"]["musicxml"]
    assert s01["body"]["midi_base64"] is None and s01["body"]["midi_dropped"]      # 큰 값은 남기지 않는다
    f01 = json.loads((out / "items" / "F01.png.json").read_text(encoding="utf-8"))
    assert f01["status"] == 422 and f01["error"]["code"] == "UPLOAD_NOT_A_SCORE" and f01["label"] == "백지"
    # 키는 어떤 결과 파일에도 남지 않는다
    assert all("sekret-key" not in p.read_text(encoding="utf-8") for p in out.rglob("*.json"))


def test_run_resumes_and_retries_when_server_is_busy(images, tmp_path):
    folder, manifest = images
    items = [i for i in run.load_items(manifest) if i["file"] == "real/S01.png"]

    client, seen = fake_server(lambda request, n: httpx.Response(429 if n < 3 else 200,
                                                                 json={"error": {"code": "RATE_LIMIT_EXCEEDED"}} if n < 3 else recognized(ARIRANG)))
    out = tmp_path / "out"
    assert run.run(client, items, folder, out, log=lambda s: None, wait_on_busy_s=0)["done"] == 1
    assert len(seen) == 3                                    # 두 번 바쁨 → 세 번째에 성공
    # 다시 돌리면 이미 있는 항목은 보내지 않는다
    assert run.run(client, items, folder, out, log=lambda s: None)["skipped"] == 1 and len(seen) == 3
    assert run.run(client, items, folder, out, log=lambda s: None, force=True)["done"] == 1 and len(seen) == 4


def test_run_survives_connection_errors_and_non_json(images, tmp_path):
    folder, manifest = images
    items = [i for i in run.load_items(manifest) if i["kind"] == "real" and "missing" not in i["file"]]

    def handler(request, n):
        if n == 1:
            raise httpx.ConnectError("연결 실패")
        return httpx.Response(502, text="<html>Bad Gateway</html>")

    client, _ = fake_server(handler)
    out = tmp_path / "out"
    assert run.run(client, items, folder, out, log=lambda s: None)["failed"] == 2
    first = json.loads((out / "items" / "S01.png.json").read_text(encoding="utf-8"))
    assert first["status"] is None and first["error"]["code"] == "ConnectError"
    second = json.loads((out / "items" / "S02.jpg.json").read_text(encoding="utf-8"))
    assert second["status"] == 502 and "Bad Gateway" in second["error"]


def test_main_refuses_to_run_without_key(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("EVAL_API_KEY", raising=False)
    assert run.main(["--base-url", "http://x/api", "--out", str(tmp_path / "o")]) == 2
    assert "EVAL_API_KEY" in capsys.readouterr().err


# ── 보고 ───────────────────────────────────────────────────────────────────
def write_run(folder: Path, records: list[dict]):
    (folder / "items").mkdir(parents=True)
    for r in records:
        (folder / "items" / f"{r['name']}.json").write_text(json.dumps(r, ensure_ascii=False), encoding="utf-8")


def rec(name, kind, status=200, body=None, error=None, label=None, seconds=5.0):
    return {"file": f"{kind}/{name}", "kind": kind, "score_type": "staff", "label": label, "name": name,
            "status": status, "seconds": seconds, **({"body": body} if body else {}), **({"error": error} if error else {})}


@pytest.fixture()
def answers(tmp_path):
    f = tmp_path / "answers.json"
    f.write_text(json.dumps({"staff": {
        "S01.png": {"piece": "arirang", "variant": "clean", "pitches": ARIRANG},
        "S02.png": {"piece": "arirang", "variant": "photo", "pitches": ARIRANG},
        "S03.png": {"piece": "arirang", "variant": "photo", "pitches": ARIRANG},
        "S04.png": {"piece": "arirang", "variant": "lowres", "pitches": ARIRANG},
    }}), encoding="utf-8")
    return f


RUN_A = [
    rec("S01.png", "real", body=recognized(ARIRANG)),                               # 정상
    rec("S02.png", "real", body=recognized(ARIRANG[:8], grade="caution")),          # 인식됐지만 절반만 — 정상 아님
    rec("S03.png", "real", body=fallback("no_structure")),                          # 오차단
    rec("S04.png", "real", body=recognized([p + 12 for p in ARIRANG])),             # 옥타브 통째로 밀림
    rec("F01.png", "fake", body=fallback("no_structure"), label="백지"),
    rec("F02.png", "fake", status=422, error={"code": "UPLOAD_NOT_A_SCORE"}, label="표"),
    rec("F03.png", "fake", body=recognized([60, 62, 64], grade="trust"), label="빈 오선지"),   # 통과 — SC-016 위반
    rec("F04.png", "fake", body=recognized([60], grade="distrust"), label="풍경"),
    rec("F05.png", "fake", status=500, error={"code": "INTERNAL_ERROR"}, label="공책"),
]


def test_report_summary_counts(tmp_path, answers):
    write_run(tmp_path / "a", RUN_A)
    rows, s = report.build(tmp_path / "a", answers)
    by = {r["name"]: r for r in rows}
    assert (by["S01.png"]["normal"], by["S02.png"]["normal"], by["S03.png"]["normal"], by["S04.png"]["normal"]) == (True, False, False, False)
    assert by["S04.png"]["pitch"]["best_shift"] == -12
    assert by["S03.png"]["outcome"] == "fallback" and by["S03.png"]["pitch"]["missing"] == len(ARIRANG)
    assert by["F02.png"]["outcome"] == "rejected" and by["F05.png"]["outcome"] == "error"

    assert s["real"]["n"] == 4 and s["real"]["normal"] == 1 and s["real"]["normal_rate"] == 0.25
    assert s["real"]["false_block"] == 1 and s["real"]["shifted"] == 1
    assert s["real"]["by_variant"] == {"clean": {"n": 1, "normal": 1}, "photo": {"n": 2, "normal": 0}, "lowres": {"n": 1, "normal": 0}}
    assert s["fake"]["n"] == 5 and s["fake"]["passed_as_trust"] == 1
    assert s["fake"]["filtered"] == 2 and s["fake"]["recognized"] == 2
    assert s["errors"] == 1
    assert s["seconds"]["median"] == 5.0


def test_report_markdown_flags_the_fake_that_passed(tmp_path, answers):
    write_run(tmp_path / "a", RUN_A)
    rows, s = report.build(tmp_path / "a", answers)
    md = report.to_markdown(rows, s)
    assert "| SC-016 가짜 악보가 '신뢰' 로 나간 수 | **1 / 5** | 0 |" in md
    assert "| F03.png | 빈 오선지 | recognized | - | trust **← 통과** |" in md
    assert "| S04.png | recognized | - | trust | homr | 20/20 | 10% |" in md and "| -12 | X |" in md


def test_report_treats_unreadable_musicxml_as_zero(tmp_path, answers):
    write_run(tmp_path / "a", [rec("S01.png", "real", body={**recognized(ARIRANG), "musicxml": "<not xml"})])
    rows, s = report.build(tmp_path / "a", answers)
    assert rows[0]["normal"] is False and rows[0]["pitch"]["got"] == 0 and "musicxml_error" in rows[0]
    assert s["real"]["normal"] == 0


def test_report_main_writes_files_and_detects_regression(tmp_path, answers, capsys):
    write_run(tmp_path / "old", [rec("S01.png", "real", body=recognized(ARIRANG)), rec("S02.png", "real", body=recognized(ARIRANG)),
                                 rec("F01.png", "fake", body=fallback())])
    assert report.main([str(tmp_path / "old"), "--answers", str(answers)]) == 0
    assert (tmp_path / "old" / "REPORT.md").exists()
    saved = json.loads((tmp_path / "old" / "summary.json").read_text(encoding="utf-8"))
    assert saved["summary"]["real"]["normal"] == 2 and len(saved["rows"]) == 3

    # 새 실행: S02 가 인식은 되지만 틀리고, 가짜가 '신뢰' 로 통과한다
    write_run(tmp_path / "new", [rec("S01.png", "real", body=recognized(ARIRANG)), rec("S02.png", "real", body=recognized(ARIRANG[:5])),
                                 rec("F01.png", "fake", body=recognized([60, 62], grade="trust"))])
    capsys.readouterr()
    code = report.main([str(tmp_path / "new"), "--answers", str(answers), "--baseline", str(tmp_path / "old" / "summary.json")])
    err = capsys.readouterr().err
    assert code == 1
    assert "정상 변환" in err and "SC-016" in err and "S02.png" in err
    assert "**나빠짐**" in (tmp_path / "new" / "REPORT.md").read_text(encoding="utf-8")

    # 같은 결과끼리 견주면 통과
    assert report.main([str(tmp_path / "old"), "--answers", str(answers), "--baseline", str(tmp_path / "old" / "summary.json")]) == 0


def test_report_main_without_results(tmp_path, answers):
    (tmp_path / "empty" / "items").mkdir(parents=True)
    assert report.main([str(tmp_path / "empty"), "--answers", str(answers)]) == 2


# ── 보정 ───────────────────────────────────────────────────────────────────
def test_combine_is_the_same_formula_as_the_service():
    """보정 도구가 다시 계산한 점수가 서비스(app/checks/validity.py)의 점수와 같아야 제안이 뜻이 있다."""
    from app.checks.validity import check_validity

    for pitches in (ARIRANG, ARIRANG[:3], [60, 84, 36, 96, 40, 100, 62], ARIRANG * 3):
        for conf in (None, 0.35, 0.9):
            v = check_validity(musicxml(pitches), "staff", engine_confidence=conf, caution_boundary=None, distrust_boundary=None)
            assert calibrate.combine(v.items) == v.score, (pitches, conf, v.items)
            assert calibrate.grade(v.score, 0.7, 0.4) == v.grade
    empty = check_validity(musicxml([]), "staff", engine_confidence=None, caution_boundary=None, distrust_boundary=None)
    assert calibrate.combine(empty.items) == empty.score == 0.0


def row(name, good, items, kind="real", outcome="recognized", grade=None):
    return {"name": name, "kind": kind, "outcome": outcome, "validity_items": items, "validity_grade": grade,
            "normal": good, "pitch": {"ratio": 1.0 if good else 0.2} if kind == "real" else None}


def test_samples_keep_only_items_that_went_through_validity():
    rows = [row("a", True, {"note_count": 30, "beat_sum": 1.0, "range_leap": 1.0}),
            row("b", False, {"note_count": 30, "beat_sum": 0.2, "range_leap": 1.0}),
            row("fake", True, {"note_count": 5, "beat_sum": 1.0, "range_leap": 1.0}, kind="fake"),   # 가짜는 인식되면 언제나 나쁨
            row("fb", False, {}, outcome="fallback"),                                               # 대체는 판정을 안 거쳤다
            {**row("noans", True, {"note_count": 30, "beat_sum": 1.0, "range_leap": 1.0}), "pitch": None}]
    got = calibrate.samples_from(rows)
    assert [(s["name"], s["good"]) for s in got] == [("a", True), ("b", False), ("fake", False)]


def test_auc():
    assert calibrate.auc([0.9, 0.8, 0.2, 0.1], [True, True, False, False]) == 1.0
    assert calibrate.auc([0.1, 0.2, 0.8, 0.9], [True, True, False, False]) == 0.0
    assert calibrate.auc([0.5, 0.5], [True, False]) == 0.5
    assert calibrate.auc([0.5, 0.6], [True, True]) is None


def test_threshold_suggestion_protects_trust_from_bad_results():
    scores, labels = [0.95, 0.9, 0.85, 0.6, 0.3], [True, True, True, False, False]
    t = calibrate.suggest_thresholds(scores, labels)
    assert t["separable"] is True
    assert t["caution"] == 0.62                 # 나쁨의 최고점(0.6) 바로 위 — 나쁜 결과가 '신뢰' 로 못 나간다
    assert t["distrust"] == 0.62                # 좋음의 최저점 아래(0.83)지만 신뢰 경계를 넘지 않게 맞춘다
    assert t["good_below_caution"] == 0
    overlapping = calibrate.suggest_thresholds([0.9, 0.5, 0.7, 0.2], [True, True, False, False])
    assert overlapping["separable"] is False and overlapping["good_below_caution"] == 1


def test_calibrate_warns_on_small_samples_and_reports_current_grades():
    good = [row(f"g{i}", True, {"note_count": 40, "beat_sum": 1.0, "range_leap": 0.95}) for i in range(3)]
    bad = [row(f"b{i}", False, {"note_count": 6, "beat_sum": 0.3, "range_leap": 0.4}) for i in range(2)]
    r = calibrate.calibrate(good + bad, search=200)
    assert (r["samples"], r["good"], r["bad"], r["reliable"]) == (5, 3, 2, False)
    assert r["current"]["auc"] == 1.0
    assert r["current"]["grades"]["trust"] == {"good": 3, "bad": 0}
    assert r["current"]["grades"]["distrust"]["bad"] == 2
    assert "표본이 적습니다" in calibrate.to_text(r)


def test_weight_search_finds_the_item_that_actually_separates():
    """좋음 · 나쁨을 가르는 것이 range_leap 하나뿐인 세계 — 지금 가중치(beat_sum 0.3)보다 range_leap 을 키워야 갈린다."""
    import random

    rng = random.Random(1)
    rows = []
    for i in range(30):
        rows.append(row(f"g{i}", True, {"note_count": 40, "beat_sum": rng.uniform(0.2, 1.0), "range_leap": rng.uniform(0.75, 1.0)}))
        rows.append(row(f"b{i}", False, {"note_count": 40, "beat_sum": rng.uniform(0.2, 1.0), "range_leap": rng.uniform(0.4, 0.7)}))
    r = calibrate.calibrate(rows, search=600)
    assert r["reliable"] is True
    w = r["weights"]
    assert w["auc"] > r["current"]["auc"]
    assert w["suggested"]["range_leap"] > w["suggested"]["beat_sum"]
    assert abs(sum(w["suggested"].values()) - 1.0) < 0.01
    assert w["leave_one_out"]["auc_searched"] > w["leave_one_out"]["auc_current"]
    assert "새 자료에서도 나아 보입니다" in calibrate.to_text(r)


def test_weight_search_does_not_invent_improvement_from_noise():
    """항목 값이 좋고 나쁨과 관계없으면, 고른 가중치가 새 자료에서 나아지지 않는다고 말해야 한다."""
    import random

    rng = random.Random(2)
    rows = [row(f"x{i}", i % 2 == 0, {"note_count": 40, "beat_sum": rng.uniform(0.3, 1.0), "range_leap": rng.uniform(0.3, 1.0)})
            for i in range(40)]
    r = calibrate.calibrate(rows, search=300)
    loo = r["weights"]["leave_one_out"]
    assert loo["auc_searched"] < 0.65
    assert "나아진다고 볼 근거가 없습니다" in calibrate.to_text(r)


def test_calibrate_main_needs_report_first(tmp_path, capsys):
    (tmp_path / "r").mkdir()
    assert calibrate.main([str(tmp_path / "r")]) == 2
    assert "evalset.report" in capsys.readouterr().err


def test_calibrate_main_end_to_end(tmp_path, answers, capsys):
    write_run(tmp_path / "a", RUN_A)
    assert report.main([str(tmp_path / "a"), "--answers", str(answers)]) in (0, 1)
    capsys.readouterr()
    assert calibrate.main([str(tmp_path / "a"), "--json", str(tmp_path / "s.json")]) == 0
    out = capsys.readouterr().out
    assert "보정 표본 5건 — 좋음 1 · 나쁨 4" in out            # S01 좋음 · S02 · S04 · F03 · F04 나쁨
    assert json.loads((tmp_path / "s.json").read_text(encoding="utf-8"))["reliable"] is False
