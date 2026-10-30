"""업로드 파일 검사 (T032, research R8, SC-015).

웹 서비스(TS)와 같은 `shared/upload-rules.json` 을 읽고, 같은 순서·같은 사유 코드로 판정한다.
순서: count → type(확장자 + 파일 앞머리 magic) → corrupted(열어 보기 / MusicXML 구조) → size → resolution.
악보 종류(score_type)는 파일 자체 검사를 모두 통과한 뒤 마지막에 본다(사진·PDF일 때).
판정 기준 파일은 `shared/fixtures/upload/expected.json` 이다(사용자 업로드 기준 — allowed_kinds = user_upload_kinds).

2026-09-29 황송해 결정(사진·PDF 입력):
- 사용자 업로드(/v1/performances · /v1/omr/* · 웹 검사 위임)는 allowed_kinds=user_upload_kinds(image·pdf)로 부른다.
  종류가 목록 밖이면(MIDI·MusicXML) type 단계에서 UPLOAD_UNSUPPORTED_TYPE. allowed_kinds=None 은 모든 종류(내부 입력용).
- PDF: 파일 머리 %PDF → 열기(손상·암호면 UPLOAD_CORRUPTED) → 20MB → ~~첫 쪽을~~ 모든 쪽을 render_dpi(300)로 PNG 변환 →
  사진 크기(650px)는 쪽마다 그 그림에.

2026-09-30 황송해 결정(119번 작은 사진 자동 확대): 반려 기준(min_short_edge_px)은 300px. 짧은 변이
  upscale_below_short_edge_px(650)보다 작은 쪽은 반려하지 않고 upscale_to_short_edge_px(1000)로 늘린 PNG 사본(Pillow LANCZOS)을
  인식용 그림(pages[].image)으로 쓴다. 원본 파일(files[].data)은 그대로. 늘린 쪽은 pages[].upscaled_short_side_px 에 적는다.

2026-09-29 황송해 결정(여러 쪽): 사용자 업로드(multi_page=True)는 한 요청 = 악보 한 곡 —
  PDF 한 개(모든 쪽) 또는 사진 여러 장(올린 순서), 최대 max_pages(10)쪽.
  순서: count(파일 수 > 10 → UPLOAD_TOO_MANY_PAGES) → type(파일마다) → 섞기(PDF 둘 이상 · PDF+사진 → UPLOAD_TOO_MANY_FILES)
        → corrupted(파일마다, PDF 는 열고 쪽수 > 10 이면 UPLOAD_TOO_MANY_PAGES) → size(파일마다) → resolution(쪽마다) → 악보 종류.
  쪽마다의 반려에는 details.page(몇 쪽인지)를 붙인다(여러 쪽일 때). 통과하면 verdict.pages(쪽마다 그림)·verdict.files.
  내부 입력(/v1/recommend · /v1/render/*, multi_page=False)은 예전처럼 파일 한 개(둘 이상이면 UPLOAD_TOO_MANY_FILES).
"""

from __future__ import annotations

import io
import json
import os
import zipfile
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

# app/model-api/app/checks/upload.py → parents[3] = app/
_DEFAULT_SHARED = Path(__file__).resolve().parents[3] / "shared"


@dataclass
class PageImage:
    """인식할 쪽 하나(2026-09-29 여러 쪽). 사진은 그 파일, PDF 는 쪽을 바꾼 PNG."""

    page_no: int  # 이어 붙이는 순서(1부터)
    file_no: int  # 올린 파일 번호(사진 올린 순서, PDF 는 1)
    source: str  # 'file' | 'pdf_page'
    short_edge_px: int | None
    image: bytes | None  # 인식에 넣을 그림(render_pdf=False 로 부른 PDF 는 None)
    suffix: str  # 임시 파일 확장자
    upscaled_short_side_px: int | None = None  # 작은 쪽을 늘려 읽으면 늘린 짧은 변(2026-09-30 119번)


@dataclass
class FileInfo:
    file_no: int
    name: str
    data: bytes
    kind: str
    short_edge_px: int | None  # 사진은 그 사진, PDF 는 쪽 중 가장 작은 짧은 변
    pdf_page_count: int | None = None


@dataclass
class UploadVerdict:
    ok: bool
    code: str | None  # shared/error-codes.json 코드 (UPLOAD_*)
    kind: str | None  # 'image' | 'pdf' | 'midi' | 'musicxml'
    short_edge_px: int | None  # 여러 쪽이면 쪽 중 가장 작은 짧은 변(PDF 는 변환한 그림)
    details: dict = field(default_factory=dict)
    converted_png: bytes | None = None  # PDF 첫 쪽을 바꾼 PNG(예전 호환 — 쪽은 pages)
    pdf_page_count: int | None = None
    pages: list[PageImage] = field(default_factory=list)
    files: list[FileInfo] = field(default_factory=list)


def shared_dir() -> Path:
    return Path(os.environ.get("GUGAK_SHARED_DIR", str(_DEFAULT_SHARED)))


@lru_cache(maxsize=1)
def load_rules() -> dict[str, Any]:
    """업로드 규칙 원본. 두 언어가 같은 파일을 읽는다."""
    with open(shared_dir() / "upload-rules.json", encoding="utf-8") as f:
        return json.load(f)


def user_upload_kinds() -> tuple[str, ...]:
    """사용자가 올리는 파일로 받는 종류(사진·PDF, 2026-09-29). 웹·연주 API·/v1/omr 같다."""
    return tuple(load_rules()["user_upload_kinds"])


def _fail(code_key: str, kind: str | None = None, short_edge: int | None = None, **details: Any) -> UploadVerdict:
    rules = load_rules()
    return UploadVerdict(ok=False, code=rules["codes"][code_key], kind=kind, short_edge_px=short_edge, details=details)


# ── type: 확장자로 종류를 정하고, 앞머리(magic)가 그 종류의 형식 중 하나와 맞아야 한다 ──────────────
def _ext(filename: str) -> str:
    return os.path.splitext(filename.lower())[1]


def _kind_for_ext(ext: str) -> str | None:
    for kind, spec in load_rules()["kinds"].items():
        if ext in spec["extensions"]:
            return kind
    return None


def _sniff_text(data: bytes, limit: int = 65536) -> str:
    head = data[:limit]
    if head.startswith((b"\xff\xfe", b"\xfe\xff")):
        return head.decode("utf-16", errors="ignore")
    return head.decode("utf-8", errors="ignore")


def _magic_format(kind: str, data: bytes) -> str | None:
    """종류 규칙의 magic 목록 중 맞는 형식 이름(png/jpeg/webp/midi/mxl/xml). 없으면 None."""
    for m in load_rules()["kinds"][kind]["magic"]:
        if "hex_prefix" in m:
            prefix = bytes.fromhex(m["hex_prefix"])
            if not data.startswith(prefix):
                continue
            if "hex_at_8" in m and data[8 : 8 + len(m["hex_at_8"]) // 2] != bytes.fromhex(m["hex_at_8"]):
                continue
            return m["format"]
        if "text_contains_any" in m:
            text = _sniff_text(data)
            if any(t in text for t in m["text_contains_any"]):
                return m["format"]
    return None


# ── corrupted: 실제로 열어 본다 ─────────────────────────────────────────────────────────────
def _upscale(data: bytes, target: int) -> tuple[bytes, int] | None:
    """짧은 변을 target 으로 늘린 PNG(LANCZOS, 평가셋 P01~P20 과 같은 방법). 실패하면 None(원본 그대로 인식)."""
    from PIL import Image

    try:
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            w, h = im.size
            scale = target / min(w, h)
            if scale <= 1:
                return None
            src = im if im.mode in ("RGB", "L") else im.convert("RGB")
            out = src.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
            buf = io.BytesIO()
            out.save(buf, format="PNG")
            return buf.getvalue(), min(out.size)
    except Exception:  # noqa: BLE001
        return None


def _maybe_upscale(pg: PageImage, spec: dict) -> None:
    """짧은 변이 upscale_below 보다 작으면 인식용 그림을 upscale_to 로 늘린다(119번)."""
    below = spec.get("upscale_below_short_edge_px")
    target = spec.get("upscale_to_short_edge_px")
    if not below or not target or pg.image is None or pg.short_edge_px is None or pg.short_edge_px >= below:
        return
    up = _upscale(pg.image, int(target))
    if up is None:
        return
    pg.image, pg.upscaled_short_side_px = up
    pg.suffix = ".png"


def _open_image(data: bytes) -> tuple[int, int] | None:
    """끝까지 풀어 본다(잘린 파일도 잡는다). 성공하면 (가로, 세로)."""
    from PIL import Image

    try:
        with Image.open(io.BytesIO(data)) as im:
            im.verify()  # 구조·CRC
        with Image.open(io.BytesIO(data)) as im:
            im.load()  # 픽셀까지 풀기
            return int(im.width), int(im.height)
    # Pillow 는 형식마다 다른 예외를 던진다 — 무엇이든 '열 수 없음'
    except Exception:  # noqa: BLE001
        return None


def _open_midi(data: bytes) -> bool:
    import mido

    try:
        mid = mido.MidiFile(file=io.BytesIO(data))
        return len(mid.tracks) >= 1
    # mido 의 여러 예외 모두 '손상'
    except Exception:  # noqa: BLE001
        return False


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _read_mxl(data: bytes) -> bytes | None:
    """압축 MusicXML(.mxl)에서 본문 XML 을 꺼낸다. 압축이 깨졌으면 None."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        names = zf.namelist()
        root_path = None
        if "META-INF/container.xml" in names:
            cont = ET.fromstring(zf.read("META-INF/container.xml"))
            for el in cont.iter():
                if _local(el.tag) == "rootfile" and el.get("full-path"):
                    root_path = el.get("full-path")
                    break
        if root_path is None:
            cands = [n for n in names if n.lower().endswith((".xml", ".musicxml")) and not n.startswith("META-INF/")]
            root_path = cands[0] if cands else None
        if root_path is None or root_path not in names:
            return b""  # 압축은 열리지만 악보 본문이 없음 → 구조 불가
        return zf.read(root_path)
    except (zipfile.BadZipFile, ET.ParseError, KeyError, OSError, EOFError):
        return None


def musicxml_structure(xml_bytes: bytes) -> dict[str, int] | None:
    """파트·마디·음표(쉼표 포함) 개수. XML 이 아니면 None. (BR-UPL-05)"""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return None
    rtag = _local(root.tag)
    if rtag not in ("score-partwise", "score-timewise"):
        return {"parts": 0, "measures": 0, "notes": 0}
    parts = measures = notes = 0
    if rtag == "score-partwise":
        for part in root:
            if _local(part.tag) != "part":
                continue
            parts += 1
            for m in part:
                if _local(m.tag) == "measure":
                    measures += 1
                    notes += sum(1 for n in m.iter() if _local(n.tag) == "note")
    else:  # timewise: measure 안에 part
        part_ids: set[str] = set()
        for m in root:
            if _local(m.tag) != "measure":
                continue
            measures += 1
            for part in m:
                if _local(part.tag) == "part":
                    part_ids.add(part.get("id", str(len(part_ids))))
                    notes += sum(1 for n in part.iter() if _local(n.tag) == "note")
        parts = len(part_ids)
    return {"parts": parts, "measures": measures, "notes": notes}


def _limit_for(kind: str, spec: dict, image_max_bytes: int | None, score_file_max_bytes: int | None) -> int:
    if kind in ("image", "pdf"):
        return image_max_bytes if image_max_bytes is not None else spec["max_bytes"]
    return score_file_max_bytes if score_file_max_bytes is not None else spec["max_bytes"]


def _type_of(filename: str, data: bytes, allowed_kinds) -> tuple[str | None, str | None, dict]:
    """(종류, 형식, 반려 details). 종류가 None 이면 형식 반려."""
    ext = _ext(filename or "")
    kind = _kind_for_ext(ext)
    if kind is None:
        return None, None, {"ext": ext}
    if allowed_kinds is not None and kind not in allowed_kinds:
        return None, None, {"ext": ext, "kind": kind, "allowed": list(allowed_kinds)}
    fmt = _magic_format(kind, data)
    if fmt is None:
        return None, None, {"ext": ext, "reason": "content_mismatch"}
    return kind, fmt, {}


def check_upload(
    files: list[tuple[str, bytes]],
    *,
    score_type: str | None,
    require_score_type: bool,
    image_max_bytes: int | None = None,
    score_file_max_bytes: int | None = None,
    min_short_edge_px: int | None = None,
    allowed_kinds: tuple[str, ...] | list[str] | None = None,
    multi_page: bool = False,
    render_pdf: bool = True,
) -> UploadVerdict:
    """업로드 한 건 검사. 숫자 상한 인자가 있으면(처리 설정) 규칙 파일 값보다 우선한다.

    allowed_kinds: 이 창구가 받는 종류. 목록 밖 종류는 type 단계에서 반려(UPLOAD_UNSUPPORTED_TYPE).
    multi_page: 사용자 업로드(2026-09-29 여러 쪽) — PDF 한 개 또는 사진 여러 장, 최대 max_pages 쪽.
    render_pdf: False 면 PDF 쪽을 그리지 않고 크기만 잰다(웹 검사 위임 — 요청을 만들지 않는 검사).
    """
    rules = load_rules()
    max_pages = int(rules.get("max_pages", 10))

    # 1) count — 파일이 없으면 요청 형식 오류(BAD_REQUEST)로 돌려준다
    if len(files) == 0:
        return UploadVerdict(ok=False, code="BAD_REQUEST", kind=None, short_edge_px=None, details={"reason": "no_file"})
    if not multi_page and len(files) > 1:
        return _fail("mix", count=len(files), max_files=1)
    if len(files) > max_pages:
        return _fail("count", count=len(files), max_pages=max_pages)
    many = len(files) > 1

    def where(i: int) -> dict:
        return {"page": i} if many else {}

    # 2) type — 파일마다
    kinds: list[tuple[str, str]] = []
    for i, (filename, data) in enumerate(files, start=1):
        kind, fmt, why = _type_of(filename, data, allowed_kinds)
        if kind is None:
            return _fail("type", **why, **where(i))
        kinds.append((kind, fmt))
    #    섞기: PDF 는 한 개만, PDF 와 사진을 섞지 않는다(UC3 E5)
    if many and any(k == "pdf" for k, _ in kinds):
        return _fail("mix", count=len(files), pdf_count=sum(1 for k, _ in kinds if k == "pdf"))
    if many and len({k for k, _ in kinds}) > 1:
        return _fail("mix", count=len(files), kinds=sorted({k for k, _ in kinds}))
    kind = kinds[0][0]
    spec = rules["kinds"][kind]

    # 3) corrupted / MusicXML 구조 — 파일마다
    details: dict[str, Any] = {"format": kinds[0][1], "bytes": len(files[0][1])}
    sizes: list[tuple[int, int] | None] = []
    page_count: int | None = None
    for i, (filename, data) in enumerate(files, start=1):
        fmt = kinds[i - 1][1]
        if kind == "pdf":
            from app.checks.pdf import open_pdf

            opened = open_pdf(data)
            if not opened.ok:
                return _fail("corrupted", kind=kind, format=fmt, reason=opened.reason)
            page_count = opened.page_count
            details["pdf_page_count"] = page_count
            if multi_page and page_count > max_pages:
                return _fail("count", kind=kind, pdf_page_count=page_count, max_pages=max_pages)
            sizes.append(None)
        elif kind == "image":
            wh = _open_image(data)
            if wh is None:
                return _fail("corrupted", kind=kind, format=fmt, **where(i))
            sizes.append(wh)
            if not many:
                details.update(width=wh[0], height=wh[1])
        elif kind == "midi":
            if not _open_midi(data):
                return _fail("corrupted", kind=kind, format=fmt)
            sizes.append(None)
        else:  # musicxml
            xml = _read_mxl(data) if fmt == "mxl" else data
            if xml is None:
                return _fail("corrupted", kind=kind, format=fmt)
            struct = musicxml_structure(xml)
            need = spec.get("structure", {})
            if (
                struct is None
                or struct["parts"] < need.get("min_parts", 1)
                or struct["measures"] < need.get("min_measures", 1)
                or (need.get("requires_note_or_rest", True) and struct["notes"] < 1)
            ):
                return _fail("musicxml_structure", kind=kind, format=fmt, structure=struct)
            details["structure"] = struct
            sizes.append(None)

    # 4) size — 파일마다(사진은 장마다, PDF 는 파일 하나)
    limit = _limit_for(kind, spec, image_max_bytes, score_file_max_bytes)
    for i, (_filename, data) in enumerate(files, start=1):
        if len(data) > limit:
            wh = sizes[i - 1]
            return _fail("size", kind=kind, short_edge=min(wh) if wh else None, bytes=len(data), limit=limit,
                         **where(i))

    # 5) resolution — 사진은 그대로, PDF 는 쪽마다 render_dpi 로 바꾼 그림에(그리기 전에 크기로 판정)
    min_edge = min_short_edge_px if min_short_edge_px is not None else spec.get("min_short_edge_px")
    pages: list[PageImage] = []
    if kind == "pdf":
        from app.checks.pdf import page_sizes

        data = files[0][1]
        dpi = float(spec.get("render_dpi", 300))
        # 내부 입력(multi_page=False)은 예전처럼 첫 쪽만 본다
        limit_pages = None if multi_page else 1
        psizes = page_sizes(data, dpi, limit=limit_pages)
        if not psizes:
            return _fail("corrupted", kind=kind, format=kinds[0][1], reason="render_failed")
        details.update(width=psizes[0][0], height=psizes[0][1], render_dpi=round(dpi, 1))
        many_pages = len(psizes) > 1
        for n, (w, h) in enumerate(psizes, start=1):
            edge = min(w, h)
            if min_edge is not None and edge < min_edge:
                extra = {"page": n} if many_pages else {}
                return _fail("resolution", kind=kind, short_edge=edge, short_edge_px=edge, min=min_edge,
                             actual_short_edge_px=edge, min_short_edge_px=min_edge, **extra)
            pages.append(PageImage(page_no=n, file_no=1, source="pdf_page", short_edge_px=edge, image=None,
                                   suffix=".png"))
        if render_pdf:
            from app.checks.pdf import render_pages

            rendered = render_pages(data, dpi, limit=limit_pages)
            if rendered is None or len(rendered) != len(pages):
                return _fail("corrupted", kind=kind, format=kinds[0][1], reason="render_failed")
            for pg, r in zip(pages, rendered, strict=True):
                pg.image = r.png
                _maybe_upscale(pg, spec)
    elif kind == "image":
        for i, (filename, data) in enumerate(files, start=1):
            w, h = sizes[i - 1]  # type: ignore[misc]
            edge = min(w, h)
            if min_edge is not None and edge < min_edge:
                return _fail("resolution", kind=kind, short_edge=edge, short_edge_px=edge, min=min_edge,
                             actual_short_edge_px=edge, min_short_edge_px=min_edge, **where(i))
            pages.append(PageImage(page_no=i, file_no=i, source="file", short_edge_px=edge, image=data,
                                   suffix=_ext(filename or "") or ".png"))
            _maybe_upscale(pages[-1], spec)

    short_edge = min((p.short_edge_px for p in pages if p.short_edge_px is not None), default=None)

    # 악보 종류 — 사진·PDF일 때 필요(요청 하나에 하나)
    if (
        kind in ("image", "pdf")
        and require_score_type
        and spec.get("requires_score_type", True)
        and score_type not in rules["score_types"]
    ):
        return _fail("score_type", kind=kind, short_edge=short_edge, score_type=score_type)

    if len(pages) > 1:
        details["page_count"] = len(pages)
    infos = [FileInfo(file_no=i, name=filename, data=data, kind=kind,
                      short_edge_px=(min(sizes[i - 1]) if sizes[i - 1] else short_edge) if kind in ("image", "pdf")
                      else None,
                      pdf_page_count=page_count if kind == "pdf" else None)
             for i, (filename, data) in enumerate(files, start=1)]
    return UploadVerdict(ok=True, code=None, kind=kind, short_edge_px=short_edge, details=details,
                         converted_png=pages[0].image if kind == "pdf" and pages else None,
                         pdf_page_count=page_count if kind == "pdf" else None, pages=pages, files=infos)
