// (#42) 음원을 기기 저장 공간(Cache Storage)에 한 번만 받는다 — 저장본이 있으면 서버에 묻지 않고, 저장소가 없거나 저장에 실패해도 연주는 막지 않는다
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FONT_CACHE, clearOldFontCaches, fetchFont, isSoundfont } from '@/player/fontCache';

const URL_GUGAK = '/soundfonts/gugak.sf2';
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

/** RIFF....sfbk 로 시작하는 작은 가짜 음원 */
function sf2(tag = 'x'): ArrayBuffer {
  const bytes = new TextEncoder().encode(`RIFF\0\0\0\0sfbk${tag}`);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
const text = (buf: ArrayBuffer) => new TextDecoder().decode(buf);

/** 메모리 안의 Cache Storage — put 이 실패하게 할 수도 있다 */
function fakeCaches(opts: { putFails?: boolean; openFails?: boolean; names?: string[] } = {}) {
  const stores = new Map<string, Map<string, Response>>();
  for (const n of opts.names ?? []) stores.set(n, new Map());
  const puts: string[] = [];
  const store = {
    async open(name: string) {
      if (opts.openFails) throw new DOMException('denied', 'SecurityError');
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      return {
        async match(url: string) { return m.get(url)?.clone(); },
        async put(url: string, res: Response) {
          puts.push(url);
          if (opts.putFails) throw new DOMException('full', 'QuotaExceededError');
          m.set(url, new Response(await res.arrayBuffer()));
        },
        async delete(url: string) { return m.delete(url); },
      } as unknown as Cache;
    },
    async keys() { return [...stores.keys()]; },
    async delete(name: string) { return stores.delete(name); },
  };
  return { store, stores, puts };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(sf2('net'), { headers: { 'content-type': 'application/octet-stream' } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('#42 음원 저장 (Cache Storage)', () => {
  it('저장소 이름에 판 번호가 있다', () => {
    expect(FONT_CACHE).toBe('klassic-soundfonts-v1');
  });

  it('처음에는 서버에서 받아 저장하고, 두 번째는 서버에 묻지 않는다', async () => {
    const c = fakeCaches();
    const first = await fetchFont(URL_GUGAK, c.store);
    expect(first?.from).toBe('network');
    expect(text(first!.buf)).toContain('net');
    await flush();
    expect(c.stores.get(FONT_CACHE)?.has(URL_GUGAK)).toBe(true);

    const second = await fetchFont(URL_GUGAK, c.store);
    expect(second?.from).toBe('cache');
    expect(text(second!.buf)).toContain('net');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('저장에 실패해도(용량 부족) 받은 음원으로 연주한다', async () => {
    const c = fakeCaches({ putFails: true });
    const got = await fetchFont(URL_GUGAK, c.store);
    await flush();
    expect(got?.from).toBe('network');
    expect(isSoundfont(got!.buf)).toBe(true);
    expect(c.puts).toEqual([URL_GUGAK]);
  });

  it('Cache Storage 가 없으면 지금처럼 서버에서 받는다', async () => {
    const got = await fetchFont(URL_GUGAK, null);
    expect(got?.from).toBe('network');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('저장소를 열 수 없어도 서버에서 받는다', async () => {
    const got = await fetchFont(URL_GUGAK, fakeCaches({ openFails: true }).store);
    expect(got?.from).toBe('network');
  });

  it('깨진 저장본은 버리고 서버에서 다시 받는다', async () => {
    const c = fakeCaches();
    const cache = await c.store.open(FONT_CACHE);
    await cache.put(URL_GUGAK, new Response('<html>'));
    const got = await fetchFont(URL_GUGAK, c.store);
    expect(got?.from).toBe('network');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('서버가 음원이 아닌 것(index.html · 404)을 주면 저장하지 않고 null', async () => {
    const c = fakeCaches();
    fetchMock.mockResolvedValueOnce(new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    expect(await fetchFont(URL_GUGAK, c.store)).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await fetchFont(URL_GUGAK, c.store)).toBeNull();
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    expect(await fetchFont(URL_GUGAK, c.store)).toBeNull();
    await flush();
    expect(c.puts).toEqual([]);
  });

  it('판 번호가 다른 옛 저장소만 지운다', async () => {
    const c = fakeCaches({ names: ['klassic-soundfonts-v0', FONT_CACHE, 'other-app'] });
    expect(await clearOldFontCaches(c.store)).toEqual(['klassic-soundfonts-v0']);
    expect([...c.stores.keys()]).toEqual([FONT_CACHE, 'other-app']);
    expect(await clearOldFontCaches(null)).toEqual([]);
  });

  it('연주기는 이 모듈로 받고, 어디서 왔는지 timings 에 남긴다 · 파일 이름은 그대로', () => {
    const p = read('src/player/player.ts');
    expect(p).toContain("from './fontCache'");
    expect(p).not.toMatch(/async function fetchFont/);
    expect(p).toContain('clearOldFontCaches()');
    expect(p).toContain('this.timings.gugakFrom = gugak?.from');
    expect(p).toContain('this.timings.fluidFrom = fluid?.from');
    expect(p).toContain("gugak: '/soundfonts/gugak.sf2', fluid: '/soundfonts/FluidR3_GM.sf2'");
  });
});
