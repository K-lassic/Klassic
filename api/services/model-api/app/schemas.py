"""응답 계약 (2026-09-30 API 점검 B1·B10 — 계약 model-api.openapi.yaml RecognitionResult 와 같은 필드).

엔드포인트에 response_model 로 묶어 **선언한 필드만** 나가게 한다. 여기 없는 값은 응답에서 빠진다.
필드를 더하거나 빼려면 계약 yaml 을 먼저 고친다(설계 우선).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class ModelState(BaseModel):
    name: str
    display_name: str
    kind: str
    provider: str
    provider_ref: str | None
    enabled: bool
    installed: bool
    version: str | None
    state: Literal["unavailable", "cold", "loading", "ready", "failed"]
    loaded_at: str | None
    last_load_ms: int | None
    expected_seconds: float | None
    load_started_at: str | None
    elapsed_seconds: int | None
    error: str | None


class EngineInfo(BaseModel):
    name: str | None = None
    version: str | None = None
    tried: list[dict[str, Any]] = []


class PageEngine(BaseModel):
    name: str | None = None
    version: str | None = None


class PageSummary(BaseModel):
    page_no: int
    file_no: int
    source: str
    short_edge_px: int | None = None
    outcome: Literal["converted", "failed"]
    fallback_reason: str | None = None
    fallback_message: str | None = None
    structure_verdict: str | None = None
    validity_grade: str | None = None
    engine: PageEngine | None = None


class RecognitionResult(BaseModel):
    api_version: str
    request_no: str
    fallback: bool
    fallback_reason: str | None = None
    fallback_message: str | None = None
    retry_hint: str | None = None
    structure_verdict: str | None = None
    type_mismatch: bool = False
    detected_type: str | None = None
    validity_grade: str | None = None
    validity_items: dict[str, float | None] = {}
    musicxml: str | None = None
    midi_base64: str | None = None
    midi_available: bool = False  # MIDI 를 만들었는가(실패하면 MusicXML 만 — 2026-09-30)
    engine: EngineInfo
    timings_ms: dict[str, int | None] = {}
    page_count: int
    converted_pages: int
    pages: list[PageSummary] = []
    notice: dict[str, Any] | None = None
    file_kind: str | None = None
    pdf_page_count: int | None = None
    short_edge_px: int | None = None
    service_down: bool | None = None


class PerformancePage(BaseModel):
    """#32 처리 중 쪽도 포함하는 외부 상태 계약."""
    page_no: int
    file_no: int
    source: str
    outcome: str
    fallback_reason: str | None
    fallback_message: str | None
    structure_verdict: str | None
    validity_grade: str | None
    engine: PageEngine | None


class PerformanceStatus(BaseModel):
    api_version: Literal["v1"]
    id: str
    status: Literal["received", "queued", "converting", "rendering", "completed", "completed_fallback", "service_down", "expired"]
    status_label: str
    route: str
    file_kind: str
    score_type: Literal["staff", "jeongganbo"] | None
    created_at: str | None
    completed_at: str | None
    expires_at: str | None
    remaining_seconds: int
    pdf_page_count: int | None
    page_count: int
    pages: list[PerformancePage]
    notice: dict[str, Any] | None


class PerformanceFiles(BaseModel):
    musicxml: str | None
    midi: str | None
    mp3: str | None


class PerformanceResult(PerformanceStatus):
    fallback: bool
    fallback_reason: str | None
    fallback_message: str | None
    retry_hint: str | None
    structure_verdict: str | None
    type_mismatch: bool
    detected_type: str | None
    validity_grade: str | None
    validity_items: dict[str, float | None] | None
    files: PerformanceFiles
    mp3_withheld: bool
    mp3_withheld_reason: str | None
    mp3_withheld_message: str | None
    render_failure: str | None
    renderer: PageEngine | None
    recommend_failed: bool
    original_instruments_unavailable: bool
    instrument_mode: str
    transpose_semitones: int
    volume: float
    engine: PageEngine | None
    files_expire_in_seconds: int


class InstrumentItem(BaseModel):
    code: str
    name: str
    is_gugak: bool
    is_percussion: bool
    range_low: int | None
    range_high: int | None


class InstrumentsResponse(BaseModel):
    api_version: Literal["v1"]
    items: list[InstrumentItem]


class SharedScoreItem(BaseModel):
    share_no: str
    title: str
    score_type: Literal['staff', 'jeongganbo']
    likes: int
    example: bool
    shared_at: str | None


class SharedScoresResponse(BaseModel):
    api_version: Literal['v1']
    sort: Literal['likes', 'recent']
    has_more: bool
    items: list[SharedScoreItem]


class SharedScoreResponse(BaseModel):
    api_version: Literal['v1']
    share_no: str
    title: str
    score_type: Literal['staff', 'jeongganbo']
    musicxml: str
