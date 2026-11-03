// #27 서명 · 접속 주소 해시 — 세션 쿠키 서명과, 접속 주소를 원문 없이 세는 데 쓴다 (v0.1.1 lib/ids.ts).
//
//   구조에서의 위치: backend 세션(web/session.ts) · 가입 한도(auth/accounts.ts) · 요청 한도(#34 이후)가 쓴다.
//     접속 주소는 Nginx 가 넘긴 X-Forwarded-For → Express trust proxy → req.ip (#22 · #37).
//   요청 번호는 #34 에서 더했다. 공유 번호는 쓰는 이슈(공유 P2)에서 더한다.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { sha256 } from './keys.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0 O 1 I 제외

/** #34 요청 번호 — 날짜 + 무작위 8자라 추측하기 어렵다. 그래도 소유 확인은 web/ownership.ts 가 따로 한다 */
export function newRequestNo(now = new Date()): string {
  return numberWith('R', now);
}

/** #90 공유 번호 — 요청 번호와 같은 모양이고, 요청 번호를 드러내지 않는다 */
export function newShareNo(now = new Date()): string {
  return numberWith('S', now);
}

function numberWith(prefix: string, now: Date): string {
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const code = Array.from(randomBytes(8), (b) => ALPHA[b % ALPHA.length]).join('');
  return `${prefix}-${mm}${dd}-${code}`;
}

/** #91 키 신청 번호 — `A-` + 무작위 10자 (web-api.yaml) */
export function newApplicationNo(): string {
  return `A-${Array.from(randomBytes(10), (b) => ALPHA[b % ALPHA.length]).join('')}`;
}

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
