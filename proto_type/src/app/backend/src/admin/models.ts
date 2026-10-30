// 모델 등록부 관리 (003 · INTERFACES §5·§7): 모델을 바꾸거나 더하고, 미리 불러와(워밍업) 첫 사용자가 기다리지 않게 한다.
// 공유 Ollama 서버에 새 모델을 받는 일(ollama pull)은 사람이 한 번 한다 — 여기서는 서버에 이미 있는 모델만 등록한다.
import { Router } from 'express';
import { query, one, tx } from '../db/pool.js';
import { ApiError, wrap } from '../web/errors.js';
import { modelJson, ModelApiDown } from '../services/modelApiClient.js';
import { modelStates } from '../services/modelStatus.js';
import { currentSettings } from '../config/settings.js';
import { addHistory } from './history.js';

export const modelsAdminRouter = Router();

const KINDS = ['omr_staff', 'omr_jeongganbo', 'recommend'] as const;
const PROVIDERS = ['venv', 'ollama', 'builtin'] as const;
const ADAPTERS = ['homr', 'audiveris', 'jeongganbo'];
const NAME_RE = /^[a-z0-9][a-z0-9._-]{1,39}$/;

interface OllamaTag { tag: string; size_gb: number; family?: string; parameter_size?: string }

async function ollamaAvailable(): Promise<{ ollama: 'ok' | 'unreachable'; version: string | null; models: OllamaTag[] }> {
  try {
    const r = await modelJson<{ ollama: 'ok' | 'unreachable'; version: string | null; models: OllamaTag[] }>(
      'GET', '/v1/internal/ollama/available', undefined, { timeoutMs: 8000 });
    return r;
  } catch (e) {
    if (!(e instanceof ModelApiDown)) throw e;
    return { ollama: 'unreachable', version: null, models: [] };
  }
}

async function reloadRegistry(): Promise<boolean> {
  try { await modelJson('POST', '/v1/internal/models/reload', {}, { timeoutMs: 8000 }); return true; }
  catch (e) { if (e instanceof ModelApiDown) return false; throw e; }
}

async function usage(): Promise<Map<string, string[]>> {
  const s = await currentSettings();
  const out = new Map<string, string[]>();
  for (const [t, names] of Object.entries(s.engine_order)) {
    names.forEach((n, i) => out.set(n, [...(out.get(n) ?? []), `${t}#${i + 1}`]));
  }
  return out;
}

modelsAdminRouter.get('/models', wrap(async (_req, res) => {
  const [rows, estimates, live, used] = await Promise.all([
    query<Record<string, any>>('SELECT * FROM model_registry ORDER BY kind, model_name'),
    query<Record<string, any>>('SELECT * FROM v_model_load_estimate'),
    modelStates(true),
    usage(),
  ]);
  const est = new Map(estimates.map((e) => [e.model_name, e]));
  res.json({
    model_api: live ? 'running' : 'stopped',
    items: rows.map((r) => {
      const l = live?.find((m) => m.name === r.model_name);
      const e = est.get(r.model_name) ?? {};
      return {
        model_name: r.model_name, kind: r.kind, provider: r.provider, display_name: r.display_name,
        provider_ref: r.provider_ref, config: r.config_json ? JSON.parse(r.config_json) : null, enabled: Boolean(r.enabled),
        notes: r.notes, registered_at: r.registered_at, in_use_by: used.get(r.model_name) ?? [],
        state: l?.state ?? (live ? 'unavailable' : 'unknown'), installed: l?.installed ?? null, version: l?.version ?? null,
        loaded_at: l?.loaded_at ?? null,
        load_started_at: (l as { load_started_at?: string } | undefined)?.load_started_at ?? null,
        elapsed_seconds: (l as { elapsed_seconds?: number } | undefined)?.elapsed_seconds ?? null,
        expected_seconds: l?.expected_seconds ?? null, error: l?.error ?? null,
        avg_load_ms: e.avg_load_ms == null ? null : Number(e.avg_load_ms), max_load_ms: e.max_load_ms == null ? null : Number(e.max_load_ms),
        last_ok_at: e.last_ok_at ?? null, last_outcome: e.last_outcome ?? null, last_error: e.last_error ?? null,
      };
    }),
  });
}));

modelsAdminRouter.get('/models/ollama-available', wrap(async (_req, res) => {
  const avail = await ollamaAvailable();
  const registered = await query<{ model_name: string; provider_ref: string }>("SELECT model_name, provider_ref FROM model_registry WHERE provider = 'ollama'");
  res.json({ ...avail, models: avail.models.map((m) => ({ ...m, registered: registered.find((r) => r.provider_ref === m.tag)?.model_name ?? null })) });
}));

modelsAdminRouter.post('/models', wrap(async (req, res) => {
  const b = req.body ?? {};
  const invalid = (field: string, reason: string) => new ApiError('MODEL_INVALID', { field, reason });
  if (typeof b.model_name !== 'string' || !NAME_RE.test(b.model_name)) throw invalid('model_name', 'slug');
  if (!KINDS.includes(b.kind)) throw invalid('kind', 'enum');
  if (!PROVIDERS.includes(b.provider) || b.provider === 'builtin') throw invalid('provider', 'venv_or_ollama');
  if (typeof b.display_name !== 'string' || !b.display_name.trim()) throw invalid('display_name', 'required');
  if (typeof b.provider_ref !== 'string' || !b.provider_ref.trim()) throw invalid('provider_ref', 'required');
  if (await one('SELECT 1 FROM model_registry WHERE model_name = ?', [b.model_name])) throw invalid('model_name', 'exists');
  let config: Record<string, unknown> = typeof b.config === 'object' && b.config ? { ...b.config } : {};
  if (b.provider === 'ollama') {
    if (b.kind !== 'recommend') throw invalid('kind', 'ollama_recommend_only');
    const avail = await ollamaAvailable();
    if (avail.ollama !== 'ok') throw new ApiError('OLLAMA_UNAVAILABLE');
    // 공유 서버 규칙: 서버에 있고 10GB 이하이며 :cloud 가 아닌 모델만(OLLAMA 설정 참조 §7.3·§7.5)
    if (!avail.models.some((m) => m.tag === b.provider_ref)) throw invalid('provider_ref', 'not_on_shared_server_or_too_large');
    config = { adapter: 'ollama_recommend', num_ctx: 4096, keep_alive: '5m', think: false, cold_start_hint_s: 30, ...config };
    if (Number(config.num_ctx) > 8192) throw invalid('config.num_ctx', 'max_8192');
  } else {
    if (b.kind === 'recommend') throw invalid('kind', 'venv_omr_only');
    if (!ADAPTERS.includes(String(config.adapter))) throw invalid('config.adapter', 'enum');
  }
  await tx(async (conn) => {
    await conn.query(
      `INSERT INTO model_registry (model_name, kind, provider, display_name, provider_ref, config_json, enabled, registered_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, ?)`,
      [b.model_name, b.kind, b.provider, b.display_name.trim().slice(0, 100), b.provider_ref.trim().slice(0, 300),
       JSON.stringify(config), req.operatorId, typeof b.notes === 'string' ? b.notes.slice(0, 500) : null]);
    await addHistory(req.operatorId!, 'model', b.model_name, 'registered', null, `${b.provider}:${b.provider_ref}`, conn);
  });
  const reloaded = await reloadRegistry();
  res.status(201).json({ model_name: b.model_name, reloaded,
    hint: '불러오기를 한 번 해 두면 첫 사용자가 기다리지 않습니다. 설정의 엔진 호출 순서에 넣어야 실제로 쓰입니다.' });
}));

modelsAdminRouter.put('/models/:name', wrap(async (req, res) => {
  const name = req.params.name;
  const cur = await one<Record<string, any>>('SELECT * FROM model_registry WHERE model_name = ?', [name]);
  if (!cur) throw new ApiError('MODEL_NOT_FOUND');
  const b = req.body ?? {};
  const changes: [string, unknown, unknown][] = [];
  if ('enabled' in b && Boolean(b.enabled) !== Boolean(cur.enabled)) {
    if (!b.enabled && (await usage()).has(name)) throw new ApiError('MODEL_INVALID', { field: 'enabled', reason: 'in_use_by_engine_order' });
    if (cur.provider === 'builtin' && !b.enabled) throw new ApiError('MODEL_INVALID', { field: 'enabled', reason: 'builtin_always_on' });
    changes.push(['enabled', Boolean(cur.enabled), Boolean(b.enabled)]);
  }
  if (typeof b.display_name === 'string' && b.display_name.trim() && b.display_name !== cur.display_name) changes.push(['display_name', cur.display_name, b.display_name.trim()]);
  if (typeof b.provider_ref === 'string' && b.provider_ref.trim() && b.provider_ref !== cur.provider_ref && cur.provider !== 'builtin') {
    if (cur.provider === 'ollama') {
      const avail = await ollamaAvailable();
      if (!avail.models.some((m) => m.tag === b.provider_ref)) throw new ApiError('MODEL_INVALID', { field: 'provider_ref', reason: 'not_on_shared_server_or_too_large' });
    }
    changes.push(['provider_ref', cur.provider_ref, b.provider_ref.trim()]);
  }
  if (b.config && typeof b.config === 'object') changes.push(['config', cur.config_json, JSON.stringify(b.config)]);
  await tx(async (conn) => {
    for (const [field, before, after] of changes) {
      const col = field === 'config' ? 'config_json' : field;
      await conn.query(`UPDATE model_registry SET ${col} = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE model_name = ?`, [after, name]);
      if (field !== 'display_name') await addHistory(req.operatorId!, 'model', name, field as 'enabled' | 'provider_ref' | 'config', before, after, conn);
    }
  });
  const reloaded = changes.length ? await reloadRegistry() : true;
  res.json({ model_name: name, changed: changes.map((c) => c[0]), reloaded });
}));

modelsAdminRouter.delete('/models/:name', wrap(async (req, res) => {
  const name = req.params.name;
  const cur = await one<{ provider: string }>('SELECT provider FROM model_registry WHERE model_name = ?', [name]);
  if (!cur) throw new ApiError('MODEL_NOT_FOUND');
  if (cur.provider === 'builtin') throw new ApiError('MODEL_INVALID', { reason: 'builtin_cannot_unregister' });
  if ((await usage()).has(name)) throw new ApiError('MODEL_INVALID', { reason: 'in_use_by_engine_order' });
  const inHistory = await one("SELECT 1 FROM setting_engine_order WHERE engine_name = ? LIMIT 1", [name]);
  await tx(async (conn) => {
    if (inHistory) {
      // 지난 설정 판본이 이 이름을 기록으로 가리키므로 행은 남기고 끈다
      await conn.query('UPDATE model_registry SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP(3) WHERE model_name = ?', [name]);
    } else {
      await conn.query('DELETE FROM model_registry WHERE model_name = ?', [name]);
    }
    await addHistory(req.operatorId!, 'model', name, 'unregistered', 'registered', inHistory ? 'disabled' : 'deleted', conn);
  });
  await reloadRegistry();
  res.status(204).end();
}));

modelsAdminRouter.post('/models/:name/load', wrap(async (req, res) => {
  const name = req.params.name;
  const cur = await one('SELECT 1 FROM model_registry WHERE model_name = ?', [name]);
  if (!cur) throw new ApiError('MODEL_NOT_FOUND');
  try {
    const r = await modelJson<{ load_id: number; expected_seconds: number | null }>(
      'POST', `/v1/internal/models/${encodeURIComponent(name)}/load`, { operator_id: req.operatorId }, { timeoutMs: 8000 });
    await addHistory(req.operatorId!, 'model', name, 'load', null, `load_id=${r.load_id}`);
    res.status(202).json(r);
  } catch (e) {
    if (!(e instanceof ModelApiDown)) throw e;
    if (e.status === 404) throw new ApiError('MODEL_NOT_FOUND');
    throw new ApiError('INTERNAL_ERROR', { reason: 'model_api_unreachable' }, null, 502);
  }
}));
