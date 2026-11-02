"""MusicXML → MIDI 변환 작업자 (2026-09-30 조성기 — 모델 API 멈춤 원인, SD_04 §8-1 「MIDI 안전 변환」).

모델 API 가상환경의 파이썬으로 따로 띄운다. 모델 API 는 이 프로세스에 시간 제한을 걸고, 넘기면 끝낸다(engines/worker.py).

    python -B midi_runner.py --serve
      music21 을 올린 뒤 `@@RESULT@@ {"ready": true}` 를 찍고,
      표준 입력 한 줄 {"xml": "<MusicXML 파일>", "out": "<MIDI 쓸 곳>", "no_repeats": false} 마다
      `@@RESULT@@ {"ok": true}` 또는 {"ok": false, "error": ...} 를 찍는다.

no_repeats=true 면 반복 기호(repeat)를 일반 마디줄로 바꾼 뒤 변환한다 — 엔진이 짝이 맞지 않는 반복 기호를 내면
music21 의 반복 펼치기(expandRepeats)가 끝나지 않기 때문이다(2026-09-30 11:54·14:04 멈춤).
"""

import json
import sys

MARK = "@@RESULT@@ "


def emit(obj: dict) -> None:
    sys.stdout.write("\n" + MARK + json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def convert(xml_path: str, out_path: str, no_repeats: bool) -> None:
    from music21 import bar, converter
    from music21.midi.translate import streamToMidiFile

    with open(xml_path, encoding="utf-8") as f:
        score = converter.parseData(f.read(), format="musicxml")
    if no_repeats:
        for rep in list(score.recurse().getElementsByClass(bar.Repeat)):
            rep.activeSite.replace(rep, bar.Barline("regular"))
    data = bytes(streamToMidiFile(score).writestr())
    with open(out_path, "wb") as f:
        f.write(data)


def main() -> int:
    try:
        import music21  # noqa: F401 — 미리 올리기
        from music21.midi.translate import streamToMidiFile  # noqa: F401
    # 올리기 실패는 결과 JSON 으로 알린다
    except Exception as e:  # noqa: BLE001
        emit({"ready": False, "error": f"{type(e).__name__}: {e}"})
        return 2
    emit({"ready": True})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            convert(req["xml"], req["out"], bool(req.get("no_repeats")))
            emit({"ok": True})
        # music21 이 내는 예외는 무엇이든 결과 JSON 으로(작업자는 계속 돈다)
        except Exception as e:  # noqa: BLE001
            emit({"ok": False, "error": f"{type(e).__name__}: {e}"[:300]})
    return 0


if __name__ == "__main__":
    sys.exit(main())
