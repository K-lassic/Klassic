// MP3·PDF 렌더링 대기열 (tasks T126, FR-032·FR-033): 렌더링 동시 상한(max_concurrency_render) 안에서 모델 API 서버에 맡긴다.
// 실패해도 화면 연주와 MIDI·MusicXML 받기는 계속된다.
import { exec, one, query } from '../db/pool.js';
import { currentSettings } from '../config/settings.js';
import { modelBinary, ModelApiDown, blobOf } from './modelApiClient.js';
import { saveFile } from './storage.js';
import { logger } from '../lib/logger.js';
import type { ScoreDoc } from '@gugak/score-core';
import type { Instruments } from '../config/shared.js';

export interface RenderJob {
  fileId: number; requestId: number; requestNo: string; format: 'mp3' | 'pdf';
  score: Uint8Array | string;
  /** MP3 만: 모델 API 에 넘길 InstrumentAssignment(JSON). 없으면 모델 API 가 기본 국악기 구성으로 덮어쓴다 */
  instruments?: string;
}

/**
 * 웹 MP3: 편집 반영 악보의 성부별 악기 → 모델 API custom 지정(성부 번호 = ScoreDoc 성부 순서).
 * 악기 목록에 있는 악기는 그대로, 원래 악기('original:N')는 예전처럼 기본 구성(선율 가야금 · 타악 장구)으로 둔다.
 * 음원은 모델 API 가 악기 목록의 soundfont(gugak.sf2 · FluidR3_GM.sf2)대로 성부마다 고른다(T150).
 */
export function mp3Instruments(doc: ScoreDoc, catalog: Instruments): string {
  const known = new Set(catalog.instruments.map((i) => i.code));
  const byRole = (role: string) => catalog.default_ensemble.find((e) => e.part_role === role)?.instrument;
  const tracks = doc.parts.map((p, i) => {
    const instrument = known.has(p.instrument) ? p.instrument : (byRole(p.isPercussion ? 'percussion' : 'melody') ?? 'gayageum');
    return { part: i, instrument };
  });
  return JSON.stringify({ mode: 'custom', tracks });
}

const pending: RenderJob[] = [];
let active = 0;

export function enqueueRender(job: RenderJob): void {
  pending.push(job);
  void pumpRender();
}

async function pumpRender(): Promise<void> {
  const s = await currentSettings();
  while (active < Math.max(1, s.max_concurrency_render) && pending.length > 0) {
    const job = pending.shift()!;
    active++;
    runRender(job)
      .catch((e) => logger.error({ err: e, fileId: job.fileId }, 'render crashed'))
      .finally(() => { active--; void pumpRender(); });
  }
}

async function fail(fileId: number, reason: string): Promise<void> {
  await exec(
    `UPDATE derived_file SET render_status = 'failed', failure_reason = ?, render_finished_at = CURRENT_TIMESTAMP(3)
      WHERE file_id = ? AND render_status IN ('queued','rendering')`, [reason, fileId]);
}

async function runRender(job: RenderJob): Promise<void> {
  await exec("UPDATE derived_file SET render_status = 'rendering', render_started_at = CURRENT_TIMESTAMP(3) WHERE file_id = ?", [job.fileId]);
  const form = new FormData();
  if (job.format === 'mp3') form.set('score', blobOf(job.score, 'audio/midi'), 'score.mid');
  else form.set('score', blobOf(job.score, 'application/vnd.recordare.musicxml+xml'), 'score.musicxml');
  if (job.format === 'mp3' && job.instruments) form.set('instruments', job.instruments);
  try {
    const out = await modelBinary(`/v1/render/${job.format}`, form, { timeoutMs: 10 * 60_000 });
    if (out.json) { await fail(job.fileId, 'RENDER_FAILED'); return; }
    const [name, version] = (out.headers.get('x-renderer') ?? `${job.format === 'mp3' ? 'fluidsynth' : 'renderer'} unknown`).split(/\s+/, 2);
    const uri = await saveFile(`${job.requestNo}/exports/${job.fileId}.${job.format}`, out.data);
    await exec(
      `UPDATE derived_file SET render_status = 'ready', storage_uri = ?, renderer_name = ?, renderer_version = ?,
              render_finished_at = CURRENT_TIMESTAMP(3) WHERE file_id = ?`, [uri, name.slice(0, 40), (version ?? 'unknown').slice(0, 40), job.fileId]);
  } catch (e) {
    if (!(e instanceof ModelApiDown)) throw e;
    const code = (e.body as { error?: { code?: string } })?.error?.code;
    await fail(job.fileId, e.reason === 'http' ? (code ?? 'RENDER_FAILED') : 'ENGINE_DOWN');
  }
}

/** 서버가 다시 켜졌을 때 남은 렌더링 작업은 실패로 돌린다(사용자가 [다시 시도]) */
export async function recoverRenders(): Promise<void> {
  const rows = await query<{ file_id: number }>("SELECT file_id FROM derived_file WHERE render_status IN ('queued','rendering')");
  for (const r of rows) await fail(r.file_id, 'RENDER_FAILED');
}

export async function queuePosition(fileId: number): Promise<number | null> {
  const r = await one<{ queue_position: number }>('SELECT queue_position FROM v_render_queue_position WHERE file_id = ?', [fileId]);
  return r?.queue_position ?? null;
}
