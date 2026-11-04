// #100 관리자 앱이 접속 주소 헤더를 믿을 연결 상대 — 목록 해석 · 서비스 이름 풀이 · 풀이 실패 때의 동작 (PR #167 리뷰, 예은).
// 구조에서의 위치: src/lib/trustedProxy.ts (config/env.ts 검증 · app.ts createAdminApp 의 trust proxy 함수가 부른다). 이름 풀이는 가짜 풀이기로 대신한다.
import { describe, expect, it } from 'vitest';
import { ProxyTrust, parseTrustList } from '../../src/lib/trustedProxy.js';

describe('믿을 프록시 목록 (#100)', () => {
  it('loopback · IP · CIDR · 서비스 이름을 읽는다', () => {
    const s = parseTrustList('loopback, 172.18.0.5, 10.0.0.0/8, frontend')!;
    expect(s.cidrs.length).toBe(2 + 1 + 1);
    expect(s.hosts).toEqual(['frontend']);
  });
  it('비었거나 한 항목이라도 잘못이면 null — 일부만 적용해 믿는 범위가 넓어지지 않게', () => {
    for (const bad of ['', ' , ', 'loopback,바보', 'frontend,10.0.0.0/99', '1.2.3.4/8/9', 'a b']) expect(parseTrustList(bad), bad).toBeNull();
  });
});

describe('ProxyTrust (#100)', () => {
  const spec = () => parseTrustList('loopback,frontend')!;

  it('loopback 과 지정한 서비스 이름이 가리키는 주소만 믿는다 — IPv4 를 IPv6 로 감싼 주소도 같은 주소로 본다', async () => {
    const t = new ProxyTrust(spec(), async () => ['172.18.0.7']);
    await t.refresh(true);
    for (const ok of ['127.0.0.1', '::1', '172.18.0.7', '::ffff:172.18.0.7']) expect(t.isTrusted(ok), ok).toBe(true);
    for (const no of ['172.18.0.8', '10.1.1.1', '::ffff:172.18.0.9', 'garbage']) expect(t.isTrusted(no), no).toBe(false);
  });

  it('이름을 한 번도 못 풀었으면 loopback 밖은 아무도 믿지 않는다(fail-closed)', async () => {
    const t = new ProxyTrust(spec(), async () => { throw new Error('ENOTFOUND'); });
    await t.refresh(true);
    expect(t.isTrusted('172.18.0.7')).toBe(false);
    expect(t.isTrusted('127.0.0.1')).toBe(true);
  });

  it('나중에 풀리면 따라가고, 일시적으로 못 풀어도 이전 값을 지우지 않는다 · 컨테이너를 다시 만들어 주소가 바뀌면 새 주소를 믿는다', async () => {
    let answer: string[] | Error = new Error('아직 없음');
    const t = new ProxyTrust(spec(), async () => { if (answer instanceof Error) throw answer; return answer; }, 0);
    await t.refreshIfUnknown('172.18.0.7');
    expect(t.isTrusted('172.18.0.7')).toBe(false);
    answer = ['172.18.0.7'];
    await t.refreshIfUnknown('172.18.0.7');
    expect(t.isTrusted('172.18.0.7')).toBe(true);
    answer = new Error('일시 실패');
    await t.refresh(true);
    expect(t.isTrusted('172.18.0.7')).toBe(true);
    answer = ['172.18.0.9'];
    await t.refreshIfUnknown('172.18.0.9');
    expect(t.isTrusted('172.18.0.9')).toBe(true);
    expect(t.isTrusted('172.18.0.7')).toBe(false);
  });

  it('이미 믿는 상대의 요청은 이름 풀이를 다시 하지 않고, 모르는 상대도 간격 안에서는 한 번만 푼다', async () => {
    let calls = 0;
    const t = new ProxyTrust(spec(), async () => { calls++; return ['172.18.0.7']; }, 60_000);
    await t.refresh(true);
    expect(calls).toBe(1);
    await t.refreshIfUnknown('172.18.0.7');
    expect(calls).toBe(1);
    await t.refreshIfUnknown('10.9.9.9');
    await t.refreshIfUnknown('10.9.9.9');
    expect(calls).toBe(1); // 간격(60초) 안이라 다시 풀지 않는다
  });
});
