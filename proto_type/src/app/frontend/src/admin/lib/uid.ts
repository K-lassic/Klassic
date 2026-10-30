// 화면 안에서 겹치지 않는 id (Vue 3.4 에는 useId 가 없어 직접 센다)
let n = 0;
export function uid(prefix = 'a'): string {
  n += 1;
  return `${prefix}-${n}`;
}
