// ScoreDoc·EditOp 모양 — app/docs/INTERFACES.md §3 을 그대로 옮긴 것.
// @gugak/score-core 가 같은 모양을 내보낸다. 화면 코드는 이 파일의 타입만 보고,
// score-core 함수 호출은 src/lib/scoreCore.ts 한 곳에 모은다(그 패키지가 늦게 빌드돼도 깨지는 곳을 한 곳으로).
export interface Note {
  id: string;
  startTick: number;
  durationTicks: number;
  pitch: number;
  velocity: number;
}
export interface Part {
  id: string;
  name: string;
  instrument: string;
  sourceInstrument?: { name: string; program: number | null } | null;
  isPercussion: boolean;
  volume: number;
  origin: 'original' | 'melody_copy';
  notes: Note[];
}
export interface ScoreDoc {
  version: 1;
  title?: string;
  ppq: number;
  tempoBpm: number;
  timeSignature: { beats: number; beatType: number };
  keyFifths: number;
  parts: Part[];
}

export type EditOp =
  | { op: 'add_instrument'; instrument: string }
  | { op: 'remove_track'; part: number }
  | { op: 'change_instrument'; part: number; instrument: string }
  | { op: 'transpose'; semitones: number }
  | { op: 'set_track_volume'; part: number; velocity: number }
  | { op: 'set_note_volume'; note_id: string; velocity: number }
  | { op: 'set_note_pitch'; note_id: string; midi_pitch: number }
  /** 곡 전체 빠르기(4분음표 BPM) — 2026-09-30 황송해 161번 */
  | { op: 'set_tempo'; bpm: number };

/** summarizeOps 결과 — 모양은 score-core 가 정한다. 화면은 그대로 서버에 넘긴다. */
export type EditSummary = Record<string, unknown>;
