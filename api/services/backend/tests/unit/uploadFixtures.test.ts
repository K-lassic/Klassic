// #44 업로드 공유 시험 파일 — api/shared/fixtures/upload 의 파일마다 웹 검사기가 expected.json 과 같은 코드를 낸다 (v0.1.1 tests/contract/upload_rules).
//   model-api 검사기(#28)도 같은 파일로 시험하면 웹 · 외부 API 판정이 같다는 것을 확인할 수 있다.
//   big_25mb.png(27MB)는 저장소에 넣지 않고 여기서 만든다. PDF 의 열기 · 쪽 크기는 model-api 몫이라 remoteCheck 만 본다.
import '../helpers/env.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkUpload } from '../../src/web/uploadCheck.js';
import { makePng } from '../helpers/files.js';

const DIR = join(process.env.SHARED_DIR!, 'fixtures', 'upload');
const expected = JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf8')) as Record<string, unknown>;
const remote = new Set((expected.$remote_checked as string[] | undefined) ?? []);
const GENERATED = 'big_25mb.png';
const entries = (Object.entries(expected).filter(([k]) => !k.startsWith('$')) as [string, string | null][]).filter(([f]) => f !== GENERATED);

const typeOf = (file: string) => (file.includes('jeongganbo') ? 'jeongganbo' : 'staff');

describe('공유 시험 파일', () => {
  it('시험 파일이 있다', () => { expect(entries.length).toBeGreaterThanOrEqual(10); });

  it.each(entries)('%s → %s', (file, code) => {
    const v = checkUpload([{ originalName: file, data: readFileSync(join(DIR, file)) }], typeOf(file));
    if (remote.has(file)) expect({ ok: v.ok, kind: v.kind, remote: v.remoteCheck }).toEqual({ ok: true, kind: 'pdf', remote: true });
    else expect(v.code).toBe(code);
  });

  it(`${GENERATED} (20MB 초과 사진) → ${String(expected[GENERATED])}`, () => {
    const data = Buffer.concat([makePng(1000, 900).subarray(0, 33), Buffer.alloc(25 * 1024 * 1024), makePng(1000, 900).subarray(-12)]);
    expect(checkUpload([{ originalName: GENERATED, data }], 'staff').code).toBe(expected[GENERATED]);
  });
});
