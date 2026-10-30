// gugak_test_web 를 비우고 마이그레이션 + 시드를 새로 적용한다
import mysql from 'mysql2/promise';

export default async function setup() {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: Number(process.env.TEST_DB_PORT ?? 26133), user: 'gugak_dev', password: 'gugak_dev' });
  await conn.query('DROP DATABASE IF EXISTS gugak_test_web');
  await conn.query('CREATE DATABASE gugak_test_web CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await conn.end();
  await import('./env.js');
  const { migrate } = await import('../../src/db/migrate.js');
  await migrate({ database: 'gugak_test_web', seed: true, log: () => {} });
  // 시험 클라이언트는 모두 127.0.0.1 에서 오므로 웹 사용자 한도(G12)는 넉넉히 두고, G12 시험만 낮춘다
  const c2 = await mysql.createConnection({ host: '127.0.0.1', port: Number(process.env.TEST_DB_PORT ?? 26133), user: 'gugak_dev', password: 'gugak_dev', database: 'gugak_test_web' });
  await c2.query('UPDATE processing_setting_version SET web_max_active_per_client = 1000, web_hourly_request_cap = 1000');
  await c2.end();
}
