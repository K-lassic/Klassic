// T078 (SC-002·SC-015): 공유 시험 파일마다 웹 검사기가 expected.json 과 같은 코드를 낸다(모델 API 쪽도 같은 파일로 시험한다)
// 2026-09-29 사진·PDF 입력: 기대값은 사용자 업로드 기준(user_upload_kinds). PDF 의 열기·사진 크기는 모델 API 검사기가 본다
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkUpload } from '../../src/web/uploadCheck.js';
import { userUploadKinds } from '../../src/config/shared.js';
import { makePng } from '../helpers/files.js';

const DIR = resolve(__dirname, '../../../shared/fixtures/upload');
const expectedPath = resolve(DIR, 'expected.json');

describe('upload rules (shared fixtures)', () => {
  const expected: Record<string, unknown> = existsSync(expectedPath) ? JSON.parse(readFileSync(expectedPath, 'utf8')) : {};
  const entries = Object.entries(expected).filter(([k]) => !k.startsWith('$')) as [string, string | null][];
  // PDF 의 손상·암호·사진 크기는 모델 API 검사기(pypdfium2)가 판정한다 — 웹은 remoteCheck 로 넘긴다(SC-015: 같은 검사기)
  const remote = new Set((expected.$remote_checked as string[] | undefined) ?? []);
  it.skipIf(entries.length === 0)('matches expected.json for every fixture (user upload: photos · PDF)', () => {
    expect((expected.$params as { allowed_kinds: string }).allowed_kinds).toBe('user_upload_kinds');
    for (const [file, code] of entries) {
      const data = readFileSync(resolve(DIR, file));
      const type = file.includes('jeongganbo') ? 'jeongganbo' : 'staff';
      const v = checkUpload([{ originalName: file, data }], type);
      if (remote.has(file)) {
        expect({ file, ok: v.ok, kind: v.kind, remote: v.remoteCheck }).toEqual({ file, ok: true, kind: 'pdf', remote: true });
        continue;
      }
      expect({ file, code: v.code }).toEqual({ file, code });
      if (v.kind === 'pdf') expect(v.remoteCheck).toBe(true);
    }
  });

  it('rejects missing score type, low resolution, bad type, corrupted', () => {
    const png = makePng(1000, 900);
    expect(checkUpload([{ originalName: 'a.png', data: png }], undefined).code).toBe('UPLOAD_SCORE_TYPE_REQUIRED');
    expect(checkUpload([{ originalName: 'a.png', data: makePng(299, 900) }], 'staff').code).toBe('UPLOAD_RESOLUTION_TOO_LOW');
    // (2026-09-30 황송해 119번) 300~649px 은 반려하지 않는다(모델 API 가 1000px 로 늘려 읽음)
    expect(checkUpload([{ originalName: 'a.png', data: makePng(300, 900) }], 'staff').ok).toBe(true);
    expect(checkUpload([{ originalName: 'a.png', data: makePng(600, 900) }], 'staff').ok).toBe(true);
    expect(checkUpload([{ originalName: 'a.png', data: makePng(650, 900) }], 'staff').ok).toBe(true);
    expect(checkUpload([{ originalName: 'a.txt', data: Buffer.from('hello') }], 'staff').code).toBe('UPLOAD_UNSUPPORTED_TYPE');
    expect(checkUpload([{ originalName: 'a.png', data: png.subarray(0, 60) }], 'staff').code).toBe('UPLOAD_CORRUPTED');
    expect(checkUpload([{ originalName: 'a.png', data: png }], 'staff').ok).toBe(true);
  });

  it('user uploads are photos · PDF only (2026-09-29): MIDI·MusicXML → UPLOAD_UNSUPPORTED_TYPE', () => {
    expect(userUploadKinds).toEqual(['image', 'pdf']);
    for (const file of ['ok.mid', 'ok.musicxml']) {
      const data = readFileSync(resolve(DIR, file));
      const v = checkUpload([{ originalName: file, data }], 'staff');
      expect({ file, code: v.code }).toEqual({ file, code: 'UPLOAD_UNSUPPORTED_TYPE' });
      expect(v.details).toMatchObject({ allowed: ['image', 'pdf'] });
    }
  });

  it('PDF: %PDF header, 20MB, score type required; opening is left to the model API', () => {
    const pdf = readFileSync(resolve(DIR, 'ok_staff_2p.pdf'));
    expect(checkUpload([{ originalName: 'a.pdf', data: pdf }], 'staff')).toMatchObject({ ok: true, kind: 'pdf', remoteCheck: true });
    expect(checkUpload([{ originalName: 'a.pdf', data: pdf }], undefined).code).toBe('UPLOAD_SCORE_TYPE_REQUIRED');
    expect(checkUpload([{ originalName: 'a.pdf', data: pdf }], 'staff', { imageMaxBytes: 1000 }).code).toBe('UPLOAD_TOO_LARGE');
    // 확장자는 .pdf 인데 속이 PDF 가 아니면 형식 반려
    expect(checkUpload([{ originalName: 'a.pdf', data: makePng(1000, 900) }], 'staff').code).toBe('UPLOAD_UNSUPPORTED_TYPE');
  });

  // T187 (2026-09-30 여러 쪽, BR-UPL-02 · UC3 E5·E9): 사진 여러 장 — 모델 API checks/upload.py(multi_page) 와 같은 순서·코드
  describe('several photos (one score, up to 10 pages)', () => {
    const png = makePng(1000, 900);
    const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ originalName: `p${i + 1}.png`, data: png }));
    const pdf = () => readFileSync(resolve(DIR, 'ok_staff_2p.pdf'));

    it('two photos now pass, with each short edge in upload order', () => {
      const v = checkUpload([{ originalName: 'a.png', data: makePng(1000, 900) }, { originalName: 'b.png', data: makePng(700, 1200) }], 'staff');
      expect(v).toMatchObject({ ok: true, kind: 'image', shortEdgePx: 700, details: { page_count: 2 } });
      expect(v.pages).toEqual([{ fileNo: 1, shortEdgePx: 900 }, { fileNo: 2, shortEdgePx: 700 }]);
      expect(checkUpload(photos(10), 'staff').ok).toBe(true);
    });

    it('count first: 11 photos → UPLOAD_TOO_MANY_PAGES (even if the type is wrong)', () => {
      const v = checkUpload([...photos(10), { originalName: 'x.txt', data: Buffer.from('hi') }], 'staff');
      expect(v).toMatchObject({ ok: false, code: 'UPLOAD_TOO_MANY_PAGES', details: { count: 11, max_pages: 10 } });
    });

    it('type (per file, with page) before mix; PDF twice or PDF + photo → UPLOAD_TOO_MANY_FILES', () => {
      expect(checkUpload([{ originalName: 'a.png', data: png }, { originalName: 'b.txt', data: Buffer.from('hi') }], 'staff'))
        .toMatchObject({ code: 'UPLOAD_UNSUPPORTED_TYPE', details: { page: 2 } });
      expect(checkUpload([{ originalName: 'a.pdf', data: pdf() }, { originalName: 'b.pdf', data: pdf() }], 'staff'))
        .toMatchObject({ code: 'UPLOAD_TOO_MANY_FILES', details: { count: 2, pdf_count: 2 } });
      expect(checkUpload([{ originalName: 'a.png', data: png }, { originalName: 'b.pdf', data: pdf() }], 'staff'))
        .toMatchObject({ code: 'UPLOAD_TOO_MANY_FILES', details: { count: 2, pdf_count: 1 } });
    });

    it('corrupted → size → resolution, each naming the page', () => {
      const broken = png.subarray(0, 60);
      // 3쪽은 손상, 2쪽은 작음 — 손상이 먼저
      expect(checkUpload([{ originalName: 'a.png', data: png }, { originalName: 'b.png', data: makePng(250, 900) }, { originalName: 'c.png', data: broken }], 'staff'))
        .toMatchObject({ code: 'UPLOAD_CORRUPTED', details: { page: 3 } });
      expect(checkUpload([{ originalName: 'a.png', data: png }, { originalName: 'b.png', data: makePng(1200, 1300) }], 'staff', { imageMaxBytes: png.length }))
        .toMatchObject({ code: 'UPLOAD_TOO_LARGE', details: { page: 2 } });
      expect(checkUpload([{ originalName: 'a.png', data: png }, { originalName: 'b.png', data: makePng(250, 900) }], 'staff'))
        .toMatchObject({ code: 'UPLOAD_RESOLUTION_TOO_LOW', details: { page: 2, actual_short_edge_px: 250, min_short_edge_px: 300 } });
      // 한 장이면 page 를 붙이지 않는다(모델 API 와 같다)
      expect(checkUpload([{ originalName: 'b.png', data: makePng(250, 900) }], 'staff').details).not.toHaveProperty('page');
      // 악보 종류는 파일 검사를 모두 통과한 뒤
      expect(checkUpload(photos(2), undefined).code).toBe('UPLOAD_SCORE_TYPE_REQUIRED');
    });
  });
});
