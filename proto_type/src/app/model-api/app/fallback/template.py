"""모델 API 서버 보유 대체 템플릿 (T072, FR-041 · BR-FBK-02 · research R9).

fallback_template 에서 holder='api_server' 인 사용 중 행을 쓴다 — (2026-09-30 박예은 팀장 결정, UC_02 BR-FBK-09) 요청의 악보 종류에
맞는 행 가운데 무작위(오선보: 아리랑 세마치 · 미뉴에트, 정간보: 타령 가야금), 없으면 사용 중인 행 아무거나.
파일 위치(midi_uri·musicxml_uri)는 app/ 기준 상대 경로(assets/templates/*).
템플릿 파일이 없으면 TemplateMissing — 연주 요청은 '서비스 중단'(UC1 E7), 인식 응답은 파일 없이 대체 표시만 한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.config import APP_ROOT, Config
from app.db import Database


class TemplateMissing(RuntimeError):
    """대체 템플릿 행이나 파일이 없다."""


@dataclass
class Template:
    template_id: int
    name: str
    version: str | None
    musicxml: str
    midi: bytes


def _resolve(cfg: Config, uri: str) -> Path:
    path = Path(uri)
    if path.is_absolute():
        return path
    if uri.startswith("assets/"):
        return cfg.assets_dir / uri[len("assets/"):]
    return APP_ROOT / uri


async def template_row(db: Database, score_type: str | None = None) -> dict:
    row = await db.fetch_one(
        "SELECT template_id, name, version, midi_uri, musicxml_uri FROM fallback_template "
        "WHERE holder = 'api_server' AND is_active = TRUE ORDER BY (score_type <=> %s) DESC, RAND() LIMIT 1",
        (score_type,),
    )
    if row is None:
        raise TemplateMissing("api_server 대체 템플릿 행이 없습니다")
    return row


async def load_template(db: Database, cfg: Config, score_type: str | None = None) -> Template:
    row = await template_row(db, score_type)
    if not row.get("musicxml_uri"):
        raise TemplateMissing("대체 템플릿에 MusicXML 위치가 없습니다")
    xml_path, mid_path = _resolve(cfg, row["musicxml_uri"]), _resolve(cfg, row["midi_uri"])
    if not xml_path.is_file() or not mid_path.is_file():
        raise TemplateMissing(f"대체 템플릿 파일이 없습니다: {xml_path.name}, {mid_path.name}")
    return Template(
        template_id=int(row["template_id"]), name=row["name"], version=row.get("version"),
        musicxml=xml_path.read_text(encoding="utf-8"), midi=mid_path.read_bytes(),
    )


async def template_versions(db: Database | None) -> list[dict]:
    """/v1/versions 의 templates 목록."""
    if db is None:
        return []
    rows = await db.fetch_all(
        "SELECT template_id, name, version, midi_uri FROM fallback_template WHERE holder = 'api_server' AND is_active = TRUE"
    )
    return [{"id": Path(r["midi_uri"]).stem, "name": r["name"], "version": r.get("version")} for r in rows]
