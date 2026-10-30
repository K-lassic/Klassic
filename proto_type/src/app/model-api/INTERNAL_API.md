# 모델 API 서버 내부 모듈 경계

두 작업자가 나눠 만든다. **파일 주인**을 지키고, 아래 함수 모양을 바꾸지 않는다(바꿔야 하면 이 문서를 먼저 고친다).
공통 약속은 `app/docs/INTERFACES.md`(값 이름·오류 형식·§6 엔드포인트·§6-1 제공자 규칙)를 따른다.

## 파일 주인

| 주인 | 파일 |
|---|---|
| **코어**(서버·등록부·추천·연주) | `app/main.py`, `app/config.py`, `app/db.py`, `app/errors.py`, `app/settings.py`, `app/auth/*`, `app/jobs/*`, `app/routers/*`(모든 라우터), `app/models/*`(등록부·상태·Ollama 클라이언트·불러오기), `app/recommend/*`, `app/fallback/*`, `app/services/*`(recognize 파이프라인 · join 쪽 이어 붙이기 — 2026-09-29 여러 쪽), `tests/contract/*`, `tests/integration/*` |
| **엔진**(인식·검사·렌더러) | `app/checks/*`, `app/engines/*`, `app/render/*`, `app/ops`가 아닌 `../ops/engines/*.sh`, `tests/unit/*`(엔진·검사·렌더러 단위 시험), `../evalset/FIRST_RUN.md` |

## 엔진 쪽이 내놓는 함수 (코어가 부른다)

```python
# app/checks/upload.py
@dataclass
class PageImage:                # 인식할 쪽 하나 (2026-09-29 여러 쪽)
    page_no: int                # 이어 붙이는 순서(1부터)
    file_no: int                # 올린 파일 번호(사진 올린 순서, PDF 는 1)
    source: str                 # 'file'(사진 한 장) | 'pdf_page'(PDF 의 한 쪽)
    short_edge_px: int | None
    image: bytes | None         # 인식에 넣을 그림(render_pdf=False 로 부른 PDF 는 None)
    suffix: str
@dataclass
class FileInfo:                 # 올린 파일 하나(upload_file 한 행)
    file_no: int; name: str; data: bytes; kind: str; short_edge_px: int | None; pdf_page_count: int | None = None
@dataclass
class UploadVerdict:
    ok: bool
    code: str | None            # shared/error-codes.json 코드 (UPLOAD_*)
    kind: str | None            # 'image' | 'pdf' | 'midi' | 'musicxml'
    short_edge_px: int | None   # 여러 쪽이면 쪽 중 가장 작은 짧은 변(PDF 는 render_dpi(300)로 바꾼 그림)
    details: dict               # PDF: pdf_page_count · render_dpi · (반려) reason 'encrypted'|'unreadable' · (여러 쪽 반려) page
    converted_png: bytes | None = None   # PDF 첫 쪽 PNG (예전 호환 — 쪽은 pages)
    pdf_page_count: int | None = None
    pages: list[PageImage] = []          # 2026-09-29 여러 쪽: 인식할 쪽(올린 순서)
    files: list[FileInfo] = []
def check_upload(files: list[tuple[str, bytes]], *, score_type: str | None, require_score_type: bool,
                 image_max_bytes: int | None = None, score_file_max_bytes: int | None = None,
                 min_short_edge_px: int | None = None,
                 allowed_kinds: tuple[str, ...] | None = None,
                 multi_page: bool = False, render_pdf: bool = True) -> UploadVerdict
    # 순서: count → type(magic, allowed_kinds 밖이면 반려) → 섞기 → corrupted/MusicXML 구조(PDF: 열기·암호·쪽수) → size → resolution(쪽마다)
    # 사용자 업로드는 allowed_kinds=user_upload_kinds()(사진·PDF, 2026-09-29), multi_page=True(2026-09-29 여러 쪽):
    #   한 요청 = 악보 한 곡 — PDF 한 개(모든 쪽) 또는 사진 여러 장(올린 순서), 최대 max_pages(10)쪽.
    #   11장·11쪽 이상 UPLOAD_TOO_MANY_PAGES, PDF 여러 개·PDF+사진 UPLOAD_TOO_MANY_FILES.
    # render_pdf=False 는 PDF 쪽을 그리지 않고 크기만 잰다(웹 검사 위임 /v1/internal/upload-check).
    # None 은 모든 종류(내부 입력 /v1/recommend·/v1/render/*, multi_page=False 라 파일 한 개)
def user_upload_kinds() -> tuple[str, ...]      # upload-rules.json user_upload_kinds

# app/checks/pdf.py (2026-09-29, pypdfium2 — Apache-2.0/BSD)
def open_pdf(data: bytes) -> PdfOpen             # ok · page_count · reason('encrypted'|'unreadable'|'no_pages')
def page_sizes(data: bytes, dpi: float = 300.0, limit: int | None = None) -> list[tuple[int, int]] | None  # 쪽마다 그릴 크기
def render_pages(data: bytes, dpi: float = 300.0, limit: int | None = None) -> list[PdfPage] | None       # 쪽마다 png · width · height · dpi
def render_first_page(data: bytes, dpi: float = 300.0) -> PdfPage | None   # 첫 쪽만(예전 규칙 — 지금은 render_pages)

# app/checks/structure.py
@dataclass
class StructureVerdict:
    verdict: str                # 'pass' | 'ambiguous' | 'fail'
    type_mismatch: bool
    detected_type: str | None   # 'staff' | 'jeongganbo' | None
    scores: dict                # {'staff': float, 'jeongganbo': float}
def check_structure(image_bytes: bytes, chosen_type: str, threshold: float | None) -> StructureVerdict

# app/checks/validity.py
@dataclass
class ValidityVerdict:
    grade: str                  # 'trust' | 'caution' | 'distrust'
    items: dict[str, float]     # note_count, beat_sum, range_leap, yulmyeong_ratio(정간보만), engine_confidence(있을 때)
    score: float                # 0..1 종합 점수 (경계와 비교한 값)
def check_validity(musicxml: str, score_type: str, *, engine_confidence: float | None,
                   caution_boundary: float | None, distrust_boundary: float | None,
                   yulmyeong_ratio: float | None = None) -> ValidityVerdict

# app/engines/base.py
@dataclass
class EngineResult:
    outcome: str                # success|error|timeout|stopped|no_notes|convert_failed  (engine_attempt.outcome)
    failure_code: str | None
    musicxml: str | None
    midi: bytes | None
    engine_name: str
    engine_version: str
    confidence: float | None
    duration_ms: int
    extra: dict                 # 정간보: {'yulmyeong_ratio': float, 'jg_convert_ms': int}
class EngineAdapter(Protocol):
    name: str                   # model_registry.model_name
    def probe(self) -> dict: ...                                # {'installed': bool, 'version': str|None, 'detail': str}
    async def warmup(self, timeout_s: float) -> None: ...       # 불러오기(가벼운 시험 실행). 실패하면 예외
    async def recognize(self, image_path: str, deadline_monotonic: float) -> EngineResult: ...
def build_adapter(model_row: dict) -> EngineAdapter              # app/engines/registry.py — model_registry 행(dict)으로 어댑터 생성

# app/engines/jeongganbo_convert.py
def convert(encoding: str) -> tuple[str, bytes, float]          # (musicxml, midi, yulmyeong_ratio) — 실패 시 ConvertError

# app/render/fluidsynth_mp3.py · app/render/pdf.py
class RenderError(Exception):  code: str                        # RENDER_FAILED | RENDER_TIMEOUT | RENDERER_MISSING
def render_mp3(midi: bytes, sf2_paths: list[str], timeout_s: float,
               part_fonts: list[str | None] | None = None,              # 성부 순서대로 'gugak'|'gm'|None — 음원 묶음별로 나눠 렌더링 후 섞음(T150, 2026-09-29)
               part_presets: list[tuple[int, int] | None] | None = None # 성부 순서대로 서비스 음원 소리 (bank, program) — 국악기 bank 1, 국악 타악 128:1 (C11, 2026-09-29)
               ) -> tuple[bytes, str, str]   # (mp3, renderer_name, version). sf2_paths 는 기본 음원만(사용자 .sf2 는 2026-09-29 US8 제거로 없음)
def render_pdf(musicxml: str, timeout_s: float) -> tuple[bytes, str, str]                      # MuseScore → 없으면 Verovio
def renderer_versions() -> list[dict]                            # /v1/versions 용
```

코어는 위 함수만 부르고, 엔진 쪽은 DB·HTTP 를 직접 다루지 않는다(순수 함수 + 하위 프로세스).
