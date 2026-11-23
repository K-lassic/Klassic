// #100 관리자 앱이 접속 주소 헤더(X-Forwarded-For)를 믿을 연결 상대 — 지정한 프록시(Nginx)만 믿는다.
//
//   구조에서의 위치: config/env.ts(ADMIN_TRUSTED_PROXIES 검증) · app.ts createAdminApp(Express trust proxy 함수 + 갱신)이 부른다.
//     web 용 trust proxy('loopback, uniquelocal')는 사설망 전체를 믿는다 — 같은 compose 네트워크의 다른 컨테이너가 Nginx 를 거치지 않고
//     관리자 포트에 직접 붙어 X-Forwarded-For 를 꾸며 보내면 접속 허용 범위(ADMIN_ALLOWED_CIDRS)를 통과했다 (PR #167 리뷰, 예은).
//   방법: 믿을 상대를 IP · CIDR · 서비스 이름으로 적는다. 서비스 이름은 Docker 의 이름 풀이로 주소를 알아내고, 푼 주소는 짧은 유효기간(TRUST_TTL_MS, 10초) 동안만 믿는다
//     (컨테이너를 다시 만들면 주소가 바뀌고 이전 주소가 다른 컨테이너에 배정될 수 있다 — PR #167 리뷰 2차). 믿을 상대가 아닌 연결이면 헤더를 무시하고
//     그 연결의 실제 주소가 접속 주소가 된다. 풀이에 실패하면 유효기간이 끝난 주소는 믿지 않는다(fail-closed).
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { inCidrs, parseCidr, type Cidr } from './cidr.js';

export type Resolver = (host: string) => Promise<string[]>;

const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/** 목록의 항목이 서비스 이름인지 — IP · CIDR 이 아니면서 이름 규칙에 맞는 것 */
const HOST_NAME = /^[a-z0-9]([a-z0-9._-]{0,61}[a-z0-9])?$/i;

export interface TrustSpec { cidrs: Cidr[]; hosts: string[] }

/** `loopback` · IP · CIDR · 서비스 이름을 쉼표로 — 잘못된 항목이 하나라도 있거나 비면 null (일부만 적용해 믿는 범위가 넓어지지 않게) */
export function parseTrustList(text: string): TrustSpec | null {
  const items = text.split(',').map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return null;
  const spec: TrustSpec = { cidrs: [], hosts: [] };
  for (const item of items) {
    if (item === 'loopback') { spec.cidrs.push(parseCidr('127.0.0.1/32')!, parseCidr('::1/128')!); continue; }
    const c = parseCidr(item);
    if (c) { spec.cidrs.push(c); continue; }
    if (!item.includes('/') && isIP(item) === 0 && HOST_NAME.test(item)) { spec.hosts.push(item.toLowerCase()); continue; }
    return null;
  }
  return spec;
}

/** 서비스 이름으로 푼 주소는 이 시간 안에서만 믿는다 — 컨테이너를 다시 만들면 주소가 바뀌고 이전 주소가 다른 컨테이너에 배정될 수 있어서(PR #167 리뷰 2차, 예은) */
export const TRUST_TTL_MS = 10_000;

interface Resolved { cidrs: Cidr[]; expiresAt: number }

/**
 * 믿을 프록시 판정. IP · CIDR · loopback 은 만료되지 않고, 서비스 이름으로 푼 주소는 유효기간(TRUST_TTL_MS) 동안만 믿는다.
 *   - 만료된 주소는 다시 풀지 않아도 믿는 목록에서 빠진다. 다시 풀기에 실패해도 되살아나지 않는다(fail-closed).
 *   - 이미 믿던 주소에서 요청이 와도 만료됐으면 다시 푼다 — "이미 믿는 주소라 건너뜀" 때문에 이전 주소를 계속 믿던 문제를 막는다.
 *   - 일시적인 이름 풀이 실패는 유효기간 안에서만 견딘다(최대 TRUST_TTL_MS). 그 뒤에는 loopback 밖의 전달 헤더를 읽지 않는다.
 *   시계는 단조 시계(performance.now)라 시스템 시각이 튀어도 유효기간이 흔들리지 않는다(시험은 가짜 시계를 넣는다).
 */
export class ProxyTrust {
  private readonly resolved = new Map<string, Resolved>();
  private lastRefresh = Number.NEGATIVE_INFINITY;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly spec: TrustSpec,
    private readonly resolver: Resolver = defaultResolver,
    private readonly minIntervalMs = 2000,
    private readonly ttlMs = TRUST_TTL_MS,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** 유효기간이 남은 이름 풀이 결과 */
  private fresh(): Cidr[] {
    const t = this.now();
    return [...this.resolved.values()].filter((r) => t < r.expiresAt).flatMap((r) => r.cidrs);
  }

  /** 이 연결 상대(소켓 주소)가 믿을 프록시인가 — Express trust proxy 함수가 부른다(동기) */
  isTrusted(addr: string): boolean {
    return inCidrs(addr, this.spec.cidrs) || inCidrs(addr, this.fresh());
  }

  /**
   * 서비스 이름을 다시 푼다. 푼 이름은 유효기간이 새로 시작되고, 못 푼 이름은 이전 결과의 남은 유효기간만 간다(연장하지 않는다).
   * 간격(minIntervalMs) 안에서는 다시 풀지 않고, 이미 풀고 있으면 그 결과를 같이 기다린다.
   */
  async refresh(force = false): Promise<void> {
    if (this.spec.hosts.length === 0) return;
    if (this.inflight) return this.inflight;
    const t = this.now();
    if (!force && t - this.lastRefresh < this.minIntervalMs) return;
    this.lastRefresh = t;
    this.inflight = (async () => {
      for (const host of this.spec.hosts) {
        try {
          const cidrs = (await this.resolver(host)).map((a) => parseCidr(a)).filter((c): c is Cidr => c !== null);
          this.resolved.set(host, { cidrs, expiresAt: this.now() + this.ttlMs });
        } catch { /* 이 이름은 이번에 못 풀었다 — 이전 결과는 자기 유효기간이 끝나면 빠진다 */ }
      }
    })().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** 요청이 들어온 연결 상대를 지금 믿을 수 없을 때(처음 보는 주소이거나 유효기간이 지남)만 다시 풀어 본다 — 요청마다 풀지 않는다 */
  async refreshIfNeeded(addr: string | undefined): Promise<void> {
    if (this.spec.hosts.length === 0 || (addr && this.isTrusted(addr))) return;
    await this.refresh();
  }
}
