// 운영자(관리자) 비밀번호 바꾸기 — 기존 코드(src)에 비밀번호 변경 기능이 없어 로컬 운영용으로 둔다.
// 사용: docker compose run --rm -it -v ./docker/scripts:/scripts:ro web node /scripts/reset-operator-password.mjs --login admin
// - 비밀번호는 화면에 보이지 않게 두 번 묻고, 기존 admin:create 와 같은 규칙(12자 이상 · argon2id)으로 저장한다
// - account(로그인 확인에 쓰는 표)와 operator_account 의 해시를 함께 바꾸고, 로그인 잠금도 풀어 준다
// - DB 연결은 앱의 pool.js 를 그대로 써서 /app/.env 설정을 읽는다
import argon2 from '/app/node_modules/argon2/argon2.cjs';
import { createInterface } from 'node:readline';
import { one, tx, closePool } from '/app/backend/dist/db/pool.js';

const MIN_LENGTH = 12;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(prompt)) rl.output.write(s); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function main() {
  const login = arg('login');
  if (!login) { console.error('사용: node reset-operator-password.mjs --login <운영자 아이디>'); process.exit(2); }
  if (!process.stdin.isTTY) { console.error('비밀번호를 입력받으려면 터미널이 필요합니다 (docker compose run 에 -it 를 붙여 주십시오).'); process.exit(2); }

  const op = await one(
    `SELECT o.operator_id, a.account_id FROM operator_account o
       JOIN account a ON a.account_id = o.account_id
      WHERE a.login_id = ?`, [login]);
  if (!op) { console.error(`운영자 계정이 없습니다: ${login}`); process.exit(1); }

  const pw = await askHidden(`새 비밀번호(${MIN_LENGTH}자 이상): `);
  if (pw.length < MIN_LENGTH) { console.error(`비밀번호는 ${MIN_LENGTH}자 이상이어야 합니다.`); process.exit(1); }
  const again = await askHidden('새 비밀번호 확인: ');
  if (again !== pw) { console.error('비밀번호가 서로 다릅니다.'); process.exit(1); }

  const hash = await argon2.hash(pw, { type: argon2.argon2id });
  await tx(async (conn) => {
    await conn.query('UPDATE account SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE account_id = ?', [hash, op.account_id]);
    await conn.query('UPDATE operator_account SET password_hash = ? WHERE operator_id = ?', [hash, op.operator_id]);
  });
  console.log(`비밀번호를 바꿨습니다: ${login} — 관리자 화면에서 새 비밀번호로 다시 로그인하십시오.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => closePool());
