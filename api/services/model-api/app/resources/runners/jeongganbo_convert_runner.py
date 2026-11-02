"""#30 정간보 변환 작업자.

구조에서의 위치: JeongganboEngine → 이 프로세스 → jeongganbo_convert·music21.
파일·DB 저장 없이 인코딩을 MusicXML/MIDI로 반환하며 시간 초과·취소 시 부모가 종료한다.
"""
import base64
import json
import sys

from app.engines.jeongganbo_convert import convert


def emit(data):
    print("@@RESULT@@ " + json.dumps(data, ensure_ascii=False), flush=True)


def main():
    emit({"ready": True})
    for line in sys.stdin:
        try:
            request = json.loads(line)
            xml, midi, ratio = convert(request["encoding"])
            emit({"ok": True, "musicxml": xml, "midi_base64": base64.b64encode(midi).decode("ascii"),
                  "yulmyeong_ratio": ratio})
        except Exception:
            emit({"ok": False, "code": "CONVERT_FAILED"})


if __name__ == "__main__":
    main()
