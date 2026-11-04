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

// 시계를 직접 움직이는 가짜 단조 시계 — 유효기간 시험이 실제로 기다리지 않게
const fakeClock = () => { let t = 0; return { now: () => t, advance: (ms: number) => { t += ms; } }; };
const TTL = 10_000;
/** 이름 풀이 결과를 시험이 바꾸는 가짜 풀이기 — 배열이면 그 주소들, Error 면 실패, 풀이 횟수를 센다 */
function fakeDns(first: string[] | Error) {
  const s = { answer: first as string[] | Error, calls: 0 };
  const resolver = async () => { s.calls++; if (s.answer instanceof Error) throw s.answer; return s.answer; };
  return Object.assign(s, { resolver });
}

describe('ProxyTrust (#100)', () => {
  const spec = () => parseTrustList('loopback,frontend')!;
  const make = (dns: ReturnType<typeof fakeDns>, clock: ReturnType<typeof fakeClock>, minInterval = 0) =>
    new ProxyTrust(spec(), dns.resolver, minInterval, TTL, clock.now);

  it('loopback 과 지정한 서비스 이름이 가리키는 주소만 믿는다 — IPv4 를 IPv6 로 감싼 주소도 같은 주소로 본다', async () => {
    const c = fakeClock();
    const t = make(fakeDns(['172.18.0.7']), c);
    await t.refresh(true);
    for (const ok of ['127.0.0.1', '::1', '172.18.0.7', '::ffff:172.18.0.7']) expect(t.isTrusted(ok), ok).toBe(true);
    for (const no of ['172.18.0.8', '10.1.1.1', '::ffff:172.18.0.9', 'garbage']) expect(t.isTrusted(no), no).toBe(false);
  });

  it('이름을 한 번도 못 풀었으면 loopback 밖은 아무도 믿지 않는다(fail-closed)', async () => {
    const t = make(fakeDns(new Error('ENOTFOUND')), fakeClock());
    await t.refresh(true);
    expect(t.isTrusted('172.18.0.7')).toBe(false);
    expect(t.isTrusted('127.0.0.1')).toBe(true);
  });

  // ---- PR #167 리뷰 2차(예은): 이름 풀이로 얻은 주소는 유효기간이 지나면 믿지 않는다 ----

  it('푼 주소는 유효기간 안에서만 믿는다 — 기간이 지나면 다시 풀지 않아도 믿는 목록에서 빠진다', async () => {
    const c = fakeClock();
    const t = make(fakeDns(['172.18.0.7']), c);
    await t.refresh(true);
    c.advance(TTL - 1);
    expect(t.isTrusted('172.18.0.7')).toBe(true);
    c.advance(1); // 정확히 유효기간만큼 지남
    expect(t.isTrusted('172.18.0.7')).toBe(false);
    expect(t.isTrusted('127.0.0.1')).toBe(true); // loopback · 고정 IP 는 만료되지 않는다
  });

  it('[재현 1] Nginx 주소를 확인한 뒤 이름 풀이가 계속 실패하면, 유효기간이 지난 뒤에는 그 주소의 전달 헤더를 믿지 않는다', async () => {
    const c = fakeClock();
    const dns = fakeDns(['172.30.0.10']);
    const t = make(dns, c);
    await t.refresh(true);
    expect(t.isTrusted('172.30.0.10')).toBe(true);
    dns.answer = new Error('DNS 장애');
    await t.refreshIfNeeded('172.30.0.10'); // 기간 안: 다시 풀지 않고, 믿는 상태 그대로
    expect(t.isTrusted('172.30.0.10')).toBe(true);
    c.advance(TTL);
    await t.refreshIfNeeded('172.30.0.10'); // 기간이 지나 다시 풀어 보지만 실패
    expect(t.isTrusted('172.30.0.10')).toBe(false); // 만료된 주소는 실패해도 되살아나지 않는다
  });

  it('[재현 2] frontend 의 주소가 바뀐 뒤에는 이전 주소에서 먼저 요청이 와도 (이미 믿던 주소라고 건너뛰지 않고) 다시 풀어 이전 주소를 뺀다', async () => {
    const c = fakeClock();
    const dns = fakeDns(['172.30.0.10']);
    const t = make(dns, c);
    await t.refresh(true);
    dns.answer = ['172.30.0.11']; // frontend 가 다시 만들어져 주소가 바뀜 — 이전 주소는 다른 컨테이너에 배정될 수 있다
    c.advance(TTL);
    await t.refreshIfNeeded('172.30.0.10'); // 이전 주소를 받은 컨테이너가 먼저 요청
    expect(t.isTrusted('172.30.0.10')).toBe(false);
    expect(t.isTrusted('172.30.0.11')).toBe(true);
  });

  it('유효기간 안에서는 이미 믿는 주소의 요청이 이름 풀이를 하지 않는다 (요청마다 풀지 않는다)', async () => {
    const c = fakeClock();
    const dns = fakeDns(['172.18.0.7']);
    const t = make(dns, c);
    await t.refresh(true);
    expect(dns.calls).toBe(1);
    for (let i = 0; i < 5; i++) { c.advance(1000); await t.refreshIfNeeded('172.18.0.7'); }
    expect(dns.calls).toBe(1); // 5초 지났어도 기간(10초) 안
  });

  it('유효기간이 지난 뒤 같은 주소가 그대로 확인되면 기간이 새로 시작되어 계속 믿는다', async () => {
    const c = fakeClock();
    const dns = fakeDns(['172.18.0.7']);
    const t = make(dns, c);
    await t.refresh(true);
    c.advance(TTL);
    expect(t.isTrusted('172.18.0.7')).toBe(false);
    await t.refreshIfNeeded('172.18.0.7');
    expect(dns.calls).toBe(2);
    expect(t.isTrusted('172.18.0.7')).toBe(true);
    c.advance(TTL - 1);
    expect(t.isTrusted('172.18.0.7')).toBe(true); // 새 기간
  });

  it('처음 못 풀었다가 나중에 풀리면 따라간다 — 모르는 주소의 요청이 풀이를 일으킨다', async () => {
    const c = fakeClock();
    const dns = fakeDns(new Error('아직 없음'));
    const t = make(dns, c);
    await t.refreshIfNeeded('172.18.0.7');
    expect(t.isTrusted('172.18.0.7')).toBe(false);
    dns.answer = ['172.18.0.7'];
    await t.refreshIfNeeded('172.18.0.7');
    expect(t.isTrusted('172.18.0.7')).toBe(true);
  });

  it('이름이 빈 목록으로 풀리면 그 이름의 이전 주소를 바로 뺀다', async () => {
    const c = fakeClock();
    const dns = fakeDns(['172.18.0.7']);
    const t = make(dns, c);
    await t.refresh(true);
    dns.answer = [];
    await t.refresh(true);
    expect(t.isTrusted('172.18.0.7')).toBe(false);
  });

  it('이름이 여럿이면 풀린 이름만 갱신하고, 못 푼 이름의 이전 주소는 그 이름의 유효기간이 끝나면 빠진다', async () => {
    const c = fakeClock();
    const answers: Record<string, string[] | Error> = { frontend: ['172.18.0.7'], gateway: ['172.18.0.8'] };
    const t = new ProxyTrust(parseTrustList('frontend,gateway')!, async (h) => { const a = answers[h]; if (a instanceof Error) throw a; return a; }, 0, TTL, c.now);
    await t.refresh(true);
    expect([t.isTrusted('172.18.0.7'), t.isTrusted('172.18.0.8')]).toEqual([true, true]);
    answers.gateway = new Error('gateway 만 실패');
    c.advance(TTL - 1);
    await t.refresh(true); // frontend 는 갱신되어 기간이 새로 시작, gateway 는 실패 → 이전 기간 그대로
    c.advance(1);
    expect([t.isTrusted('172.18.0.7'), t.isTrusted('172.18.0.8')]).toEqual([true, false]);
  });

  it('동시에 들어온 요청은 이름 풀이를 한 번만 한다', async () => {
    const c = fakeClock();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const t = new ProxyTrust(spec(), async () => { calls++; await gate; return ['172.18.0.7']; }, 0, TTL, c.now);
    const pending = [t.refreshIfNeeded('172.18.0.7'), t.refreshIfNeeded('172.18.0.7'), t.refreshIfNeeded('10.9.9.9')];
    release();
    await Promise.all(pending);
    expect(calls).toBe(1);
    expect(t.isTrusted('172.18.0.7')).toBe(true);
  });

  it('풀이에 실패한 직후 간격(minInterval) 안에서는 다시 풀지 않고 믿지도 않는다 (이름 풀이를 두들기지 못하게)', async () => {
    const c = fakeClock();
    const dns = fakeDns(new Error('ENOTFOUND'));
    const t = make(dns, c, 2000);
    for (let i = 0; i < 4; i++) await t.refreshIfNeeded('10.9.9.9');
    expect(dns.calls).toBe(1);
    expect(t.isTrusted('10.9.9.9')).toBe(false);
    c.advance(2000);
    await t.refreshIfNeeded('10.9.9.9');
    expect(dns.calls).toBe(2); // 간격이 지나면 다시 푼다
  });
});
