// API 예시 홈페이지 서버 (2026-09-30 조성기 — design/SD_02 §7-2 · SD_04 · UC12 A10 · tasks T361)
// "다른 회사 홈페이지"가 Klassic 모델 API 를 가져다 배경음악을 만드는 예시다. Node 내장 기능만 쓴다(의존성 없음).
// - 브라우저는 우리 API 를 직접 부르지 않는다(CORS). 이 서버가 외부 키(DEMO_API_KEY)를 갖고 부른다 — 키는 브라우저로 나가지 않는다.
// - GET /demo/api/music : 곡(공유 악보) · 악기(선율 국악기) 목록 — 5분 캐시
// - GET /demo/api/bgm?share=&inst= : 공유 악보 MusicXML → POST /v1/render/mp3(모든 성부를 고른 악기로) → MP3 — (곡, 악기)마다 1시간 캐시
// 입구(ops/gateway.mjs)가 /demo · /demo/* 를 이 서버(127.0.0.1:26102)로 넘긴다.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, 'public');

/** app/.env 를 읽는다(이미 있는 환경변수가 먼저) */
function loadEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}
const fileEnv = loadEnv(process.env.GUGAK_ENV_FILE ?? resolve(HERE, '..', '.env'));
const pick = (k, d) => process.env[k] ?? fileEnv[k] ?? d;

const HOST = pick('DEMO_HOST', '127.0.0.1');
const PORT = Number(pick('DEMO_PORT', '26102'));
// 외부 개발자와 같은 공개 주소를 기본으로 쓴다(예: https://p3.sumzip.com/api). 루트 경로 /api 까지.
const API_BASE = pick('DEMO_API_BASE', 'https://p3.sumzip.com/api').replace(/\/$/, '');
const API_KEY = pick('DEMO_API_KEY', '');
const LIST_TTL = 5 * 60_000;
const MP3_TTL = 60 * 60_000;
const MP3_MAX = 40;
const SHARE_NO = /^S-\d{4}-[A-Z0-9]{8}$/;

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

class ApiFail extends Error {
  constructor(status, code, message, retryAfter) { super(message); this.status = status; this.code = code; this.retryAfter = retryAfter; }
}

async function api(path, init = {}) {
  if (!API_KEY) throw new ApiFail(503, 'DEMO_NOT_CONFIGURED', '예시 서버에 API 키가 설정되지 않았습니다.');
  let res;
  try {
    res = await fetch(API_BASE + path, { ...init, headers: { 'X-API-Key': API_KEY, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(init.timeoutMs ?? 20_000) });
  } catch {
    throw new ApiFail(502, 'API_UNREACHABLE', 'Klassic API 에 연결할 수 없습니다.');
  }
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    const body = type.includes('json') ? await res.json().catch(() => null) : null;
    const code = body?.error?.code ?? `HTTP_${res.status}`;
    const status = res.status === 429 ? 429 : res.status === 404 ? 404 : 502;
    throw new ApiFail(status, code, body?.error?.message ?? 'Klassic API 오류', res.headers.get('retry-after') ?? undefined);
  }
  return { res, type };
}

// ── 곡 · 악기 목록 (5분)
let listCache = null;
async function music() {
  if (listCache && Date.now() - listCache.at < LIST_TTL) return listCache.body;
  const [s, i] = await Promise.all([api('/v1/shared-scores?sort=likes&limit=50'), api('/v1/instruments')]);
  const scores = (await s.res.json()).items.map(({ share_no, title, score_type, likes, example }) => ({ share_no, title, score_type, likes, example }));
  // 배경음악은 선율 국악기로(장구 · 북 같은 타악은 선율을 낼 수 없어 뺀다)
  const instruments = (await i.res.json()).items.filter((x) => x.is_gugak && !x.is_percussion).map(({ code, name }) => ({ code, name }));
  const body = { scores, instruments, api_base: API_BASE };
  listCache = { at: Date.now(), body };
  return body;
}

// ── 배경음악 MP3 ((곡, 악기) 1시간, 같은 것을 동시에 두 번 만들지 않는다)
const mp3Cache = new Map();   // key → { at, data }
const inflight = new Map();   // key → Promise<Buffer>

function partCount(musicxml) {
  return Math.max(1, (musicxml.match(/<score-part\b/g) ?? []).length);
}

async function makeBgm(share, inst) {
  const { res } = await api(`/v1/shared-scores/${encodeURIComponent(share)}/score`);
  const score = await res.json();
  const tracks = Array.from({ length: partCount(score.musicxml) }, (_, part) => ({ part, instrument: inst }));
  const form = new FormData();
  form.append('score', new Blob([score.musicxml], { type: 'application/vnd.recordare.musicxml+xml' }), 'score.musicxml');
  form.append('instruments', JSON.stringify({ mode: 'custom', tracks }));
  const r = await api('/v1/render/mp3', { method: 'POST', body: form, timeoutMs: 120_000 });
  if (r.type.includes('json')) {
    const j = await r.res.json();
    if (j.mp3_withheld) throw new ApiFail(409, 'MP3_WITHHELD', j.message ?? '지금은 MP3 외부 제공이 허용되지 않았습니다.');
    throw new ApiFail(502, 'UNEXPECTED', 'MP3 대신 다른 응답이 왔습니다.');
  }
  return Buffer.from(await r.res.arrayBuffer());
}

async function bgm(share, inst) {
  const key = `${share}|${inst}`;
  const hit = mp3Cache.get(key);
  if (hit && Date.now() - hit.at < MP3_TTL) return hit.data;
  if (!inflight.has(key)) {
    inflight.set(key, makeBgm(share, inst).then((data) => {
      mp3Cache.set(key, { at: Date.now(), data });
      while (mp3Cache.size > MP3_MAX) mp3Cache.delete(mp3Cache.keys().next().value);
      return data;
    }).finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

// ── HTTP
function sendJson(res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}
function sendFail(res, e) {
  if (e instanceof ApiFail) {
    return sendJson(res, e.status, { error: { code: e.code, message: e.message } }, e.retryAfter ? { 'Retry-After': e.retryAfter } : {});
  }
  console.error('[demo]', e?.message ?? e);
  return sendJson(res, 500, { error: { code: 'DEMO_ERROR', message: '예시 서버 오류' } });
}

async function serveStatic(res, rel) {
  const file = resolve(PUBLIC, rel || 'index.html');
  if (!file.startsWith(PUBLIC + sep) && file !== PUBLIC) return sendJson(res, 404, { error: { code: 'NOT_FOUND' } });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: { code: 'NOT_FOUND' } });
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://demo');
    const path = url.pathname;
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } });
    if (path === '/demo') { res.writeHead(301, { Location: '/demo/' }); return res.end(); }
    if (path === '/demo/api/music') return sendJson(res, 200, await music());
    if (path === '/demo/api/bgm') {
      const share = url.searchParams.get('share') ?? '';
      const inst = url.searchParams.get('inst') ?? '';
      if (!SHARE_NO.test(share)) return sendJson(res, 400, { error: { code: 'BAD_SHARE', message: '곡을 골라 주세요.' } });
      const { instruments } = await music();
      if (!instruments.some((x) => x.code === inst)) return sendJson(res, 400, { error: { code: 'BAD_INSTRUMENT', message: '악기를 골라 주세요.' } });
      const data = await bgm(share, inst);
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': data.length, 'Cache-Control': 'private, max-age=3600' });
      return res.end(data);
    }
    if (path.startsWith('/demo/')) return serveStatic(res, decodeURIComponent(path.slice('/demo/'.length)));
    return sendJson(res, 404, { error: { code: 'NOT_FOUND' } });
  } catch (e) {
    return sendFail(res, e);
  }
});

server.listen(PORT, HOST, () => console.log(`[demo] ${HOST}:${PORT} → Klassic API ${API_BASE} (key ${API_KEY ? API_KEY.slice(0, 8) + '…' : '없음'})`));
