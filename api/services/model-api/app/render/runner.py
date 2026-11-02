"""#31 구조에서의 위치: RenderPool → 이 프로세스 → 악기 배정·MP3/PDF 렌더러.

중간 파일은 /tmp에서 생성·정리한다. API 응답 파일은 메모리로 반환하며 DB·영속 저장은 하지 않는다.
"""
import base64
import json
import sys
import time

from app.catalog import load_errors
from app.config import load_config
from app.errors import ApiError, CATALOG
from app.render.errors import RenderError
from app.services import scoreio
from app.services.arrange import Assignment, arrange, render_fonts, render_presets


def render_job(request):
    at = time.monotonic()
    timings = {}
    data = base64.b64decode(request["score_base64"], validate=True)
    kind, deadline = request["kind"], request["deadline"]
    try:
        doc = scoreio.load_score(data)
        if kind == "mp3":
            assignment = Assignment(**request["assignment"])
            arrange(doc, assignment=assignment, codes=None, transpose=0, volume=1)
            fonts = render_fonts(doc)
            presets = render_presets(doc, fonts)
            midi = scoreio.to_midi(doc)
            timings["midi"] = round((time.monotonic() - at) * 1000)
        else:
            # 원래 MusicXML의 편집·음악 기호는 재직렬화하지 않고 보존한다.
            xml = data.decode("utf-8") if not data.startswith((b"MThd", b"PK\x03\x04")) else scoreio.to_musicxml(doc)
            timings["score_prepare"] = round((time.monotonic() - at) * 1000)
    except Exception as exc:
        raise ApiError("UPLOAD_CORRUPTED") from exc
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise RenderError("RENDER_TIMEOUT")
    if kind == "mp3":
        from app.render.fluidsynth_mp3 import render_mp3
        result, name, version = render_mp3(midi, [], remaining, part_fonts=fonts, part_presets=presets, timings=timings)
    else:
        from app.render.pdf import render_pdf
        tick = time.monotonic()
        result, name, version = render_pdf(xml, remaining)
        timings["pdf"] = round((time.monotonic() - tick) * 1000)
    timings["worker_total"] = round((time.monotonic() - at) * 1000)
    return {"ok": True, "data_base64": base64.b64encode(result).decode("ascii"), "name": name,
            "version": version, "timings_ms": timings}


def emit(data):
    print("@@RESULT@@ " + json.dumps(data, ensure_ascii=False), flush=True)


def main():
    cfg = load_config()
    CATALOG.set(load_errors(cfg.shared_dir))
    emit({"ready": True})
    for line in sys.stdin:
        try:
            emit(render_job(json.loads(line)))
        except (ApiError, RenderError) as exc:
            emit({"ok": False, "code": exc.code})
        except Exception:
            emit({"ok": False, "code": "RENDER_FAILED"})


if __name__ == "__main__":
    main()
