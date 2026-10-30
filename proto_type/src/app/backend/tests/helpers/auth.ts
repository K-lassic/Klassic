// 2026-09-29 RBAC: 웹 기능(UC1~UC7·UC15)은 로그인해야 쓴다 — 시험마다 새 사용자로 가입해 로그인한 에이전트를 만든다.
import request from 'supertest';
import type { Server } from 'node:http';

let n = 0;
export async function loggedInAgent(app: Server, who = 'u') {
  const agent = request.agent(app);
  const email = `${who}-${process.pid}-${Date.now()}-${n++}@test.kr`;
  const r = await agent.post('/api/auth/signup').send({ email, password: 'password-1234', name: `시험 ${who}` });
  if (r.status !== 201) throw new Error(`signup failed ${r.status} ${JSON.stringify(r.body)}`);
  return Object.assign(agent, { email, accountId: Number(r.body.account.account_id) as number });
}
