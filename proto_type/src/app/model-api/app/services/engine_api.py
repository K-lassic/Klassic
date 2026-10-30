"""엔진 쪽 함수(INTERNAL_API.md) 를 부르는 한 곳.

엔진 작업자가 만드는 app/checks·app/engines·app/render 를 **부를 때 가져온다**(lazy import).
- 아직 없거나 가져오기에 실패하면 EngineModuleMissing → 호출한 쪽이 알맞은 상태(설치 안 됨·렌더러 없음)로 바꾼다.
- 시험은 이 모듈의 함수를 바꿔 끼운다(monkeypatch).
"""

from __future__ import annotations

import importlib
from typing import Any

RENDER_CODES = ("RENDER_FAILED", "RENDER_TIMEOUT", "RENDERER_MISSING")


class EngineModuleMissing(RuntimeError):
    """엔진 쪽 모듈이 아직 없다."""


def _load(module: str, name: str) -> Any:
    try:
        return getattr(importlib.import_module(module), name)
    except (ImportError, AttributeError) as exc:
        raise EngineModuleMissing(f"{module}.{name}: {exc}") from exc


def check_upload(files: list[tuple[str, bytes]], **kwargs: Any) -> Any:
    return _load("app.checks.upload", "check_upload")(files, **kwargs)


def check_structure(image_bytes: bytes, chosen_type: str, threshold: float | None) -> Any:
    return _load("app.checks.structure", "check_structure")(image_bytes, chosen_type, threshold)


def check_validity(musicxml: str, score_type: str, **kwargs: Any) -> Any:
    return _load("app.checks.validity", "check_validity")(musicxml, score_type, **kwargs)


def build_adapter(model_row: dict) -> Any:
    return _load("app.engines.registry", "build_adapter")(model_row)


def render_mp3(midi: bytes, sf2_paths: list[str], timeout_s: float,
               part_fonts: list[str | None] | None = None,
               part_presets: list[tuple[int, int] | None] | None = None) -> tuple[bytes, str, str]:
    """part_fonts: 성부(악보 순서)별 음원 — 'gugak' | 'gm' | .sf2 경로 | None(기본 겹침). T150
    part_presets: 성부별 서비스 음원 소리 번호 (bank, program) | None(GM 번호 그대로) — 결정 C11"""
    fn = _load("app.render.fluidsynth_mp3", "render_mp3")
    kwargs: dict[str, Any] = {}
    if part_fonts and any(part_fonts):
        kwargs["part_fonts"] = part_fonts
    if part_presets and any(part_presets):
        kwargs["part_presets"] = part_presets
    return fn(midi, sf2_paths, timeout_s, **kwargs)


def render_pdf(musicxml: str, timeout_s: float) -> tuple[bytes, str, str]:
    return _load("app.render.pdf", "render_pdf")(musicxml, timeout_s)


def renderer_versions() -> list[dict]:
    # INTERNAL_API.md 는 두 렌더러 파일을 함께 적어 두었다 — 있는 곳에서 가져온다
    for module in ("app.render", "app.render.pdf", "app.render.fluidsynth_mp3"):
        try:
            return _load(module, "renderer_versions")()
        except EngineModuleMissing:
            continue
    raise EngineModuleMissing("app.render.*.renderer_versions")


def render_error_code(exc: BaseException) -> str | None:
    """RenderError(code 속성)면 그 코드를, 렌더러 모듈이 없으면 RENDERER_MISSING 을 돌려준다."""
    if isinstance(exc, EngineModuleMissing):
        return "RENDERER_MISSING"
    code = getattr(exc, "code", None)
    return code if code in RENDER_CODES else None
