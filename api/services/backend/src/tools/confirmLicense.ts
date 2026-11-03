// #98 음원 · 렌더러 라이선스 확인 기록 — 팀장 결정을 DB license_policy 에 남긴다 (관리자 API #100 `PUT /admin/license` 전까지의 대체 수단).
//
//   사용 (서버 PC):
//     docker compose run --rm -T web node dist/tools/confirmLicense.js                         → 지금 상태만 본다
//     docker compose run --rm -T web node dist/tools/confirmLicense.js --operator <아이디> --confirm   → 확인함 (1)
//     docker compose run --rm -T web node dist/tools/confirmLicense.js --operator <아이디> --withhold  → 되돌림 (0)
//   구조에서의 위치: 운영자 → 이 도구 → DB license_policy · change_history.
//     뷰 v_mp3_license 가 이 값을 읽어 web 은 "팀 내부 시연용" 안내를, model-api 는 외부 키 MP3 허용(api_mp3_allowed)을 정한다.
//   DB 제약 chk_license_decided: 확인함(1)은 결정한 운영자 · 시각이 있어야 한다. 바꾸면 change_history 에 남는다.
import { one, closePool, tx } from '../db/pool.js';
import { operatorIdOf } from '../services/accessKeys.js';
import { addHistory } from '../services/history.js';
import { arg, runTool } from './cli.js';

const POLICY = 'sound_and_renderer';

interface Policy { confirmed: number; decided_by: number | null; decided_at: Date | null }

async function current(): Promise<Policy> {
  const p = await one<Policy>('SELECT confirmed, decided_by, decided_at FROM license_policy WHERE policy_code = ?', [POLICY]);
  if (!p) throw new Error(`license_policy 에 ${POLICY} 행이 없습니다 — DB 마이그레이션을 확인하세요`);
  return p;
}

function show(p: Policy): string {
  return p.confirmed
    ? `확인함 (운영자 번호 ${p.decided_by} · ${p.decided_at?.toISOString()}) — 외부 키 MP3 허용, 화면 "내부 시연용" 안내 없음`
    : '확인 전 — 외부 키 MP3 보류(409 MP3_WITHHELD), 화면에 "내부 시연용" 안내';
}

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');
  const withhold = process.argv.includes('--withhold');
  const before = await current();
  if (!confirm && !withhold) {
    console.log(`지금 상태: ${show(before)}`);
    return;
  }
  if (confirm && withhold) throw new Error('--confirm 과 --withhold 는 함께 쓸 수 없습니다');
  const operator = arg('operator');
  if (!operator) throw new Error('사용: confirmLicense.js --operator <운영자 아이디> --confirm | --withhold (누가 정했는지 이력에 남긴다)');
  const operatorId = await operatorIdOf(operator);
  const next = confirm ? 1 : 0;
  if (before.confirmed === next) {
    console.log(`바꾸지 않았습니다 — 이미 ${show(before)}`);
    return;
  }

  await tx(async (conn) => {
    await conn.query(
      'UPDATE license_policy SET confirmed = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP(3) WHERE policy_code = ?',
      [next, operatorId, POLICY]);
    await addHistory(operatorId, 'license_policy', POLICY, 'confirmed', Boolean(before.confirmed), Boolean(next), conn);
  });
  console.log(`바꿨습니다: ${show(await current())}`);
}

runTool(main, closePool);
