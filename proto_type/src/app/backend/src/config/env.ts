// .env 읽기 (tasks T021) — zod 로 검증하고, 빠진 값이 있으면 시작하지 않는다.
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
/** app/ 폴더 (src·dist 어디서 실행해도 같은 곳) */
export const APP_ROOT = resolve(here, '..', '..', '..');

const envFile = process.env.GUGAK_ENV_FILE ?? resolve(APP_ROOT, '.env');
if (existsSync(envFile)) loadDotenv({ path: envFile });

const schema = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive(),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().min(1),
  /** 교수님 배정 백엔드 포트 9523(2026-09-30). 밖에서는 입구(9503)로만 들어오므로 루프백에만 연다 */
  WEB_PORT: z.coerce.number().int().positive().default(9523),
  WEB_HOST: z.string().min(1).default('127.0.0.1'),
  /** 같은 접속 주소에서 한 시간에 가입할 수 있는 수(FR-066·BR-AUTH-01, 2026-09-29 RBAC). 시험은 크게 둔다 */
  SIGNUP_HOURLY_CAP: z.coerce.number().int().positive().default(5),
  /** 관리 포트는 내부 포트(배정 포트 아님) — 루프백에만 연다(ADMIN_ALLOWED_CIDRS 기본값과 같은 범위) */
  ADMIN_PORT: z.coerce.number().int().positive().default(26101),
  ADMIN_HOST: z.string().min(1).default('127.0.0.1'),
  MODEL_API_URL: z.string().url().default('http://127.0.0.1:9543'),
  /** API활용 안내에 보이는 외부 주소(모델 API의 /v1 앞부분) */
  PUBLIC_API_URL: z.string().url().default('https://p3.sumzip.com/api'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET 는 32자 이상'),
  SERVICE_API_KEY: z.string().default(''),
  ADMIN_ALLOWED_CIDRS: z.string().default('127.0.0.1/32,::1/128'),
  ADDR_HASH_SALT: z.string().default(''),
  STORAGE_DIR: z.string().default(resolve(APP_ROOT, 'storage')),
  OLLAMA_URL: z.string().url().default('http://127.0.0.1:11434'),
});

export type Env = z.infer<typeof schema>;
export const env: Env = schema.parse(process.env);
