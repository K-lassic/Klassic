// #91 외부 키 발급 — 시험 · 시연용 외부 키를 서버 PC 에서 바로 만든다 (화면 신청과 같은 발급 코드).
//
//   사용 (서버 PC):
//     docker compose run --rm -T web node dist/tools/issueExternalKey.js --name <이름> --email <메일> [--organization <소속>] [--purpose <용도>] [--limit <시간당 호출 수>]
//     → 새 키 원문이 **한 번만** 나온다. 서비스 키와 달리 다른 키를 폐기하지 않는다.
//   구조에서의 위치: 운영자 → 이 도구 → services/accessKeys.ts → DB access_key · key_application. model-api 가 같은 표에서 대조한다.
//   DB 제약 chk_key_origin 때문에 외부 키는 신청 번호가 있어야 해서, 도구로 만든 키도 신청 기록을 남긴다. --limit 이 없으면 처리 설정의 기본 한도.
//   출력: 키 원문만 표준 출력(stdout)에, 안내는 표준 오류(stderr)에 — `> 파일` 로 받아도 키만 남는다.
import { currentSettings } from '../config/settings.js';
import { closePool } from '../db/pool.js';
import { hashAddr } from '../lib/ids.js';
import { ApplicationRateLimited, issueExternalKey } from '../services/accessKeys.js';
import { arg, runTool } from './cli.js';

async function main(): Promise<void> {
  const name = arg('name');
  const email = arg('email')?.toLowerCase();
  if (!name || !email) throw new Error('사용: issueExternalKey.js --name <이름> --email <메일> [--organization <소속>] [--purpose <용도>] [--limit <시간당 호출 수>]');
  const limit = arg('limit') === undefined ? (await currentSettings()).default_call_limit_per_hour ?? 30 : Number(arg('limit'));
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit 은 1 이상의 정수여야 합니다');
  try {
    const k = await issueExternalKey({
      name, contactEmail: email, organization: arg('organization') ?? 'K-lassic', purpose: arg('purpose') ?? '운영자 발급',
      // G11 주소 한도가 도구끼리 묶이지 않게 메일별로 다른 값을 쓴다 (메일 한도는 그대로 걸린다)
      callLimitPerHour: limit, clientAddrHash: hashAddr(`operator-tool:${email}`), accountId: null,
    });
    console.error(`외부 키를 발급했습니다 — 번호 ${k.keyId} · 앞자리 ${k.prefix} · 신청 번호 ${k.applicationNo} · 시간당 ${k.callLimitPerHour}회`);
    console.error('아래 키는 다시 볼 수 없습니다. 요청의 X-API-Key 머리글에 넣습니다.');
    console.log(k.raw);
  } catch (e) {
    if (e instanceof ApplicationRateLimited) throw new Error('신청 빈도 한도(G11)에 걸렸습니다 — 다른 --email 을 쓰거나 잠시 뒤 다시 하세요');
    throw e;
  }
}

runTool(main, closePool);
