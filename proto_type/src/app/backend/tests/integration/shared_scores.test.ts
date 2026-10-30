// 공유 악보 · 좋아요 (2026-09-30 황송해 결정 — design/UC_18 UC18 · UC19 · SD_01 P9 · SD_03 §11B)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import { startFakeModelApi, SAMPLE_MUSICXML, type FakeModelApi } from '../helpers/fakeModelApi.js';
import { makeMidi, makePng } from '../helpers/files.js';
import { exec, one, waitFor } from '../helpers/db.js';
import { createWebApp, createAdminApp } from '../../src/server.js';
import { closePool } from '../../src/db/pool.js';
import { startWorker } from '../../src/services/requestWorker.js';
import { purgeResults } from '../../src/services/jobs/purgeResults.js';
import { purgeSharedScores } from '../../src/services/jobs/purgeSharedScores.js';

let fake: FakeModelApi;
const app = serve(createWebApp());
const admin = serve(createAdminApp());
const PW = 'shared-op-pw-123';

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

async function completedRequest(agent: ReturnType<typeof request.agent>) {
  const up = await agent.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'song.png');
  expect(up.status).toBe(202);
  await waitFor(() => agent.get(`/api/requests/${up.body.id}`).then((r) => r.body), (b) => b.status === 'completed');
  return String(up.body.id);
}

describe('UC18 악보 공유하고 공유 악보 듣기', () => {
  it('공유 → 목록(올린 사람 정보 없음) → 듣기 → 좋아요 · 취소 → 거두기', async () => {
    const owner = await loggedInAgent(app, 'share-owner');
    const other = await loggedInAgent(app, 'share-other');
    const no = await completedRequest(owner);

    expect((await owner.get(`/api/requests/${no}/share`)).body).toEqual({ shared: false });
    // E1 제목 없음 · 너무 김
    expect((await owner.put(`/api/requests/${no}/share`).send({ title: '  ' })).body.error.code).toBe('BAD_REQUEST');
    expect((await owner.put(`/api/requests/${no}/share`).send({ title: 'ㄱ'.repeat(61) })).status).toBe(400);
    // E3 남의 요청
    expect((await other.put(`/api/requests/${no}/share`).send({ title: '남의 것' })).body.error.code).toBe('REQUEST_NOT_FOUND');

    const sh = await owner.put(`/api/requests/${no}/share`).send({ title: '시험 아리랑' });
    expect(sh.status).toBe(200);
    expect(sh.body).toMatchObject({ shared: true, title: '시험 아리랑', taken_down: false });
    const shareNo = String(sh.body.share_no);
    expect(shareNo).toMatch(/^S-\d{4}-[A-Z2-9]{8}$/);
    // A1 다시 누르면 제목만 바뀐다(새로 만들지 않음)
    const again = await owner.put(`/api/requests/${no}/share`).send({ title: '시험 아리랑 2' });
    expect(again.body.share_no).toBe(shareNo);

    const list = await other.get('/api/shared-scores').query({ sort: 'recent' });
    expect(list.status).toBe(200);
    const item = list.body.items.find((x: { share_no: string }) => x.share_no === shareNo);
    expect(item).toMatchObject({ title: '시험 아리랑 2', score_type: 'staff', likes: 0, liked_by_me: false });
    // BR-SHR-03 올린 사람 · 요청 번호가 응답 어디에도 없다
    const raw = JSON.stringify(list.body);
    expect(raw).not.toContain(no);
    expect(raw).not.toContain(owner.email);
    expect(Object.keys(item).sort()).toEqual(['example', 'expires_at', 'liked_by_me', 'likes', 'score_type', 'share_no', 'shared_at', 'title']);
    expect(item.example).toBe(false); // 예시 공유 악보가 아님(2026-09-30 BR-SHR-08)

    const score = await other.get(`/api/shared-scores/${shareNo}/score`);
    expect(score.status).toBe(200);
    expect(score.body.musicxml).toContain('score-partwise');
    expect(JSON.stringify(score.body)).not.toContain(no);

    const l1 = await other.post(`/api/shared-scores/${shareNo}/like`);
    expect(l1.body).toMatchObject({ liked: true, likes: 1 });
    const l2 = await owner.post(`/api/shared-scores/${shareNo}/like`);
    expect(l2.body).toMatchObject({ liked: true, likes: 2 });
    const l3 = await other.post(`/api/shared-scores/${shareNo}/like`);
    expect(l3.body).toMatchObject({ liked: false, likes: 1 });   // A3 다시 누르면 취소
    const byLikes = await owner.get('/api/shared-scores').query({ sort: 'likes', limit: 50 });
    expect(byLikes.body.items.find((x: { share_no: string }) => x.share_no === shareNo)).toMatchObject({ likes: 1, liked_by_me: true });

    // 로그인 안 하면 목록도 좋아요도 안 된다(G13)
    expect((await request(app).get('/api/shared-scores')).status).toBe(401);
    expect((await request(app).post(`/api/shared-scores/${shareNo}/like`)).status).toBe(401);

    // A4 거두기 — 파일 삭제 · 목록에서 빠짐
    const un = await owner.delete(`/api/requests/${no}/share`);
    expect(un.body).toEqual({ shared: false });
    const after = await other.get('/api/shared-scores').query({ sort: 'recent', limit: 50 });
    expect(after.body.items.some((x: { share_no: string }) => x.share_no === shareNo)).toBe(false);
    expect((await other.get(`/api/shared-scores/${shareNo}/score`)).body.error.code).toBe('REQUEST_NOT_FOUND');   // E4
    expect(existsSync(resolve(process.env.STORAGE_DIR!, 'shared', shareNo))).toBe(false);
  });

  it('공유 복사본은 24시간 결과 정리(P0)에서 지워지지 않는다(BR-SHR-02)', async () => {
    const owner = await loggedInAgent(app, 'share-keep');
    const no = await completedRequest(owner);
    const sh = await owner.put(`/api/requests/${no}/share`).send({ title: '남는 악보' });
    const shareNo = String(sh.body.share_no);
    // 요청을 25시간 전에 받은 것으로 돌려 P0 대상이 되게 한다
    await exec('UPDATE score_request SET received_at = CURRENT_TIMESTAMP(3) - INTERVAL 25 HOUR WHERE request_no = ?', [no]);
    await purgeResults();
    expect((await one<{ purged_at: Date | null }>('SELECT purged_at FROM score_request WHERE request_no = ?', [no]))?.purged_at).toBeTruthy();
    const score = await owner.get(`/api/shared-scores/${shareNo}/score`);
    expect(score.status).toBe(200);
    expect(score.body.title).toBe('남는 악보');
  });
});

describe('공유 악보 3일 보관(2026-09-30 황송해 결정, BR-SHR-02)', () => {
  it('공유 시각 + 3일 · 지나면 목록 · 듣기에서 빠지고 P0 가 복사본 · 좋아요를 지운다(내린 것도 같음)', async () => {
    const owner = await loggedInAgent(app, 'share-ttl');
    const other = await loggedInAgent(app, 'share-ttl2');
    const no = await completedRequest(owner);
    const sh = await owner.put(`/api/requests/${no}/share`).send({ title: '3일 악보' });
    const shareNo = String(sh.body.share_no);
    const span = new Date(sh.body.expires_at).getTime() - new Date(sh.body.shared_at).getTime();
    expect(Math.round(span / 3600_000)).toBe(72);
    const listed = await other.get('/api/shared-scores').query({ sort: 'recent', limit: 50 });
    expect(listed.body.items.find((x: { share_no: string }) => x.share_no === shareNo).expires_at).toBeTruthy();
    await other.post(`/api/shared-scores/${shareNo}/like`);
    await exec('UPDATE shared_score SET taken_down_at = CURRENT_TIMESTAMP(3), expires_at = CURRENT_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE share_no = ?', [shareNo]);
    expect((await other.get(`/api/shared-scores/${shareNo}/score`)).body.error.code).toBe('REQUEST_NOT_FOUND');
    const after = await other.get('/api/shared-scores').query({ sort: 'recent', limit: 50 });
    expect(after.body.items.some((x: { share_no: string }) => x.share_no === shareNo)).toBe(false);
    expect(existsSync(resolve(process.env.STORAGE_DIR!, 'shared', shareNo))).toBe(true);
    expect(await purgeSharedScores()).toBeGreaterThanOrEqual(1);
    expect(existsSync(resolve(process.env.STORAGE_DIR!, 'shared', shareNo))).toBe(false);
    const row = await one<{ purged_at: Date | null; musicxml_uri: string | null; likes: number }>(
      'SELECT purged_at, musicxml_uri, (SELECT COUNT(*) FROM score_like l WHERE l.share_id = s.share_id) AS likes FROM shared_score s WHERE share_no = ?', [shareNo]);
    expect(row?.purged_at).toBeTruthy();
    expect(row?.musicxml_uri).toBeNull();
    expect(Number(row?.likes)).toBe(0);
    expect((await owner.get(`/api/requests/${no}/share`)).body).toEqual({ shared: false });
  });
});

describe('UC19 공유 악보 내리기(운영자)', () => {
  it('내리면 목록 · 듣기에서 빠지고 이력이 남는다 · 다시 올리면 돌아온다', async () => {
    const owner = await loggedInAgent(app, 'share-td');
    const no = await completedRequest(owner);
    const shareNo = String((await owner.put(`/api/requests/${no}/share`).send({ title: '내릴 악보' })).body.share_no);

    const login = `share-op-${Date.now()}`;
    const hash = await argon2.hash(PW, { type: argon2.argon2id });
    const a = await exec('INSERT INTO account (login_id, password_hash, display_name) VALUES (?, ?, ?)', [login, hash, login]);
    await exec("INSERT INTO account_role (account_id, role_code) VALUES (?, 'operator')", [a.insertId]);
    await exec('INSERT INTO operator_account (login_id, password_hash, display_name, account_id) VALUES (?, ?, ?, ?)', [login, hash, login, a.insertId]);
    const op = request.agent(admin);
    expect((await op.post('/admin/login').send({ login_id: login, password: PW })).status).toBe(200);

    const listed = await op.get('/admin/shared-scores').query({ status: 'visible' });
    const row = listed.body.items.find((x: { share_no: string }) => x.share_no === shareNo);
    expect(row).toMatchObject({ title: '내릴 악보', status: 'visible', likes: 0 });
    expect(JSON.stringify(row)).not.toContain(owner.email);

    const td = await op.post(`/admin/shared-scores/${shareNo}/take-down`).send({ reason: '시험' });
    expect(td.body).toEqual({ share_no: shareNo, status: 'taken_down' });
    expect((await owner.get(`/api/shared-scores/${shareNo}/score`)).body.error.code).toBe('REQUEST_NOT_FOUND');
    expect((await owner.get(`/api/requests/${no}/share`)).body).toMatchObject({ shared: true, taken_down: true });
    const hist = await one<{ field_name: string; after_value: string }>(
      "SELECT field_name, after_value FROM change_history WHERE target_type = 'shared_score' AND target_ref = ? ORDER BY history_id DESC LIMIT 1", [shareNo]);
    expect(hist).toMatchObject({ field_name: 'taken_down', after_value: '시험' });

    const rs = await op.post(`/admin/shared-scores/${shareNo}/restore`);
    expect(rs.body.status).toBe('visible');
    expect((await owner.get(`/api/shared-scores/${shareNo}/score`)).status).toBe(200);
    expect((await op.post('/admin/shared-scores/S-0000-NOTHERE/take-down')).body.error.code).toBe('REQUEST_NOT_FOUND');
    // 권한표: user UC18 · operator UC19
    expect(await one('SELECT 1 AS ok FROM role_permission WHERE role_code = ? AND uc_code = ?', ['user', 'UC18'])).toBeTruthy();
    expect(await one('SELECT 1 AS ok FROM role_permission WHERE role_code = ? AND uc_code = ?', ['operator', 'UC19'])).toBeTruthy();
  });
});

// (2026-10-01 황송해 확인 요청) 1단계 악보 공유하기 정렬 — 최신 순은 공유 시각이 늦은 것부터, 좋아요 순은 좋아요 많은 것부터
describe('UC18 공유 악보 목록 정렬', () => {
  it('최신 순 · 좋아요 순이 서로 다르게 정렬된다(오래된 악보에 좋아요가 더 많을 때)', async () => {
    const owner = await loggedInAgent(app, 'share-sort-owner');
    const other = await loggedInAgent(app, 'share-sort-other');
    const nos = [await completedRequest(owner), await completedRequest(owner), await completedRequest(owner)];
    const shares: string[] = [];
    for (const [i, no] of nos.entries()) {
      const sh = await owner.put(`/api/requests/${no}/share`).send({ title: `정렬 시험 ${i + 1}` });
      expect(sh.status).toBe(200);
      shares.push(String(sh.body.share_no));
    }
    // 공유 시각을 분명히 벌린다: 1번이 가장 오래, 3번이 가장 최근(다른 시험 항목보다 뒤)
    for (const [i, s] of shares.entries()) {
      await exec('UPDATE shared_score SET shared_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE) WHERE share_no = ?', [i + 1, s]);
    }
    // 가장 오래된 1번에 좋아요 2개, 2번에 1개, 3번은 0개
    const third = await loggedInAgent(app, 'share-sort-third');
    for (const a of [other, third]) expect((await a.post(`/api/shared-scores/${shares[0]}/like`)).status).toBe(200);
    expect((await other.post(`/api/shared-scores/${shares[1]}/like`)).status).toBe(200);

    const pick = (items: { share_no: string }[]) => items.map((x) => x.share_no).filter((n) => shares.includes(n));
    const recent = await other.get('/api/shared-scores').query({ sort: 'recent', limit: 50 });
    expect(recent.body.sort).toBe('recent');
    expect(pick(recent.body.items)).toEqual([shares[2], shares[1], shares[0]]);
    expect(recent.body.items[0].share_no).toBe(shares[2]); // 가장 최근 공유가 목록 맨 위
    // 최신 순 전체 목록이 공유 시각 내림차순
    const times = recent.body.items.map((x: { shared_at: string }) => new Date(x.shared_at).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));

    const likes = await other.get('/api/shared-scores').query({ sort: 'likes', limit: 50 });
    expect(pick(likes.body.items)).toEqual([shares[0], shares[1], shares[2]]);

    // 1단계는 한 쪽에 4개(limit=4) — 최신 순 첫 쪽 맨 위도 가장 최근 공유
    const page1 = await other.get('/api/shared-scores').query({ sort: 'recent', limit: 4, offset: 0 });
    expect(page1.body.items[0].share_no).toBe(shares[2]);
  });
});
