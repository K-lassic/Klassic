// 모델 API 서버 상태 (tasks T097): /v1/health · /v1/versions 를 읽고 확인본을 남긴다. 멈췄으면 "확인 불가" + 마지막 확인본
import { Router } from 'express';
import { one, query, tx } from '../db/pool.js';
import { wrap } from '../web/errors.js';
import { modelJson, ModelApiDown } from '../services/modelApiClient.js';

export const modelApiStatusRouter = Router();

modelApiStatusRouter.get('/model-api-status', wrap(async (_req, res) => {
  try {
    const [health, versions] = await Promise.all([
      modelJson<any>('GET', '/v1/health', undefined, { timeoutMs: 3000 }),
      modelJson<any>('GET', '/v1/versions', undefined, { timeoutMs: 3000 }),
    ]);
    const snapshotId = await tx(async (conn) => {
      const [s] = await conn.query("INSERT INTO api_spec_snapshot (health_status, api_version) VALUES ('ok', ?)", [health.api_version ?? 'v1']);
      const id = (s as { insertId: number }).insertId;
      for (const e of versions.engines ?? []) {
        await conn.query('INSERT INTO snapshot_engine_version (snapshot_id, engine_name, engine_version) VALUES (?, ?, ?)',
          [id, String(e.name).slice(0, 40), String(e.version ?? 'unknown').slice(0, 40)]);
      }
      return id;
    });
    res.json({ reachable: true, health, versions, snapshot_id: snapshotId, checked_at: new Date().toISOString() });
  } catch (e) {
    if (!(e instanceof ModelApiDown)) throw e;
    await tx(async (conn) => { await conn.query("INSERT INTO api_spec_snapshot (health_status) VALUES ('unreachable')"); });
    const last = await one<{ last_ok_snapshot_id: number | null }>('SELECT last_ok_snapshot_id FROM v_server_status');
    const engines = last?.last_ok_snapshot_id
      ? await query('SELECT engine_name, engine_version FROM snapshot_engine_version WHERE snapshot_id = ?', [last.last_ok_snapshot_id]) : [];
    res.json({ reachable: false, health: null, versions: null, last_known_engines: engines, checked_at: new Date().toISOString() });
  }
}));
