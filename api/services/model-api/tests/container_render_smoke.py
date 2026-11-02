"""#31 격리 DB·실제 HTTP에서 MP3/PDF와 다운로드 완료 시간을 확인한다.

렌더링 결과는 /tmp/issue31-review에만 남겨 청감·PDF 시각 검토에 사용한다.
시험용 키·운영자만 정리하고 기존 요청·라이선스 정책은 바꾸지 않는다.
"""
import asyncio
import hashlib
import io
import json
from pathlib import Path
import secrets
import subprocess
import time
import urllib.error
import urllib.request
import uuid
import wave
import zipfile

import numpy as np
import pypdfium2 as pdfium

from app.config import load_config
from app.db import Database
from app.resources.startup import worker_environment
from app.services import scoreio


def post(kind, data, key, assignment=None, filename="score.musicxml"):
    boundary = "render" + uuid.uuid4().hex
    body = [f'--{boundary}\r\nContent-Disposition: form-data; name="score"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode(), data, b"\r\n"]
    if assignment is not None:
        body.append(f'--{boundary}\r\nContent-Disposition: form-data; name="instruments"\r\n\r\n{json.dumps(assignment)}\r\n'.encode())
    body.append(f"--{boundary}--\r\n".encode())
    headers = {"Content-Type": "multipart/form-data; boundary=" + boundary}
    if key:
        headers["X-API-Key"] = key
    started = time.monotonic()
    try:
        response = urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:9543/v1/render/{kind}",
            data=b"".join(body), headers=headers), timeout=150)
    except urllib.error.HTTPError as exc:
        response = exc
    ready = time.monotonic()
    with response:
        payload = response.read()
        assert response.headers.get("X-Request-ID")
        return response.status, {key.lower(): value for key, value in response.headers.items()}, payload, {
            "headers_ready_ms": round((ready - started) * 1000),
            "download_complete_ms": round((time.monotonic() - started) * 1000)}


async def counts(db):
    return {name: int((await db.fetch_one(f"SELECT COUNT(*) AS n FROM {name}"))["n"])
            for name in ("score_request", "request_page", "processing_job", "engine_attempt", "validity_check_item")}


async def main():
    cfg = load_config()
    if cfg.db_name != "klassic_issue24":
        raise RuntimeError("격리된 klassic_issue24 시험 DB에서만 실행하십시오")
    db = await Database.connect(cfg)
    operator, keys = None, []
    folder = Path("/tmp/issue31-review")
    folder.mkdir(exist_ok=True)
    report = {}
    try:
        before = await counts(db)
        operator = await db.execute("INSERT INTO operator_account(login_id,password_hash,display_name,disabled_at) "
            "VALUES(%s,'disabled-test-only','렌더링 시험',UTC_TIMESTAMP(3))", ("render_" + uuid.uuid4().hex[:16],))
        raw_keys = {}
        for kind in ("service", "external"):
            raw = secrets.token_urlsafe(32)
            keys.append(await db.execute("INSERT INTO access_key(key_kind,key_hash,key_prefix,application_no,call_limit_per_hour,issued_by) "
                        "VALUES(%s,%s,%s,%s,%s,%s)", (kind, hashlib.sha256(raw.encode()).hexdigest(), raw[:8],
                        "A-" + uuid.uuid4().hex[:16] if kind == "external" else None,
                        100 if kind == "external" else None, operator if kind == "service" else None)))
            raw_keys[kind] = raw
        xml = (cfg.assets_dir / "templates/arirang-semachi-v1.musicxml").read_bytes()
        # 음원 비교는 같은 선율 한 성부로 통일한다. GM 시험에 원래 장구 성부가 남지 않게 한다.
        melody = scoreio.load_score(xml)
        for part in list(melody.parts)[1:]:
            melody.remove(part)
        melody_xml = scoreio.to_musicxml(melody).encode("utf-8")
        percussion = scoreio.load_score(xml)
        for part in list(percussion.parts):
            if not scoreio.is_percussion_part(part):
                percussion.remove(part)
        from music21 import tempo
        if not list(percussion.recurse().getElementsByClass(tempo.MetronomeMark)):
            percussion.parts[0].insert(0, tempo.MetronomeMark(number=100))
        percussion_xml = scoreio.to_musicxml(percussion).encode("utf-8")
        for label, assignment in (("default", None), ("gm", {"mode": "custom", "tracks": [{"part": 0, "instrument": "piano"}]}),
            ("mixed", {"mode": "custom", "tracks": [{"part": 0, "instrument": "gayageum"}, {"part": 1, "instrument": "piano"}]}),
            ("default-with-janggu", None), ("janggu-only", None)):
            source = xml if label == "default-with-janggu" else percussion_xml if label == "janggu-only" else melody_xml
            status, headers, data, timing = await asyncio.to_thread(post, "mp3", source, raw_keys["service"], assignment)
            assert status == 200, (label, status, data[:150])
            assert headers["content-type"] == "audio/mpeg" and "fluidsynth" in headers["x-renderer"]
            assert data.startswith(b"ID3") or data[:2] in (b"\xff\xfb", b"\xff\xfa", b"\xff\xf3")
            mp3, wav = folder / f"{label}.mp3", folder / f"{label}.wav"
            mp3.write_bytes(data)
            subprocess.run(["lame", "--quiet", "--decode", str(mp3), str(wav)], check=True,
                           timeout=30, capture_output=True, env=worker_environment())
            with wave.open(str(wav)) as audio:
                seconds = audio.getnframes() / audio.getframerate()
                samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float64)
            rms = round(float(np.sqrt(np.mean(samples ** 2))), 1)
            assert seconds > 1 and rms > 1, (label, seconds, rms)
            wav.unlink()
            report[label] = timing | {"bytes": len(data), "audio_seconds": round(seconds, 2), "rms": rms,
                                      "sha256": hashlib.sha256(data).hexdigest()}
        assert report["default"]["sha256"] != report["gm"]["sha256"]
        assert report["mixed"]["sha256"] not in (report["default"]["sha256"], report["gm"]["sha256"])
        assert report["default-with-janggu"]["sha256"] != report["default"]["sha256"]

        # PDF에는 한글 제목·악기 이름과 음악 기호가 들어 있는 원본을 넣는다.
        status, headers, data, timing = await asyncio.to_thread(post, "pdf", xml, raw_keys["service"])
        assert status == 200 and headers["content-type"] == "application/pdf", (status, data[:150])
        assert data.startswith(b"%PDF-") and "verovio" in headers["x-renderer"]
        (folder / "score.pdf").write_bytes(data)
        with pdfium.PdfDocument(data) as doc:
            pages = len(doc)
            text = ""
            for page in doc:
                tp = page.get_textpage()
                try:
                    text += tp.get_text_range()
                finally:
                    tp.close()
                    page.close()
        assert pages >= 1 and "아리랑" in text and "\u25a0" not in text
        report["pdf"] = timing | {"bytes": len(data), "pages": pages, "korean_text": True}

        from music21 import note, stream
        part = stream.Part()
        part.partName = "가야금"
        for i in range(800):
            part.append(note.Note(60 + (i * 5) % 17, quarterLength=.5))
        multi = stream.Score()
        multi.insert(0, part)
        status, _, data, _ = await asyncio.to_thread(post, "pdf", scoreio.to_musicxml(multi).encode(), raw_keys["service"])
        assert status == 200 and data.startswith(b"%PDF-")
        with pdfium.PdfDocument(data) as doc:
            assert len(doc) >= 2
            report["multi_page_pdf"] = len(doc)
        (folder / "score-multipage.pdf").write_bytes(data)

        midi = scoreio.to_midi(scoreio.load_score(xml))
        status, _, data, _ = await asyncio.to_thread(post, "pdf", midi, raw_keys["service"], None, "score.mid")
        assert status == 200 and data.startswith(b"%PDF-"), (status, data[:150])
        report["midi_input"] = True
        packed = io.BytesIO()
        with zipfile.ZipFile(packed, "w") as archive:
            archive.writestr("score.musicxml", xml)
            archive.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>')
        status, _, data, _ = await asyncio.to_thread(post, "pdf", packed.getvalue(), raw_keys["service"], None, "score.mxl")
        assert status == 200 and data.startswith(b"%PDF-")
        report["mxl_input"] = True
        status, headers, data, _ = await asyncio.to_thread(post, "mp3", xml, raw_keys["external"])
        policy = await db.fetch_one("SELECT api_mp3_allowed FROM v_mp3_license")
        assert status == 200
        if not policy or not policy["api_mp3_allowed"]:
            assert json.loads(data)["mp3_withheld"] is True and "x-renderer" not in headers
            report["external_policy"] = "withheld"
        else:
            assert headers["content-type"] == "audio/mpeg"
            report["external_policy"] = "allowed"
        assert await counts(db) == before
        report["request_and_job_rows_unchanged"] = True
        (folder / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    finally:
        for key_id in keys:
            await db.execute("DELETE FROM api_call_log WHERE access_key_id=%s", (key_id,))
            await db.execute("DELETE FROM access_key WHERE key_id=%s", (key_id,))
        if operator:
            await db.execute("DELETE FROM operator_account WHERE operator_id=%s", (operator,))
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
