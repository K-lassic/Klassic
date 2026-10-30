// 남은 시간·시각 표시 — 쉬운 말
export function formatRemaining(seconds: number): string {
  if (seconds <= 0) return '보관 기간 지남';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 1) return `보관 ${h}시간 남음`;
  if (m >= 1) return `보관 ${m}분 남음`;
  return '보관 1분 안에 끝남';
}

export function formatClock(d: Date): string {
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}분 ${r}초` : `${r}초`;
}

/**
 * 오류 본문의 retry_after 를 시각으로 — ISO 문자열이면 그 시각, 숫자(초)면 지금부터.
 * (INTERFACES §2: 429 는 Retry-After 초 머리글도 보냄 — 서버가 어느 쪽을 넣어도 받는다)
 */
export function parseRetryAfter(value: string | number | null | undefined, now: number = Date.now()): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) return new Date(now + Number(value) * 1000);
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? null : new Date(t);
}

export const MIDI_NOTE_NAMES = ['도', '도♯', '레', '레♯', '미', '파', '파♯', '솔', '솔♯', '라', '라♯', '시'];
export function pitchName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${MIDI_NOTE_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}
