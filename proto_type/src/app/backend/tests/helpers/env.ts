// 시험은 로컬 devdb 의 gugak_test_web 만 쓴다(팀 DB 금지). 가짜 모델 API 서버 주소는 각 시험이 정한다.
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = process.env.TEST_DB_PORT ?? '26133';
process.env.DB_USER = 'gugak_dev';
process.env.DB_PASSWORD = 'gugak_dev';
process.env.DB_NAME = 'gugak_test_web';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-0123456789';
process.env.SERVICE_API_KEY = 'gk_testservicekey';
process.env.ADDR_HASH_SALT = 'test';
process.env.STORAGE_DIR = '/private/tmp/gugak-test-storage';
process.env.MODEL_API_URL = process.env.MODEL_API_URL ?? 'http://127.0.0.1:26199';
process.env.ADMIN_ALLOWED_CIDRS = '127.0.0.1/32,::1/128,::ffff:127.0.0.1/128';
// 2026-09-29 RBAC: 시험 계정을 많이 만들므로 가입 빈도 상한을 크게(G14 시험은 따로 낮춘 앱을 쓴다)
process.env.SIGNUP_HOURLY_CAP = process.env.SIGNUP_HOURLY_CAP ?? '100000';

// Node 19+ 는 전역 HTTP 연결 재사용(keep-alive)이 기본이다. supertest 는 요청마다 서버를 열고 닫으므로
// 닫힌 연결을 다시 쓰다 "socket hang up" 이 날 수 있다 — 시험에서는 끈다.
import http from 'node:http';
http.globalAgent = new http.Agent({ keepAlive: false });
