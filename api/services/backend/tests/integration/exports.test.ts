// #36 편집 · 내보내기 통합 시험 — 실제 MariaDB 필요 (TEST_DB_HOST 가 있을 때만 돈다). model-api 는 가짜.
//   v0.1.1 us7_us8 · midi_available · tempo_export 와 악기 기록 · 음원 제공을 시험한다.
import { HAS_DB } from '../helpers/env.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import type { Server } from 'node:http';
import { parseMidi } from '@gugak/score-core';
import { MIDI, SAMPLE_MUSICXML, makePng } from '../helpers/files.js';
import type { FakeModelApi } from '../helpers/fakeModelApi.js';

let app: Server;
let fake: FakeModelApi;
let db: typeof import('../../src/db/pool.js');
let h: typeof import('../helpers/db.js');
let loggedInAgent: typeof import('../helpers/auth.js').loggedInAgent;

type Agent = ReturnType<typeof request.agent>;
const binary = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  if (!HAS_DB) return;
  const { serve } = await import('../helpers/serve.js');
  const { createWebApp } = await import('../../src/app.js');
  const { startFakeModelApi } = await import('../helpers/fakeModelApi.js');
  db = await import('../../src/db/pool.js');
  h = await import('../helpers/db.js');
  ({ loggedInAgent } = await import('../helpers/auth.js'));
  app = serve(createWebApp());
  fake = await startFakeModelApi();
  await h.setSettings({ web_max_active_per_client: 100000, web_hourly_request_cap: 100000 });
});
afterAll(async () => { if (HAS_DB) { await fake.close(); await db.closePool(); } });

/** 업로드 → 완료 상태(작업자는 켜지 않고 helpers/db.ts 로 만든다) */
async function completed(who: string, midi = false) {
  const u = await loggedInAgent(app, who);
  const up = await u.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'song.png');
  expect(up.status).toBe(202);
  const no = up.body.id as string;
  const id = await h.completeRecognized(no, SAMPLE_MUSICXML);
  if (midi) {
    const { saveFile } = await import('../../src/services/storage.js');
    await db.exec('UPDATE score_result SET midi_uri = ? WHERE request_id = ?', [await saveFile(`${no}/result.mid`, MIDI), id]);
  }
  return { u, no, id };
}
const exportOf = (u: Agent, no: string, body: Record<string, unknown>) => u.post(`/api/requests/${no}/exports`).send({ edit_ops: [], ...body });
const settled = (u: Agent, no: string, id: string) => h.waitFor(
  () => u.get(`/api/requests/${no}/exports/${id}`).then((r) => r.body), (b) => b.status === 'ready' || b.status === 'failed');

describe.skipIf(!HAS_DB)('편집 기록', () => {
  const ops = [{ op: 'transpose', semitones: 2 }];

  it('[편집 마치기]는 연산 · 조옮김 · 트랙을 남기고, 원본 결과는 그대로다', async () => {
    const { u, no, id } = await completed('e1');
    const r = await u.put(`/api/requests/${no}/edits`).send({ summary: { edited: true }, ops });
    expect(r.status).toBe(204);
    const e = await db.one<{ edit_id: number; transpose_semitones: number; finished_at: Date | null; ops_json: unknown }>(
      'SELECT edit_id, transpose_semitones, finished_at, ops_json FROM edited_score WHERE request_id = ?', [id]);
    expect(e).toMatchObject({ transpose_semitones: 2 });
    expect(e!.finished_at).not.toBeNull();
    expect(await db.one('SELECT COUNT(*) AS n FROM edited_track WHERE edit_id = ?', [e!.edit_id])).toMatchObject({ n: 1 });
    expect((await u.get(`/api/requests/${no}/score`)).body.musicxml).toBe(SAMPLE_MUSICXML);
  });

  it('[작업 저장하기](finished:false)는 마침으로 치지 않는다, 빈 연산이면 연산만 지운다', async () => {
    const { u, no, id } = await completed('e2');
    expect((await u.put(`/api/requests/${no}/edits`).send({ summary: {}, ops, finished: false })).status).toBe(204);
    const saved = await db.one<{ finished_at: Date | null; ops_json: string | null }>('SELECT finished_at, ops_json FROM edited_score WHERE request_id = ?', [id]);
    expect(saved?.finished_at).toBeNull();
    expect(saved?.ops_json).toBeTruthy();
    await u.put(`/api/requests/${no}/edits`).send({ summary: {}, ops: [], finished: false });
    expect((await db.one<{ ops_json: string | null }>('SELECT ops_json FROM edited_score WHERE request_id = ?', [id]))?.ops_json).toBeNull();
  });

  it('원본으로 되돌리고 마치면 되돌린 시각이 남는다', async () => {
    const { u, no, id } = await completed('e3');
    await u.put(`/api/requests/${no}/edits`).send({ summary: { edited: true }, ops });
    await u.put(`/api/requests/${no}/edits`).send({ summary: { edited: false }, ops: [] });
    expect((await db.one<{ reverted_at: Date | null }>('SELECT reverted_at FROM edited_score WHERE request_id = ?', [id]))?.reverted_at).not.toBeNull();
  });

  it('연산이 배열이 아니면 400, 다른 계정은 404', async () => {
    const { u, no } = await completed('e4');
    const bad = await u.put(`/api/requests/${no}/edits`).send({ summary: {}, ops: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details).toMatchObject({ field: 'ops' });
    expect((await (await loggedInAgent(app, 'e4b')).put(`/api/requests/${no}/edits`).send({ summary: {}, ops })).status).toBe(404);
  });
});

describe.skipIf(!HAS_DB)('내보내기', () => {
  it('MIDI · MusicXML 은 model-api 없이 바로 ready, 편집이 반영되고 내려받기가 기록된다', async () => {
    const { u, no, id } = await completed('x1');
    const ops = [{ op: 'transpose', semitones: 2 }, { op: 'change_instrument', part: 0, instrument: 'haegeum' }];
    const midi = await exportOf(u, no, { format: 'midi', edit_ops: ops });
    expect(midi.status).toBe(202);
    expect(midi.body).toMatchObject({ format: 'midi', status: 'ready', basis: 'edited', failure_reason: null, notices: [] });
    const file = await u.get(midi.body.download_url).buffer(true).parse(binary);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/audio\/midi/);
    expect(file.headers['content-disposition']).toContain(`${no}.mid`);
    expect(parseMidi(new Uint8Array(file.body as Buffer)).parts[0].notes[0].pitch).toBe(62);
    const xml = await exportOf(u, no, { format: 'musicxml', edit_ops: ops });
    expect((await u.get(xml.body.download_url).buffer(true).parse(binary)).body.toString()).toContain('해금');
    expect(await db.one<{ storage_uri: string }>('SELECT storage_uri FROM derived_file WHERE file_id = ?', [midi.body.id]))
      .toEqual({ storage_uri: `${no}/exports/${midi.body.id}.mid` });
    expect(await db.one('SELECT COUNT(*) AS n FROM download_event WHERE request_id = ?', [id])).toMatchObject({ n: 2 });
    expect(await db.one('SELECT edited, transpose_semitones, downloaded_midi_after_edit FROM v_edit_record WHERE request_id = ?', [id]))
      .toMatchObject({ edited: 1, transpose_semitones: 2, downloaded_midi_after_edit: 1 });
  });

  it('편집 없으면 basis=original, 빠르기 편집은 MIDI · MusicXML 에 들어간다', async () => {
    const { u, no } = await completed('x2');
    expect((await exportOf(u, no, { format: 'musicxml' })).body.basis).toBe('original');
    const ops = [{ op: 'set_tempo', bpm: 150 }];
    const midi = await exportOf(u, no, { format: 'midi', edit_ops: ops });
    expect(parseMidi(new Uint8Array((await u.get(midi.body.download_url).buffer(true).parse(binary)).body as Buffer)).tempoBpm).toBeCloseTo(150, 0);
    const xml = await exportOf(u, no, { format: 'musicxml', edit_ops: ops });
    expect((await u.get(xml.body.download_url).buffer(true).parse(binary)).body.toString()).toContain('tempo="150"');
  });

  it('MP3 는 model-api 로 렌더링해 받는다 — 성부별 악기를 넘기고 사용자 음원은 없다', async () => {
    const { u, no } = await completed('x3');
    fake.calls.length = 0;
    fake.on('post', '/v1/render/mp3', (_q, s) => { s.set('X-Renderer', 'fluidsynth 2.3').type('audio/mpeg').send(Buffer.from('ID3-mp3')); });
    const mp3 = await exportOf(u, no, { format: 'mp3', edit_ops: [{ op: 'change_instrument', part: 0, instrument: 'daegeum' }] });
    expect(mp3.status).toBe(202);
    expect(mp3.body.notices.join(' ')).toContain('팀 내부 시연');
    const done = await settled(u, no, mp3.body.id);
    expect(done).toMatchObject({ status: 'ready', renderer: 'fluidsynth 2.3' });
    expect(JSON.parse(String(fake.calls[0].fields.instruments))).toEqual({ mode: 'custom', tracks: [{ part: 0, instrument: 'daegeum' }] });
    expect(fake.calls[0].files).toEqual(['score.mid']);
    const f = await u.get(done.download_url).buffer(true).parse(binary);
    expect(f.headers['content-type']).toMatch(/audio\/mpeg/);
    expect(f.body.toString()).toBe('ID3-mp3');
  });

  it('PDF 는 편집 반영 MusicXML 로 렌더링한다', async () => {
    const { u, no } = await completed('x4');
    fake.calls.length = 0;
    fake.on('post', '/v1/render/pdf', (_q, s) => { s.type('application/pdf').send(Buffer.from('%PDF')); });
    const pdf = await exportOf(u, no, { format: 'pdf' });
    expect((await settled(u, no, pdf.body.id)).status).toBe('ready');
    expect(fake.calls[0].files).toEqual(['score.musicxml']);
  });

  it.each([
    [502, { error: { code: 'RENDERER_MISSING' } }, 'RENDERER_MISSING'],
    [500, { error: { code: '계약에 없는 코드' } }, 'RENDER_FAILED'],
  ])('렌더링 실패(%s)는 실패로 표시되고 MIDI 받기는 그대로 된다', async (status, body, reason) => {
    const { u, no } = await completed('x5');
    fake.on('post', '/v1/render/mp3', (_q, s) => { s.status(status).json(body); });
    const mp3 = await exportOf(u, no, { format: 'mp3' });
    expect(await settled(u, no, mp3.body.id)).toMatchObject({ status: 'failed', failure_reason: reason, download_url: null });
    expect((await exportOf(u, no, { format: 'midi' })).body.status).toBe('ready');
    expect((await u.get(`/api/requests/${no}/exports/${mp3.body.id}/file`)).status).toBe(404);
  });

  it('재시작하면 끝나지 않은 렌더링은 실패로 돌린다', async () => {
    const { u, no, id } = await completed('x6');
    const ins = await db.exec("INSERT INTO derived_file (request_id, format, basis, render_status) VALUES (?, 'mp3', 'original', 'rendering')", [id]);
    const { recoverRenders } = await import('../../src/services/renderQueue.js');
    await recoverRenders();
    expect((await u.get(`/api/requests/${no}/exports/${ins.insertId}`)).body).toMatchObject({ status: 'failed', failure_reason: 'RENDER_FAILED' });
  });

  it('잘못된 입력: 형식 · 악보 없는 번호 · 완료 전 · 다른 계정', async () => {
    const { u, no } = await completed('x7');
    expect((await exportOf(u, no, { format: 'wav' })).status).toBe(400);
    expect((await u.get(`/api/requests/${no}/exports/abc`)).status).toBe(404);
    expect((await u.get(`/api/requests/${no}/exports/999999999`)).status).toBe(404);
    const other = await loggedInAgent(app, 'x7b');
    const mine = await exportOf(u, no, { format: 'midi' });
    expect((await other.get(`/api/requests/${no}/exports/${mine.body.id}`)).status).toBe(404);
    const up = await other.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'q.png');
    expect((await exportOf(other, up.body.id, { format: 'midi' })).status).toBe(409);
  });

  it('파일이 저장소에서 사라졌으면 내려받기는 410', async () => {
    const { u, no } = await completed('x8');
    const midi = await exportOf(u, no, { format: 'midi' });
    rmSync(join(process.env.STORAGE_DIR!, no, 'exports', `${midi.body.id}.mid`));
    expect((await u.get(midi.body.download_url)).status).toBe(410);
  });
});

describe.skipIf(!HAS_DB)('원본 결과 내려받기', () => {
  it('MusicXML · MIDI 를 받고 기록한다', async () => {
    const { u, no, id } = await completed('o1', true);
    const xml = await u.get(`/api/requests/${no}/original/musicxml`);
    expect(xml.status).toBe(200);
    expect(xml.headers['content-disposition']).toContain(`${no}.musicxml`);
    expect((await u.get(`/api/requests/${no}/original/midi`)).status).toBe(200);
    expect(await db.one('SELECT COUNT(*) AS n FROM download_event WHERE request_id = ?', [id])).toMatchObject({ n: 2 });
  });

  it('MIDI 가 없는 결과는 409 MIDI_UNAVAILABLE, 틀린 형식은 400', async () => {
    const { u, no } = await completed('o2');
    const r = await u.get(`/api/requests/${no}/original/midi`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('MIDI_UNAVAILABLE');
    expect((await u.get(`/api/requests/${no}/original/wav`)).status).toBe(400);
  });
});

describe.skipIf(!HAS_DB)('악기 · 화면 이벤트', () => {
  it('악기 목록: 국악기 먼저 · 소리 번호 · 사용자 음원 없음, 방문자는 401', async () => {
    const u = await loggedInAgent(app, 'i1');
    const r = await u.get('/api/instruments');
    expect(r.status).toBe(200);
    expect(r.body.default_set).toEqual(['gayageum', 'janggu']);
    expect(r.body.gugak[0]).toMatchObject({ id: 'gayageum', bank: 1, program: 0, gm_program: 107, soundfont: 'gugak.sf2' });
    expect(r.body.others.length).toBeGreaterThan(0);
    expect(r.body.custom).toBeUndefined();
    expect((await request(app).get('/api/instruments')).status).toBe(401);
  });

  it('result_shown: 시각을 한 번만 적고, 타악 성부가 없으면 장구는 기록하지 않는다', async () => {
    const { u, no, id } = await completed('i2');
    expect((await u.post(`/api/requests/${no}/events`).send({ event: 'result_shown' })).status).toBe(204);
    const first = await db.one<{ result_shown_at: Date }>('SELECT result_shown_at FROM score_request WHERE request_id = ?', [id]);
    await u.post(`/api/requests/${no}/events`).send({ event: 'result_shown' });
    expect(await db.one('SELECT result_shown_at FROM score_request WHERE request_id = ?', [id])).toEqual(first);
    const codes = await db.query<{ code: string }>(
      `SELECT i.code FROM instrument_selection s JOIN ensemble_member m ON m.ensemble_id = s.ensemble_id
         JOIN instrument i ON i.instrument_id = m.instrument_id WHERE s.request_id = ?`, [id]);
    expect(codes.map((c) => c.code)).toEqual(['gayageum']);
    expect((await db.query('SELECT 1 FROM instrument_selection WHERE request_id = ?', [id])).length).toBe(1);
  });

  it('first_played 는 시각만, 모르는 이벤트는 400', async () => {
    const { u, no, id } = await completed('i3');
    expect((await u.post(`/api/requests/${no}/events`).send({ event: 'first_played' })).status).toBe(204);
    expect((await db.one<{ first_played_at: Date | null }>('SELECT first_played_at FROM score_request WHERE request_id = ?', [id]))?.first_played_at).not.toBeNull();
    expect((await u.post(`/api/requests/${no}/events`).send({ event: 'x' })).status).toBe(400);
  });
});

describe.skipIf(!HAS_DB)('음원 제공', () => {
  it('로그인 없이 받고 세션을 만들지 않는다, 바뀌지 않았으면 304, 없는 파일 · 폴더 밖은 404', async () => {
    const dir = process.env.SOUNDFONTS_DIR!;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'gugak.sf2'), Buffer.alloc(2048, 1));
    const r = await request(app).get('/soundfonts/gugak.sf2').buffer(true).parse(binary);
    expect(r.status).toBe(200);
    expect((r.body as Buffer).length).toBe(2048);
    expect(r.headers['set-cookie']).toBeUndefined();
    expect((await request(app).get('/soundfonts/gugak.sf2').set('If-None-Match', r.headers.etag)).status).toBe(304);
    expect((await request(app).get('/soundfonts/nothing.sf2')).status).toBe(404);
    expect((await request(app).get('/soundfonts/..%2Fetc%2Fpasswd')).status).toBe(404);
  });
});
