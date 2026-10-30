"""응답 계약 (2026-09-30 API 점검 B1·B10 — 계약 model-api.openapi.yaml RecognitionResult 와 같은 필드).

엔드포인트에 response_model 로 묶어 **선언한 필드만** 나가게 한다. 여기 없는 값은 응답에서 빠진다.
필드를 더하거나 빼려면 계약 yaml 을 먼저 고친다(설계 우선).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


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
