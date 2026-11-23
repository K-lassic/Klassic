// #100 관리자 접속 허용 범위 판정 — DB 없이 돈다. 경계 · IPv6 · 잘못된 입력에서 "허용하지 않는" 쪽으로 기우는지 본다 (lib/cidr.ts).
import '../helpers/env.js';
import { describe, expect, it } from 'vitest';
import { inCidrs, parseCidr, parseCidrList } from '../../src/lib/cidr.js';
import { loadEnv } from '../../src/config/env.js';

const DEFAULT = parseCidrList('127.0.0.1/32,::1/128,172.16.0.0/12')!;
const base = { DB_HOST: 'db', DB_USER: 'u', DB_PASSWORD: '', DB_NAME: 'n', SESSION_SECRET: 'x'.repeat(32), ADDR_HASH_SALT: 'y'.repeat(16) };

describe('CIDR 항목 읽기', () => {
  it.each(['10.0.0.0/8', '127.0.0.1', '127.0.0.1/32', '::1', '::1/128', 'fe80::/10', '0.0.0.0/0'])('올바른 항목 %s', (c) => {
    expect(parseCidr(c)).not.toBeNull();
  });
  // IPv4 를 IPv6 로 감싼 표기(::ffff:a.b.c.d/길이)의 접두 길이는 IPv4 길이와 뜻이 달라 헷갈린다 — 받지 않고 IPv4 로 쓰게 한다
  it.each(['', '::ffff:10.0.0.0/104', '/8', '10.0.0.0/', '10.0.0.0/33', '::1/129', '10.0.0.0/-1', '10.0.0.0/8/8', '10.0.0/8', '256.0.0.1', 'localhost', '10.0.0.0/abc', '1:2:3:4:5:6:7:8:9', ':::', '1::2::3'])('잘못된 항목 %j 은 null', (c) => {
    expect(parseCidr(c)).toBeNull();
  });
  it('목록 — 비었거나 한 항목이라도 잘못이면 전체를 거부한다(일부만 적용해 범위가 넓어지지 않게)', () => {
    expect(parseCidrList('')).toBeNull();
    expect(parseCidrList(' , ,')).toBeNull();
    expect(parseCidrList('127.0.0.1/32,not-a-cidr')).toBeNull();
    expect(parseCidrList('127.0.0.1/32, ::1/128 ,')).toHaveLength(2);
  });
});

describe('접속 주소 판정', () => {
  it.each([
    ['127.0.0.1', true], ['127.0.0.2', false], ['::1', true], ['::2', false],
    ['172.16.0.0', true], ['172.30.0.1', true], ['172.31.255.255', true], ['172.15.255.255', false], ['172.32.0.0', false],
    ['192.168.0.19', false], ['10.0.0.1', false], ['203.0.113.9', false],
  ])('기본 범위에서 %s → %s', (ip, expected) => {
    expect(inCidrs(ip, DEFAULT)).toBe(expected);
  });

  it('IPv4 를 IPv6 로 감싼 주소는 IPv4 로 본다 (Express 는 ::ffff:127.0.0.1 로 알려 준다)', () => {
    expect(inCidrs('::ffff:127.0.0.1', DEFAULT)).toBe(true);
    expect(inCidrs('::ffff:7f00:1', DEFAULT)).toBe(true); // 같은 주소의 16진 표기
    expect(inCidrs('::ffff:203.0.113.9', DEFAULT)).toBe(false);
  });

  it('IPv4 범위는 IPv6 주소에, IPv6 범위는 IPv4 주소에 닿지 않는다', () => {
    expect(inCidrs('2001:db8::1', parseCidrList('0.0.0.0/0')!)).toBe(false);
    expect(inCidrs('203.0.113.9', parseCidrList('::/0')!)).toBe(false);
    expect(inCidrs('2001:db8::1', parseCidrList('2001:db8::/32')!)).toBe(true);
    expect(inCidrs('2001:db9::1', parseCidrList('2001:db8::/32')!)).toBe(false);
  });

  it('접두 길이 밖의 비트가 켜진 항목도 같은 범위로 본다 (10.1.2.3/8 = 10.0.0.0/8)', () => {
    const list = parseCidrList('10.1.2.3/8')!;
    expect(inCidrs('10.255.0.1', list)).toBe(true);
    expect(inCidrs('11.0.0.1', list)).toBe(false);
  });

  it('인터페이스 이름이 붙은 IPv6 주소(fe80::1%eth0)는 이름을 버리고 판정한다', () => {
    expect(inCidrs('fe80::1%eth0', parseCidrList('fe80::/10')!)).toBe(true);
  });

  it.each([undefined, '', 'unknown', 'not-an-ip', '999.1.1.1', '1.2.3', '127.0.0.1, 10.0.0.1', '127.0.0.1:8080', ' '])('읽을 수 없는 주소 %j 은 허용하지 않는다', (ip) => {
    // 가장 넓은 범위여도 읽지 못하면 막는다 — 주소를 못 읽은 요청이 통과하지 않게
    expect(inCidrs(ip, parseCidrList('0.0.0.0/0,::/0')!)).toBe(false);
  });

  it('허용 목록이 비어 있으면 아무것도 허용하지 않는다', () => {
    expect(inCidrs('127.0.0.1', [])).toBe(false);
  });
});

describe('설정 ADMIN_ALLOWED_CIDRS 검증 (시작할 때)', () => {
  it('값이 없으면 같은 PC + Docker 사설 대역이 기본이다', () => {
    expect(loadEnv(base).ADMIN_ALLOWED_CIDRS).toBe('127.0.0.1/32,::1/128,172.16.0.0/12');
  });
  it('잘못된 값 · 빈 값이면 시작하지 않고, 키 이름만 알리며 값은 출력하지 않는다', () => {
    for (const bad of ['oops-secret-value', '', '127.0.0.1/32,oops-secret-value']) {
      let message = '';
      try { loadEnv({ ...base, ADMIN_ALLOWED_CIDRS: bad }); } catch (e) { message = (e as Error).message; }
      expect(message, `값 ${JSON.stringify(bad)}`).toContain('ADMIN_ALLOWED_CIDRS');
      expect(message).not.toContain('oops-secret-value');
    }
  });
  it('올바른 값은 그대로 받는다', () => {
    expect(loadEnv({ ...base, ADMIN_ALLOWED_CIDRS: '10.0.0.0/8, ::1/128' }).ADMIN_ALLOWED_CIDRS).toBe('10.0.0.0/8, ::1/128');
  });
});
