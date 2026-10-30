"""쪽 이어 붙이기 (2026-09-29 여러 쪽 — services/join.py · SD_01 1.12a · BR-FBK-08)."""

import xml.etree.ElementTree as ET

from app.services.join import join_musicxml


def _score(parts: list[list[str]], divisions: int = 1, beats: int = 4) -> str:
    """parts: 성부마다 마디별 음 이름(한 마디 = 온음표 하나)."""
    plist = "".join(f'<score-part id="P{i + 1}"><part-name>p{i + 1}</part-name></score-part>' for i in range(len(parts)))
    body = ""
    for i, measures in enumerate(parts):
        ms = ""
        for k, step in enumerate(measures, start=1):
            attrs = (f"<attributes><divisions>{divisions}</divisions><time><beats>{beats}</beats>"
                     "<beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>"
                     if k == 1 else "")
            ms += (f'<measure number="{k}">{attrs}<note><pitch><step>{step}</step><octave>4</octave></pitch>'
                   f"<duration>{divisions * beats}</duration><type>whole</type></note></measure>")
        body += f'<part id="P{i + 1}">{ms}</part>'
    return f'<?xml version="1.0"?><score-partwise version="4.0"><part-list>{plist}</part-list>{body}</score-partwise>'


def _steps(xml: str) -> list[list[str]]:
    root = ET.fromstring(xml.split("\n", 2)[-1])
    out = []
    for part in root.findall("part"):
        row = []
        for m in part.findall("measure"):
            n = m.find("note")
            row.append("R" if n.find("rest") is not None else n.findtext("pitch/step"))
        out.append(row)
    return out


def test_single_page_is_returned_as_is() -> None:
    xml = _score([["C", "D"]])
    assert join_musicxml([xml]) == xml


def test_pages_joined_in_order_and_renumbered() -> None:
    joined = join_musicxml([_score([["C", "D"]]), _score([["E"]]), _score([["F", "G"]])])
    assert _steps(joined) == [["C", "D", "E", "F", "G"]]
    root = ET.fromstring(joined.split("\n", 2)[-1])
    assert [m.get("number") for m in root.find("part").findall("measure")] == ["1", "2", "3", "4", "5"]


def test_missing_part_filled_with_rests() -> None:
    # 1쪽은 성부 1개, 2쪽은 2개 → 결과는 2성부, 1쪽 자리의 둘째 성부는 쉼표 마디
    joined = join_musicxml([_score([["C", "D"]]), _score([["E"], ["A"]])])
    assert _steps(joined) == [["C", "D", "E"], ["R", "R", "A"]]
    root = ET.fromstring(joined.split("\n", 2)[-1])
    assert len(root.find("part-list").findall("score-part")) == 2
    # 쉼표 마디 길이는 그 쪽 마디 길이와 같다(divisions 를 함께 적는다)
    rest = root.findall("part")[1].find("measure")
    assert rest.findtext("attributes/divisions") == "1" and rest.findtext("note/duration") == "4"


def test_shorter_part_in_page_padded() -> None:
    # 한 쪽 안에서 성부마다 마디 수가 다르면 가장 긴 성부에 맞춰 쉼표로 채운다
    joined = join_musicxml([_score([["C", "D"], ["E"]], divisions=2), _score([["F"], ["G"]], divisions=2)])
    assert _steps(joined) == [["C", "D", "F"], ["E", "R", "G"]]
    root = ET.fromstring(joined.split("\n", 2)[-1])
    pad = root.findall("part")[1].findall("measure")[1]
    assert pad.findtext("note/duration") == "8" and pad.findtext("attributes/divisions") == "2"
