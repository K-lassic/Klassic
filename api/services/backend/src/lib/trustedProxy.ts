// #100 관리자 앱이 접속 주소 헤더(X-Forwarded-For)를 믿을 연결 상대 — 지정한 프록시(Nginx)만 믿는다.
//
//   구조에서의 위치: config/env.ts(ADMIN_TRUSTED_PROXIES 검증) · app.ts createAdminApp(Express trust proxy 함수 + 갱신)이 부른다.
//     web 용 trust proxy('loopback, uniquelocal')는 사설망 전체를 믿는다 — 같은 compose 네트워크의 다른 컨테이너가 Nginx 를 거치지 않고
//     관리자 포트에 직접 붙어 X-Forwarded-For 를 꾸며 보내면 접속 허용 범위(ADMIN_ALLOWED_CIDRS)를 통과했다 (PR #167 리뷰, 예은).
//   방법: 믿을 상대를 IP · CIDR · 서비스 이름으로 적는다. 서비스 이름은 Docker 의 이름 풀이로 주소를 알아내고 주기적으로 다시 푼다(컨테이너를 다시 만들면 주소가 바뀐다).
//     믿을 상대가 아닌 연결이면 헤더를 무시하고 그 연결의 실제 주소가 접속 주소가 된다. 풀이에 실패하면 아무도 믿지 않는다(fail-closed).
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

export class ProxyTrust {
  private resolved: Cidr[] = [];
  private lastRefresh = 0;

  constructor(private readonly spec: TrustSpec, private readonly resolver: Resolver = defaultResolver, private readonly minIntervalMs = 2000) {}

  /** 이 연결 상대(소켓 주소)가 믿을 프록시인가 — Express trust proxy 함수가 부른다(동기) */
  isTrusted(addr: string): boolean {
    return inCidrs(addr, this.spec.cidrs) || inCidrs(addr, this.resolved);
  }

  /** 서비스 이름을 다시 푼다. 실패하면 이전에 푼 값을 지우지 않고 남긴다(일시적인 이름 풀이 실패로 관리자 화면이 막히지 않게) — 처음부터 못 풀었으면 믿는 상대가 없다 */
  async refresh(force = false): Promise<void> {
    if (this.spec.hosts.length === 0) return;
    const now = Date.now();
    if (!force && now - this.lastRefresh < this.minIntervalMs) return;
    this.lastRefresh = now;
    const found: Cidr[] = [];
    for (const host of this.spec.hosts) {
      try {
        for (const a of await this.resolver(host)) {
          const c = parseCidr(a);
          if (c) found.push(c);
        }
      } catch { /* 이 이름은 이번에 못 풀었다 */ }
    }
    if (found.length > 0) this.resolved = found;
  }

  /** 믿을 서비스 이름이 있고 이 상대가 아직 믿을 수 없을 때만 다시 풀어 본다 — 요청마다 이름 풀이를 하지 않게 간격을 둔다 */
  async refreshIfUnknown(addr: string | undefined): Promise<void> {
    if (this.spec.hosts.length === 0 || (addr && this.isTrusted(addr))) return;
    await this.refresh();
  }
}
