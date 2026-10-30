// #26 접근 키 만들기 — v0.1.1 과 같은 모양이어야 model-api 가 같은 방식으로 대조한다 (INTERFACES §1).
//
//   구조에서의 위치: backend 가 키를 만들어 DB(access_key)에 해시만 넣고, model-api 는 요청의 X-API-Key 를
//     같은 SHA-256 으로 바꿔 access_key.key_hash 와 대조한다 (원문은 어디에도 저장하지 않는다).
//   원문: gk_ + base62 43자 · DB: SHA-256 hex 64자(key_hash) + 앞 8글자(key_prefix, gk_ 포함)
import { randomBytes, createHash } from 'node:crypto';

const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const KEY_BODY_LENGTH = 43;
export const KEY_PREFIX_LENGTH = 8; // DB 제약 chk_key_prefix_len

export interface NewKey {
  /** 원문 — 발급할 때 한 번만 보여 준다 */
  raw: string;
  /** SHA-256 hex (access_key.key_hash) */
  hash: string;
  /** 앞 8글자 (access_key.key_prefix) — 목록에서 어떤 키인지 알아보는 용도 */
  prefix: string;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function newAccessKey(): NewKey {
  // 바이트 % 62 — v0.1.1 과 같은 방식. 앞 글자 쪽으로 아주 조금 치우치지만 43자라 추측 난이도에는 영향이 없다
  const bytes = randomBytes(KEY_BODY_LENGTH);
  let body = '';
  for (let i = 0; i < KEY_BODY_LENGTH; i++) body += B62[bytes[i] % B62.length];
  const raw = `gk_${body}`;
  return { raw, hash: sha256(raw), prefix: raw.slice(0, KEY_PREFIX_LENGTH) };
}
