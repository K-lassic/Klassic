// 평가셋 (tasks T096, SC-012·016·017): 지표 보기와 일괄 실행 시작(evalset/run.py)
import { Router } from 'express';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { query, one } from '../db/pool.js';
import { wrap, ApiError } from '../web/errors.js';
import { APP_ROOT } from '../config/env.js';
import { logger } from '../lib/logger.js';

export const evaluationRouter = Router();
let running: { startedAt: Date; pid: number | undefined } | null = null;

evaluationRouter.get('/evaluation', wrap(async (_req, res) => {
  const m = await one('SELECT * FROM v_eval_metrics');
  const counts = await query<{ set_kind: string; n: number }>('SELECT set_kind, COUNT(*) AS n FROM eval_item GROUP BY set_kind');
  const runs = await one<{ n: number; last: Date | null }>('SELECT COUNT(*) AS n, MAX(run_at) AS last FROM eval_run_result');
  res.json({ metrics: m, items: Object.fromEntries(counts.map((c) => [c.set_kind, Number(c.n)])),
    runs: Number(runs?.n ?? 0), last_run_at: runs?.last ?? null, running: running ? { started_at: running.startedAt } : null });
}));

evaluationRouter.post('/evaluation/run', wrap(async (_req, res) => {
  if (running) throw new ApiError('BAD_REQUEST', { reason: 'already_running' }, null, 409);
  const script = resolve(APP_ROOT, 'evalset', 'run.py');
  if (!existsSync(script)) throw new ApiError('BAD_REQUEST', { reason: 'evalset_runner_missing' }, null, 409);
  const child = spawn('uv', ['run', '--project', resolve(APP_ROOT, 'model-api'), 'python', script, '--all'],
    { cwd: resolve(APP_ROOT, 'evalset'), stdio: 'ignore', detached: false });
  running = { startedAt: new Date(), pid: child.pid };
  child.on('exit', (code) => { logger.info({ code }, 'evalset run finished'); running = null; });
  child.on('error', (e) => { logger.error({ err: e }, 'evalset run failed'); running = null; });
  res.status(202).json({ started_at: running.startedAt });
}));
