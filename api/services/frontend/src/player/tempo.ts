// 재생 빠르기 계산(2026-09-30 황송해, UC_06 BR-PLY-05 · SD_02 ㉝) — spessasynth 없이 시험할 수 있게 player.ts 밖에 둔다.
/** 재생 빠르기의 기준 — 곡과 관계없이 4분음표 100 BPM. 배율은 여기에 곱한다 */
export const PLAYBACK_BASE_BPM = 100;

/** 고른 배율(rate)과 곡의 원래 빠르기(songBpm) → 연주기에 줄 속도 배수. 예: 120 BPM 곡을 1.5배(=150 BPM)로 → 1.25 */
export function playbackSpeed(rate: number, songBpm: number | null | undefined): number {
  const bpm = songBpm && songBpm > 0 ? songBpm : PLAYBACK_BASE_BPM;
  return (rate * PLAYBACK_BASE_BPM) / bpm;
}
