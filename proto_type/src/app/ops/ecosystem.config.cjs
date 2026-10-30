// pm2 설정 (research R4 — Docker 없이 uv + uvicorn + pm2). 사용: pm2 start ops/ecosystem.config.cjs && pm2 save
const path = require('path');
const APP = path.resolve(__dirname, '..');
// 포트 등 값은 app/.env 한 곳에서(2026-09-30 개선 가이드 §2-2). 비밀값은 읽지 않고 필요한 키만 꺼낸다(인자에 비밀값 없음, D8)
const fs = require('fs');
const envFile = path.join(APP, '.env');
const dotenv = {};
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*(MODEL_API_PORT)\s*=\s*(.*)\s*$/);
    if (m) dotenv[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const MODEL_API_PORT = process.env.MODEL_API_PORT || dotenv.MODEL_API_PORT || '9543';
module.exports = {
  apps: [
    { name: 'web', cwd: path.join(APP, 'backend'), script: 'dist/server.js', args: '--role=web',
      env: { NODE_ENV: 'production' }, max_restarts: 10 },
    { name: 'admin', cwd: path.join(APP, 'backend'), script: 'dist/server.js', args: '--role=admin',
      env: { NODE_ENV: 'production' }, max_restarts: 10 },
    // 모델 API 는 model-api/.venv 가상환경의 파이썬으로 직접 띄운다(uv 를 거치지 않음, 2026-09-29).
    // 포트 9543(교수님 지정, 2026-09-29). 외부 접속은 입구(gateway, 9503)를 거치므로 127.0.0.1 에만 연다.
    // --root-path /api: 밖에서는 https://p3.sumzip.com/api/v1/... 로 보인다(Swagger·결과 파일 링크). 입구가 /api 를 떼고 넘긴다.
    // --no-access-log: uvicorn 기본 접근 로그(쿼리·토큰 경로가 그대로 찍힘)를 끄고 앱이 req_id 로그 한 줄을 남긴다(2026-09-30 API 점검 D5·D7).
    // --proxy-headers: 입구가 넘긴 실제 접속 주소(X-Forwarded-For)·https 를 쓴다(127.0.0.1 에서 온 것만 믿음).
    { name: 'model-api', cwd: path.join(APP, 'model-api'),
      script: path.join(APP, 'model-api', '.venv', 'bin', 'python'),
      args: `-m uvicorn app.main:app --host 127.0.0.1 --port ${MODEL_API_PORT} --root-path /api --proxy-headers --forwarded-allow-ips 127.0.0.1 --workers 1 --no-access-log`,
      interpreter: 'none', max_restarts: 10,
      env: { VIRTUAL_ENV: path.join(APP, 'model-api', '.venv'),
             PATH: `${path.join(APP, 'model-api', '.venv', 'bin')}:${process.env.PATH}` } },
    // 외부 공개 입구: nginx(p3.sumzip.com) → 0.0.0.0:9503 → /api/v1/* 모델 API(9543) · 그 밖 웹(127.0.0.1:9523). 관리자(127.0.0.1:26101)는 넣지 않는다.
    // 교수님 배정 포트(2026-09-30): 프런트엔드 9503 · 백엔드 9523 · API 서버 9543. 웹·관리자 포트는 .env WEB_PORT·ADMIN_PORT.
    { name: 'gateway', cwd: APP, script: path.join(APP, 'ops', 'gateway.mjs'), max_restarts: 10 },
    // API 예시 홈페이지(2026-09-30 조성기 — design/SD_02 §7-2): 127.0.0.1:26102, 입구가 /demo · /demo/* 만 넘긴다. 외부 키 DEMO_API_KEY 는 .env 에서 서버가 직접 읽는다(인자에 없음).
    { name: 'demo', cwd: path.join(APP, 'demo'), script: path.join(APP, 'demo', 'server.mjs'), max_restarts: 10 },
  ],
};
