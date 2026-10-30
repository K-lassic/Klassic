// S4-B 키 관리 — 한도 값 G6 검사와 C8 가린 키 표시.

/** 호출 한도(시간당) — 1 이상 정수(UC14 E1). 올바르면 null */
export function keyLimitProblem(raw: string): string | null {
  const t = raw.trim();
  if (t === '') return '호출 한도를 넣어 주십시오.';
  const v = Number(t);
  if (Number.isNaN(v)) return '숫자만 넣어 주십시오.';
  if (!Number.isInteger(v)) return '소수가 아닌 정수로 넣어 주십시오.';
  if (v < 1) return `호출 한도는 1 이상이어야 합니다 (${v}은(는) 쓸 수 없습니다).`;
  return null;
}

/** C8 변형 B — 앞자리만 (예: gk_7Qx…) */
export function maskedKey(prefix: string | null | undefined): string {
  if (!prefix) return '—';
  return `${prefix}…`;
}
