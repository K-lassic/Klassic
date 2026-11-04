// #100 접속 주소가 허용 범위(CIDR 목록) 안인지 판정 — 관리자 접속 허용(ADMIN_ALLOWED_CIDRS)이 쓴다.
//
//   구조에서의 위치: config/env.ts(시작할 때 설정 검증) · admin/networkGuard.ts(요청마다 판정)가 부른다. 이 파일은 설정 · DB 를 모른다.
//   원칙: 판정할 수 없으면 허용하지 않는다(fail-closed). 주소를 읽지 못하거나, 목록이 비었거나, 항목이 하나라도 잘못이면 막는다.
//   IPv4 와 IPv6 는 서로 다른 종류라 섞어 비교하지 않는다. IPv4 를 IPv6 로 감싼 주소(::ffff:a.b.c.d)는 IPv4 로 본다.
import { isIP } from 'node:net';

export interface Cidr { bits: 32 | 128; network: bigint; prefix: number }

interface Addr { bits: 32 | 128; value: bigint }

function ipv4(text: string): bigint | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let v = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    v = (v << 8n) + BigInt(Number(p));
  }
  return v;
}

/** IPv6 를 128비트 정수로 — '::' 줄임과 끝의 점 표기 IPv4(1:2::1.2.3.4)를 다룬다 */
function ipv6(text: string): bigint | null {
  let t = text;
  const dot = t.lastIndexOf('.');
  if (dot >= 0) {
    const colon = t.lastIndexOf(':');
    const v4 = ipv4(t.slice(colon + 1));
    if (v4 === null) return null;
    t = `${t.slice(0, colon + 1)}${((v4 >> 16n) & 0xffffn).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = t.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  let v = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    v = (v << 16n) + BigInt(parseInt(g, 16));
  }
  return v;
}

function parseAddr(raw: string): Addr | null {
  const text = raw.split('%')[0].trim(); // fe80::1%eth0 처럼 붙는 인터페이스 이름은 버린다
  const kind = isIP(text);
  if (kind === 4) { const v = ipv4(text); return v === null ? null : { bits: 32, value: v }; }
  if (kind === 6) {
    const v = ipv6(text);
    if (v === null) return null;
    if (v >> 32n === 0xffffn) return { bits: 32, value: v & 0xffffffffn }; // ::ffff:a.b.c.d → IPv4
    return { bits: 128, value: v };
  }
  return null;
}

/** `10.0.0.0/8` · `::1/128` · `127.0.0.1`(접두 길이를 생략하면 그 주소 하나) — 잘못된 항목은 null */
export function parseCidr(text: string): Cidr | null {
  const [base, len, ...rest] = text.trim().split('/');
  if (rest.length > 0 || !base) return null;
  const addr = parseAddr(base);
  if (!addr) return null;
  if (len !== undefined && !/^\d{1,3}$/.test(len)) return null;
  const prefix = len === undefined ? addr.bits : Number(len);
  if (prefix > addr.bits) return null;
  const shift = BigInt(addr.bits - prefix);
  return { bits: addr.bits, network: addr.value >> shift << shift, prefix };
}

/** 쉼표로 나눈 목록 — 항목이 없거나 하나라도 잘못이면 null (일부만 적용해 범위가 넓어지는 일을 막는다) */
export function parseCidrList(text: string): Cidr[] | null {
  const items = text.split(',').map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return null;
  const list: Cidr[] = [];
  for (const item of items) {
    const c = parseCidr(item);
    if (!c) return null;
    list.push(c);
  }
  return list;
}

export function inCidrs(ip: string | undefined, list: Cidr[]): boolean {
  if (!ip) return false;
  const addr = parseAddr(ip);
  if (!addr) return false;
  return list.some((c) => {
    if (c.bits !== addr.bits) return false;
    const shift = BigInt(c.bits - c.prefix);
    return addr.value >> shift << shift === c.network;
  });
}
