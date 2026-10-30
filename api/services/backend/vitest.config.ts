// #23 시험 설정 — tests/ 아래 *.test.ts. DB 없이 도는 단위 시험만 둔다 (DB 가 필요한 시험은 #44)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
