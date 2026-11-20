// #34 업로드 검사 — DB 없이 돈다. 검사 순서 · 코드는 upload-rules.json · model-api 검사기와 같아야 한다.
import '../helpers/env.js';
import { describe, expect, it } from 'vitest';
import { checkUpload } from '../../src/web/uploadCheck.js';
import { errorBody } from '../../src/web/errors.js';
import { MIDI, PDF, makePng } from '../helpers/files.js';

const png = (name = 'a.png', w = 1000, h = 900) => ({ originalName: name, data: makePng(w, h) });

describe('업로드 검사 (G1)', () => {
  it('사진 한 장 · 여러 장을 올린 순서대로 받는다', () => {
    expect(checkUpload([png()], 'staff')).toMatchObject({ ok: true, kind: 'image', shortEdgePx: 900 });
    const v = checkUpload([png('1.png', 1000, 900), png('2.png', 800, 1000)], 'jeongganbo');
    expect(v.pages).toEqual([{ fileNo: 1, shortEdgePx: 900 }, { fileNo: 2, shortEdgePx: 800 }]);
    expect(v).toMatchObject({ ok: true, shortEdgePx: 800, details: { page_count: 2 } });
  });

  it('파일이 없으면 BAD_REQUEST, 30장은 받고 31장이면 UPLOAD_TOO_MANY_PAGES', () => {
    expect(checkUpload([], 'staff').code).toBe('BAD_REQUEST');
    expect(checkUpload(Array.from({ length: 30 }, () => png()), 'staff').ok).toBe(true);
    expect(checkUpload(Array.from({ length: 31 }, () => png()), 'staff').code).toBe('UPLOAD_TOO_MANY_PAGES');
  });

  it('받지 않는 형식 — 확장자와 파일 머리가 모두 맞아야 한다', () => {
    expect(checkUpload([{ originalName: 'a.txt', data: Buffer.from('text') }], 'staff').code).toBe('UPLOAD_UNSUPPORTED_TYPE');
    expect(checkUpload([{ originalName: 'fake.png', data: Buffer.from('not png') }], 'staff').code).toBe('UPLOAD_UNSUPPORTED_TYPE');
    expect(checkUpload([{ originalName: 'a.mid', data: MIDI }], 'staff')).toMatchObject({
      code: 'UPLOAD_UNSUPPORTED_TYPE', kind: 'midi', details: { allowed: ['image', 'pdf'] },
    });
  });

  it('PDF 와 사진 · PDF 여러 개는 섞을 수 없다', () => {
    const pdf = { originalName: 'b.pdf', data: PDF };
    expect(checkUpload([png(), pdf], 'staff').code).toBe('UPLOAD_TOO_MANY_FILES');
    expect(checkUpload([pdf, pdf], 'staff').code).toBe('UPLOAD_TOO_MANY_FILES');
  });

  it('잘린 사진은 UPLOAD_CORRUPTED, 여러 장이면 몇 번째인지 알려 준다', () => {
    const cut = { originalName: 'cut.png', data: makePng(1000, 900).subarray(0, 60) };
    expect(checkUpload([cut], 'staff').code).toBe('UPLOAD_CORRUPTED');
    expect(checkUpload([png(), cut], 'staff')).toMatchObject({ code: 'UPLOAD_CORRUPTED', details: { page: 2 } });
  });

  it('짧은 변 300px 미만 반려, 300px 는 통과', () => {
    expect(checkUpload([png('s.png', 299, 900)], 'staff')).toMatchObject({
      code: 'UPLOAD_RESOLUTION_TOO_LOW', details: { min_short_edge_px: 300, actual_short_edge_px: 299 },
    });
    expect(checkUpload([png('s.png', 300, 900)], 'staff').ok).toBe(true);
  });

  it('악보 종류가 없거나 틀리면 UPLOAD_SCORE_TYPE_REQUIRED', () => {
    expect(checkUpload([png()], undefined).code).toBe('UPLOAD_SCORE_TYPE_REQUIRED');
    expect(checkUpload([png()], 'piano').code).toBe('UPLOAD_SCORE_TYPE_REQUIRED');
  });

  it('PDF 는 여기서 끝내지 않고 model-api 검사로 넘긴다', () => {
    expect(checkUpload([{ originalName: 'b.pdf', data: PDF }], 'staff')).toMatchObject({ ok: true, kind: 'pdf', remoteCheck: true });
  });

  it.each([
    [8000, 5000, true], [8000, 5001, false], [8000, 6000, false],
    [10000, 700, true], [10001, 700, false], [300, 3000, true], [300, 4000, false],
  ])('#33 사진 %i×%i: 공통 화소·긴 변·기존 확대 기준으로 접수 여부 %s', (w, h, ok) => {
    const verdict = checkUpload([png('sized.png', w, h)], 'staff');
    expect(verdict.ok).toBe(ok);
    if (!ok) {
      expect(verdict).toMatchObject({ code: 'UPLOAD_TOO_LARGE', details: {
        reason: 'image_pixels', max_pixels: 40000000, max_edge: 10000, width: w, height: h,
      } });
    }
  });

  it('#33 여러 장의 화소 초과는 해당 쪽을 알리고 용량 초과와 다른 안내를 준다', () => {
    const verdict = checkUpload([png(), png('large.png', 8000, 6000)], 'staff');
    expect(verdict.details.page).toBe(2);
    const error = errorBody(verdict.code!, verdict.details).error;
    expect(error.message).toContain('해상도');
    expect(error.message).toContain('4000만 화소');
    expect(error.message).toContain('10000px');
    expect(error.fix).toContain('다시 올려');
    expect(errorBody('UPLOAD_TOO_LARGE', { max_bytes: 20971520 }).error.message).not.toContain('해상도');
  });

  it('#33 확대 후 상한을 넘는 긴 사진은 쪽별로 나누도록 안내한다', () => {
    const verdict = checkUpload([png('long.png', 300, 4000)], 'staff');
    expect(verdict.details.after_upscale).toBe(true);
    expect(errorBody(verdict.code!, verdict.details).error.message).toContain('쪽별로 나누어');
  });
});
