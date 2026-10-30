// @gugak/score-core 함수는 이 파일로만 들여온다(INTERFACES §3 공개 함수).
// 그 패키지가 아직 빌드되지 않았으면 이 파일에서만 형 오류가 나고, 빌드되면 그대로 풀린다.
import * as core from '@gugak/score-core';
import type { EditOp, EditSummary, ScoreDoc } from '@/types/score';
import sharedInstruments from '../../../shared/instruments.json';

type Core = {
  parseMusicXml(text: string | Uint8Array): ScoreDoc;
  toMusicXml(doc: ScoreDoc): string;
  toMidi(doc: ScoreDoc, opts?: { soundNumbers?: 'gm' | 'service'; gugakReverbSend?: number }): Uint8Array;
  applyOps(doc: ScoreDoc, ops: EditOp[]): ScoreDoc;
  applyInstrumentMode(doc: ScoreDoc, mode: 'default' | 'original' | 'custom', opts?: unknown): ScoreDoc;
  rangeWarnings(doc: ScoreDoc, instruments: unknown): { part: number; noteId: string }[];
  fitToRangeOps(doc: ScoreDoc, instruments: unknown): EditOp[];
  summarizeOps(ops: EditOp[]): EditSummary;
};
const c = core as unknown as Core;

export const parseMusicXml = (text: string | Uint8Array): ScoreDoc => c.parseMusicXml(text);
export const toMusicXml = (doc: ScoreDoc): string => c.toMusicXml(doc);
/** 기본은 GM 호환 번호(내려받기용). 화면 연주는 soundNumbers: 'service'(국악기 gugak.sf2 bank 1 · 장구·북 128/1, 결정 C11) */
export const toMidi = (doc: ScoreDoc, opts?: { soundNumbers?: 'gm' | 'service'; gugakReverbSend?: number }): Uint8Array => c.toMidi(doc, opts);
/** 국악기 연주 잔향 "약하게"(2026-09-30 박예은 팀장 결정, UC_07 BR-RND-05) — MP3 렌더러의 GUGAK_REVERB_SEND 와 같은 값 */
export const GUGAK_REVERB_SEND = 60;
export const applyOps = (doc: ScoreDoc, ops: EditOp[]): ScoreDoc => c.applyOps(doc, ops);
export const summarizeOps = (ops: EditOp[]): EditSummary => c.summarizeOps(ops);
/** 원래 악기(FR-056) — score-core 가 sourceInstrument 로 되돌린다 */
export const withOriginalInstruments = (doc: ScoreDoc): ScoreDoc => c.applyInstrumentMode(doc, 'original', {});
/** 음역을 벗어난 음 — 악보에서 음표 머리를 빨간색으로 칠한다(2026-09-30 BR-EDT-03). shared/instruments.json 의 range_low/high */
export const rangeWarnings = (doc: ScoreDoc): { part: number; noteId: string }[] =>
  c.rangeWarnings(doc, sharedInstruments.instruments);
/** [음역에 맞게 옥타브 옮기기] — 벗어난 음을 가장 가까운 옥타브로 옮기는 편집 명령(누를 때만, 2026-09-30 BR-EDT-03) */
export const fitToRangeOps = (doc: ScoreDoc): EditOp[] => c.fitToRangeOps(doc, sharedInstruments.instruments);
