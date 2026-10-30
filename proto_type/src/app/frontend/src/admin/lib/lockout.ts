// G5 로그인 잠김(423) — 다시 시도할 수 있는 시각까지 남은 초.
import { GateError } from '@/api/client';

/** 남은 초(올림). 지났으면 0 */
export function remainingSeconds(retryAt: Date | null, now: number = Date.now()): number {
  if (!retryAt) return 0;
  const ms = retryAt.getTime() - now;
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/** 423 오류에서 다시 시도 시각 — retry_after 가 ISO 시각이든 초(숫자)든 받는다. 없으면 null */
export function retryAtFromError(e: GateError, now: number = Date.now()): Date | null {
  const raw = e.body.retry_after as unknown;
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' || /^\d+$/.test(String(raw))) return new Date(now + Number(raw) * 1000);
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 65 → '1분 5초', 30 → '30초' */
export function formatRemaining(sec: number): string {
  if (sec <= 0) return '0초';
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m === 0) return `${s}초`;
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}
