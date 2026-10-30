// 사용자 화면용 모델 준비 상태 (INTERFACES §4 ModelStatusPublic, §7)
import { Router } from 'express';
import { wrap } from './errors.js';
import { modelStates } from '../services/modelStatus.js';

export const modelsPublicRouter = Router();

modelsPublicRouter.get('/models/status', wrap(async (_req, res) => {
  const models = await modelStates();
  res.json({
    checked_at: new Date().toISOString(),
    model_api: models ? 'running' : 'stopped',
    models: (models ?? []).filter((m) => m.enabled).map((m) => ({
      name: m.name, display_name: m.display_name, kind: m.kind, provider: m.provider,
      state: m.state, expected_seconds: m.expected_seconds,
    })),
  });
}));
