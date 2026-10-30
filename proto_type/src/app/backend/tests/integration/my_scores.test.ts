// 내가 만든 악보 (2026-09-30 황송해 160번 — UC7 A9 · SD_01 3.8) — 이 계정 요청만, 보관 기간 안, 편집 기록은 서버에서
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import { startFakeModelApi, SAMPLE_MUSICXML, type FakeModelApi } from '../helpers/fakeModelApi.js';
import { makeMidi, makePng } from '../helpers/files.js';
import { exec, query, waitFor } from '../helpers/db.js';
import { createWebApp } from '../../src/server.js';
import { closePool } from '../../src/db/pool.js';
import { startWorker } from '../../src/services/requestWorker.js';

let fake: FakeModelApi;
const app = serve(createWebApp());
beforeAll(async () => {
  fake = await startFakeModelApi();
  fake.on('post', '/v1/omr/staff', (_req, res) => {
    res.json({ api_version: 'v1', fallback: false, fallback_reason: null, structure_verdict: 'pass', type_mismatch: false,
      detected_type: null, validity_grade: 'trust', musicxml: SAMPLE_MUSICXML, midi_base64: makeMidi().toString('base64'),
      engine: { name: 'homr', version: '0.test' } });
  });
  await startWorker();
});
afterAll(async () => { await fake.close(); await closePool(); });

async function done(agent: ReturnType<typeof request.agent>, name: string) {
  const up = await agent.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), name);
  await waitFor(() => agent.get(`/api/requests/${up.body.id}`).then((r) => r.body), (b) => b.status === 'completed');
  return String(up.body.id);
}

describe('GET /api/my-scores', () => {
  it('내 계정 요청만(다른 계정 것 없음) · 편집 기록 · 보관이 끝난 요청은 빠진다', async () => {
    expect((await request(app).get('/api/my-scores')).status).toBe(401);
    const me = await loggedInAgent(app, 'mine');
    const other = await loggedInAgent(app, 'other');
    const a = await done(me, 'song-a.png');
    const theirs = await done(other, 'secret.png');
    const list = await me.get('/api/my-scores');
    expect(list.status).toBe(200);
    const ids = list.body.items.map((x: { id: string }) => x.id);
    expect(ids).toContain(a);
    expect(ids).not.toContain(theirs);
    expect(JSON.stringify(list.body)).not.toContain('secret.png');
    const item = list.body.items.find((x: { id: string }) => x.id === a);
    expect(item).toMatchObject({ file_name: 'song-a.png', edited: false, edit_ops: null, fallback: false });
    expect(item.remaining_seconds).toBeGreaterThan(0);
    // 편집을 마치면 편집 기록이 서버에 남아 목록에 나온다(다른 기기에서도 편집 반영 받기)
    const ops = [{ op: 'transpose', semitones: 2 }];
    expect((await me.put(`/api/requests/${a}/edits`).send({ summary: { edited: true }, ops })).status).toBe(204);
    const after = (await me.get('/api/my-scores')).body.items.find((x: { id: string }) => x.id === a);
    expect(after).toMatchObject({ edited: true, edit_ops: ops });
    // 되돌린 뒤 마치면 편집 기록이 지워진다
    await me.put(`/api/requests/${a}/edits`).send({ summary: { edited: false }, ops: [] });
    expect((await me.get('/api/my-scores')).body.items.find((x: { id: string }) => x.id === a).edited).toBe(false);
    // 보관 기간이 지나면 목록에서 빠진다
    await exec("UPDATE score_request SET received_at = NOW() - INTERVAL 2 DAY WHERE request_no = ?", [a]).catch(() => undefined);
    const expired = (await me.get('/api/my-scores')).body.items.map((x: { id: string }) => x.id);
    expect(expired).not.toContain(a);
  });
});

describe('PUT /api/requests/:no/edits finished:false — [작업 저장하기] (2026-10-01 황송해 202번)', () => {
  it('편집 마침으로 치지 않고 ops 만 저장 · 목록에서 이어 하기 · 빈 ops 면 비움 · 다른 계정은 못 씀', async () => {
    const me = await loggedInAgent(app, 'save-me');
    const other = await loggedInAgent(app, 'save-other');
    const a = await done(me, 'save-work.png');
    const ops = [{ op: 'transpose', semitones: 3 }];
    expect((await me.put(`/api/requests/${a}/edits`).send({ summary: { edited: true }, ops, finished: false })).status).toBe(204);
    const row = await query<{ ops_json: string | null; finished_at: Date | null }>(
      'SELECT e.ops_json, e.finished_at FROM edited_score e JOIN score_request r ON r.request_id = e.request_id WHERE r.request_no = ?', [a]);
    expect(JSON.parse(row[0].ops_json!)).toEqual(ops);
    expect(row[0].finished_at).toBeNull();
    const item = (await me.get('/api/my-scores')).body.items.find((x: { id: string }) => x.id === a);
    expect(item).toMatchObject({ edited: true, edit_ops: ops });
    expect((await other.put(`/api/requests/${a}/edits`).send({ summary: {}, ops, finished: false })).status).not.toBe(204);
    await me.put(`/api/requests/${a}/edits`).send({ summary: { edited: false }, ops: [], finished: false });
    expect((await me.get('/api/my-scores')).body.items.find((x: { id: string }) => x.id === a).edited).toBe(false);
  });
});

describe('DELETE /api/my-scores/:no (2026-09-30 황송해 176번 — UC7 A10 · SD_01 3.9)', () => {
  it('내 요청만 바로 지움 · 파일 · 편집 기록 비움 · 기록 남김 · 공유 복사본은 남음 · 다른 계정은 404', async () => {
    const me = await loggedInAgent(app, 'del-me');
    const other = await loggedInAgent(app, 'del-other');
    const a = await done(me, 'to-delete.png');
    await me.put(`/api/requests/${a}/edits`).send({ summary: { edited: true }, ops: [{ op: 'transpose', semitones: 1 }] });
    const sh = await me.put(`/api/requests/${a}/share`).send({ title: '지우기 시험 공유' });
    const shareNo = String(sh.body.share_no);
    expect((await request(app).delete(`/api/my-scores/${a}`)).status).toBe(401);
    // 다른 계정은 있는지도 모른다(REQUEST_NOT_FOUND — 소유 확인 규약 D-1)
    const theirs = await other.delete(`/api/my-scores/${a}`);
    expect(theirs.status).toBe(404);
    expect(theirs.body.error.code).toBe('REQUEST_NOT_FOUND');
    expect((await me.get(`/api/requests/${a}`)).status).toBe(200);
    // 지움
    expect((await me.delete(`/api/my-scores/${a}`)).status).toBe(204);
    expect((await me.get('/api/my-scores')).body.items.map((x: { id: string }) => x.id)).not.toContain(a);
    const rows = await query<{ purged_at: Date | null; owner_deleted_at: Date | null }>('SELECT purged_at, owner_deleted_at FROM score_request WHERE request_no = ?', [a]);
    expect(rows[0].purged_at).not.toBeNull();
    expect(rows[0].owner_deleted_at).not.toBeNull();
    const files = await query<{ n: number }>('SELECT COUNT(*) AS n FROM upload_file u JOIN score_request r ON r.request_id = u.request_id WHERE r.request_no = ? AND u.storage_uri IS NOT NULL', [a]);
    expect(Number(files[0].n)).toBe(0);
    const ed = await query<{ ops_json: string | null }>('SELECT e.ops_json FROM edited_score e JOIN score_request r ON r.request_id = e.request_id WHERE r.request_no = ?', [a]);
    expect(ed[0]?.ops_json ?? null).toBeNull();
    // 요청은 만료와 같게 막힌다(G4)
    expect((await me.get(`/api/requests/${a}/score`)).status).not.toBe(200);
    // 한 번 더 지워도 204
    expect((await me.delete(`/api/my-scores/${a}`)).status).toBe(204);
    // 공유 복사본은 남는다
    const shared = await me.get(`/api/shared-scores/${shareNo}/score`);
    expect(shared.status).toBe(200);
    expect(shared.body.musicxml).toContain('<score-partwise');
  });
});

describe('DELETE /api/my-scores/:no — 공유 악보로 만든 요청 (2026-09-30 황송해 180번)', () => {
  it('공유 악보로 만든 요청은 from_shared · 지울 수 없음(403) · 내 악보는 지울 수 있음', async () => {
    const owner = await loggedInAgent(app, 'sh-owner');
    const user = await loggedInAgent(app, 'sh-user');
    const a = await done(owner, 'shared-src.png');
    const shareNo = String((await owner.put(`/api/requests/${a}/share`).send({ title: '공유 원본' })).body.share_no);
    const use = await user.post(`/api/shared-scores/${shareNo}/use`);
    expect(use.status).toBe(202);
    const mine = String(use.body.id);
    // (190번) 공유 악보에서 만든 요청은 목록에 나오지 않는다 — 직접 올린 것은 나온다
    const own = await done(user, 'user-own.png');
    const ids = (await user.get('/api/my-scores')).body.items.map((x: { id: string }) => x.id);
    expect(ids).not.toContain(mine);
    expect(ids).toContain(own);
    const del = await user.delete(`/api/my-scores/${mine}`);
    expect(del.status).toBe(403);
    expect(del.body.error.code).toBe('MY_SCORE_FROM_SHARED');
    expect((await user.get(`/api/requests/${mine}`)).status).toBe(200); // 지워지지 않고 남음(24시간 뒤 정리)
    // 올린 사람의 원래 악보는 from_shared 가 아니고 지울 수 있다 — 지워도 공유 악보는 남는다
    expect((await owner.get('/api/my-scores')).body.items.find((x: { id: string }) => x.id === a).from_shared).toBe(false);
    expect((await owner.delete(`/api/my-scores/${a}`)).status).toBe(204);
    expect((await user.get(`/api/shared-scores/${shareNo}/score`)).status).toBe(200);
  });
});

describe('GET /api/my-scores — 계정 기준만 (2026-09-30 황송해 187번)', () => {
  it('계정 없이 만든 세션 요청 · 다른 계정 요청은 보이지 않고, 두 계정 목록이 섞이지 않는다', async () => {
    const a = await loggedInAgent(app, 'acct-a');
    const b = await loggedInAgent(app, 'acct-b');
    const ra = await done(a, 'a-only.png');
    const rb = await done(b, 'b-only.png');
    const idsA = (await a.get('/api/my-scores')).body.items.map((x: { id: string }) => x.id);
    const idsB = (await b.get('/api/my-scores')).body.items.map((x: { id: string }) => x.id);
    expect(idsA).toContain(ra); expect(idsA).not.toContain(rb);
    expect(idsB).toContain(rb); expect(idsB).not.toContain(ra);
    // 계정 없이 만든 예전 세션 요청(account_id 없음)은 같은 세션이라도 목록에 없다
    await exec('UPDATE score_request SET account_id = NULL WHERE request_no = ?', [ra]);
    expect((await a.get('/api/my-scores')).body.items.map((x: { id: string }) => x.id)).not.toContain(ra);
    // 로그인하지 않은 방문은 401
    expect((await request(app).get('/api/my-scores')).status).toBe(401);
  });
});

describe('GET /api/my-scores — 예시로 올린 악보 제목 (2026-09-30 황송해 192번)', () => {
  it('예시로 올리면 example_id 가 남고 목록 제목은 예시 이름 · from_example', async () => {
    const me = await loggedInAgent(app, 'ex-title');
    const up = await me.post('/api/requests/example').send({ example_id: 'arirang-semachi-staff' });
    expect(up.status).toBe(202);
    await waitFor(() => me.get(`/api/requests/${up.body.id}`).then((r) => r.body), (b) => b.status === 'completed');
    const it = (await me.get('/api/my-scores')).body.items.find((x: { id: string }) => x.id === up.body.id);
    expect(it).toMatchObject({ title: '아리랑 세마치 (오선보)', from_example: true });
    const row = await query<{ example_id: string | null }>('SELECT example_id FROM score_request WHERE request_no = ?', [up.body.id]);
    expect(row[0].example_id).toBe('arirang-semachi-staff');
    // 직접 올린 것은 예시 아님
    const own = await done(me, 'plain.png');
    expect((await me.get('/api/my-scores')).body.items.find((x: { id: string }) => x.id === own).from_example).toBe(false);
  });
});
