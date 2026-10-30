// T128 (US7): 내려받기 MIDI·MusicXML 은 모델 API 없이 바로, MP3 실패해도 나머지는 계속, 편집 기록
// (웹은 사진만 받으므로(2026-09-29) 완료된 요청은 사진 → 가짜 인식 결과로 만든다)
// US8(내 SoundFont 악기로 연주하기)은 2026-09-29 삭제(황송해 결정) — .sf2 올리기 경로가 없고, [나가기]·2시간 무활동 세션 종료만 남는다
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import { startFakeModelApi, SAMPLE_MUSICXML, type FakeModelApi } from '../helpers/fakeModelApi.js';
import { makeMidi, makePng } from '../helpers/files.js';
import { exec, one, waitFor } from '../helpers/db.js';
import { createWebApp } from '../../src/server.js';
import { purgeEndedSessions } from '../../src/services/jobs/purgeSessions.js';
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

/** 사진 올리기 → 인식 완료까지 */
async function completedRequest(agent: ReturnType<typeof request.agent>) {
  const up = await agent.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'song.png');
  expect(up.status).toBe(202);
  await waitFor(() => agent.get(`/api/requests/${up.body.id}`).then((r) => r.body), (b) => b.status === 'completed');
  return up;
}
afterAll(async () => { await fake.close(); await closePool(); });

/** 응답의 세션 쿠키(gugak_sid=<id>.<서명>)에서 세션 id 를 꺼낸다 */
describe('US7 exports', () => {
  it('MIDI/MusicXML ready without the model API; MP3 failure keeps them usable', async () => {
    const agent = (await loggedInAgent(app));
    const up = await completedRequest(agent);
    const ops = [{ op: 'transpose', semitones: 2 }, { op: 'change_instrument', part: 0, instrument: 'haegeum' }];
    fake.on('post', '/v1/render/mp3', (_q, s) => s.status(502).json({ error: { code: 'RENDERER_MISSING', message: 'x' } }));
    const mp3 = await agent.post(`/api/requests/${up.body.id}/exports`).send({ format: 'mp3', edit_ops: ops });
    expect(mp3.status).toBe(202);
    const midi = await agent.post(`/api/requests/${up.body.id}/exports`).send({ format: 'midi', edit_ops: ops });
    expect(midi.body.status).toBe('ready');
    expect(midi.body.basis).toBe('edited');
    const file = await agent.get(midi.body.download_url);
    expect(file.status).toBe(200);
    const xml = await agent.post(`/api/requests/${up.body.id}/exports`).send({ format: 'musicxml', edit_ops: ops });
    const xmlFile = await agent.get(xml.body.download_url);
    expect(xmlFile.text).toContain('해금');
    const failed = await waitFor(() => agent.get(`/api/requests/${up.body.id}/exports/${mp3.body.id}`).then((r) => r.body), (b) => b.status === 'failed');
    expect(failed.failure_reason).toBe('RENDERER_MISSING');
    expect(failed.notices.join(' ')).toContain('팀 내부 시연');
    const rec = await one<{ edited: number; transpose_semitones: number; downloaded_midi_after_edit: number }>(
      'SELECT v.* FROM v_edit_record v JOIN score_request r ON r.request_id = v.request_id WHERE r.request_no = ?', [up.body.id]);
    expect(rec).toMatchObject({ edited: 1, transpose_semitones: 2, downloaded_midi_after_edit: 1 });
  });

  it('MP3 sends the chosen instrument per part, no user sound font (no default overwrite)', async () => {
    const agent = (await loggedInAgent(app));
    const up = await completedRequest(agent);
    let fields: Record<string, unknown> = {};
    let fileNames: string[] = [];
    fake.on('post', '/v1/render/mp3', (q, s) => {
      fields = { ...q.body };
      fileNames = ((q as unknown as { files?: { fieldname: string; originalname: string }[] }).files ?? []).map((f) => f.fieldname);
      s.status(502).json({ error: { code: 'RENDERER_MISSING', message: 'x' } });
    });
    const ops = [{ op: 'change_instrument', part: 0, instrument: 'daegeum' }];
    const mp3 = await agent.post(`/api/requests/${up.body.id}/exports`).send({ format: 'mp3', edit_ops: ops });
    expect(mp3.status).toBe(202);
    await waitFor(() => agent.get(`/api/requests/${up.body.id}/exports/${mp3.body.id}`).then((r) => r.body), (b) => b.status === 'failed');
    const sent = JSON.parse(String(fields.instruments));
    expect(sent.mode).toBe('custom');
    expect(sent.tracks[0]).toEqual({ part: 0, instrument: 'daegeum' });
    expect(fileNames).not.toContain('sf2_files');
    expect(fields.session_id).toBeUndefined();
  });
});

describe('US8 removed (user .sf2)', () => {
  it('has no .sf2 upload endpoint and no custom instrument list', async () => {
    const agent = (await loggedInAgent(app));
    const inst = await agent.get('/api/instruments');
    expect(inst.body.custom).toBeUndefined();
    expect(inst.body.gugak[0].id).toBe('gayageum');
    expect(inst.body.gugak[0]).toMatchObject({ bank: 1, program: 0, gm_program: 107 }); // 결정 C11 소리 번호 + GM 호환 번호
    const up = await agent.post('/api/sf2').attach('file', Buffer.from('RIFF\0\0\0\0sfbk'), 'mine.sf2');
    expect(up.status).toBe(404);
    expect((await agent.get('/api/sf2/sf2:1')).status).toBe(404);
  });

  it('[나가기] still ends the session', async () => {
    const agent = (await loggedInAgent(app));
    // 2026-09-29 RBAC: 가입할 때 받은 세션(쿠키는 그때 한 번 발급된다)
    const sid = (await one<{ session_id: string }>('SELECT session_id FROM anon_session WHERE account_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1', [agent.accountId]))!.session_id;
    expect((await agent.post('/api/session/end')).status).toBe(204);
    const row = await one<{ end_reason: string | null }>('SELECT end_reason FROM anon_session WHERE session_id = ?', [sid]);
    expect(row!.end_reason).toBe('exit');
  });

  it('ends sessions after 2 hours idle', async () => {
    const agent = (await loggedInAgent(app));
    // 2026-09-29 RBAC: 가입할 때 받은 세션(쿠키는 그때 한 번 발급된다)
    const sid = (await one<{ session_id: string }>('SELECT session_id FROM anon_session WHERE account_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1', [agent.accountId]))!.session_id;
    await exec('UPDATE anon_session SET last_active_at = CURRENT_TIMESTAMP(3) - INTERVAL 121 MINUTE WHERE session_id = ?', [sid]);
    expect(await purgeEndedSessions()).toBeGreaterThanOrEqual(1);
    const sess = await one<{ end_reason: string }>('SELECT end_reason FROM anon_session WHERE session_id = ?', [sid]);
    expect(sess!.end_reason).toBe('idle');
  });
});
