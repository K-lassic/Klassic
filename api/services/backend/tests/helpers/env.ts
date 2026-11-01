// #34 시험 설정 — 앱 모듈을 불러오기 전에 import 한다 (모듈이 env() 를 읽기 전에 값을 채운다).
//   DB 는 TEST_DB_HOST 가 있을 때만 실제로 닿는다. 저장소는 시험마다 임시 폴더, 예시 · 대체 악보는 저장소의 assets/.
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const HAS_DB = Boolean(process.env.TEST_DB_HOST);
export const FAKE_MODEL_PORT = 26199;

Object.assign(process.env, {
  DB_HOST: process.env.TEST_DB_HOST ?? '127.0.0.1', DB_PORT: process.env.TEST_DB_PORT ?? (HAS_DB ? '3306' : '1'),
  DB_USER: process.env.TEST_DB_USER ?? 'test', DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? '', DB_NAME: process.env.TEST_DB_NAME ?? 'test',
  SESSION_SECRET: 'test-secret-test-secret-test-secret-0123456789', ADDR_HASH_SALT: 'test-salt-test-salt',
  SIGNUP_HOURLY_CAP: '100000', SERVICE_API_KEY: 'test-service-key', MODEL_API_URL: `http://127.0.0.1:${FAKE_MODEL_PORT}`,
  SHARED_DIR: process.env.SHARED_DIR ?? join(here, '..', '..', '..', '..', 'shared'),
  ASSETS_DIR: join(here, '..', '..', 'assets'),
  STORAGE_DIR: mkdtempSync(join(tmpdir(), 'klassic-storage-')),
});
// 요청마다 서버를 여닫는 supertest 에서 끊긴 연결을 다시 쓰지 않게
http.globalAgent = new http.Agent({ keepAlive: false });
