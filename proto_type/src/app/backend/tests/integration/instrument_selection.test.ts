// 연주 악기 선택 기록 = 실제로 놓인 악기만 (2026-09-29 황송해 결정)
// 타악 성부가 없는 악보에 기본 구성(가야금 · 장구)을 놓으면 장구는 연주되지 않으므로 기록에도 없어야 한다.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Midi } from '@tonejs/midi';
import { parseMidi, toMusicXml } from '@gugak/score-core';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import { startFakeModelApi, SAMPLE_MUSICXML, type FakeModelApi } from '../helpers/fakeModelApi.js';
import { makeMidi, makePng } from '../helpers/files.js';
import { exec, one, query, waitFor } from '../helpers/db.js';
import { createWebApp } from '../../src/server.js';
import { closePool } from '../../src/db/pool.js';
import { startWorker } from '../../src/services/requestWorker.js';
import { placedCodes } from '../../src/services/placedEnsemble.js';

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

/** 인식 결과가 musicxml 인 사진 요청을 끝까지 돌리고 결과 표시 이벤트까지 보낸다.
 *  웹은 사진만 받으므로(2026-09-29) MIDI 직행 대신 사진 → 가짜 인식 결과로 악보 모양(타악 유무)을 정한다 */
async function imageRequest(agent: ReturnType<typeof request.agent>, musicxml = SAMPLE_MUSICXML): Promise<string> {
  fake.on('post', '/v1/omr/staff', (_req, res) => {
    res.json({ api_version: 'v1', fallback: false, fallback_reason: null, structure_verdict: 'pass', type_mismatch: false,
      detected_type: null, validity_grade: 'trust', musicxml, midi_base64: makeMidi().toString('base64'),
      engine: { name: 'homr', version: '0.test' } });
  });
  const up = await agent.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'score.png');
  expect(up.status).toBe(202);
  await waitFor(() => agent.get(`/api/requests/${up.body.id}`).then((r) => r.body), (b) => b.status === 'completed');
  expect((await agent.post(`/api/requests/${up.body.id}/events`).send({ event: 'result_shown' })).status).toBe(204);
  return up.body.id as string;
}

function midiWithDrums(): Buffer {
  const midi = new Midi();
  const mel = midi.addTrack();
  mel.name = 'Piano';
  [60, 62, 64, 65].forEach((n, i) => mel.addNote({ midi: n, time: i * 0.5, duration: 0.5, velocity: 0.8 }));
  const drums = midi.addTrack();
  drums.name = 'Drums';
  drums.channel = 9;
  [38, 38, 38, 38].forEach((n, i) => drums.addNote({ midi: n, time: i * 0.5, duration: 0.25, velocity: 0.8 }));
  return Buffer.from(midi.toArray());
}

async function members(ensembleId: number): Promise<string[]> {
  const rows = await query<{ part_role: string; code: string }>(
    `SELECT m.part_role, i.code FROM ensemble_member m JOIN instrument i ON i.instrument_id = m.instrument_id
      WHERE m.ensemble_id = ? ORDER BY m.part_no`, [ensembleId]);
  return rows.map((r) => `${r.part_role}:${r.code}`);
}

async function selections(no: string) {
  return query<{ ensemble_id: number; source: string; kind: string }>(
    `SELECT s.ensemble_id, s.source, e.ensemble_kind AS kind FROM instrument_selection s
       JOIN score_request r ON r.request_id = s.request_id JOIN ensemble e ON e.ensemble_id = s.ensemble_id
      WHERE r.request_no = ? ORDER BY s.selection_id`, [no]);
}

describe('placedCodes (화면 applyDefaultEnsemble · applyCombination 과 같은 규칙)', () => {
  const mel = { isPercussion: false };
  const perc = { isPercussion: true };
  it('default: no percussion part → only 가야금', () => {
    expect(placedCodes([mel], ['gayageum', 'janggu'], { isDefault: true })).toEqual(['gayageum']);
    expect(placedCodes([mel, perc], ['gayageum', 'janggu'], { isDefault: true })).toEqual(['gayageum', 'janggu']);
    expect(placedCodes([perc], ['gayageum', 'janggu'], { isDefault: true })).toEqual(['janggu']);
  });
  it('percussion-only combo → melodic parts get the default melody instrument', () => {
    expect(placedCodes([mel, mel], ['janggu', 'buk'])).toEqual(['gayageum']);
    expect(placedCodes([mel, perc], ['janggu', 'buk'])).toEqual(['gayageum', 'janggu']);
  });
  it('gugak-less combo and extra melodic instruments (copied tracks) are all placed', () => {
    expect(placedCodes([mel], ['piano', 'violin'])).toEqual(['piano', 'violin']);
    expect(placedCodes([mel], ['daegeum', 'buk'])).toEqual(['daegeum']);
    expect(placedCodes([mel, perc], ['daegeum'])).toEqual(['daegeum', 'janggu']); // 타악 성부엔 기본 타악기
  });
});

describe('instrument_selection records only placed instruments', () => {
  it('score without percussion: initial record is 가야금 only (no 장구), reused across requests', async () => {
    const ids: number[] = [];
    for (let k = 0; k < 2; k++) {
      const agent = (await loggedInAgent(app));
      const no = await imageRequest(agent);
      const sel = await selections(no);
      expect(sel).toHaveLength(1);
      expect(sel[0]).toMatchObject({ source: 'initial_default', kind: 'custom' });
      expect(await members(sel[0].ensemble_id)).toEqual(['melody:gayageum']);
      ids.push(sel[0].ensemble_id);
      // 결과 표시 이벤트가 다시 와도 같은 구성이면 다시 적지 않는다
      expect((await agent.post(`/api/requests/${no}/events`).send({ event: 'result_shown' })).status).toBe(204);
      expect(await selections(no)).toHaveLength(1);
    }
    expect(ids[0]).toBe(ids[1]);
  });

  it('score with a percussion part: the default ensemble (가야금 · 장구) itself is recorded', async () => {
    const no = await imageRequest((await loggedInAgent(app)), toMusicXml(parseMidi(new Uint8Array(midiWithDrums()))));
    const sel = await selections(no);
    expect(sel).toHaveLength(1);
    expect(sel[0]).toMatchObject({ source: 'initial_default', kind: 'default' });
    expect(await members(sel[0].ensemble_id)).toEqual(['melody:gayageum', 'percussion:janggu']);
  });

  it('choosing default / a percussion-only recommendation on a score without percussion records no 장구·북', async () => {
    const agent = (await loggedInAgent(app));
    const up = { body: { id: await imageRequest(agent) } };
    const rid = (await one<{ request_id: number }>('SELECT request_id FROM score_request WHERE request_no = ?', [up.body.id]))!.request_id;
    // 추천 기록(모델 API 가 적는 것과 같은 모양): 1위 장구 · 북, 2위 피아노 · 바이올린
    const rec = await exec(
      `INSERT INTO recommendation (request_id, responded_at, outcome, model_name, model_version)
       VALUES (?, CURRENT_TIMESTAMP(3), 'ok', 'rules', 'test')`, [rid]);
    for (const [rank, codes] of [[1, ['janggu', 'buk']], [2, ['piano', 'violin']]] as const) {
      const e = await exec("INSERT INTO ensemble (ensemble_kind) VALUES ('recommended')");
      for (const [i, c] of codes.entries()) {
        await exec(
          `INSERT INTO ensemble_member (ensemble_id, part_no, part_role, instrument_id)
           SELECT ?, ?, IF(is_percussion, 'percussion', 'melody'), instrument_id FROM instrument WHERE code = ?`, [e.insertId, i + 1, c]);
      }
      await exec('INSERT INTO recommendation_option (recommendation_id, rank_no, ensemble_id) VALUES (?, ?, ?)', [rec.insertId, rank, e.insertId]);
    }

    expect((await agent.put(`/api/requests/${up.body.id}/instrument-choice`).send({ mode: 'recommend', recommendation_index: 0 })).status).toBe(204);
    expect((await agent.put(`/api/requests/${up.body.id}/instrument-choice`).send({ mode: 'recommend', recommendation_index: 1 })).status).toBe(204);
    expect((await agent.put(`/api/requests/${up.body.id}/instrument-choice`).send({ mode: 'default' })).status).toBe(204);
    const sel = await selections(up.body.id);
    expect(sel.map((s) => s.source)).toEqual(['initial_default', 'user_choice', 'user_choice', 'revert_default']);
    // 장구 · 북 → 타악 성부가 없어 선율 성부만 기본 선율 악기(가야금)로 연주됨
    expect(sel[1].kind).toBe('custom');
    expect(await members(sel[1].ensemble_id)).toEqual(['melody:gayageum']);
    // 피아노 · 바이올린(국악기 없음)은 모두 놓이므로 추천 구성 그대로
    expect(sel[2].kind).toBe('recommended');
    expect(await members(sel[2].ensemble_id)).toEqual(['melody:piano', 'melody:violin']);
    expect(await members(sel[3].ensemble_id)).toEqual(['melody:gayageum']);
  });

  it('image request: the initial record is written when the result is shown, with placed instruments only', async () => {
    const agent = (await loggedInAgent(app));
    const up = await agent.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'score.png');
    expect(up.status).toBe(202);
    expect(await selections(up.body.id)).toHaveLength(0); // 성부를 모르는 올리기 때는 적지 않는다
    await waitFor(() => agent.get(`/api/requests/${up.body.id}`).then((r) => r.body), (b) => b.status === 'completed');
    expect((await agent.post(`/api/requests/${up.body.id}/events`).send({ event: 'result_shown' })).status).toBe(204);
    const sel = await selections(up.body.id);
    expect(sel).toHaveLength(1);
    expect(sel[0].source).toBe('initial_default');
    expect(await members(sel[0].ensemble_id)).toEqual(['melody:gayageum']);
  });
});
