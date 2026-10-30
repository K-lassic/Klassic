// 운영자 계정 만들기 (tasks T016, FR-051): npm run admin:create -- --login <id> --name <이름>
// 비밀번호는 화면에 보이지 않게 묻고 argon2id 로만 저장한다(research R12).
// 2026-09-29 RBAC: 계정(account) + 운영자 표(operator_account) + 역할 operator·user 를 한 번에 만든다(팀원은 사용자 기능도 쓴다).
// 이미 가입한 계정(같은 아이디)이면 새로 만들지 않고 operator 역할만 더한다.
import argon2 from 'argon2';
import { createInterface } from 'node:readline';
import { one, tx, closePool } from '../db/pool.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => { if (s.includes(prompt)) out.output.write(s); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function grantOperator(accountId: number, login: string, hash: string, name: string): Promise<void> {
  await tx(async (conn) => {
    await conn.query('INSERT INTO operator_account (login_id, password_hash, display_name, account_id) VALUES (?, ?, ?, ?)',
      [login, hash, name, accountId]);
    await conn.query("INSERT IGNORE INTO account_role (account_id, role_code) VALUES (?, 'operator'), (?, 'user')", [accountId, accountId]);
  });
}

async function main() {
  const login = arg('login');
  const name = arg('name');
  if (!login || !name) { console.error('사용: npm run admin:create -- --login <아이디> --name <이름>'); process.exit(2); }
  if (await one('SELECT 1 FROM operator_account WHERE login_id = ?', [login])) { console.error(`이미 있는 운영자 아이디: ${login}`); process.exit(1); }
  const existing = await one<{ account_id: number; password_hash: string; display_name: string }>(
    'SELECT account_id, password_hash, display_name FROM account WHERE login_id = ?', [login]);
  if (existing) {
    await grantOperator(Number(existing.account_id), login, existing.password_hash, existing.display_name);
    console.log(`이미 있는 계정에 운영자 역할을 더했습니다: ${login}`);
    await closePool();
    return;
  }
  const pw = process.env.ADMIN_PASSWORD ?? (await askHidden('비밀번호(12자 이상): '));
  if (pw.length < 12) { console.error('비밀번호는 12자 이상이어야 합니다.'); process.exit(1); }
  if (!process.env.ADMIN_PASSWORD) {
    const again = await askHidden('비밀번호 확인: ');
    if (again !== pw) { console.error('비밀번호가 서로 다릅니다.'); process.exit(1); }
  }
  const hash = await argon2.hash(pw, { type: argon2.argon2id });
  const accountId = await tx(async (conn) => {
    const [ins] = await conn.query('INSERT INTO account (login_id, password_hash, display_name) VALUES (?, ?, ?)', [login, hash, name]);
    return Number((ins as { insertId: number }).insertId);
  });
  await grantOperator(accountId, login, hash, name);
  console.log(`운영자 계정을 만들었습니다: ${login} (${name}) — 역할 operator · user`);
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });
