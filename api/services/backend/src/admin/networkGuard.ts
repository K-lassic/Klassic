// #100 관리자 접속 허용 범위 검사 — ADMIN_ALLOWED_CIDRS 밖이면 403 ADMIN_NETWORK_DENIED (G5, 기능 목록 FR-051 · v0.1.1 admin/networkGuard.ts).
//
//   구조에서의 위치: Nginx 관리자 server ─ X-Forwarded-For(실제 접속 주소) ─▶ admin(createAdminApp) ─ 이 검사 ─▶ 로그인 · 관리자 라우터
//     접속 주소는 Express trust proxy 가 읽은 req.ip 다. 관리자 Nginx 는 X-Forwarded-For 를 믿지 않고(set_real_ip_from 없음) 실제 TCP 접속 주소 하나로 덮어써 넘기고
//     (deploy/nginx/admin/admin.conf), 이 앱은 그 Nginx 연결(ADMIN_TRUSTED_PROXIES)이 넘긴 헤더만 믿는다(app.ts createAdminApp, lib/trustedProxy.ts).
//     다른 컨테이너가 Nginx 를 거치지 않고 직접 붙어 헤더를 꾸며도 req.ip 는 그 연결의 실제 주소다. 이 앱 앞에 다른 프록시를 두면 ADMIN_TRUSTED_PROXIES 에 그 프록시만 더한다.
//     막힌 사건은 gate_event(G5)에 주소 해시만 남긴다.
//   /admin/health 는 이 검사 앞에서 답한다 — 컨테이너 안 healthcheck 용이고 준비 여부만 알린다.
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '../config/env.js';
import { inCidrs, parseCidrList, type Cidr } from '../lib/cidr.js';
import { hashAddr } from '../lib/ids.js';
import { recordGate } from '../services/gateEvents.js';
import { ApiError, sendError } from '../web/errors.js';

/** 허용 범위를 받아 검사기를 만든다 — 앱은 env().ADMIN_ALLOWED_CIDRS, 시험은 시험용 범위를 넣는다 */
export function networkGuard(allowed: Cidr[] = parseCidrList(env().ADMIN_ALLOWED_CIDRS) ?? []): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (inCidrs(req.ip, allowed)) { next(); return; }
    void recordGate('G5', 'admin', 'client', hashAddr(req.ip), 'ADMIN_NETWORK_DENIED');
    sendError(res, new ApiError('ADMIN_NETWORK_DENIED'));
  };
}
