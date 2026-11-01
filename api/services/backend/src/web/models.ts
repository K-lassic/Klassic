// #35 모델 준비 상태 — 화면이 "모델 준비" 안내에 쓴다 (GET /api/models/status). 실패해도 올리기는 그대로 된다.
//
//   구조에서의 위치: 화면 → Nginx → web(이 파일) → 모델 상태 캐시(modelStatus.ts) → model-api GET /v1/models. 켜진 모델의 공개 항목만 내보낸다.
//   v0.1.1 web/models.ts 와 같은 동작.
import { Router } from 'express';
import { modelStates } from '../services/modelStatus.js';
import { wrap } from './errors.js';

export const modelsRouter = Router();

modelsRouter.get('/models/status', wrap(async (_req, res) => {
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
