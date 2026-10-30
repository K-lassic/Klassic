// #26 운영자 계정 만들기 — 관리자 화면에서는 만들 수 없고 명령줄로만 만든다 (v0.1.1 admin/createOperator.ts 와 같은 동작).
//
//   사용 (서버 PC):
//     docker compose run --rm -it web node dist/tools/createOperator.js --login <아이디> --name <이름>
//     → 비밀번호(12자 이상)를 두 번 묻는다. 화면에 보이지 않고, argon2id 해시만 저장한다.
//   구조에서의 위치: backend → DB account(계정) + operator_account(운영자 표) + account_role(operator · user)
//     계정 하나로 사용자 기능도 쓰고 관리자 화면도 쓴다. 이미 가입한 계정이면 operator 역할만 더한다.
import argon2 from 'argon2';
import { one, tx, closePool } from '../db/pool.js';
import { arg, askHidden, runTool } from './cli.js';

const MIN_PASSWORD = 12;

async function grantOperator(accountId: number, login: string, hash: string, name: string): Promise<void> {
  await tx(async (conn) => {
    await conn.query('INSERT INTO operator_account (login_id, password_hash, display_name, account_id) VALUES (?, ?, ?, ?)',
      [login, hash, name, accountId]);
    await conn.query("INSERT IGNORE INTO account_role (account_id, role_code) VALUES (?, 'operator'), (?, 'user')", [accountId, accountId]);
  });
}

async function main(): Promise<void> {
  const login = arg('login');
  const name = arg('name');
  if (!login || !name) throw new Error('사용: createOperator.js --login <아이디> --name <이름>');
  if (await one('SELECT 1 FROM operator_account WHERE login_id = ?', [login])) throw new Error(`이미 있는 운영자 아이디: ${login}`);

  const existing = await one<{ account_id: number; password_hash: string; display_name: string }>(
    'SELECT account_id, password_hash, display_name FROM account WHERE login_id = ?', [login]);
  if (existing) {
    await grantOperator(Number(existing.account_id), login, existing.password_hash, existing.display_name);
    console.log(`이미 있는 계정에 운영자 역할을 더했습니다: ${login}`);
    return;
  }

  // 비밀번호는 환경변수(자동화용) 또는 화면에 안 보이게 입력 — 명령줄 인자로는 받지 않는다(셸 기록 · ps 에 남으므로)
  const fromEnv = process.env.ADMIN_PASSWORD;
  const pw = fromEnv ?? (await askHidden(`비밀번호(${MIN_PASSWORD}자 이상): `));
  if (pw.length < MIN_PASSWORD) throw new Error(`비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다`);
  if (!fromEnv && (await askHidden('비밀번호 확인: ')) !== pw) throw new Error('비밀번호가 서로 다릅니다');

  const hash = await argon2.hash(pw, { type: argon2.argon2id });
  const accountId = await tx(async (conn) => {
    const [ins] = await conn.query('INSERT INTO account (login_id, password_hash, display_name) VALUES (?, ?, ?)', [login, hash, name]);
    return Number((ins as { insertId: number }).insertId);
  });
  await grantOperator(accountId, login, hash, name);
  console.log(`운영자 계정을 만들었습니다: ${login} (${name}) — 역할 operator · user`);
}

runTool(main, closePool);
