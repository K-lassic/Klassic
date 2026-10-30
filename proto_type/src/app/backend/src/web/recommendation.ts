// 추천 중계·악기 선택 기록 (tasks T090, UC5): 모델 API /v1/recommend 를 부르고, 실패해도 200 + available=false(FR-008)
import { Router } from 'express';
import { exec, one, query } from '../db/pool.js';
import { ApiError, wrap } from './errors.js';
import { loadOwnedRequest } from './ownership.js';
import { modelJson, ModelApiDown, blobOf } from '../services/modelApiClient.js';
import { readStored } from '../services/storage.js';
import { currentSettings } from '../config/settings.js';
import { defaultEnsembleId, placedSelection } from '../services/placedEnsemble.js';

export const recommendationRouter = Router();

interface Rec {
  available: boolean; reason: string | null; pending?: boolean;
  combinations: { label: string; instruments: string[]; reason?: string }[];
  model: { name: string; version: string; provider?: string } | null;
  features: Record<string, unknown> | null;
}

const unavailable = (pending = false): Rec => ({ available: false, reason: 'RECOMMEND_UNAVAILABLE', pending, combinations: [], model: null, features: null });

recommendationRouter.get('/requests/:no/recommendation', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  // 추천은 MusicXML 기준(2026-09-30 조성기 지시 — 조·박자 정보가 있고, MIDI 가 없는 결과도 있다)
  const cur = await one<{ musicxml_uri: string }>('SELECT musicxml_uri FROM v_current_result WHERE request_id = ? AND deleted_at IS NULL', [r.request_id]);
  if (!cur) { res.json(unavailable()); return; }
  const s = await currentSettings();
  const form = new FormData();
  form.set('score', blobOf(await readStored(cur.musicxml_uri), 'application/vnd.recordare.musicxml+xml'), 'score.musicxml');
  form.set('request_no', r.request_no);
  // 추천 순서 중 가장 긴 제한 + 여유. LLM 이 준비되지 않았으면 모델 API 가 규칙표로 곧바로 넘어간다
  const timeoutMs = Math.max(s.recommend_timeout_ms ?? 3000, s.llm_recommend_timeout_ms ?? 0) + 2000;
  try {
    const rec = await modelJson<Rec>('POST', '/v1/recommend', form, { timeoutMs });
    res.json({ pending: false, ...rec });
  } catch (e) {
    if (!(e instanceof ModelApiDown)) throw e;
    await exec(
      `INSERT INTO recommendation (request_id, responded_at, outcome) VALUES (?, CURRENT_TIMESTAMP(3), ?)`,
      [r.request_id, e.reason === 'timeout' ? 'no_response' : 'api_down']);
    res.json(unavailable());
  }
}));

recommendationRouter.put('/requests/:no/instrument-choice', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  const mode = req.body?.mode;
  if (!['default', 'recommend', 'original', 'custom'].includes(mode)) throw new ApiError('BAD_REQUEST', { field: 'mode' });
  let ensembleId: number | null = null;
  let source: 'user_choice' | 'revert_default' = 'user_choice';
  if (mode === 'default') {
    // 실제로 놓이는 악기만(타악 성부가 없으면 장구 빼고) 기록한다(2026-09-29)
    ensembleId = await placedSelection(r.request_id, await defaultEnsembleId(), { isDefault: true });
    source = 'revert_default';
  } else if (mode === 'original') {
    ensembleId = (await one<{ original_ensemble_id: number | null }>(
      "SELECT original_ensemble_id FROM score_result WHERE request_id = ? AND origin = 'direct'", [r.request_id]))?.original_ensemble_id ?? null;
  } else if (mode === 'recommend') {
    const idx = Number(req.body?.recommendation_index ?? 0);
    const opt = await one<{ ensemble_id: number }>(
      `SELECT o.ensemble_id FROM recommendation_option o
         JOIN recommendation c ON c.recommendation_id = o.recommendation_id
        WHERE c.request_id = ? AND c.outcome = 'ok' ORDER BY c.recommendation_id DESC, o.rank_no LIMIT 1 OFFSET ?`,
      [r.request_id, Math.max(0, idx)]);
    // 화면 applyCombination 과 같은 규칙으로 놓이는 악기만(타악만의 조합이면 선율 성부는 기본 선율 악기)
    ensembleId = await placedSelection(r.request_id, opt?.ensemble_id ?? null);
  } else {
    const tracks = Array.isArray(req.body?.tracks) ? req.body.tracks as { part: number; instrument: string }[] : [];
    if (tracks.length === 0) throw new ApiError('BAD_REQUEST', { field: 'tracks' });
    const codes = await query<{ instrument_id: number; code: string; is_percussion: number }>(
      'SELECT instrument_id, code, is_percussion FROM instrument WHERE code IN (?)', [tracks.map((t) => t.instrument)]);
    const byCode = new Map(codes.map((c) => [c.code, c]));
    if (tracks.some((t) => !byCode.has(t.instrument))) throw new ApiError('BAD_REQUEST', { field: 'tracks.instrument' });
    const ins = await exec("INSERT INTO ensemble (ensemble_kind) VALUES ('custom')");
    ensembleId = ins.insertId;
    for (const [i, t] of tracks.entries()) {
      const c = byCode.get(t.instrument)!;
      await exec('INSERT INTO ensemble_member (ensemble_id, part_no, part_role, instrument_id) VALUES (?, ?, ?, ?)',
        [ensembleId, i + 1, c.is_percussion ? 'percussion' : 'melody', c.instrument_id]);
    }
  }
  if (ensembleId == null) throw new ApiError('BAD_REQUEST', { reason: 'ensemble_unavailable', mode });
  await exec('INSERT INTO instrument_selection (request_id, ensemble_id, source) VALUES (?, ?, ?)', [r.request_id, ensembleId, source]);
  res.status(204).end();
}));
