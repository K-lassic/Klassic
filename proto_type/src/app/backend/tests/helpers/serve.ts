// 시험 파일마다 서버를 한 번만 띄워 둔다. supertest 가 요청마다 임시 서버를 열고 닫으면
// 가끔 연결이 끊긴다(socket hang up) — 계속 떠 있는 서버를 넘기면 그렇지 않다.
import type { Express } from 'express';
import type { Server } from 'node:http';
import { afterAll } from 'vitest';

const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => { s.closeAllConnections?.(); s.close(() => r()); })));
  servers.length = 0;
});

export function serve(app: Express): Server {
  const s = app.listen(0, '127.0.0.1');
  servers.push(s);
  return s;
}
