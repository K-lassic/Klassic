// #27 서명 · 접속 주소 해시 — 세션 쿠키 서명과, 접속 주소를 원문 없이 세는 데 쓴다 (v0.1.1 lib/ids.ts).
//
//   구조에서의 위치: backend 세션(web/session.ts) · 가입 한도(auth/accounts.ts) · 요청 한도(#34 이후)가 쓴다.
//     접속 주소는 Nginx 가 넘긴 X-Forwarded-For → Express trust proxy → req.ip (#22 · #37).
//   요청 번호 · 공유 번호 만들기는 쓰는 이슈(#34 · 공유 P2)에서 더한다.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { sha256 } from './keys.js';

/** 접속 주소는 원문으로 저장하지 않는다 — 소금 친 SHA-256 (v0.1.1 과 같은 식) */
export function hashAddr(ip: string | undefined): string {
  return sha256(`${env().ADDR_HASH_SALT}|${(ip ?? 'unknown').replace(/^::ffff:/, '')}`);
}

export function sign(value: string): string {
  return createHmac('sha256', env().SESSION_SECRET).update(value).digest('base64url');
}

/** `값.서명` 에서 서명이 맞으면 값을, 아니면 null — 길이가 같을 때만 시간 일정 비교 */
export function verifySigned(signed: string | undefined): string | null {
  if (!signed) return null;
  const dot = signed.lastIndexOf('.');
  if (dot < 0) return null;
  const value = signed.slice(0, dot);
  const mac = Buffer.from(signed.slice(dot + 1));
  const expect = Buffer.from(sign(value));
  return mac.length === expect.length && timingSafeEqual(mac, expect) ? value : null;
}
