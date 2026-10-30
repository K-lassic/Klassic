// 가짜 모델 API 서버 — 시험마다 응답을 바꿔 끼운다(모델 API 가 멈춘 경우는 서버를 닫는다)
import express from 'express';
import multer from 'multer';
import type { Server } from 'node:http';

export type Handler = (req: express.Request, res: express.Response) => void | Promise<void>;

export interface FakeModelApi {
  url: string;
  calls: { path: string; fields: Record<string, unknown> }[];
  on: (method: 'get' | 'post' | 'delete', path: string, h: Handler) => void;
  close: () => Promise<void>;
}

export async function startFakeModelApi(port = 26199): Promise<FakeModelApi> {
  const app = express();
  const handlers = new Map<string, Handler>();
  const calls: FakeModelApi['calls'] = [];
  app.use(express.json());
  app.use(multer({ storage: multer.memoryStorage() }).any());
  app.all(/.*/, async (req, res) => {
    calls.push({ path: `${req.method} ${req.path}`, fields: { ...(req.body ?? {}) } });
    const h = handlers.get(`${req.method.toLowerCase()} ${req.path}`);
    if (!h) { res.status(404).json({ error: { code: 'REQUEST_NOT_FOUND' } }); return; }
    await h(req, res);
  });
  const server: Server = await new Promise((r) => { const s = app.listen(port, '127.0.0.1', () => r(s)); });
  const fake: FakeModelApi = {
    url: `http://127.0.0.1:${port}`,
    calls,
    on: (m, p, h) => { handlers.set(`${m} ${p}`, h); },
    close: () => new Promise((r) => server.close(() => r())),
  };
  // 기본 응답: 모델 상태 목록
  fake.on('get', '/v1/models', (_q, s) => { s.json([]); });
  return fake;
}

export const SAMPLE_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>가야금</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
<note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
</measure></part></score-partwise>`;
