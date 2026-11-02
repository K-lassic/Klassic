"""인식 결과의 파싱·병합·MIDI 변환에 필요한 악보 입출력만 제공한다."""
import tempfile
from pathlib import Path


def load_score(data: bytes):
    from music21 import converter
    suffix = ".mid" if data.startswith(b"MThd") else ".musicxml"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as stream:
        stream.write(data)
        path = Path(stream.name)
    try:
        return converter.parse(str(path), format="midi" if suffix == ".mid" else "musicxml")
    finally:
        path.unlink(missing_ok=True)


def to_musicxml(score):
    from music21.musicxml.m21ToXml import GeneralObjectExporter
    return GeneralObjectExporter(score).parse().decode("utf-8")


def count_notes(score):
    return sum(1 for _ in score.flatten().notes)
