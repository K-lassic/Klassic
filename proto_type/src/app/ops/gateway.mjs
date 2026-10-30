// 외부 공개 입구 (2026-09-29 조성기 — 교수님이 정한 포트 기준).
//
//   https://p3.sumzip.com ─ nginx(서버 관리자) ─▶ 192.168.0.19:9503 (이 입구)
//        /api/v1/...  ─▶ 모델 API 127.0.0.1:9543 (앞의 /api 를 떼고 넘긴다. 모델 API 는 --root-path /api 로 떠서
//                         Swagger·결과 파일 링크를 https://p3.sumzip.com/api/v1/... 로 만든다)
//        /demo, /demo/* ─▶ API 예시 홈페이지 서버 127.0.0.1:26102 (2026-09-30 조성기 — design/SD_02 §7-2 · SD_04)
//        그 밖        ─▶ 웹 서비스 127.0.0.1:9523 (화면 · /api/requests 등 웹 서비스 경로)
//   교수님 배정 포트(2026-09-30): 프런트엔드 9503(이 입구) · 백엔드 9523 · API 서버 9543. 밖에서 들어오는 길은 이 입구 하나다.
//
// - 관리자(26101, 127.0.0.1 내부 포트)는 넣지 않는다(research R13·R14).
// - /api/v1/internal/* 는 밖에서 막는다(서비스 키로도 막혀 있지만 한 겹 더).
// - 실제 접속 주소 하나만 X-Forwarded-For 로 넘긴다. 웹 서비스(trust proxy loopback)와 모델 API(--forwarded-allow-ips 127.0.0.1)가
//   그 주소로 시간당 한도를 센다. nginx 가 보낸 요청이면 X-Real-IP 를 믿고, 아니면 소켓 주소를 쓴다.
// - 추가 패키지 없이 node:http 만 쓴다. 요청·응답 본문은 그대로 흘려 보낸다(업로드 20MB, 인식 수 분).
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
const envFile = resolve(APP, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const pick = (k, d) => process.env[k] ?? env[k] ?? d;

const PORT = Number(pick('GATEWAY_PORT', '9503'));
const HOST = pick('GATEWAY_HOST', '0.0.0.0');
const WEB = { host: '127.0.0.1', port: Number(pick('WEB_PORT', '9523')) };
const API = { host: '127.0.0.1', port: Number(pick('MODEL_API_PORT', '9543')) };
const DEMO = { host: '127.0.0.1', port: Number(pick('DEMO_PORT', '26102')) };
// nginx 가 있는 곳(이 서버 자신). 여기서 온 요청만 X-Real-IP·X-Forwarded-Proto 를 믿는다.
const TRUSTED = new Set(pick('GATEWAY_TRUSTED_PROXIES', '127.0.0.1,::1,192.168.0.19').split(',').map((s) => s.trim()));
const TIMEOUT_MS = 15 * 60_000; // 모델 API 처리 시간 제한(최대 10분)보다 넉넉히

const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer']);

function clientOf(req) {
  const sock = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  if (!TRUSTED.has(sock)) return { ip: sock, proto: 'http' };
  const real = req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return { ip: real || sock, proto: String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim() };
}

function sendError(res, status, code, message) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: { code, message, gate: null, retry_after: null, details: {} }, api_version: 'v1' }));
}

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  const path = url.split('?')[0];
  const toApi = path === '/api/v1' || path.startsWith('/api/v1/');
  if (toApi && path.startsWith('/api/v1/internal')) return sendError(res, 404, 'NOT_FOUND', '없는 경로예요.');
  const toDemo = path === '/demo' || path.startsWith('/demo/');
  const target = toApi ? API : toDemo ? DEMO : WEB;
  const { ip, proto } = clientOf(req);

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;
  headers['x-forwarded-for'] = ip;
  headers['x-real-ip'] = ip;
  headers['x-forwarded-proto'] = proto;
  headers['x-forwarded-host'] = req.headers.host ?? '';

  const up = http.request({
    host: target.host, port: target.port, method: req.method, headers,
    path: toApi ? url.slice('/api'.length) : url,
  }, (r) => {
    const out = {};
    for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k)) out[k] = v;
    res.writeHead(r.statusCode ?? 502, out);
    r.pipe(res);
  });
  up.setTimeout(TIMEOUT_MS, () => up.destroy(new Error('upstream timeout')));
  up.on('error', (e) => {
    console.error(`[gateway] ${req.method} ${path} → ${toApi ? 'model-api' : 'web'} 실패: ${e.message}`);
    sendError(res, 502, toApi ? 'SERVICE_UNAVAILABLE' : 'WEB_UNAVAILABLE', '서버가 잠시 응답하지 않아요. 잠시 뒤 다시 해 주세요.');
  });
  req.pipe(up);
});
server.requestTimeout = TIMEOUT_MS;
server.headersTimeout = 65_000;
server.listen(PORT, HOST, () => console.log(`[gateway] ${HOST}:${PORT} → /api/v1 ${API.host}:${API.port} · /demo ${DEMO.host}:${DEMO.port} · 그 밖 ${WEB.host}:${WEB.port}`));
