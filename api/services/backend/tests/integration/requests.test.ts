// #34 악보 요청 통합 시험 — 실제 MariaDB 필요 (TEST_DB_HOST 가 있을 때만 돈다). model-api 는 가짜.
//   v0.1.1 us1_upload_to_result · us3_us4_upload · examples · validity_items 중 #34 범위를 옮겼다.
//   인식을 끝내는 일은 작업자(#35) 몫이라 완료 상태는 helpers/db.ts 가 DB 에 직접 만든다 — 인식까지 잇는 시험은 #35 에서.
import { HAS_DB } from '../helpers/env.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import type { Server } from 'node:http';
import { MIDI, PDF, SAMPLE_MUSICXML, makePng } from '../helpers/files.js';
import type { FakeModelApi } from '../helpers/fakeModelApi.js';

let app: Server;
let fake: FakeModelApi;
let db: typeof import('../../src/db/pool.js');
let h: typeof import('../helpers/db.js');
let loggedInAgent: typeof import('../helpers/auth.js').loggedInAgent;

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

const count = async () => Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM score_request'))!.n);
const lastGate = async (gate: string) => (await db.one<{ reason_code: string }>(
  'SELECT reason_code FROM gate_event WHERE gate_code = ? ORDER BY event_id DESC LIMIT 1', [gate]))?.reason_code;
const uploadPng = (u: ReturnType<typeof request.agent>, name = 'score.png') =>
  u.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), name);

describe.skipIf(!HAS_DB)('악보 올리기', () => {
  it('사진을 접수해 202 + RequestStatus 전체 필드, 파일과 저장 위치가 남는다', async () => {
    const u = await loggedInAgent(app, 'up');
    const up = await uploadPng(u);
    expect(up.status).toBe(202);
    expect(up.body.id).toMatch(/^R-\d{4}-[A-Z2-9]{8}$/);
    expect(up.body).toMatchObject({ file_kind: 'image', score_type: 'staff', status: 'queued', route: 'recognize', fallback: false,
      page_count: 1, pages: [], notice: null, model_wait: null, validity_items: null, midi_available: null, from_shared: false });
    for (const key of ['status_label', 'queue_position', 'received_at', 'expires_at', 'remaining_seconds', 'deadline_at']) expect(up.body).toHaveProperty(key);
    const f = await db.one<{ storage_uri: string; image_short_side_px: number }>(
      'SELECT u.storage_uri, u.image_short_side_px FROM upload_file u JOIN score_request r USING (request_id) WHERE r.request_no = ?', [up.body.id]);
    expect(f).toMatchObject({ storage_uri: `${up.body.id}/original.png`, image_short_side_px: 900 });
    expect(existsSync(join(process.env.STORAGE_DIR!, f!.storage_uri))).toBe(true);
  });

  it('사진 여러 장은 올린 순서대로 한 요청 — 쪽 수 · 파일 번호, 한글 이름이 깨지지 않는다', async () => {
    const u = await loggedInAgent(app, 'many');
    const up = await u.post('/api/requests').field('score_type', 'jeongganbo')
      .attach('file', makePng(1000, 900), '첫쪽.png').attach('file', makePng(800, 1000), '둘째쪽.png');
    expect(up.status).toBe(202);
    expect(up.body.page_count).toBe(2);
    const rows = await db.query<{ file_no: number; original_name: string; storage_uri: string; image_short_side_px: number }>(
      'SELECT u.file_no, u.original_name, u.storage_uri, u.image_short_side_px FROM upload_file u JOIN score_request r USING (request_id) WHERE r.request_no = ? ORDER BY u.file_no', [up.body.id]);
    expect(rows.map((r) => [r.file_no, r.original_name, r.storage_uri, r.image_short_side_px])).toEqual([
      [1, '첫쪽.png', `${up.body.id}/original1.png`, 900], [2, '둘째쪽.png', `${up.body.id}/original2.png`, 800],
    ]);
  });

  it('반려는 요청 행을 만들지 않고 G1 만 남긴다', async () => {
    const u = await loggedInAgent(app, 'rej');
    const before = await count();
    const r1 = await u.post('/api/requests').field('score_type', 'staff').attach('file', Buffer.from('text'), 'a.txt');
    expect(r1.status).toBe(415);
    expect(r1.body.error).toMatchObject({ code: 'UPLOAD_UNSUPPORTED_TYPE', gate: 'G1' });
    expect(r1.body.error.fix).toBeTruthy();
    const r2 = await u.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'a.png').attach('file', PDF, 'b.pdf');
    expect(r2.body.error.code).toBe('UPLOAD_TOO_MANY_FILES');
    const r3 = await u.post('/api/requests').field('score_type', 'staff').attach('file', makePng(250, 900), 'a.png');
    expect(r3.body.error.code).toBe('UPLOAD_RESOLUTION_TOO_LOW');
    expect(await lastGate('G1')).toBe('UPLOAD_RESOLUTION_TOO_LOW');
    const r4 = await u.post('/api/requests').field('score_type', 'staff').attach('file', MIDI, 'a.mid');
    expect(r4.status).toBe(415);
    expect(r4.body.error.fix).toContain('MIDI·MusicXML은 받지 않습니다');
    expect(r4.body.error.details).toMatchObject({ allowed: ['image', 'pdf'] });
    expect(await count()).toBe(before);
  });

  it('상한을 넘는 파일 · 파일 수는 500 이 아니라 G1 코드로 반려한다', async () => {
    const u = await loggedInAgent(app, 'big');
    const big = await u.post('/api/requests').field('score_type', 'staff').attach('file', Buffer.alloc(20971521), 'big.png');
    expect(big.status).toBe(413);
    expect(big.body.error).toMatchObject({ code: 'UPLOAD_TOO_LARGE', gate: 'G1' });
    expect(await lastGate('G1')).toBe('UPLOAD_TOO_LARGE');
    let many = u.post('/api/requests').field('score_type', 'staff');
    for (let i = 0; i < 31; i++) many = many.attach('file', makePng(400, 400), `${i}.png`);
    const r = await many;
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('UPLOAD_TOO_MANY_PAGES');
    expect(await lastGate('G1')).toBe('UPLOAD_TOO_MANY_PAGES');
  });

  it('방문자는 올릴 수 없다 (401)', async () => {
    const r = await request(app).post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'a.png');
    expect(r.status).toBe(401);
  });

  it('G12: 처리 중 한도 · 시간당 상한은 접수 전에 반려한다', async () => {
    await h.setSettings({ web_max_active_per_client: 1 });
    try {
      const a = await loggedInAgent(app, 'lim');
      const b = await uploadPng(a);
      expect(b.status).toBe(429); // 같은 주소(127.0.0.1)에 앞선 시험의 대기 요청이 있다
      expect(b.body.error.code).toBe('WEB_ACTIVE_REQUEST_EXISTS');
      expect(b.body.error.retry_after).toBeTruthy();
      expect(b.headers['retry-after']).toBeTruthy();
      expect(await lastGate('G12')).toBe('WEB_ACTIVE_REQUEST_EXISTS');
      await h.setSettings({ web_max_active_per_client: 100000, web_hourly_request_cap: 1 });
      const c = await uploadPng(a);
      expect(c.status).toBe(429);
      expect(c.body.error.code).toBe('WEB_HOURLY_LIMIT');
    } finally {
      await h.setSettings({ web_max_active_per_client: 100000, web_hourly_request_cap: 100000 });
    }
  });
});

describe.skipIf(!HAS_DB)('PDF 검사 위임 (#28 model-api)', () => {
  beforeEach(() => { fake.calls.length = 0; });

  it('model-api 검사를 통과하면 쪽 수를 남기고 접수, 서비스 키를 붙여 부른다', async () => {
    fake.on('post', '/v1/internal/upload-check', (_q, s) => { s.json({ ok: true, kind: 'pdf', short_edge_px: 2126, pdf_page_count: 3, page_count: 3, pages: [] }); });
    const u = await loggedInAgent(app, 'pdf');
    const up = await u.post('/api/requests').field('score_type', 'staff').attach('file', PDF, 'score.pdf');
    expect(up.status).toBe(202);
    expect(up.body).toMatchObject({ file_kind: 'pdf', route: 'recognize', pdf_page_count: 3, page_count: 3 });
    expect(fake.calls[0]).toMatchObject({ path: 'POST /v1/internal/upload-check', apiKey: 'test-service-key', files: ['score.pdf'], fields: { score_type: 'staff' } });
    const f = await db.one<{ pdf_page_count: number; image_short_side_px: number; file_no: number }>(
      'SELECT u.pdf_page_count, u.image_short_side_px, u.file_no FROM upload_file u JOIN score_request r USING (request_id) WHERE r.request_no = ?', [up.body.id]);
    expect(f).toMatchObject({ pdf_page_count: 3, image_short_side_px: 2126, file_no: 1 });
  });

  // #168 상한(max_pages)만큼은 검사뿐 아니라 저장까지 된다 — DB CHECK 제약이 10 에 묶여 11쪽부터 500 이 났던 것
  it('규칙의 max_pages 만큼(PDF 30쪽 · 사진 30장) 접수까지 되고, model-api 가 쓰는 쪽 행도 그 번호까지 들어간다', async () => {
    const { shared } = await import('../../src/config/shared.js');
    const max = shared().uploadRules.max_pages!;
    fake.on('post', '/v1/internal/upload-check', (_q, s) => { s.json({ ok: true, kind: 'pdf', short_edge_px: 2126, pdf_page_count: max, page_count: max, pages: [] }); });
    const u = await loggedInAgent(app, 'maxpdf');
    const pdf = await u.post('/api/requests').field('score_type', 'staff').attach('file', PDF, 'score.pdf');
    expect(pdf.status).toBe(202);
    expect(pdf.body).toMatchObject({ pdf_page_count: max, page_count: max });
    const id = await h.requestIdOf(pdf.body.id);
    await db.exec(`INSERT INTO request_page (request_id, page_no, file_no, source, outcome) VALUES (?, ?, 1, 'pdf_page', 'pending')`, [id, max]);

    const v = await loggedInAgent(app, 'maxphoto');
    let photos = v.post('/api/requests').field('score_type', 'staff');
    for (let i = 0; i < max; i++) photos = photos.attach('file', makePng(400, 400), `${i}.png`);
    const r = await photos;
    expect(r.status).toBe(202);
    const f = await db.one<{ n: number; last: number }>(
      'SELECT COUNT(*) AS n, MAX(u.file_no) AS last FROM upload_file u JOIN score_request r USING (request_id) WHERE r.request_no = ?', [r.body.id]);
    expect(f).toMatchObject({ n: max, last: max });
  });

  it('쪽별 상태 · 일부 쪽 실패 안내 (model-api 가 적은 request_page 를 읽는다)', async () => {
    const u = await loggedInAgent(app, 'pdf2');
    const up = await u.post('/api/requests').field('score_type', 'staff').attach('file', PDF, 'score.pdf');
    const id = await h.requestIdOf(up.body.id);
    for (const [no, outcome, reason] of [[1, 'converted', null], [2, 'failed', 'no_structure'], [3, 'converted', null]] as const) {
      await db.exec(`INSERT INTO request_page (request_id, page_no, file_no, source, outcome, fallback_reason, validity_grade)
                     VALUES (?, ?, 1, 'pdf_page', ?, ?, ?)`, [id, no, outcome, reason, outcome === 'converted' ? 'trust' : null]);
    }
    const st = (await u.get(`/api/requests/${up.body.id}`)).body;
    expect(st.notice).toEqual({ code: 'PAGES_PARTIAL', message: '3쪽 중 2쪽 변환했습니다 (못 읽은 쪽: 2쪽)', pages: 3, converted: 2, failed_pages: [2] });
    expect(st.pages[1]).toMatchObject({ page_no: 2, source: 'pdf_page', outcome: 'failed', fallback_reason: 'NO_SCORE_STRUCTURE' });
  });

  it('손상 · 암호 PDF 는 model-api 판정 그대로 반려, 요청 행 없음', async () => {
    fake.on('post', '/v1/internal/upload-check', (_q, s) => { s.status(422).json({ error: { code: 'UPLOAD_CORRUPTED', gate: 'G1', details: { reason: 'encrypted' } } }); });
    const before = await count();
    const up = await (await loggedInAgent(app, 'lock')).post('/api/requests').field('score_type', 'staff').attach('file', PDF, 'locked.pdf');
    expect(up.status).toBe(422);
    expect(up.body.error).toMatchObject({ code: 'UPLOAD_CORRUPTED', gate: 'G1', details: { reason: 'encrypted' } });
    expect(await count()).toBe(before);
  });

  it('model-api 가 키 오류 · 서버 오류면 검사 못 한 것으로 503', async () => {
    fake.on('post', '/v1/internal/upload-check', (_q, s) => { s.status(401).json({ error: { code: 'AUTH_KEY_MISSING' } }); });
    const r = await (await loggedInAgent(app, 'key')).post('/api/requests').field('score_type', 'staff').attach('file', PDF, 'a.pdf');
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('UPLOAD_CHECK_UNAVAILABLE');
  });
});

describe.skipIf(!HAS_DB)('상태 · 결과 · 소유', () => {
  it('다른 계정의 요청은 없는 것처럼 404', async () => {
    const a = await loggedInAgent(app, 'own');
    const up = await uploadPng(a);
    const other = await loggedInAgent(app, 'other');
    for (const path of ['', '/score']) expect((await other.get(`/api/requests/${up.body.id}${path}`)).status).toBe(404);
    expect((await other.post(`/api/requests/${up.body.id}/fallback`)).status).toBe(404);
  });

  it('요청은 계정 것 — 같은 계정은 다른 브라우저에서도 본다 (v0.1.1 rbac)', async () => {
    const a = await loggedInAgent(app, 'acct');
    const up = await uploadPng(a);
    expect((await a.post('/api/auth/logout')).status).toBeLessThan(300);
    const other = request.agent(app);
    expect((await other.post('/api/auth/login').send({ email: a.email, password: 'password-1234' })).status).toBe(200);
    expect((await other.get(`/api/requests/${up.body.id}`)).status).toBe(200);
  });

  it('완료 전 결과는 409, 완료되면 ScoreDoc + MusicXML + 대체 아님', async () => {
    const u = await loggedInAgent(app, 'score');
    const up = await uploadPng(u);
    const early = await u.get(`/api/requests/${up.body.id}/score`);
    expect(early.status).toBe(409);
    expect(early.body.error.details).toMatchObject({ reason: 'not_completed', status: 'queued' });
    await h.completeRecognized(up.body.id, SAMPLE_MUSICXML);
    const score = await u.get(`/api/requests/${up.body.id}/score`);
    expect(score.status).toBe(200);
    expect(score.body.scoredoc.parts.length).toBeGreaterThan(0);
    expect(score.body).toMatchObject({ musicxml: SAMPLE_MUSICXML, fallback: false, fallback_reason: null, has_original_instruments: false });
    expect((await u.get(`/api/requests/${up.body.id}`)).body).toMatchObject({ status: 'completed', midi_available: false });
  });

  it('DB 에 있는 결과 파일이 저장소에 없으면 500 이 아니라 410 RESULT_EXPIRED', async () => {
    const u = await loggedInAgent(app, 'gone');
    const up = await uploadPng(u);
    await h.completeRecognized(up.body.id, SAMPLE_MUSICXML);
    rmSync(join(process.env.STORAGE_DIR!, up.body.id, 'result.musicxml'));
    const r = await u.get(`/api/requests/${up.body.id}/score`);
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe('RESULT_EXPIRED');
  });

  it('타당성 점검 항목: 없으면 null, 있으면 값', async () => {
    const u = await loggedInAgent(app, 'validity');
    const up = await uploadPng(u);
    const id = await h.requestIdOf(up.body.id);
    expect((await u.get(`/api/requests/${up.body.id}`)).body.validity_items).toBeNull();
    await db.exec("INSERT IGNORE INTO processing_job (request_id, confirmed_score_type, structure_verdict, validity_grade) VALUES (?, 'staff', 'pass', 'caution')", [id]);
    await db.exec("INSERT INTO validity_check_item (request_id, item_code, measured_value) VALUES (?, 'note_count', 12), (?, 'beat_sum', 0.6875)", [id, id]);
    expect((await u.get(`/api/requests/${up.body.id}`)).body.validity_items).toEqual({ note_count: 12, beat_sum: 0.6875 });
  });

  it('보관 기간이 지나면 상태는 expired 로 보이고 결과는 RESULT_EXPIRED', async () => {
    const u = await loggedInAgent(app, 'exp');
    const up = await uploadPng(u);
    const id = await h.completeRecognized(up.body.id, SAMPLE_MUSICXML);
    await db.exec('UPDATE score_request SET received_at = CURRENT_TIMESTAMP(3) - INTERVAL 2 DAY, completed_at = CURRENT_TIMESTAMP(3) - INTERVAL 2 DAY WHERE request_id = ?', [id]);
    expect((await u.get(`/api/requests/${up.body.id}`)).body).toMatchObject({ status: 'expired', status_label: '만료' });
    expect((await u.get(`/api/requests/${up.body.id}/score`)).status).toBe(410);
  });
});

describe.skipIf(!HAS_DB)('대체 결과 (UC2)', () => {
  it('완료된 인식 결과를 대체로 바꾼다 — 악보 종류에 맞는 템플릿, 다시 불러도 그대로', async () => {
    const u = await loggedInAgent(app, 'fb');
    const up = await u.post('/api/requests').field('score_type', 'jeongganbo').attach('file', makePng(1000, 900), 'j.png');
    await h.completeRecognized(up.body.id, SAMPLE_MUSICXML);
    const r = await u.post(`/api/requests/${up.body.id}/fallback`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ route: 'fallback', fallback: true, fallback_reason: 'USER_REQUEST', status: 'completed' });
    const score = await u.get(`/api/requests/${up.body.id}/score`);
    expect(score.body).toMatchObject({ fallback: true, fallback_reason: 'USER_REQUEST' });
    expect(score.body.musicxml).not.toBe(SAMPLE_MUSICXML);
    expect(score.body.scoredoc.parts.length).toBeGreaterThan(0);
    const t = await db.one<{ name: string }>(
      `SELECT t.name FROM score_result s JOIN fallback_template t ON t.template_id = s.fallback_template_id
        JOIN score_request r ON r.request_id = s.request_id WHERE r.request_no = ?`, [up.body.id]);
    expect(t?.name).toContain('정간보');
    expect((await u.post(`/api/requests/${up.body.id}/fallback`)).body.route).toBe('fallback');
  });

  it('끝나지 않은 요청은 바뀌지 않는다', async () => {
    const u = await loggedInAgent(app, 'fb2');
    const up = await uploadPng(u);
    expect((await u.post(`/api/requests/${up.body.id}/fallback`)).body).toMatchObject({ route: 'recognize', status: 'queued' });
  });
});

describe.skipIf(!HAS_DB)('악보 종류 확인', () => {
  async function asking(who: string) {
    const u = await loggedInAgent(app, who);
    const up = await uploadPng(u);
    const id = await h.completeRecognized(up.body.id, SAMPLE_MUSICXML, 'awaiting_type_answer');
    await db.exec("INSERT INTO processing_job (request_id, confirmed_score_type, structure_verdict, validity_grade, type_mismatch) VALUES (?, 'staff', 'pass', 'trust', TRUE)", [id]);
    return { u, no: up.body.id as string, id };
  }

  it('그대로 → 받아 둔 결과로 완료', async () => {
    const { u, no, id } = await asking('tc1');
    expect((await u.get(`/api/requests/${no}`)).body).toMatchObject({ status: 'awaiting_type_answer', type_mismatch: true, detected_type: 'jeongganbo' });
    const r = await u.post(`/api/requests/${no}/type-confirmation`).send({ change_to: null });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ status: 'completed', fallback: false });
    expect((await db.one('SELECT type_answer FROM processing_job WHERE request_id = ?', [id]))?.type_answer).toBe('kept');
  });

  it('바꾸기 → 결과를 버리고 다른 종류로 다시 처리', async () => {
    const { u, no, id } = await asking('tc2');
    const r = await u.post(`/api/requests/${no}/type-confirmation`).send({ change_to: 'jeongganbo' });
    expect(r.body).toMatchObject({ status: 'converting', score_type: 'jeongganbo' });
    expect((await db.one('SELECT type_answer FROM processing_job WHERE request_id = ?', [id]))?.type_answer).toBe('changed');
    expect(await db.one("SELECT 1 AS x FROM score_result WHERE request_id = ? AND origin = 'recognized'", [id])).toBeNull();
  });

  it('잘못된 값 · 필드 누락은 400, 묻는 중이 아니면 상태만 돌려준다', async () => {
    const { u, no } = await asking('tc3');
    for (const body of [{ change_to: 'piano' }, {}]) {
      const r = await u.post(`/api/requests/${no}/type-confirmation`).send(body);
      expect(r.status).toBe(400);
      expect(r.body.error.details).toMatchObject({ field: 'change_to' });
    }
    const plain = await uploadPng(u);
    expect((await u.post(`/api/requests/${plain.body.id}/type-confirmation`).send({ change_to: null })).body.status).toBe('queued');
  });
});

describe.skipIf(!HAS_DB)('예시 악보', () => {
  it('목록 순서 — 파일 이름은 내보내지 않는다, 방문자는 볼 수 없다', async () => {
    const guest = request(app);
    expect((await guest.get('/api/examples')).status).toBe(401);
    expect((await guest.get('/api/examples/minuet-staff/thumb')).status).toBe(401);
    expect((await guest.post('/api/requests/example').send({ example_id: 'minuet-staff' })).status).toBe(401);
    const u = await loggedInAgent(app, 'ex-list');
    const list = await u.get('/api/examples');
    expect(list.status).toBe(200);
    expect(list.body.items.map((e: { id: string }) => e.id)).toEqual(['arirang-semachi-staff', 'minuet-staff', 'taryeong-gayageum-jeongganbo']);
    expect(list.body.items[0]).toEqual({ id: 'arirang-semachi-staff', title: '아리랑 세마치 (오선보)', score_type: 'staff' });
    expect(JSON.stringify(list.body)).not.toMatch(/\.(png|jpe?g|pdf)/);
  });

  it('미리보기 · 목록 밖 id 와 경로 문자는 404', async () => {
    const u = await loggedInAgent(app, 'ex-bad');
    for (const id of ['arirang-semachi-staff', 'minuet-staff', 'taryeong-gayageum-jeongganbo']) {
      const th = await u.get(`/api/examples/${id}/thumb`);
      expect(th.status).toBe(200);
      expect(th.headers['content-type']).toMatch(/image\/jpeg/);
    }
    expect((await u.get('/api/examples/nothing/thumb')).status).toBe(404);
    expect((await u.get('/api/examples/..%2F..%2Fexamples.json/thumb')).status).toBe(404);
    for (const bad of ['../examples.json', '..%2Fexamples.json', 'SOURCES.md', 'nothing', '', null]) {
      expect((await u.post('/api/requests/example').send({ example_id: bad })).status, String(bad)).toBe(404);
    }
  });

  it('사진 예시 2개는 실제 파일 그대로 보통 올리기와 같은 검사를 통과해 접수되고, 예시 id 가 남는다', async () => {
    for (const id of ['arirang-semachi-staff', 'minuet-staff']) {
      const u = await loggedInAgent(app, 'ex-up');
      const up = await u.post('/api/requests/example').send({ example_id: id });
      expect(up.status, id).toBe(202);
      expect(up.body.score_type).toBe('staff');
      const f = await db.one<{ example_id: string; size_bytes: number }>(
        'SELECT r.example_id, u.size_bytes FROM upload_file u JOIN score_request r USING (request_id) WHERE r.request_no = ?', [up.body.id]);
      expect(f?.example_id).toBe(id);
      expect(Number(f?.size_bytes)).toBeGreaterThan(1000);
    }
  });

  it('PDF 예시는 model-api 검사로 — 파일 이름은 영어로 넘어간다', async () => {
    fake.calls.length = 0;
    fake.on('post', '/v1/internal/upload-check', (_q, s) => { s.json({ ok: true, kind: 'pdf', short_edge_px: 2126, pdf_page_count: 2, page_count: 2, pages: [] }); });
    const u = await loggedInAgent(app, 'ex-pdf');
    const up = await u.post('/api/requests/example').send({ example_id: 'taryeong-gayageum-jeongganbo' });
    expect(up.status).toBe(202);
    expect(up.body).toMatchObject({ score_type: 'jeongganbo', file_kind: 'pdf', page_count: 2 });
    expect(fake.calls[0].files).toEqual(['taryeong-gayageum-jeongganbo.pdf']);
    const stored = await db.one<{ storage_uri: string }>(
      'SELECT u.storage_uri FROM upload_file u JOIN score_request r USING (request_id) WHERE r.request_no = ?', [up.body.id]);
    expect(readFileSync(join(process.env.STORAGE_DIR!, stored!.storage_uri)).subarray(0, 4).toString()).toBe('%PDF');
  });
});

// 맨 끝에 둔다 — 가짜 model-api 를 닫는다
describe.skipIf(!HAS_DB)('model-api 가 없을 때', () => {
  it('PDF 는 503 UPLOAD_CHECK_UNAVAILABLE(접수 안 함), 사진은 그대로 접수', async () => {
    await fake.close();
    fake = { calls: [], on: () => undefined, close: async () => undefined };
    const u = await loggedInAgent(app, 'down');
    const before = await count();
    const r = await u.post('/api/requests').field('score_type', 'staff').attach('file', PDF, 'a.pdf');
    expect(r.status).toBe(503);
    expect(r.body.error).toMatchObject({ code: 'UPLOAD_CHECK_UNAVAILABLE', gate: 'G1' });
    expect(await count()).toBe(before);
    expect(await lastGate('G1')).toBe('UPLOAD_CHECK_UNAVAILABLE');
    expect((await uploadPng(u)).status).toBe(202);
  });
});
