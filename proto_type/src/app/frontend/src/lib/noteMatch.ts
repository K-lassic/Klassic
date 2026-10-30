// 악보에서 누른 음표 → ScoreDoc 음표 찾기 (SD_02 §5 "악보에서 음표를 눌러 고르기", 2026-09-30 황송해 결정)
// OSMD 음표는 (성부 번호 · 시작 시각(온음표 단위) · 음 높이)만 안다. ScoreDoc 음표와 같은 성부에서 시작 틱이 같은
// 음표를 찾고, 여럿이면(화음) 음 높이가 가장 가까운 것을 고른다. 붙임줄로 나뉜 뒷부분처럼 시작이 맞는 음표가 없으면 null.
import type { ScoreDoc } from '@/types/score';

/** OSMD 음 높이(getHalfTone) → MIDI 번호(가운데 도 = 60).
 *  (2026-09-30 131번) OSMD 1.9.9 는 가운데 도(C4)를 48 로 준다(브라우저에서 확인) — 전에는 +48 로 36 반음 높게 잡아
 *  화음에서 늘 가장 높은 음이 골라졌다. */
export const osmdHalfToneToMidi = (halfTone: number): number => halfTone + 12;

/** 화음(한 VexFlow 음표 g 에 음표 머리가 여럿)의 머리 순서 → ScoreDoc 음표 id. 머리는 낮은 음부터 그려진다.
 *  머리 수와 음 수가 다르면 null(그 화음은 통째로 고른다) (2026-09-30 131번) */
export function chordHeadIds(entries: { id: string; midi: number | null }[], headCount: number): string[] | null {
  if (entries.length < 2 || entries.length !== headCount) return null;
  return [...entries].sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0)).map((e) => e.id);
}

export function matchScoreNote(doc: ScoreDoc, part: number, wholeNotes: number, midi: number | null): string | null {
  const notes = doc.parts[part]?.notes ?? [];
  const tick = Math.round(wholeNotes * 4 * doc.ppq);
  const tol = Math.max(1, doc.ppq / 16);
  const same = notes.filter((n) => Math.abs(n.startTick - tick) <= tol);
  if (!same.length) return null;
  if (midi == null || same.length === 1) return same[0].id;
  return same.reduce((a, b) => (Math.abs(b.pitch - midi) < Math.abs(a.pitch - midi) ? b : a)).id;
}

/** 한 성부 안에서 시간 순서(같으면 낮은 음부터)로 정렬한 음표 id — 이전/다음 음표 옮기기용 */
export function orderedNoteIds(doc: ScoreDoc, part: number): string[] {
  return [...(doc.parts[part]?.notes ?? [])].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch).map((n) => n.id);
}

/** 음표 id → 성부 번호 */
export function partOfNote(doc: ScoreDoc, noteId: string): number {
  return doc.parts.findIndex((p) => p.notes.some((n) => n.id === noteId));
}
