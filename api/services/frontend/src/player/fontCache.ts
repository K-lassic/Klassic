// 사운드폰트를 기기 저장 공간(Cache Storage)에 한 번만 받는다 (#42)
//
// 구조에서의 위치: 연주기(player.ts)가 음원을 부를 때 이 파일을 거친다 — 저장본이 있으면 서버(Nginx #22 → /soundfonts)에 묻지 않고 쓴다.
//   두 번째 접속부터 gugak.sf2(22MB) · FluidR3_GM.sf2(148MB) 요청이 없어진다 (2026-10-30 팀장 피드백 "재생 지연").
// 저장소 이름에 판 번호를 넣는다 — 음원 파일을 바꾸면 FONT_CACHE 판 번호를 올린다. 옛 판 저장소는 clearOldFontCaches 가 지운다.
//   파일 이름 · /soundfonts 경로는 그대로다 (판본 파일 이름은 #22 · #31 과 정한 뒤).
// Cache Storage 가 없거나(https · localhost 가 아닌 주소, 일부 사생활 보호 창) 저장에 실패해도(용량 부족 등) 지금처럼 받아서 연주한다.

export const FONT_CACHE_PREFIX = 'klassic-soundfonts-';
export const FONT_CACHE = `${FONT_CACHE_PREFIX}v1`;

export type FontSource = 'cache' | 'network';
export interface FetchedFont {
  buf: ArrayBuffer;
  from: FontSource;
}

/** 브라우저의 Cache Storage — 없으면 null (시험에서 바꿔 끼운다) */
type Caches = Pick<CacheStorage, 'open' | 'keys' | 'delete'>;
function browserCaches(): Caches | null {
  try {
    return typeof caches === 'undefined' ? null : caches;
  } catch {
    return null;
  }
}

/** .sf2 인지 — RIFF 머리 + sfbk 형식 */
export function isSoundfont(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false;
  const head = new Uint8Array(buf, 0, 12);
  return String.fromCharCode(...head.slice(0, 4)) === 'RIFF' && String.fromCharCode(...head.slice(8, 12)) === 'sfbk';
}

async function openCache(store: Caches | null): Promise<Cache | null> {
  if (!store) return null;
  try { return await store.open(FONT_CACHE); } catch { return null; }
}

async function fromCache(cache: Cache | null, url: string): Promise<ArrayBuffer | null> {
  if (!cache) return null;
  try {
    const res = await cache.match(url);
    if (!res) return null;
    const buf = await res.arrayBuffer();
    if (isSoundfont(buf)) return buf;
    void cache.delete(url).catch(() => undefined); // 깨진 저장본 — 지우고 서버에서 다시 받는다
  } catch { /* 저장본을 못 읽음 — 서버에서 받는다 */ }
  return null;
}

async function fromNetwork(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/html')) return null; // 개발 서버가 index.html 을 돌려준 경우
    const buf = await res.arrayBuffer();
    return isSoundfont(buf) ? buf : null;
  } catch {
    return null;
  }
}

/**
 * 음원 하나를 받는다 — 저장본이 있으면 그것, 없으면 서버에서 받아 저장한다. 못 받으면 null.
 * 저장은 기다리지 않는다(연주를 늦추지 않게). 실패해도 다음 접속에 다시 받을 뿐이다.
 * 돌려준 buf 는 신시사이저가 가져가도(worklet 으로 넘김) 되도록 저장용 Response 를 먼저 만든다 — Response 는 만들 때 바이트를 복사한다.
 */
export async function fetchFont(url: string, store: Caches | null = browserCaches()): Promise<FetchedFont | null> {
  const cache = await openCache(store);
  const cached = await fromCache(cache, url);
  if (cached) return { buf: cached, from: 'cache' };
  const buf = await fromNetwork(url);
  if (!buf) return null;
  if (cache) {
    try {
      const copy = new Response(buf, { headers: { 'content-type': 'application/octet-stream' } });
      void cache.put(url, copy).catch(() => undefined);
    } catch { /* 저장만 못 한다 */ }
  }
  return { buf, from: 'network' };
}

/** 판 번호가 다른 옛 음원 저장소를 지운다 — 실패해도 조용히 넘어간다 */
export async function clearOldFontCaches(store: Caches | null = browserCaches()): Promise<string[]> {
  if (!store) return [];
  try {
    const old = (await store.keys()).filter((k) => k.startsWith(FONT_CACHE_PREFIX) && k !== FONT_CACHE);
    await Promise.all(old.map((k) => store.delete(k)));
    return old;
  } catch {
    return [];
  }
}
