// 식별자 (app/docs/INTERFACES.md §1) — 요청 번호는 날짜 + 무작위라 추측하기 어렵다(D-1). 소유 확인은 따로 한다.
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0 O 1 I 제외
function randomCode(n: number): string {
  const bytes = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHA[bytes[i] % ALPHA.length];
  return s;
}

export function newRequestNo(now = new Date()): string {
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `R-${mm}${dd}-${randomCode(8)}`;
}

/** 공유 악보 번호(2026-09-30 UC18) — 요청 번호와 모양은 같지만 S 로 시작하고 요청 번호를 드러내지 않는다 */
export function newShareNo(now = new Date()): string {
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `S-${mm}${dd}-${randomCode(8)}`;
}

export function newApplicationNo(): string {
  return `A-${randomCode(10)}`;
}

const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** 접근 키: gk_ + base62 43자. 원문은 발급 응답에서 한 번만 보인다(FR-054) */
export function newAccessKey(): { raw: string; hash: string; prefix: string } {
  const bytes = randomBytes(43);
  let body = '';
  for (let i = 0; i < 43; i++) body += B62[bytes[i] % 62];
  const raw = `gk_${body}`;
  return { raw, hash: sha256(raw), prefix: raw.slice(0, 8) };
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** 접속 주소는 원문으로 저장하지 않는다(FR-063) — 소금 친 SHA-256 */
export function hashAddr(ip: string | undefined): string {
  return sha256(`${env.ADDR_HASH_SALT}|${(ip ?? 'unknown').replace(/^::ffff:/, '')}`);
}

export function sign(value: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(value).digest('base64url');
}

export function verifySigned(signed: string | undefined): string | null {
  if (!signed) return null;
  const dot = signed.lastIndexOf('.');
  if (dot < 0) return null;
  const value = signed.slice(0, dot);
  const mac = Buffer.from(signed.slice(dot + 1));
  const expect = Buffer.from(sign(value));
  return mac.length === expect.length && timingSafeEqual(mac, expect) ? value : null;
}
