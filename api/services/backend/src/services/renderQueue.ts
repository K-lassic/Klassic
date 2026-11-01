// #36 MP3 · PDF 렌더링 대기열 — 렌더링 동시 상한(max_concurrency_render) 안에서 model-api 에 맡긴다.
//
//   구조에서의 위치: exports.ts → 이 파일 → model-api /v1/render/{mp3,pdf} → 볼륨 storage/<요청 번호>/exports/ · DB derived_file.
//     인식 작업자와 달리 재시작하면 이어서 하지 않고 실패로 돌린다 — 악보 내용이 메모리에만 있고, 사용자가 [다시 시도]하면 된다.
//   v0.1.1 services/renderQueue.ts 에서 달라진 점: 실패 이유는 계약의 값만 내보낸다 · 시간 초과는 ENGINE_DOWN 이 아니라 RENDER_TIMEOUT.
import type { ScoreDoc } from '@gugak/score-core';
import { exec, one, query } from '../db/pool.js';
import { currentSettings } from '../config/settings.js';
import { shared } from '../config/shared.js';
import { blobOf, modelBinary, ModelApiDown } from './modelApiClient.js';
import { saveFile } from './storage.js';
import { logger } from '../lib/logger.js';

export interface RenderJob {
  fileId: number; requestNo: string; format: 'mp3' | 'pdf';
  score: Uint8Array | string;
  /** MP3 만: model-api 에 넘길 악기 지정(JSON). 없으면 기본 국악기 구성으로 덮어쓴다 */
  instruments?: string;
}

/** 렌더링은 곡 길이에 따라 오래 걸릴 수 있다 */
const RENDER_TIMEOUT_MS = 10 * 60_000;
/** web-api.yaml ExportTask.failure_reason 에 있는 값 */
const FAILURE_REASONS = new Set(['RENDER_FAILED', 'RENDER_TIMEOUT', 'RENDERER_MISSING', 'ENGINE_DOWN']);

/**
 * 웹 MP3: 편집 반영 악보의 성부별 악기 → model-api custom 지정(성부 번호 = ScoreDoc 성부 순서).
 * 악기 목록에 있는 악기는 그대로, 원래 악기('original:N')는 기본 구성(선율 가야금 · 타악 장구)으로 둔다.
 */
export function mp3Instruments(doc: ScoreDoc): string {
  const { instruments } = shared();
  const known = new Set(instruments.instruments.map((i) => i.code));
  const byRole = (role: string) => instruments.default_ensemble.find((e) => e.part_role === role)?.instrument;
  const tracks = doc.parts.map((p, i) => ({
    part: i,
    instrument: known.has(p.instrument) ? p.instrument : (byRole(p.isPercussion ? 'percussion' : 'melody') ?? 'gayageum'),
  }));
  return JSON.stringify({ mode: 'custom', tracks });
}

const pending: RenderJob[] = [];
let active = 0;

export function enqueueRender(job: RenderJob): void {
  pending.push(job);
  pumpRender();
}

function pumpRender(): void {
  void (async () => {
    const s = await currentSettings();
    while (active < Math.max(1, s.max_concurrency_render) && pending.length > 0) {
      const job = pending.shift()!;
      active++;
      runRender(job)
        .catch(async (e) => {
          logger.error({ err: e, fileId: job.fileId }, '렌더링 처리 오류');
          await fail(job.fileId, 'RENDER_FAILED');
        })
        .catch((e) => logger.error({ err: e, fileId: job.fileId }, '렌더링 실패 기록도 실패'))
        .finally(() => { active--; pumpRender(); });
    }
  })().catch((e) => logger.error({ err: e }, '렌더링 대기열 처리 실패'));
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
    const out = await modelBinary(`/v1/render/${job.format}`, form, { timeoutMs: RENDER_TIMEOUT_MS });
    if (out.json) { await fail(job.fileId, 'RENDER_FAILED'); return; }
    const [name, version] = (out.headers.get('x-renderer') ?? `${job.format === 'mp3' ? 'fluidsynth' : 'renderer'} unknown`).split(/\s+/, 2);
    const uri = await saveFile(`${job.requestNo}/exports/${job.fileId}.${job.format}`, out.data);
    await exec(
      `UPDATE derived_file SET render_status = 'ready', storage_uri = ?, renderer_name = ?, renderer_version = ?,
              render_finished_at = CURRENT_TIMESTAMP(3) WHERE file_id = ?`, [uri, name.slice(0, 40), (version ?? 'unknown').slice(0, 40), job.fileId]);
  } catch (e) {
    if (!(e instanceof ModelApiDown)) throw e;
    if (e.reason === 'timeout') { await fail(job.fileId, 'RENDER_TIMEOUT'); return; }
    if (e.reason === 'unreachable') { await fail(job.fileId, 'ENGINE_DOWN'); return; }
    const code = (e.body as { error?: { code?: string } })?.error?.code ?? '';
    await fail(job.fileId, FAILURE_REASONS.has(code) ? code : 'RENDER_FAILED');
  }
}

/** web 이 다시 켜졌을 때 남은 렌더링은 실패로 돌린다 (사용자가 [다시 시도]) */
export async function recoverRenders(): Promise<void> {
  const rows = await query<{ file_id: number }>("SELECT file_id FROM derived_file WHERE render_status IN ('queued','rendering')");
  for (const r of rows) await fail(r.file_id, 'RENDER_FAILED');
  if (rows.length > 0) logger.info({ count: rows.length }, '끝나지 않은 렌더링을 실패로 돌림');
}

export async function queuePosition(fileId: number): Promise<number | null> {
  const r = await one<{ queue_position: number }>('SELECT queue_position FROM v_render_queue_position WHERE file_id = ?', [fileId]);
  return r?.queue_position ?? null;
}
