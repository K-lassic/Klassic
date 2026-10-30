// #26 접근 키 모양 시험 — model-api 가 대조할 수 있는 형식인지 (DB 없이)
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { newAccessKey, sha256, KEY_PREFIX_LENGTH } from '../../src/lib/keys.js';

describe('접근 키 (INTERFACES §1)', () => {
  it('gk_ + base62 43자 · 앞 8글자 · SHA-256 hex 64자', () => {
    const k = newAccessKey();
    expect(k.raw).toMatch(/^gk_[A-Za-z0-9]{43}$/);
    expect(k.prefix).toBe(k.raw.slice(0, 8));
    expect(k.prefix).toHaveLength(KEY_PREFIX_LENGTH); // DB 제약 chk_key_prefix_len
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('model-api 와 같은 대조 방식 — 원문의 SHA-256 hex 가 key_hash', () => {
    const k = newAccessKey();
    expect(createHash('sha256').update(k.raw).digest('hex')).toBe(k.hash);
    expect(sha256(k.raw)).toBe(k.hash);
  });
  it('매번 다른 키', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newAccessKey().raw));
    expect(keys.size).toBe(200);
  });
});
