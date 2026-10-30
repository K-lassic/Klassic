import pino from 'pino';

// DB 오류(mysql2)는 오류 객체에 SQL 본문(sql)·값이 섞인 문구(sqlMessage·message)가 들어 있어 올린 파일 이름 같은
// 입력이 로그에 남는다. 코드·번호만 남긴다(2026-09-30 API 점검 D6, design/SD_04 §8-1).
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

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.VITEST ? 'silent' : 'info'),
  serializers: { err: safeErr, error: safeErr },
});
