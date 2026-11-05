// #93 구조에서의 위치: 브라우저 /demo → 이 예시 서버 → 외부 키로 model-api 공유 목록·MP3 호출.
// 키는 환경변수로만 받고 브라우저·로그로 보내지 않는다. Node 내장 모듈만 사용한다.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHARE = /^S-\d{4}-[A-Z0-9]{8}$/;
const STATIC = new Map([
  ['/demo/', ['index.html', 'text/html; charset=utf-8']],
  ['/demo/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/demo/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/demo2/', ['demo2/index.html', 'text/html; charset=utf-8']],
  ['/demo2/app.js', ['demo2/app.js', 'text/javascript; charset=utf-8']],
  ['/demo2/style.css', ['demo2/style.css', 'text/css; charset=utf-8']],
  ...['ajaeng', 'buk', 'daegeum', 'gayageum', 'geomungo', 'haegeum', 'janggu', 'piri'].map(
    (name) => [`/demo2/img/${name}.jpg`, [`demo2/img/${name}.jpg`, 'image/jpeg']],
  ),
]);
const HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

class Failure extends Error {
  constructor(status, code, message, retryAfter) { super(message); Object.assign(this, { status, code, retryAfter }); }
}

async function bounded(response, max) {
  if (Number(response.headers.get('content-length')) > max) {
    await response.body?.cancel();
    throw new Failure(502, 'API_RESPONSE_TOO_LARGE', '응답 크기가 너무 큽니다.');
  }
  const chunks = [];
  let size = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > max) throw new Failure(502, 'API_RESPONSE_TOO_LARGE', '응답 크기가 너무 큽니다.');
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks, size);
}

export function createDemo({ apiBase, apiKey, fetchImpl = fetch, now = Date.now, maxActive = 2 } = {}) {
  const base = new URL(apiBase);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('DEMO_API_BASE는 비밀값 없는 HTTP(S) 주소여야 합니다');
  }
  if (!apiKey || /[\r\n]/.test(apiKey)) throw new Error('DEMO_API_KEY를 실행 환경에 설정하십시오');
  const address = base.href.replace(/\/$/, '');
  const redact = (text) => String(text).replaceAll(apiKey, '[숨김]');
  let listCache, listPending;
  const inflight = new Map();

  async function upstream(path, options = {}, max = 6 * 1024 * 1024) {
    let response;
    try {
      response = await fetchImpl(address + path, { ...options,
        headers: { 'X-API-Key': apiKey }, redirect: 'error', signal: AbortSignal.timeout(options.method ? 130000 : 20000) });
      if (!response.ok) {
        const retry = response.headers.get('retry-after');
        await response.body?.cancel();
        const retryAfter = /^\d{1,5}$/.test(retry ?? '') ? retry : undefined;
        if (response.status === 429) throw new Failure(429, 'API_BUSY', '요청이 많습니다. 잠시 후 다시 시도해 주세요.', retryAfter);
        if (response.status === 404) throw new Failure(404, 'SCORE_NOT_FOUND', '공유가 끝났거나 없는 곡입니다.');
        throw new Failure(502, 'API_FAILED', '악보 API 요청을 처리하지 못했습니다.');
      }
      return { type: (response.headers.get('content-type') ?? '').split(';')[0], data: await bounded(response, max) };
    } catch (error) {
      if (error instanceof Failure) throw error;
      throw new Failure(502, 'API_UNAVAILABLE', '악보 API에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }

  async function json(path) {
    const result = await upstream(path);
    if (result.type !== 'application/json') throw new Failure(502, 'API_INVALID', '목록을 읽지 못했습니다.');
    try { return JSON.parse(result.data); } catch { throw new Failure(502, 'API_INVALID', '목록을 읽지 못했습니다.'); }
  }

  async function music() {
    if (listCache && now() - listCache.at < 60000) return listCache.body;
    if (!listPending) {
      listPending = (async () => {
        const [scores, instruments] = await Promise.all([json('/v1/shared-scores?sort=likes&limit=50'), json('/v1/instruments')]);
        if (!Array.isArray(scores.items) || !Array.isArray(instruments.items)) throw new Failure(502, 'API_INVALID', '목록을 읽지 못했습니다.');
        const body = {
          scores: scores.items.filter((s) => SHARE.test(s.share_no)).map((s) => ({
            share_no: s.share_no, title: redact(s.title), score_type: s.score_type,
            likes: Number(s.likes) || 0, example: s.example === true,
          })),
          instruments: instruments.items.filter((i) => i.is_gugak && !i.is_percussion).map((i) => ({ code: i.code, name: redact(i.name) })),
        };
        listCache = { at: now(), body };
        return body;
      })().finally(() => { listPending = undefined; });
    }
    return listPending;
  }

  async function render(share, instrument) {
    // 사라진 공유 악보·MP3 정책 변경을 넘기지 않도록 요청마다 API에서 새로 확인한다.
    // 완성 MP3의 장기 캐시는 두지 않고 같은 동시 요청만 합친다.
    const key = `${share}|${instrument}`;
    if (!inflight.has(key)) {
      if (inflight.size >= maxActive) throw new Failure(429, 'DEMO_BUSY', '다른 곡을 준비 중입니다. 잠시 후 다시 시도해 주세요.', '5');
      inflight.set(key, (async () => {
        const score = await json(`/v1/shared-scores/${share}/score`);
        if (typeof score.musicxml !== 'string' || !score.musicxml) throw new Failure(502, 'API_INVALID', '악보를 읽지 못했습니다.');
        const parts = Math.max(1, (score.musicxml.match(/<(?:[\w.-]+:)?score-part(?=[\s>])/g) ?? []).length);
        if (parts > 64) throw new Failure(502, 'SCORE_TOO_COMPLEX', '성부 수가 너무 많아 재생할 수 없습니다.');
        const form = new FormData();
        form.append('score', new Blob([score.musicxml], { type: 'application/vnd.recordare.musicxml+xml' }), 'score.musicxml');
        // 렌더러가 읽은 모든 선율 성부에 적용하고 기존 타악 성부는 유지한다.
        form.append('instruments', JSON.stringify({ mode: 'custom', tracks: [{ part: 'melodic', instrument }] }));
        const audio = await upstream('/v1/render/mp3', { method: 'POST', body: form }, 20 * 1024 * 1024);
        if (audio.type === 'application/json') {
          let body;
          try { body = JSON.parse(audio.data); } catch { /* 아래 공통 응답으로 처리한다. */ }
          if (body?.mp3_withheld) throw new Failure(409, 'MP3_WITHHELD', '운영자가 음원과 MP3 변환 도구의 이용 조건을 확인한 뒤 재생할 수 있습니다.');
        }
        if (audio.type !== 'audio/mpeg' || !audio.data.length) throw new Failure(502, 'API_INVALID', 'MP3를 만들지 못했습니다.');
        return audio.data;
      })().finally(() => { inflight.delete(key); }));
    }
    return inflight.get(key);
  }

  function send(res, status, body, headers = {}) {
    const data = typeof body === 'object' && !Buffer.isBuffer(body) ? Buffer.from(JSON.stringify(body)) : body;
    res.writeHead(status, { ...HEADERS, 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(data);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://demo');
      if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }, { Allow: 'GET, HEAD' });
      if (url.pathname === '/health') return send(res, 200, { status: 'ok' });
      if (url.pathname === '/demo' || url.pathname === '/demo2') {
        return send(res, 302, '', { Location: `${url.pathname}/` });
      }
      if (STATIC.has(url.pathname)) {
        const [file, type] = STATIC.get(url.pathname);
        const data = await readFile(resolve(HERE, 'public', file));
        return send(res, 200, req.method === 'HEAD' ? undefined : data, { 'Content-Type': type });
      }
      if (req.method !== 'GET') return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } });
      if (url.pathname === '/demo/api/music' || url.pathname === '/demo2/api/music') {
        return send(res, 200, await music());
      }
      if (url.pathname === '/demo/api/bgm' || url.pathname === '/demo2/api/bgm') {
        const share = url.searchParams.get('share') ?? '', instrument = url.searchParams.get('inst') ?? '';
        if (!SHARE.test(share) || [...url.searchParams.keys()].some((k) => !['share', 'inst'].includes(k))) {
          throw new Failure(400, 'BAD_SELECTION', '곡과 악기를 골라 주세요.');
        }
        const list = await music();
        if (!list.scores.some((s) => s.share_no === share) || !list.instruments.some((i) => i.code === instrument)) {
          throw new Failure(400, 'BAD_SELECTION', '목록에서 곡과 악기를 골라 주세요.');
        }
        return send(res, 200, await render(share, instrument), { 'Content-Type': 'audio/mpeg' });
      }
      return send(res, 404, { error: { code: 'NOT_FOUND' } });
    } catch (error) {
      const safe = error instanceof Failure ? error : new Failure(502, 'DEMO_ERROR', '재생을 준비하지 못했습니다.');
      if (!res.headersSent) send(res, safe.status, { error: { code: safe.code, message: safe.message } },
        safe.retryAfter ? { 'Retry-After': safe.retryAfter } : {});
      else res.destroy();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.DEMO_PORT ?? 26102);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DEMO_PORT 범위를 확인하십시오');
  const server = createDemo({ apiBase: process.env.DEMO_API_BASE ?? 'http://model-api:9543', apiKey: process.env.DEMO_API_KEY });
  server.listen(port, '0.0.0.0', () => console.log(`예시 서버 준비 완료 port=${port}`));
}
