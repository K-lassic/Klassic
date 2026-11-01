// #34 가짜 model-api — 시험마다 응답을 바꿔 끼운다. model-api(#24 · #28)가 없어도 PDF 검사 위임을 시험할 수 있다.
import express from 'express';
import multer from 'multer';
import type { Server } from 'node:http';
import { FAKE_MODEL_PORT } from './env.js';

export type Handler = (req: express.Request, res: express.Response) => void;

export interface FakeModelApi {
  calls: { path: string; apiKey: string | undefined; deadline: string | undefined; fields: Record<string, unknown>; files: string[] }[];
  on: (method: 'get' | 'post', path: string, h: Handler) => void;
  close: () => Promise<void>;
}

export async function startFakeModelApi(): Promise<FakeModelApi> {
  const app = express();
  const handlers = new Map<string, Handler>();
  const calls: FakeModelApi['calls'] = [];
  app.use(multer({ storage: multer.memoryStorage() }).any());
  app.all(/.*/, (req, res) => {
    calls.push({ path: `${req.method} ${req.path}`, apiKey: req.header('X-API-Key'), deadline: req.header('X-Deadline'), fields: { ...(req.body ?? {}) },
      files: ((req.files as Express.Multer.File[]) ?? []).map((f) => f.originalname) });
    const h = handlers.get(`${req.method.toLowerCase()} ${req.path}`);
    if (!h) { res.status(404).json({ error: { code: 'REQUEST_NOT_FOUND' } }); return; }
    h(req, res);
  });
  const server: Server = await new Promise((r) => { const s = app.listen(FAKE_MODEL_PORT, '127.0.0.1', () => r(s)); });
  const fake: FakeModelApi = {
    calls,
    on: (m, p, h) => { handlers.set(`${m} ${p}`, h); },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
  fake.on('get', '/v1/models', (_q, s) => { s.json([]); });
  return fake;
}
