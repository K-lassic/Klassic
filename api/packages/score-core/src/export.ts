// 편집 반영 MIDI·MusicXML 내려받기 — 원본 + 연산 목록으로 바로 만든다 (tasks T123, BR-RND-04·07, FR-032).
import { applyInstrumentMode, applyOps, type InstrumentMode } from './edit.js';
import { toMidi } from './midi.js';
import { toMusicXml } from './musicxml.js';
import { BUILTIN_INSTRUMENTS, type EditOp, type EnsembleEntry, type InstrumentCatalog, type ScoreDoc } from './scoredoc.js';

export type ExportFormat = 'midi' | 'musicxml';

export interface ExportOptions {
  catalog?: InstrumentCatalog;
  /** 연주 악기 구성(편집 연산보다 먼저 적용). 없으면 doc 의 악기 그대로 */
  instruments?: { mode: InstrumentMode; tracks?: { part: number; instrument: string }[] };
  defaultEnsemble?: EnsembleEntry[];
}

export interface ExportResult {
  data: Uint8Array | string;                    // midi = 바이트, musicxml = 문자열(UTF-8)
  mimeType: string;
  extension: 'mid' | 'musicxml';
  notices: string[];
  doc: ScoreDoc;                                // 실제로 적은 편집본
}

/** 원본 + (악기 구성) + 편집 연산 → MIDI/MusicXML */
export function exportScore(doc: ScoreDoc, ops: readonly EditOp[], format: ExportFormat, opts: ExportOptions = {}): ExportResult {
  const catalog = opts.catalog ?? BUILTIN_INSTRUMENTS;
  let base = doc;
  if (opts.instruments) {
    base = applyInstrumentMode(doc, opts.instruments.mode, { tracks: opts.instruments.tracks, defaultEnsemble: opts.defaultEnsemble, catalog });
  }
  const edited = applyOps(base, ops, { catalog });
  const notices: string[] = [];
  if (format === 'midi') {
    return { data: toMidi(edited, { catalog }), mimeType: 'audio/midi', extension: 'mid', notices, doc: edited };
  }
  return { data: toMusicXml(edited, { catalog }), mimeType: 'application/vnd.recordare.musicxml+xml', extension: 'musicxml', notices, doc: edited };
}
