// #100 서비스 전용 키 발급 — POST /admin/service-key (계약 web-api.yaml · v0.1.1 admin/keys.ts · 명령줄 도구 #26 issueServiceKey 와 같은 동작).
//
//   구조에서의 위치: 관리자 화면 → admin /admin/service-key (requireOperator 뒤) ─▶ services/accessKeys.issueServiceKey ─▶ DB access_key · change_history
//     발급한 키로 backend 가 model-api 를 부른다(X-API-Key). 새 키를 만들면 이전 서비스 키는 같은 트랜잭션에서 폐기된다.
//   원문은 이 응답에서 한 번만 보인다(저장하지 않음). 응답은 캐시하지 않는다(Cache-Control: no-store).
//   발급해도 실행 중인 web 은 옛 키를 쓴다 — api/.env 의 SERVICE_API_KEY 를 바꾸고 web 을 다시 만들어야 한다(notice).
import { Router } from 'express';
import { issueServiceKey } from '../services/accessKeys.js';
import { wrap } from '../web/errors.js';

export const serviceKeyRouter = Router();

// POST /admin/service-key → 201 { key_id, api_key, key_prefix, revoked_key_ids, notice }
serviceKeyRouter.post('/service-key', wrap(async (req, res) => {
  const k = await issueServiceKey(req.operatorId!);
  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json({
    key_id: k.keyId, api_key: k.raw, key_prefix: k.prefix, revoked_key_ids: k.revokedKeyIds,
    notice: '이 키는 다시 볼 수 없습니다. api/.env 의 SERVICE_API_KEY 를 이 값으로 바꾸고 `docker compose up -d web` 으로 web 을 다시 만들어 주십시오.',
  });
}));
