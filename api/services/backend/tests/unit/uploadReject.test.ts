// #33 후속: 실제 multipart 웹 경로에서 고화소 사진을 저장·요청 생성·인식 접수 전에 반려한다.
import '../helpers/env.js';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/settings.js', () => ({ currentSettings: vi.fn(async () => ({ setting_version_id: 1 })) }));
vi.mock('../../src/services/gateEvents.js', () => ({ recordGate: vi.fn(async () => {}) }));

import * as db from '../../src/db/pool.js';
import * as storage from '../../src/services/storage.js';
import * as worker from '../../src/services/requestWorker.js';
import { requestsRouter } from '../../src/web/requests.js';
import { errorHandler } from '../../src/web/errors.js';
import { makePng } from '../helpers/files.js';
import { checkResponse } from '../helpers/contract.js';

beforeEach(() => { vi.restoreAllMocks(); });

describe('#33 웹 접수 반려', () => {
  it('여러 장 중 화소 초과 사진은 413과 안내를 주며 영속 부작용이 없다', async () => {
    const save = vi.spyOn(storage, 'saveFile');
    const insert = vi.spyOn(db, 'exec');
    const transaction = vi.spyOn(db, 'tx');
    const enqueue = vi.spyOn(worker, 'enqueueRecognition');
    const app = express();
    app.use('/api', requestsRouter);
    app.use(errorHandler);
    const response = await request(app).post('/api/requests').field('score_type', 'staff')
      .attach('file', makePng(700, 700), 'normal.png')
      .attach('file', makePng(8000, 6000), 'large.png');
    expect(response.status).toBe(413);
    expect(response.body.error).toMatchObject({
      code: 'UPLOAD_TOO_LARGE', gate: 'G1', details: { reason: 'image_pixels', page: 2 },
    });
    expect(response.body.error.message).toContain('4000만 화소');
    expect(checkResponse('POST', '/api/requests', 413, response.body)).toBeNull();
    for (const operation of [save, insert, transaction, enqueue]) expect(operation).not.toHaveBeenCalled();
  });
});
