"""API 요청 행(score_request channel 'api')과 파일 저장 (D-18: API 요청은 모델 API 서버가 쓴다).

웹 요청(channel 'web')의 score_request·score_result·upload_file 은 웹 서비스가 쓰므로 여기서 건드리지 않는다.
파일은 STORAGE_DIR/api/<request_no>/ 에 두고 24시간 뒤 jobs/purge.py 가 지운다.
"""

from __future__ import annotations

import secrets
from datetime import datetime
from pathlib import Path

import pymysql

from app.config import Config
from app.db import Database, utcnow

_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 0 O 1 I 제외(INTERFACES §1)

DB_TO_CODE = {
    "recognition_failed": "RECOGNITION_FAILED",
    "timeout": "TIMEOUT",
    "engine_stopped": "ENGINE_DOWN",
    "no_structure": "NO_SCORE_STRUCTURE",
    "distrust": "UNTRUSTED_RESULT",
    "user_request": "USER_REQUEST",
}


def new_request_no(now: datetime | None = None) -> str:
    """R-MMDD-XXXXXXXX (웹 서비스 lib/ids.ts 와 같은 UTC 날짜·글자판)."""
    now = now or utcnow()
    code = "".join(secrets.choice(_ALPHA) for _ in range(8))
    return f"R-{now.month:02d}{now.day:02d}-{code}"


def request_dir(cfg: Config, request_no: str) -> Path:
    path = cfg.api_storage / request_no
    path.mkdir(parents=True, exist_ok=True)
    return path


def storage_uri(cfg: Config, path: Path) -> str:
    """DB 에는 STORAGE_DIR 기준 상대 위치를 적는다."""
    try:
        return str(path.relative_to(cfg.storage_dir))
    except ValueError:
        return str(path)


def resolve_uri(cfg: Config, uri: str) -> Path:
    path = Path(uri)
    return path if path.is_absolute() else cfg.storage_dir / uri


async def create_api_request(db: Database, cfg: Config, *, key_id: int, setting_version_id: int, file_kind: str,
                             score_type: str | None, original_name: str, data: bytes,
                             short_edge_px: int | None, status: str = "received", image_data: bytes | None = None,
                             pdf_page_count: int | None = None, files: list | None = None,
                             pages: list | None = None) -> tuple[int, str, list[Path]]:
    """score_request(api) + upload_file 을 만들고 원본을 저장한다. (request_id, request_no, 쪽마다 인식할 그림 경로).

    2026-09-29 여러 쪽(황송해 결정): files(services.uploads.UploadedFile 목록, 올린 순서)가 있으면 파일마다
    upload_file 한 행(file_no 1~10)을 쓰고 original{n}.<확장자> 로 둔다. PDF 는 original.pdf 하나(file_no 1)와
    쪽마다 page{n}.png 를 둔다. pages(services.uploads.UploadPage 목록)의 순서대로 인식할 그림 경로를 돌려준다.
    pdf_converted_page 는 더 쓰지 않는다(쪽은 request_page). files 가 없으면 예전처럼 파일 한 개(data).
    """
    is_picture = file_kind in ("image", "pdf")
    route = "recognize" if is_picture else "direct"
    default_ext = {"image": ".png", "pdf": ".pdf", "midi": ".mid", "musicxml": ".musicxml"}[file_kind]
    if files:
        items = [(f.file_no, f.name, f.data, f.short_edge_px) for f in files]
    else:
        items = [(1, original_name, data, short_edge_px)]
    for _ in range(5):
        request_no = new_request_no()
        folder = request_dir(cfg, request_no)
        written: list[Path] = []
        stored: list[tuple[int, str, int, int | None, Path]] = []
        for file_no, name, blob, edge in items:
            suffix = Path(name).suffix.lower() or default_ext
            path = folder / (f"original{suffix}" if len(items) == 1 else f"original{file_no}{suffix}")
            path.write_bytes(blob)
            written.append(path)
            stored.append((file_no, name, len(blob), edge, path))
        picture_paths: list[Path] = []
        if pages:
            for pg in pages:
                if file_kind == "pdf" or pg.source == "pdf_page":
                    path = folder / f"page{pg.page_no}.png"
                    path.write_bytes(pg.image or b"")
                    written.append(path)
                    picture_paths.append(path)
                else:
                    picture_paths.append(next(s[4] for s in stored if s[0] == pg.file_no))
        elif file_kind == "pdf" and image_data is not None:
            path = folder / "page1.png"
            path.write_bytes(image_data)
            written.append(path)
            picture_paths.append(path)
        else:
            picture_paths.append(stored[0][4])
        try:
            async with db.transaction() as cur:
                await cur.execute(
                    "INSERT INTO score_request (request_no, channel, access_key_id, file_kind, chosen_score_type, route, "
                    "status, setting_version_id, received_at) VALUES (%s,'api',%s,%s,%s,%s,%s,%s,%s)",
                    (request_no, key_id, file_kind, score_type if is_picture else None, route, status,
                     setting_version_id, utcnow()),
                )
                request_id = int(cur.lastrowid)
                is_pdf = file_kind == "pdf" and pdf_page_count is not None
                for file_no, name, size, edge, path in stored:
                    await cur.execute(
                        "INSERT INTO upload_file (request_id, file_no, original_name, size_bytes, image_short_side_px, "
                        "pdf_page_count, storage_uri) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                        (request_id, file_no, name[:255] or path.name, size,
                         edge if is_picture else None, pdf_page_count if is_pdf else None, storage_uri(cfg, path)),
                    )
            return request_id, request_no, picture_paths
        except pymysql.err.IntegrityError as exc:
            for path in written:
                path.unlink(missing_ok=True)
            if "uq_request_no" not in str(exc):
                raise
    raise RuntimeError("요청 번호를 만들지 못했습니다")


async def find_web_request(db: Database, request_no: str) -> dict | None:
    return await db.fetch_one(
        "SELECT request_id, request_no, channel, received_at FROM score_request WHERE request_no = %s AND channel = 'web'",
        (request_no,),
    )


async def set_status(db: Database, request_id: int, status: str) -> None:
    """끝 상태(완료·서비스 중단)가 아니면 상태를 바꾼다(trg_request_terminal)."""
    await db.execute(
        "UPDATE score_request SET status = %s WHERE request_id = %s AND status NOT IN ('completed','service_down')",
        (status, request_id),
    )


async def stage(db: Database, request_id: int, code: str, started: datetime, ended: datetime | None,
                page_no: int = 0) -> None:
    """stage_timing 한 줄(다시 돌면 덮어쓴다). 쪽 단계(structure·jg_convert·validity)는 page_no(1~), 요청 단계는 0."""
    await db.execute(
        "INSERT INTO stage_timing (request_id, stage_code, page_no, started_at, ended_at) VALUES (%s,%s,%s,%s,%s) "
        "ON DUPLICATE KEY UPDATE started_at = VALUES(started_at), ended_at = VALUES(ended_at)",
        (request_id, code, page_no, started, max(ended, started) if ended else None),
    )


async def complete_api_request(db: Database, cfg: Config, *, request_id: int, request_no: str,
                               fallback_reason: str | None, musicxml: str | None, midi: bytes | None,
                               template_id: int | None, origin: str, original_ensemble_id: int | None = None,
                               final_status: str = "completed") -> None:
    """API 요청을 끝낸다: score_result(출처별) + score_request 경로·상태. 대체는 api_server 템플릿(BR-FBK-02)."""
    folder = request_dir(cfg, request_no)
    xml_uri = mid_uri = None
    if musicxml is not None:
        # MIDI 변환에 실패했으면 MusicXML 만 저장한다(midi_uri 비움 — 2026-09-30, 마이그레이션 014)
        (folder / "result.musicxml").write_text(musicxml, encoding="utf-8")
        xml_uri = storage_uri(cfg, folder / "result.musicxml")
        if midi is not None:
            (folder / "result.mid").write_bytes(midi)
            mid_uri = storage_uri(cfg, folder / "result.mid")
    async with db.transaction() as cur:
        if fallback_reason:
            await cur.execute(
                "UPDATE score_request SET route = 'fallback', fallback_reason = %s WHERE request_id = %s",
                (fallback_reason, request_id),
            )
        if xml_uri:
            await cur.execute(
                "INSERT INTO score_result (request_id, origin, musicxml_uri, midi_uri, fallback_template_id, "
                "original_ensemble_id) VALUES (%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE "
                "musicxml_uri = VALUES(musicxml_uri), midi_uri = VALUES(midi_uri), deleted_at = NULL",
                (request_id, origin, xml_uri, mid_uri, template_id if origin == "fallback" else None,
                 original_ensemble_id if origin == "direct" else None),
            )
        if final_status == "completed":
            await cur.execute(
                "UPDATE score_request SET status = 'completed', completed_at = %s WHERE request_id = %s "
                "AND status NOT IN ('completed','service_down')",
                (utcnow(), request_id),
            )
        elif final_status == "service_down":
            await cur.execute(
                "UPDATE score_request SET status = 'service_down' WHERE request_id = %s "
                "AND status NOT IN ('completed','service_down')",
                (request_id,),
            )
