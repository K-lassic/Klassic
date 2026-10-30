// US3 (T079·T080·SC-002): 반려는 요청 행을 만들지 않는다 · FR-062 웹 사용자 한도(G12)
// US4: 받는 파일은 사진·PDF(2026-09-29 황송해 결정, 웹·API 같음) — MIDI·MusicXML 은 G1 UPLOAD_UNSUPPORTED_TYPE 으로 반려, 요청 행 없음.
// PDF 는 열기·쪽수·쪽마다 사진 크기를 모델 API 검사기(/v1/internal/upload-check)에 맡긴다. (2026-09-29 여러 쪽) 모든 쪽을
// 변환하고 일부 쪽만 못 읽으면 PAGES_PARTIAL 안내, 모델 API 에 닿지 않으면 PDF 는 503 UPLOAD_CHECK_UNAVAILABLE(요청 행 없음).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import { startFakeModelApi, SAMPLE_MUSICXML, type FakeModelApi } from '../helpers/fakeModelApi.js';
import { makePng, makeMidi } from '../helpers/files.js';
import { one, query, setSettings, waitFor } from '../helpers/db.js';
import { createWebApp } from '../../src/server.js';
import { startWorker } from '../../src/services/requestWorker.js';
import { closePool } from '../../src/db/pool.js';

let fake: FakeModelApi;
const app = serve(createWebApp());
beforeAll(async () => { fake = await startFakeModelApi(); await startWorker(); });
afterAll(async () => { await fake.close(); await closePool(); });

describe('US3 rejections', () => {
  it('rejects before accepting and creates no request row', async () => {
    const before = await one<{ n: number }>('SELECT COUNT(*) AS n FROM score_request');
    const agent = (await loggedInAgent(app));
    const r1 = await agent.post('/api/requests').field('score_type', 'staff').attach('file', Buffer.from('text'), 'a.txt');
    expect(r1.status).toBe(415);
    expect(r1.body.error).toMatchObject({ code: 'UPLOAD_UNSUPPORTED_TYPE', gate: 'G1' });
    expect(r1.body.error.fix).toBeTruthy();
    // (2026-09-30 T187) 사진 두 장은 이제 한 곡으로 받는다 — PDF 와 사진을 섞으면 UPLOAD_TOO_MANY_FILES
    const r2 = await agent.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'a.png')
      .attach('file', Buffer.from('%PDF-1.7\n%%EOF\n'), 'b.pdf');
    expect(r2.body.error.code).toBe('UPLOAD_TOO_MANY_FILES');
    const r3 = await agent.post('/api/requests').field('score_type', 'staff').attach('file', makePng(250, 900), 'a.png');
    expect(r3.body.error.code).toBe('UPLOAD_RESOLUTION_TOO_LOW'); // (2026-09-30 119번) 반려 기준 300px
    const after = await one<{ n: number }>('SELECT COUNT(*) AS n FROM score_request');
    expect(after!.n).toBe(before!.n);
    const g = await query("SELECT reason_code FROM gate_event WHERE gate_code = 'G1' ORDER BY event_id DESC LIMIT 3");
    expect(g.length).toBe(3);
  });

  it('G12: one active request per session, then hourly cap', async () => {
    // 인식이 끝나지 않게 붙잡아 둔다
    fake.on('post', '/v1/omr/staff', async (_q, s) => { await new Promise((r) => setTimeout(r, 3000)); s.status(503).end(); });
    await setSettings({ web_max_active_per_client: 1 });
    try {
      const agent = (await loggedInAgent(app));
      const a = await agent.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'a.png');
      expect(a.status).toBe(202);
      const b = await agent.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'b.png');
      expect(b.status).toBe(429);
      expect(b.body.error.code).toBe('WEB_ACTIVE_REQUEST_EXISTS');
      expect(b.body.error.retry_after).toBeTruthy();
      expect(b.headers['retry-after']).toBeTruthy();
      await waitFor(() => agent.get(`/api/requests/${a.body.id}`).then((r) => r.body), (x) => x.status === 'completed', 10000);
      // 같은 주소(127.0.0.1)가 이번 시간에 이미 1건 이상 올렸으므로 상한 1 이면 막힌다
      await setSettings({ web_hourly_request_cap: 1, web_max_active_per_client: 1000 });
      const c = await (await loggedInAgent(app)).post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'c.png');
      expect(c.status).toBe(429);
      expect(c.body.error.code).toBe('WEB_HOURLY_LIMIT');
    } finally {
      await setSettings({ web_hourly_request_cap: 1000, web_max_active_per_client: 1000 });
    }
  });
});

describe('US4 photos · PDF only (2026-09-29 사진·PDF 입력) — MIDI · MusicXML rejected', () => {
  it.each([
    ['piano.mid', () => makeMidi(0)],
    ['song.musicxml', () => Buffer.from(SAMPLE_MUSICXML)],
  ])('%s → 415 UPLOAD_UNSUPPORTED_TYPE, no request row, G1 gate event', async (name, make) => {
    const before = await one<{ n: number }>('SELECT COUNT(*) AS n FROM score_request');
    const agent = (await loggedInAgent(app));
    const up = await agent.post('/api/requests').field('score_type', 'staff').attach('file', make(), name);
    expect(up.status).toBe(415);
    expect(up.body.error).toMatchObject({ code: 'UPLOAD_UNSUPPORTED_TYPE', gate: 'G1', message: '받을 수 없는 파일 형식입니다.' });
    // 웹·API 같은 고치는 방법 — 사진이나 PDF 로 다시 올리라고 알린다
    expect(up.body.error.fix).toContain('PDF');
    expect(up.body.error.fix).toContain('MIDI·MusicXML은 받지 않습니다');
    expect(up.body.error.details).toMatchObject({ allowed: ['image', 'pdf'] });
    const after = await one<{ n: number }>('SELECT COUNT(*) AS n FROM score_request');
    expect(after!.n).toBe(before!.n);
    const g = await one<{ reason_code: string }>("SELECT reason_code FROM gate_event WHERE gate_code = 'G1' ORDER BY event_id DESC LIMIT 1");
    expect(g!.reason_code).toBe('UPLOAD_UNSUPPORTED_TYPE');
  });

  it('a photo with a score type is still accepted (recognize route)', async () => {
    const up = await (await loggedInAgent(app)).post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'a.png');
    expect(up.status).toBe(202);
    expect(up.body.route).toBe('recognize');
  });

  const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF\n')]);
  const omrOk = (pages: number | null) => (_q: unknown, s: import('express').Response) => {
    s.json({ api_version: 'v1', fallback: false, fallback_reason: null, structure_verdict: 'pass', type_mismatch: false,
      detected_type: null, validity_grade: 'trust', musicxml: SAMPLE_MUSICXML, midi_base64: makeMidi().toString('base64'),
      engine: { name: 'homr', version: '0.test' }, file_kind: 'pdf', pdf_page_count: pages, short_edge_px: 2126 });
  };

  it('multi-page PDF → model API check (pages 3) → recognize all pages → completed; partial failure → PAGES_PARTIAL', async () => {
    fake.on('post', '/v1/internal/upload-check', (q, s) => {
      expect((q as unknown as { files: { originalname: string }[] }).files[0].originalname).toBe('score.pdf');
      s.json({ ok: true, kind: 'pdf', short_edge_px: 2126, pdf_page_count: 3, page_count: 3, pages: [] });
    });
    fake.on('post', '/v1/omr/staff', omrOk(3));
    const agent = (await loggedInAgent(app));
    const up = await agent.post('/api/requests').field('score_type', 'staff').attach('file', PDF, 'score.pdf');
    expect(up.status).toBe(202);
    expect(up.body).toMatchObject({ file_kind: 'pdf', route: 'recognize', score_type: 'staff', pdf_page_count: 3, page_count: 3 });
    const done = await waitFor(() => agent.get(`/api/requests/${up.body.id}`).then((r) => r.body), (x) => x.status === 'completed', 10000);
    expect(done.notice).toBeNull();
    const row = await one<{ request_id: number; file_kind: string; pdf_page_count: number; pdf_converted_page: number | null; image_short_side_px: number; file_no: number }>(
      `SELECT r.request_id, r.file_kind, u.pdf_page_count, u.pdf_converted_page, u.image_short_side_px, u.file_no FROM score_request r
         JOIN upload_file u ON u.request_id = r.request_id WHERE r.request_no = ?`, [up.body.id]);
    expect(row).toMatchObject({ file_kind: 'pdf', pdf_page_count: 3, pdf_converted_page: null, image_short_side_px: 2126, file_no: 1 });
    // 모델 API 가 쪽 판정(request_page)을 적는다 — 2쪽만 못 읽었다고 적어 두면 부분 실패 안내와 쪽별 상태가 나온다
    for (const [no, outcome, reason] of [[1, 'converted', null], [2, 'failed', 'no_structure'], [3, 'converted', null]] as const) {
      await query(
        `INSERT INTO request_page (request_id, page_no, file_no, source, outcome, fallback_reason, validity_grade)
         VALUES (?, ?, 1, 'pdf_page', ?, ?, ?)`, [row!.request_id, no, outcome, reason, outcome === 'converted' ? 'trust' : null]);
    }
    const again = (await agent.get(`/api/requests/${up.body.id}`)).body;
    expect(again.notice).toEqual({ code: 'PAGES_PARTIAL', message: '3쪽 중 2쪽 변환했습니다 (못 읽은 쪽: 2쪽)', pages: 3, converted: 2, failed_pages: [2] });
    expect(again.pages.map((p: { outcome: string }) => p.outcome)).toEqual(['converted', 'failed', 'converted']);
    expect(again.pages[1]).toMatchObject({ page_no: 2, source: 'pdf_page', fallback_reason: 'NO_SCORE_STRUCTURE' });
  });

  it('corrupted / encrypted PDF (model API G1) → 422 UPLOAD_CORRUPTED, no request row', async () => {
    fake.on('post', '/v1/internal/upload-check', (_q, s) => {
      s.status(422).json({ error: { code: 'UPLOAD_CORRUPTED', gate: 'G1', details: { reason: 'encrypted' } }, api_version: 'v1' });
    });
    const before = await one<{ n: number }>('SELECT COUNT(*) AS n FROM score_request');
    const up = await (await loggedInAgent(app)).post('/api/requests').field('score_type', 'staff').attach('file', PDF, 'locked.pdf');
    expect(up.status).toBe(422);
    expect(up.body.error).toMatchObject({ code: 'UPLOAD_CORRUPTED', gate: 'G1', details: { reason: 'encrypted' } });
    const after = await one<{ n: number }>('SELECT COUNT(*) AS n FROM score_request');
    expect(after!.n).toBe(before!.n);
  });

  it('PDF needs a score type too; a single-page PDF has no notice', async () => {
    // 모델 API 검사기가 악보 종류 없음을 알리면 그대로 반려
    fake.on('post', '/v1/internal/upload-check', (_q, s) => {
      s.status(400).json({ error: { code: 'UPLOAD_SCORE_TYPE_REQUIRED', gate: 'G1', details: {} } });
    });
    const r1 = await (await loggedInAgent(app)).post('/api/requests').attach('file', PDF, 'score.pdf');
    expect(r1.status).toBe(400);
    expect(r1.body.error.code).toBe('UPLOAD_SCORE_TYPE_REQUIRED');
    // 모델 API 가 닿지 않아도 웹 자체 판정으로 같은 반려
    fake.on('post', '/v1/internal/upload-check', (_q, s) => { s.status(503).json({ error: { code: 'INTERNAL_ERROR' } }); });
    const r2 = await (await loggedInAgent(app)).post('/api/requests').attach('file', PDF, 'score.pdf');
    expect(r2.status).toBe(400);
    expect(r2.body.error.code).toBe('UPLOAD_SCORE_TYPE_REQUIRED');
    fake.on('post', '/v1/internal/upload-check', (_q, s) => {
      s.json({ ok: true, kind: 'pdf', short_edge_px: 2126, pdf_page_count: 1, page_count: 1, pages: [] });
    });
    fake.on('post', '/v1/omr/staff', omrOk(1));
    const agent = (await loggedInAgent(app));
    const up = await agent.post('/api/requests').field('score_type', 'staff').attach('file', PDF, 'one.pdf');
    expect(up.status).toBe(202);
    const done = await waitFor(() => agent.get(`/api/requests/${up.body.id}`).then((r) => r.body), (x) => x.status === 'completed', 10000);
    expect(done.notice).toBeNull();
    expect(done.pdf_page_count).toBe(1);
  });

  it('model API unreachable at upload → PDF rejected 503 UPLOAD_CHECK_UNAVAILABLE, no request row; images unaffected', async () => {
    // 2026-09-29 황송해 결정(BR-UPL-06): PDF 를 확인할 수 없으면 접수하지 않는다
    fake.on('post', '/v1/internal/upload-check', (_q, s) => { s.status(503).json({ error: { code: 'INTERNAL_ERROR' } }); });
    const before = await one<{ n: number }>('SELECT COUNT(*) AS n FROM score_request');
    const agent = (await loggedInAgent(app));
    const up = await agent.post('/api/requests').field('score_type', 'jeongganbo').attach('file', PDF, 'two.pdf');
    expect(up.status).toBe(503);
    expect(up.body.error).toMatchObject({ code: 'UPLOAD_CHECK_UNAVAILABLE', gate: 'G1' });
    expect(up.body.error.message).toBe('지금은 PDF 를 확인할 수 없습니다. 잠시 뒤 다시 올리거나 사진으로 올려 주십시오.');
    const after = await one<{ n: number }>('SELECT COUNT(*) AS n FROM score_request');
    expect(after!.n).toBe(before!.n);
    // 모델 API 가 11쪽 PDF 를 반려하면 그대로 UPLOAD_TOO_MANY_PAGES
    fake.on('post', '/v1/internal/upload-check', (_q, s) => {
      s.status(400).json({ error: { code: 'UPLOAD_TOO_MANY_PAGES', gate: 'G1', details: { pdf_page_count: 11, max_pages: 10 } } });
    });
    const big = await agent.post('/api/requests').field('score_type', 'staff').attach('file', PDF, 'eleven.pdf');
    expect(big.status).toBe(400);
    expect(big.body.error.code).toBe('UPLOAD_TOO_MANY_PAGES');
    // 사진은 모델 API 검사 없이 웹 판정으로 접수한다
    const img = await agent.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'a.png');
    expect(img.status).toBe(202);
  });
});

// T187 (2026-09-30 여러 쪽, BR-UPL-02 · UC3 E5·E9): 웹도 사진 여러 장(최대 10장, 올린 순서)을 한 곡으로 받는다
describe('several photos → one request, pages in upload order', () => {
  it('two photos → upload_file 1·2, stored as original1·2, sent to the model API as image × 2 in order', async () => {
    let names: string[] = [];
    fake.on('post', '/v1/omr/staff', (q, s) => {
      names = ((q as unknown as { files: { fieldname: string; originalname: string }[] }).files)
        .filter((f) => f.fieldname === 'image').map((f) => f.originalname);
      s.json({ api_version: 'v1', fallback: false, fallback_reason: null, structure_verdict: 'pass', type_mismatch: false,
        detected_type: null, validity_grade: 'trust', musicxml: SAMPLE_MUSICXML, midi_base64: makeMidi().toString('base64'),
        engine: { name: 'homr', version: '0.test' }, file_kind: 'image', page_count: 2 });
    });
    const agent = (await loggedInAgent(app));
    const up = await agent.post('/api/requests').field('score_type', 'staff')
      .attach('file', makePng(1000, 900), 'first.png').attach('file', makePng(700, 1200), 'second.png');
    expect(up.status).toBe(202);
    expect(up.body).toMatchObject({ file_kind: 'image', route: 'recognize', page_count: 2, pdf_page_count: null });
    const done = await waitFor(() => agent.get(`/api/requests/${up.body.id}`).then((r) => r.body), (x) => x.status === 'completed', 10000);
    expect(done.route).toBe('recognize');
    expect(names).toEqual(['first.png', 'second.png']);
    const rows = await query<{ file_no: number; original_name: string; image_short_side_px: number; storage_uri: string }>(
      `SELECT u.file_no, u.original_name, u.image_short_side_px, u.storage_uri FROM upload_file u
         JOIN score_request r ON r.request_id = u.request_id WHERE r.request_no = ? ORDER BY u.file_no`, [up.body.id]);
    expect(rows.map((r) => [r.file_no, r.original_name, r.image_short_side_px])).toEqual([[1, 'first.png', 900], [2, 'second.png', 700]]);
    expect(rows[0].storage_uri).toMatch(/original1\.png$/);
    expect(rows[1].storage_uri).toMatch(/original2\.png$/);
  });

  it('11 photos → 400 UPLOAD_TOO_MANY_PAGES, a low 2nd photo → 422 UPLOAD_RESOLUTION_TOO_LOW with page 2; no request row', async () => {
    const before = await one<{ n: number }>('SELECT COUNT(*) AS n FROM score_request');
    const agent = (await loggedInAgent(app));
    let q = agent.post('/api/requests').field('score_type', 'staff');
    for (let i = 1; i <= 11; i++) q = q.attach('file', makePng(700, 700), `p${i}.png`);
    const r1 = await q;
    expect(r1.status).toBe(400);
    expect(r1.body.error).toMatchObject({ code: 'UPLOAD_TOO_MANY_PAGES', gate: 'G1', message: '한 번에 10쪽까지 올릴 수 있습니다.' });
    const r2 = await agent.post('/api/requests').field('score_type', 'staff')
      .attach('file', makePng(1000, 900), 'a.png').attach('file', makePng(250, 900), 'b.png');
    expect(r2.status).toBe(422);
    expect(r2.body.error).toMatchObject({ code: 'UPLOAD_RESOLUTION_TOO_LOW', details: { page: 2, actual_short_edge_px: 250 } });
    const after = await one<{ n: number }>('SELECT COUNT(*) AS n FROM score_request');
    expect(after!.n).toBe(before!.n);
    const g = await query<{ reason_code: string }>("SELECT reason_code FROM gate_event WHERE gate_code = 'G1' ORDER BY event_id DESC LIMIT 2");
    expect(g.map((x) => x.reason_code)).toEqual(['UPLOAD_RESOLUTION_TOO_LOW', 'UPLOAD_TOO_MANY_PAGES']);
  });
});
