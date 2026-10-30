// #26 서비스 전용 키 발급 — backend → model-api 호출에 쓰는 키. 관리자 API(P3) 전까지의 대체 수단 (#5 ※ · v0.1.1 POST /admin/service-key).
//
//   사용 (서버 PC):
//     docker compose run --rm web node dist/tools/issueServiceKey.js --operator <운영자 아이디>
//     → 이전 서비스 키는 폐기되고, 새 키 원문이 **한 번만** 나온다 → api/.env 의 SERVICE_API_KEY 에 넣고
//       docker compose up -d web (web 을 다시 만들어야 새 값을 읽는다)
//   구조에서의 위치: backend → DB access_key · change_history. model-api 는 같은 표에서 키를 대조한다 (#24).
//   출력: 키 원문만 표준 출력(stdout)에, 안내는 표준 오류(stderr)에 — `> 파일` 로 받아도 키만 남는다. 로그에는 앞 8글자만.
import { closePool } from '../db/pool.js';
import { issueServiceKey, operatorIdOf } from '../services/accessKeys.js';
import { arg, runTool } from './cli.js';

async function main(): Promise<void> {
  const operator = arg('operator');
  if (!operator) throw new Error('사용: issueServiceKey.js --operator <운영자 아이디> (누가 발급했는지 이력에 남긴다)');
  const operatorId = await operatorIdOf(operator);
  const k = await issueServiceKey(operatorId);

  console.error(`서비스 키를 발급했습니다 — 번호 ${k.keyId} · 앞자리 ${k.prefix}${k.revokedKeyIds.length ? ` · 폐기한 이전 키 ${k.revokedKeyIds.join(', ')}` : ''}`);
  console.error('아래 키는 다시 볼 수 없습니다. api/.env 의 SERVICE_API_KEY 에 넣고 `docker compose up -d web` 하세요.');
  console.log(k.raw);
}

runTool(main, closePool);
