// #23 · #27 시험 설정 — tests/unit(DB 없이) · tests/integration(TEST_DB_HOST 가 있을 때만, 실제 MariaDB)
//   통합 시험은 같은 DB 를 쓰므로 파일을 하나씩 차례로 돌린다
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
