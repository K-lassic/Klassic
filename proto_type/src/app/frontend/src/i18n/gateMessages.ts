// 게이트 반려 문구 — 원본: app/shared/error-codes.json `gate_codes`(message·fix).
// 화면 제목·해제 주체·다음 행동은 design/SD_02 §12(게이트 맵 → 화면 표현)에서 왔다.
// 웹 문구와 API 사유 코드가 같은 원본에서 나온다(SC-015).
import errorCodes from '../../../shared/error-codes.json';
import type { ApiErrorBody } from '@/api/client';
import { GateError } from '@/api/client';
import { parseRetryAfter } from '@/lib/time';

export type GateId = 'G1' | 'G4' | 'G9' | 'G10' | 'G11' | 'G12' | string;

export interface GateView {
  code: string;
  gate: GateId | null;
  /** 칩 글자 — 예: "반려 · G1" */
  chip: string;
  /** 칩 종류 — 만료(G4)는 s-expired, 나머지 반려는 s-rejected */
  chipKind: 's-rejected' | 's-expired';
  /** 제목 — SD_02 §12 */
  title: string;
  /** ① 사유 */
  reason: string;
  /** ② 해제 주체 */
  releaser: string;
  /** ③ 다음 행동(안내 글) */
  fix: string;
  /** 다음 행동 버튼 이름(해제 주체가 나일 때만 — 변형 A) */
  actionLabel: string | null;
  /** 레일에 붙일 짧은 이름 — "G1 반려" */
  railLabel: string;
  /** 다시 해 볼 수 있는 시각(G11·G12·G3) */
  retryAt: Date | null;
}

/** web_fix: 웹 화면 전용 고치는 방법(웹은 사진만 받음, 2026-09-29) — 있으면 fix 대신 쓴다. API활용 오류표는 fix */
interface GateCodeEntry { http: number; gate: string | null; message: string; fix: string; web_fix?: string }
const CODES = errorCodes.gate_codes as Record<string, GateCodeEntry>;

interface GateFrame { title: string; releaser: string; actionLabel: string | null; railLabel: string; chipKind?: 's-rejected' | 's-expired' }
const FRAMES: Record<string, GateFrame> = {
  G1: { title: '반려 · 접수하지 않았습니다 (G1 파일 검사)', releaser: '올린 사람(나)', actionLabel: '다시 올리기', railLabel: 'G1 반려' },
  G4: { title: '만료 · 보관 기간(24시간)이 지났습니다 (G4 보관 기간)', releaser: '올린 사람(나)이 악보를 다시 올려 새 요청을 만듭니다', actionLabel: '악보 다시 올리기', railLabel: 'G4 만료', chipKind: 's-expired' },
  G9: { title: '한 번만 보입니다 (G9 키 한 번 확인)', releaser: '신청하는 사람(나)이 보관합니다. 잃어버리면 다시 신청해 새 키를 받습니다', actionLabel: null, railLabel: 'G9 한 번만' },
  G10: { title: '반려 · 신청할 수 없습니다 (G10 신청 필수 항목)', releaser: '신청하는 사람(나)', actionLabel: '빠진 항목으로 가기', railLabel: 'G10 빠진 항목' },
  G11: { title: '반려 · 잠시 뒤에 다시 신청해 주십시오 (G11 신청 빈도 제한)', releaser: '신청하는 사람(나)이 잠시 기다린 뒤 다시 신청합니다', actionLabel: null, railLabel: 'G11 잠시 뒤 다시' },
  G12: { title: '반려 · 지금은 올릴 수 없습니다 (G12 올리기 횟수 제한)', releaser: '올린 사람(나)이 잠시 기다린 뒤 다시 올립니다', actionLabel: null, railLabel: 'G12 잠시 뒤 다시' },
  // 2026-09-29 RBAC — SD_02 §9B S0 로그인·가입
  G13: { title: '반려 · 이 기능을 쓸 수 없습니다 (G13 권한)', releaser: '내가 로그인하거나 권한이 있는 계정으로 다시 합니다', actionLabel: null, railLabel: 'G13 권한' },
  G14: { title: '반려 · 가입할 수 없습니다 (G14 가입 검사)', releaser: '방문자(나)가 고쳐서 다시 가입하거나 로그인합니다', actionLabel: null, railLabel: 'G14 가입' },
  G15: { title: '반려 · 로그인할 수 없습니다 (G15 로그인 잠금)', releaser: '내가 다시 입력하거나, 잠금이 풀린 뒤(10분) 다시 로그인합니다', actionLabel: null, railLabel: 'G15 로그인' },
};
const GENERIC: GateFrame = { title: '요청을 처리하지 못했습니다', releaser: '나', actionLabel: null, railLabel: '막힘' };

/** 코드별 화면 문구 덮어쓰기 — 공유 원본보다 화면에 더 맞는 말이 필요할 때만 */
const OVERRIDES: Record<string, Partial<Pick<GateView, 'reason' | 'fix' | 'actionLabel' | 'releaser'>>> = {
  // (2026-10-01 황송해 212번) 다른 곳 로그인 중 · 이미 로그인은 잠금이 아니다 — G15 틀의 "잠금이 풀린 뒤(10분)" 대신
  LOGIN_ALREADY_ACTIVE: { releaser: '다른 곳에서 로그아웃하거나 10분 뒤 다시 로그인합니다' },
  ALREADY_LOGGED_IN: { releaser: '내가 먼저 로그아웃합니다' },
  // ~~UPLOAD_TOO_MANY_FILES: '한 장만 올려 주세요'~~ — 2026-09-29 여러 쪽 결정으로 뜻이 'PDF 여러 개 · PDF 와 사진 섞음'으로
  // 바뀌어 공유 원본(error-codes.json) 문구를 그대로 쓴다(2026-09-30 T188)
  UPLOAD_RESOLUTION_TOO_LOW: { actionLabel: '더 선명한 사진으로 다시 올리기' },
  UPLOAD_SCORE_TYPE_REQUIRED: { actionLabel: '악보 종류 고르기' },
  WEB_ACTIVE_REQUEST_EXISTS: { actionLabel: null },
};

export function gateMessage(code: string, extra: { reason?: string | null; fix?: string | null; gate?: string | null; retryAfter?: string | number | null } = {}): GateView {
  const entry = CODES[code];
  const gate = extra.gate ?? entry?.gate ?? null;
  const frame = (gate && FRAMES[gate]) || GENERIC;
  const over = OVERRIDES[code] ?? {};
  const chipKind = frame.chipKind ?? 's-rejected';
  return {
    code,
    gate,
    chip: `${chipKind === 's-expired' ? '만료' : '반려'}${gate ? ` · ${gate}` : ''}`,
    chipKind,
    title: frame.title,
    reason: over.reason ?? extra.reason ?? entry?.message ?? '요청을 처리하지 못했습니다.',
    releaser: over.releaser ?? frame.releaser,
    fix: over.fix ?? extra.fix ?? entry?.web_fix ?? entry?.fix ?? '잠시 뒤 다시 시도해 주십시오.',
    actionLabel: over.actionLabel !== undefined ? over.actionLabel : frame.actionLabel,
    railLabel: frame.railLabel,
    retryAt: parseRetryAfter(extra.retryAfter ?? null),
  };
}

/** 서버 오류(GateError) → 화면 문구. 서버가 보낸 message·fix 가 있으면 그것을 쓴다(같은 원본).
 *  (2026-09-30 T188 여러 쪽) 반려에 details.page 가 있으면 사유 앞에 어느 쪽인지 붙인다 — "2쪽(page2.jpg) 해상도가…"(SD_02 S1 도면).
 *  pageNames: 올린 순서의 파일 이름(있으면 괄호로) */
export function gateFromError(e: unknown, pageNames: string[] = []): GateView {
  if (e instanceof GateError) {
    const b: ApiErrorBody = e.body;
    const reason = resolutionReason(b) ?? b.message ?? CODES[b.code]?.message ?? null;
    return gateMessage(b.code, { reason: reason ? pagePrefix(b, pageNames) + reason : null, fix: b.fix ?? null, gate: b.gate, retryAfter: b.retry_after });
  }
  return gateMessage('INTERNAL_ERROR');
}

/** 여러 쪽 반려의 쪽 표시 — details.page(1부터)가 없으면 빈 글 */
function pagePrefix(b: ApiErrorBody, names: string[]): string {
  const page = b.details?.page;
  if (typeof page !== 'number') return '';
  const name = names[page - 1];
  return name ? `${page}쪽(${name}) ` : `${page}쪽 `;
}

/** 해상도 반려 사유에 실제 사진 크기와 기준을 붙인다 — SD_02 §3-3 "해상도가 너무 낮아요 (사진 크기 600px, 기준 650px)".
 *  화면 말은 '짧은 변' 대신 '사진 크기'(2026-09-29). 서버 details 에 숫자가 없으면 공유 문구 그대로 */
function resolutionReason(b: ApiErrorBody): string | null {
  if (b.code !== 'UPLOAD_RESOLUTION_TOO_LOW') return null;
  const actual = b.details?.actual_short_edge_px;
  const min = b.details?.min_short_edge_px;
  if (typeof actual !== 'number' || typeof min !== 'number') return null;
  return `해상도가 너무 낮습니다 (사진 크기 ${actual}px, 기준 ${min}px)`;
}

/** 사유 코드만으로 원본 문구 */
export function codeMessage(code: string): { message: string; fix: string } | null {
  const e = CODES[code];
  return e ? { message: e.message, fix: e.fix } : null;
}

/** 게이트가 아닌 상태 문구(렌더링 실패·추천 없음 등) — error-codes.json `status_codes` */
export function statusText(code: string): string {
  return (errorCodes.status_codes as Record<string, string>)[code] ?? code;
}

/** S4-A 매뉴얼 오류 코드 표용 — 게이트별 목록 */
export function gateCodesFor(gates: string[]): { code: string; http: number; gate: string; message: string; fix: string }[] {
  return Object.entries(CODES)
    .filter(([, v]) => v.gate && gates.includes(v.gate))
    .map(([code, v]) => ({ code, http: v.http, gate: v.gate as string, message: v.message, fix: v.fix }));
}
