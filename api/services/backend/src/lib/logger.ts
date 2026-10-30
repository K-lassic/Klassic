// #23 로그 — pino JSON 한 줄 → stdout (작성규칙 1-4: 파일이 아니라 stdout, 수집은 Docker 가 한다).
//
//   구조에서의 위치: backend 모든 모듈. `docker compose logs web` 로 본다.
//   v0.1.1 과 같은 규칙: DB 오류(mysql2)는 SQL 본문 · 값을 지우고 코드 · 번호만 남긴다 — 올린 파일 이름 같은 입력이 로그에 새지 않게.
import pino from 'pino';

const DB_FIELDS = ['sql', 'sqlMessage', 'parameters', 'values'] as const;

export function safeErr(e: unknown): unknown {
  const s = pino.stdSerializers.err(e as Error) as unknown as Record<string, unknown>;
  if (!s || typeof s !== 'object') return s;
  const isDb = DB_FIELDS.some((k) => k in s) || typeof s.sqlState === 'string';
  if (!isDb) return s;
  for (const k of DB_FIELDS) delete s[k];
  s.message = `DB 오류 ${String(s.code ?? '')} ${String(s.errno ?? '')}`.trim();
  if (typeof s.stack === 'string') s.stack = s.stack.split('\n').filter((l) => l.trimStart().startsWith('at ')).join('\n');
  return s;
}

// 로그 수준은 설정(env)보다 먼저 정해야 해서 환경변수를 직접 본다 — 설정 검증 실패도 로그로 남기기 위해
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.VITEST ? 'silent' : 'info'),
  serializers: { err: safeErr, error: safeErr },
  base: { service: 'backend' },
});
