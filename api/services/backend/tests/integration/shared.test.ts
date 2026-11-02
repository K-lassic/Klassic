// #90 내 악보 · 공유 악보 통합 시험 — 실제 MariaDB 필요 (TEST_DB_HOST 가 있을 때만 돈다).
//   v0.1.1 my_scores · shared_scores · shared_use 를 옮겼다. 관리자 내리기(UC19)는 관리자 API(#100)에서 시험한다.
//   인식은 helpers/db.ts 로 완료 상태를 만들어 건너뛴다.
import { HAS_DB } from '../helpers/env.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import type { Server } from 'node:http';
import { SAMPLE_MUSICXML, makePng } from '../helpers/files.js';
import type { FakeModelApi } from '../helpers/fakeModelApi.js';

let app: Server;
let fake: FakeModelApi;
let db: typeof import('../../src/db/pool.js');
let h: typeof import('../helpers/db.js');
let jobs: typeof import('../../src/services/periodicJobs.js');
let loggedInAgent: typeof import('../helpers/auth.js').loggedInAgent;

type Agent = ReturnType<typeof request.agent>;
const sharedDir = (no: string) => join(process.env.STORAGE_DIR!, 'shared', no);

beforeAll(async () => {
  if (!HAS_DB) return;
  const { serve } = await import('../helpers/serve.js');
  const { createWebApp } = await import('../../src/app.js');
  const { startFakeModelApi } = await import('../helpers/fakeModelApi.js');
  db = await import('../../src/db/pool.js');
  h = await import('../helpers/db.js');
  jobs = await import('../../src/services/periodicJobs.js');
  ({ loggedInAgent } = await import('../helpers/auth.js'));
  app = serve(createWebApp());
  fake = await startFakeModelApi();
  await h.setSettings({ web_max_active_per_client: 100000, web_hourly_request_cap: 100000 });
});
afterAll(async () => { if (HAS_DB) { await fake.close(); await db.closePool(); } });

async function done(u: Agent, name = 'song.png'): Promise<string> {
  const up = await u.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), name);
  expect(up.status).toBe(202);
  await h.completeRecognized(up.body.id, SAMPLE_MUSICXML);
  return String(up.body.id);
}
const share = async (u: Agent, no: string, title: string) => String((await u.put(`/api/requests/${no}/share`).send({ title })).body.share_no);
const ids = async (u: Agent) => (await u.get('/api/my-scores')).body.items.map((x: { id: string }) => x.id);

describe.skipIf(!HAS_DB)('내가 만든 악보', () => {
  it('내 계정 요청만 · 편집 기록 표시 · 보관이 끝나면 빠진다', async () => {
    expect((await request(app).get('/api/my-scores')).status).toBe(401);
    const me = await loggedInAgent(app, 'mine');
    const other = await loggedInAgent(app, 'other');
    const a = await done(me, 'song-a.png');
    const theirs = await done(other, 'secret.png');
    const list = await me.get('/api/my-scores');
    expect(list.status).toBe(200);
    expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([a]);
    expect(JSON.stringify(list.body)).not.toContain('secret.png');
    expect(list.body.items[0]).toMatchObject({ file_name: 'song-a.png', edited: false, edit_ops: null, fallback: false, from_shared: false });
    expect(list.body.items[0].remaining_seconds).toBeGreaterThan(0);
    expect(await ids(other)).toEqual([theirs]);

    const ops = [{ op: 'transpose', semitones: 2 }];
    expect((await me.put(`/api/requests/${a}/edits`).send({ summary: { edited: true }, ops })).status).toBe(204);
    expect((await me.get('/api/my-scores')).body.items[0]).toMatchObject({ edited: true, edit_ops: ops });

    await db.exec(`UPDATE score_request SET received_at = CURRENT_TIMESTAMP(3) - INTERVAL 2 DAY,
                   completed_at = CURRENT_TIMESTAMP(3) - INTERVAL 2 DAY WHERE request_no = ?`, [a]);
    expect(await ids(me)).toEqual([]);
  });

  it('지우면 파일 · 편집 기록이 사라지고 기록은 남으며, 공유 복사본은 남는다', async () => {
    const me = await loggedInAgent(app, 'del-me');
    const other = await loggedInAgent(app, 'del-other');
    const a = await done(me, 'to-delete.png');
    await me.put(`/api/requests/${a}/edits`).send({ summary: { edited: true }, ops: [{ op: 'transpose', semitones: 1 }] });
    const shareNo = await share(me, a, '지우기 시험');

    expect((await request(app).delete(`/api/my-scores/${a}`)).status).toBe(401);
    const theirs = await other.delete(`/api/my-scores/${a}`);
    expect(theirs.status).toBe(404);
    expect(theirs.body.error.code).toBe('REQUEST_NOT_FOUND');
    expect((await me.get(`/api/requests/${a}`)).status).toBe(200);

    expect((await me.delete(`/api/my-scores/${a}`)).status).toBe(204);
    expect(await ids(me)).not.toContain(a);
    expect(existsSync(join(process.env.STORAGE_DIR!, a))).toBe(false);
    const row = await db.one<{ purged_at: Date | null; owner_deleted_at: Date | null }>('SELECT purged_at, owner_deleted_at FROM score_request WHERE request_no = ?', [a]);
    expect(row!.purged_at).not.toBeNull();
    expect(row!.owner_deleted_at).not.toBeNull();
    const id = await h.requestIdOf(a);
    expect((await db.one<{ ops_json: string | null }>('SELECT ops_json FROM edited_score WHERE request_id = ?', [id]))?.ops_json ?? null).toBeNull();
    expect((await me.get(`/api/requests/${a}/score`)).status).not.toBe(200);
    expect((await me.delete(`/api/my-scores/${a}`)).status).toBe(204); // 한 번 더 지워도 204
    expect((await me.get(`/api/shared-scores/${shareNo}/score`)).status).toBe(200);
  });

  it('공유 악보로 만든 요청은 목록에 없고 지울 수 없다(403)', async () => {
    const owner = await loggedInAgent(app, 'sh-owner');
    const user = await loggedInAgent(app, 'sh-user');
    const a = await done(owner, 'src.png');
    const shareNo = await share(owner, a, '공유 원본');
    const mine = String((await user.post(`/api/shared-scores/${shareNo}/use`)).body.id);
    const own = await done(user, 'own.png');
    expect(await ids(user)).toEqual([own]);
    const del = await user.delete(`/api/my-scores/${mine}`);
    expect(del.status).toBe(403);
    expect(del.body.error.code).toBe('MY_SCORE_FROM_SHARED');
    expect((await user.get(`/api/requests/${mine}`)).status).toBe(200);
  });

  it('예시로 올리면 목록 제목이 예시 이름이다', async () => {
    const me = await loggedInAgent(app, 'ex-title');
    const up = await me.post('/api/requests/example').send({ example_id: 'arirang-semachi-staff' });
    expect(up.status).toBe(202);
    await h.completeRecognized(up.body.id, SAMPLE_MUSICXML);
    expect((await me.get('/api/my-scores')).body.items[0]).toMatchObject({ title: '아리랑 세마치 (오선보)', from_example: true });
  });
});

describe.skipIf(!HAS_DB)('공유 악보', () => {
  it('공유 → 게시판(올린 사람 정보 없음) → 듣기 → 좋아요 · 취소 → 거두기', async () => {
    const owner = await loggedInAgent(app, 'share-owner');
    const other = await loggedInAgent(app, 'share-other');
    const no = await done(owner);

    expect((await owner.get(`/api/requests/${no}/share`)).body).toEqual({ shared: false });
    expect((await owner.put(`/api/requests/${no}/share`).send({ title: '  ' })).body.error.code).toBe('BAD_REQUEST');
    expect((await owner.put(`/api/requests/${no}/share`).send({ title: 'ㄱ'.repeat(61) })).status).toBe(400);
    expect((await other.put(`/api/requests/${no}/share`).send({ title: '남의 것' })).body.error.code).toBe('REQUEST_NOT_FOUND');

    const sh = await owner.put(`/api/requests/${no}/share`).send({ title: '시험 아리랑' });
    expect(sh.status).toBe(200);
    expect(sh.body).toMatchObject({ shared: true, title: '시험 아리랑', taken_down: false });
    const shareNo = String(sh.body.share_no);
    expect(shareNo).toMatch(/^S-\d{4}-[A-Z2-9]{8}$/);
    expect((await owner.put(`/api/requests/${no}/share`).send({ title: '시험 아리랑 2' })).body.share_no).toBe(shareNo);

    const list = await other.get('/api/shared-scores').query({ sort: 'recent', limit: 50 });
    expect(list.status).toBe(200);
    const item = list.body.items.find((x: { share_no: string }) => x.share_no === shareNo);
    expect(item).toMatchObject({ title: '시험 아리랑 2', score_type: 'staff', likes: 0, liked_by_me: false, example: false });
    const raw = JSON.stringify(list.body);
    expect(raw).not.toContain(no);
    expect(raw).not.toContain(owner.email);

    const score = await other.get(`/api/shared-scores/${shareNo}/score`);
    expect(score.status).toBe(200);
    expect(score.body.musicxml).toContain('score-partwise');
    expect(JSON.stringify(score.body)).not.toContain(no);

    expect((await other.post(`/api/shared-scores/${shareNo}/like`)).body).toMatchObject({ liked: true, likes: 1 });
    expect((await owner.post(`/api/shared-scores/${shareNo}/like`)).body).toMatchObject({ liked: true, likes: 2 });
    expect((await other.post(`/api/shared-scores/${shareNo}/like`)).body).toMatchObject({ liked: false, likes: 1 });
    const byLikes = await owner.get('/api/shared-scores').query({ sort: 'likes', limit: 50 });
    expect(byLikes.body.items.find((x: { share_no: string }) => x.share_no === shareNo)).toMatchObject({ likes: 1, liked_by_me: true });

    expect((await request(app).get('/api/shared-scores')).status).toBe(401);
    expect((await request(app).post(`/api/shared-scores/${shareNo}/like`)).status).toBe(401);

    expect((await owner.delete(`/api/requests/${no}/share`)).body).toEqual({ shared: false });
    const after = await other.get('/api/shared-scores').query({ sort: 'recent', limit: 50 });
    expect(after.body.items.some((x: { share_no: string }) => x.share_no === shareNo)).toBe(false);
    expect((await other.get(`/api/shared-scores/${shareNo}/score`)).body.error.code).toBe('REQUEST_NOT_FOUND');
    expect(existsSync(sharedDir(shareNo))).toBe(false);

    // 다시 공유하면 파일을 새로 복사하고 3일을 새로 센다
    const again = await owner.put(`/api/requests/${no}/share`).send({ title: '다시 공유' });
    expect(again.body).toMatchObject({ shared: true, share_no: shareNo });
    expect(existsSync(sharedDir(shareNo))).toBe(true);
  });

  it('복사본은 24시간 정리에 지워지지 않고, 일치 확인에서 고아로 보고되지 않는다', async () => {
    const owner = await loggedInAgent(app, 'share-keep');
    const no = await done(owner);
    const shareNo = await share(owner, no, '남는 악보');
    const old = new Date(Date.now() - 3600 * 1000);
    const { utimesSync } = await import('node:fs');
    utimesSync(join(sharedDir(shareNo), 'score.musicxml'), old, old);
    await db.exec(`UPDATE score_request SET received_at = CURRENT_TIMESTAMP(3) - INTERVAL 25 HOUR,
                   completed_at = CURRENT_TIMESTAMP(3) - INTERVAL 25 HOUR WHERE request_no = ?`, [no]);
    await jobs.runPeriodicJobs();
    expect((await db.one<{ purged_at: Date | null }>('SELECT purged_at FROM score_request WHERE request_no = ?', [no]))?.purged_at).toBeTruthy();
    expect((await owner.get(`/api/shared-scores/${shareNo}/score`)).body.title).toBe('남는 악보');
    expect((await jobs.checkFiles()).orphans).not.toContain(`shared/${shareNo}/score.musicxml`);
  });

  it('공유 후 3일이 지나면 게시판 · 듣기에서 빠지고 주기 정리가 복사본 · 좋아요를 지운다', async () => {
    const owner = await loggedInAgent(app, 'share-ttl');
    const other = await loggedInAgent(app, 'share-ttl2');
    const no = await done(owner);
    const sh = await owner.put(`/api/requests/${no}/share`).send({ title: '3일 악보' });
    const shareNo = String(sh.body.share_no);
    expect(Math.round((new Date(sh.body.expires_at).getTime() - new Date(sh.body.shared_at).getTime()) / 3600_000)).toBe(72);
    await other.post(`/api/shared-scores/${shareNo}/like`);

    await db.exec('UPDATE shared_score SET expires_at = CURRENT_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE share_no = ?', [shareNo]);
    expect((await other.get(`/api/shared-scores/${shareNo}/score`)).body.error.code).toBe('REQUEST_NOT_FOUND');
    expect(existsSync(sharedDir(shareNo))).toBe(true); // 판정은 바로, 삭제는 주기 정리가 한다

    const out = await jobs.runPeriodicJobs();
    expect(out!.shares_purged).toBeGreaterThanOrEqual(1);
    expect(existsSync(sharedDir(shareNo))).toBe(false);
    const row = await db.one<{ purged_at: Date | null; musicxml_uri: string | null; likes: number }>(
      'SELECT purged_at, musicxml_uri, (SELECT COUNT(*) FROM score_like l WHERE l.share_id = s.share_id) AS likes FROM shared_score s WHERE share_no = ?', [shareNo]);
    expect(row!.purged_at).toBeTruthy();
    expect(row!.musicxml_uri).toBeNull();
    expect(Number(row!.likes)).toBe(0);
    expect((await owner.get(`/api/requests/${no}/share`)).body).toEqual({ shared: false });
  });
});

describe.skipIf(!HAS_DB)('이 악보로 작업하기', () => {
  it('공유 복사본으로 내 새 요청(인식 없음 · 바로 완료 · 공유자 정보 없음), 거두면 404', async () => {
    const owner = await loggedInAgent(app, 'use-owner');
    const other = await loggedInAgent(app, 'use-other');
    const no = await done(owner);
    const shareNo = await share(owner, no, '작업 시험');

    expect((await request(app).post(`/api/shared-scores/${shareNo}/use`)).status).toBe(401);
    const use = await other.post(`/api/shared-scores/${shareNo}/use`);
    expect(use.status).toBe(202);
    expect(use.body).toMatchObject({ status: 'completed', route: 'direct', file_kind: 'musicxml', from_shared: true });
    expect(JSON.stringify(use.body)).not.toContain(no);
    expect(JSON.stringify(use.body)).not.toContain(shareNo);

    const score = await other.get(`/api/requests/${use.body.id}/score`);
    expect(score.status).toBe(200);
    expect(score.body.musicxml).toContain('score-partwise');
    expect((await owner.get(`/api/requests/${use.body.id}`)).status).toBe(404);

    await owner.delete(`/api/requests/${no}/share`);
    expect((await other.post(`/api/shared-scores/${shareNo}/use`)).status).toBe(404);
  });

  it('공유 파일을 읽지 못하면 요청 · 파일을 남기지 않는다', async () => {
    const owner = await loggedInAgent(app, 'use-bad');
    const no = await done(owner);
    const shareNo = await share(owner, no, '깨진 악보');
    const { writeFileSync, readdirSync } = await import('node:fs');
    writeFileSync(join(sharedDir(shareNo), 'score.musicxml'), 'not xml');
    const before = readdirSync(process.env.STORAGE_DIR!).length;
    const count = async () => Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM score_request'))!.n);
    const rows = await count();
    const use = await owner.post(`/api/shared-scores/${shareNo}/use`);
    expect(use.body.error.code).toBe('UPLOAD_CORRUPTED');
    expect(await count()).toBe(rows);
    expect(readdirSync(process.env.STORAGE_DIR!).length).toBe(before);
  });
});
