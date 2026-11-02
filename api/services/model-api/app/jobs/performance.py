"""#32 구조에서의 위치: 외부 연주 접수 → 이 작업 → 기존 인식·렌더링 작업자와 결과 DB.

접수 후 비동기로 인식·대체·악기 배정·MP3를 수행한다. 결과와 상대 파일 위치를 저장한다.
종료·실패는 service_down으로 마감하며 작업자를 정리한다. 웹 채널 데이터는 변경하지 않는다.
"""
import asyncio
import base64
from dataclasses import asdict, dataclass, field
import json
import logging
from pathlib import Path
import time

from app.db import utcnow
from app.errors import ApiError
from app.fallback.template import TemplateMissing, load_template
from app.jobs.limiter import QueueTimeout
from app.jobs.performance_storage import _default_ensemble_id, _derived, placed_ensemble_id
from app.services.arrange import Assignment
from app.services.recognize import PageInput, RecognizeInput, run_recognition
from app.services.requests import complete_api_request, request_dir, set_status, storage_uri
from app.settings import Settings

log = logging.getLogger("model-api.performance")


@dataclass
class PerformanceJob:
    request_id: int
    request_no: str
    channel: str
    file_kind: str
    score_type: str | None
    data: bytes
    original_path: Path
    assignment: Assignment
    explicit_ensemble_id: int | None
    transpose: int
    volume: float
    settings: Settings
    deadline_mono: float
    pages: list[PageInput] = field(default_factory=list)


class PerformanceRunner:
    def __init__(self, app):
        self.app = app
        self.tasks = {}

    def submit(self, job):
        task = asyncio.create_task(self._run(job), name=f"perf-{job.request_no}")
        self.tasks[job.request_no] = task
        task.add_done_callback(lambda _task: self.tasks.pop(job.request_no, None))

    async def shutdown(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _run(self, job):
        try:
            await run_performance(self.app.state, job)
        except asyncio.CancelledError:
            await _finish_failed(self.app.state.db, job)
            raise
        except Exception as exc:
            # 예외 문자열은 파일 경로·비밀값이 섞일 수 있어 남기지 않는다.
            log.error("performance_failed request_no=%s error_type=%s", job.request_no, type(exc).__name__)
            await _finish_failed(self.app.state.db, job)


async def _finish_failed(db, job):
    try:
        await db.execute(
            "UPDATE score_request SET route = 'fallback', fallback_reason = COALESCE(fallback_reason, 'recognition_failed'), "
            "status = 'service_down' WHERE request_id = %s AND status NOT IN ('completed','service_down')",
            (job.request_id,))
        await db.execute(
            "UPDATE derived_file SET render_status = 'failed', failure_reason = 'RENDER_FAILED', "
            "render_finished_at = %s WHERE request_id = %s AND render_status IN ('queued','rendering')",
            (utcnow(), job.request_id))
    except Exception as exc:
        log.error("performance_finalize_failed request_no=%s error_type=%s", job.request_no, type(exc).__name__)


async def run_performance(state, job):
    db, cfg = state.db, state.config
    folder = request_dir(cfg, job.request_no)
    await set_status(db, job.request_id, "converting")
    outcome = await run_recognition(db, state.limiter, state.registry, RecognizeInput(
        request_id=job.request_id, request_no=job.request_no, score_type=job.score_type,
        pages=job.pages, is_web=False, deadline_mono=job.deadline_mono, settings=job.settings,
        page_timeout_s=job.settings.timeout_seconds))
    template_id = None
    base_xml, base_midi = outcome.musicxml, outcome.midi
    if outcome.fallback:
        try:
            template = await load_template(db, cfg, job.score_type)
        except TemplateMissing:
            await complete_api_request(db, cfg, request_id=job.request_id, request_no=job.request_no,
                fallback_reason=outcome.fallback_reason, musicxml=None, midi=None, template_id=None,
                origin="fallback", final_status="service_down")
            return
        base_xml, base_midi, template_id = template.musicxml, template.midi, template.template_id
    await complete_api_request(db, cfg, request_id=job.request_id, request_no=job.request_no,
        fallback_reason=outcome.fallback_reason, musicxml=base_xml, midi=base_midi, template_id=template_id,
        origin="fallback" if outcome.fallback else "recognized", final_status="keep")

    # 사진·PDF에는 원래 악기 정보가 없으므로 original은 기준판처럼 기본 구성으로 대체한다.
    assignment = job.assignment if job.assignment.mode != "original" else Assignment()
    deadline = time.monotonic() + cfg.render_timeout_s
    async with state.limiter.slot("render", job.channel, deadline):
        prepared = await state.render_pool.prepare(base_xml.encode(), asdict(assignment), job.transpose, job.volume, deadline)
    ensemble_id = (job.explicit_ensemble_id if job.assignment.mode == "custom" else await _default_ensemble_id(db))
    ensemble_id = await placed_ensemble_id(db, ensemble_id, prepared["used"])
    if ensemble_id is not None:
        await db.execute("INSERT INTO instrument_selection (request_id, ensemble_id, source) VALUES (%s,%s,'api_option')",
                         (job.request_id, ensemble_id))
    xml_path, midi_path = folder / "performance.musicxml", folder / "performance.mid"
    await asyncio.to_thread(xml_path.write_text, prepared["musicxml"], encoding="utf-8")
    await _derived(db, job.request_id, "musicxml", ensemble_id=ensemble_id, status="ready",
                   path_uri=storage_uri(cfg, xml_path))
    if prepared["midi_base64"] is not None:
        await asyncio.to_thread(midi_path.write_bytes, base64.b64decode(prepared["midi_base64"], validate=True))
        await _derived(db, job.request_id, "midi", ensemble_id=ensemble_id, status="ready",
                       path_uri=storage_uri(cfg, midi_path))

    await set_status(db, job.request_id, "rendering")
    file_id = await _derived(db, job.request_id, "mp3", ensemble_id=ensemble_id, status="queued")
    started = utcnow()
    try:
        if prepared["midi_base64"] is None:
            raise ApiError("RENDER_FAILED")
        deadline = time.monotonic() + cfg.render_timeout_s
        async with state.limiter.slot("render", job.channel, deadline):
            await db.execute("UPDATE derived_file SET render_status = 'rendering', render_started_at = %s WHERE file_id = %s",
                             (started, file_id))
            result = await state.render_pool.render_prepared(prepared, deadline)
        path = folder / "performance.mp3"
        await asyncio.to_thread(path.write_bytes, result.data)
        await db.execute(
            "UPDATE derived_file SET render_status = 'ready', renderer_name = %s, renderer_version = %s, "
            "render_finished_at = %s, storage_uri = %s WHERE file_id = %s",
            (result.name[:40], result.version[:40], utcnow(), storage_uri(cfg, path), file_id))
        log.info("performance_render_complete request_no=%s timings_ms=%s", job.request_no,
                 json.dumps(prepared["timings_ms"] | result.timings, sort_keys=True))
    except (ApiError, QueueTimeout) as exc:
        code = "RENDER_TIMEOUT" if isinstance(exc, QueueTimeout) else exc.code
        await _render_failed(db, file_id, code, started)
    except Exception:
        await _render_failed(db, file_id, "RENDER_FAILED", started)
    await db.execute(
        "UPDATE score_request SET status = 'completed', completed_at = %s WHERE request_id = %s "
        "AND status NOT IN ('completed','service_down')", (utcnow(), job.request_id))


async def _render_failed(db, file_id, code, started):
    await db.execute(
        "UPDATE derived_file SET render_status = 'failed', failure_reason = %s, render_started_at = COALESCE(render_started_at, %s), "
        "render_finished_at = %s WHERE file_id = %s", (code, started, utcnow(), file_id))
