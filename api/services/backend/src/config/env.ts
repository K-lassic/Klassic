// #23 설정 읽기 — 환경변수를 zod 로 검증하고, 빠지거나 잘못된 값이 있으면 시작하지 않는다 (기능 목록 H1 · 작성규칙 원칙 6).
//
//   구조에서의 위치: backend(web · admin) 의 모든 모듈이 이 값을 쓴다.
//     값은 compose 의 environment 로 주입한다(api/.env → services/backend/compose.yaml). .env 파일을 코드에서 직접 읽지 않는다.
//   v0.1.1 과 다른 점: 수신 주소 기본값이 127.0.0.1 → 0.0.0.0 (컨테이너 밖 Nginx 가 부르므로 · 작성규칙 1-6),
//     model-api 주소가 서비스 이름(http://model-api:9543), shared 위치가 SHARED_DIR(이미지 안 /app/shared).
import { z } from 'zod';

const schema = z.object({
  // DB (#20 · 서비스 이름 db)
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().min(1),

  // 수신 — 컨테이너 안 포트. 호스트에는 열지 않고 Nginx 만 부른다 (#22 와 약속: web 9523 · admin 26101)
  WEB_HOST: z.string().min(1).default('0.0.0.0'),
  WEB_PORT: z.coerce.number().int().positive().default(9523),
  ADMIN_HOST: z.string().min(1).default('0.0.0.0'),
  ADMIN_PORT: z.coerce.number().int().positive().default(26101),

  // 다른 서비스 — 서비스 이름으로 부른다 (127.0.0.1 고정 없음)
  MODEL_API_URL: z.string().url().default('http://model-api:9543'),
  /** backend → model-api 서비스 전용 키 (#26 명령줄 도구로 발급) — 비어 있으면 model-api 호출이 401 */
  SERVICE_API_KEY: z.string().default(''),

  // 쿠키 서명 — 세션(#27)에서 쓴다. 비밀값이라 실행 시에만 주입
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET 는 32자 이상'),
  /** 접속 주소는 원문으로 저장하지 않고 이 값을 섞은 SHA-256 만 남긴다 (#27 · 기능 목록 H8 · H11). 비밀값 */
  ADDR_HASH_SALT: z.string().min(16, 'ADDR_HASH_SALT 는 16자 이상'),
  /** 같은 접속 주소에서 한 시간에 가입할 수 있는 수 (#27 · 기능 목록 H8). 시험은 크게 둔다 */
  SIGNUP_HOURLY_CAP: z.coerce.number().int().positive().default(5),

  // 프록시 뒤에서 실제 접속 주소를 읽을 범위 (Express trust proxy). Nginx 가 같은 compose 네트워크(사설 대역)에 있다 — #37 에서 확정
  TRUST_PROXY: z.string().default('loopback, uniquelocal'),

  // 공용 설정 파일 위치 (api/shared 를 이미지에 구운 곳 — api/shared/README.md 「이미지에 넣는 방법」)
  SHARED_DIR: z.string().min(1).default('/app/shared'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof schema>;

/** 설정을 검증한다. 실패하면 어떤 키가 문제인지만 알린다 — 값(비밀번호 등)은 출력하지 않는다 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new Error(`설정이 빠졌거나 잘못됐습니다: ${keys}`);
  }
  return parsed.data;
}

let cached: Env | null = null;

/** 프로세스 전체에서 한 번 읽은 설정 */
export function env(): Env {
  cached ??= loadEnv();
  return cached;
}
