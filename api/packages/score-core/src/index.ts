// @gugak/score-core 공개 API (app/docs/INTERFACES.md §3)
export * from './scoredoc.js';
export { parseMusicXml, toMusicXml, toMxl, type ToMusicXmlOptions } from './musicxml.js';
export { parseMidi, toMidi, isGugakSound, type ToMidiOptions } from './midi.js';
export {
  applyOps, applyInstrumentMode, fitToRangeOps, rangeWarnings, summarizeOps, validateOps, transposeFifths,
  type ApplyOptions, type InstrumentMode, type InstrumentModeOptions, type RangeInfo,
} from './edit.js';
export {
  exportScore,
  type ExportFormat, type ExportOptions, type ExportResult,
} from './export.js';
