// ScoreDoc — 브라우저와 웹 서비스가 함께 쓰는 악보 모델 (app/docs/INTERFACES.md §3, research R6).

export const PPQ = 480;

export interface ScoreDoc {
  version: 1;
  title?: string;
  ppq: number;                                  // 4분음표당 틱 (480)
  tempoBpm: number;                             // 첫 빠르기(4분음표 기준)
  timeSignature: { beats: number; beatType: number };
  keyFifths: number;                            // 조표(5도권, -7..7). 조옮김하면 바뀐다
  parts: Part[];                                // parts[0] = 원래 선율(첫 성부, BR-EDT-07)
}

export interface SourceInstrument {
  name: string;
  program: number | null;                       // 0부터 센 GM 번호. 모르면 null
}

export interface Part {
  id: string;                                   // "P1", "P2" … (추가 트랙은 "P{n}")
  name: string;                                 // 표시 이름(한글 악기 이름)
  instrument: string;                           // 악기 코드 (shared/instruments.json) 또는 'original:<program>'
  sourceInstrument?: SourceInstrument | null;   // 올린 파일에 있던 원래 악기(FR-056)
  isPercussion: boolean;
  volume: number;                               // 트랙 음량 0..127 (기본 100)
  origin: 'original' | 'melody_copy';
  notes: Note[];
}

export interface Note {
  id: string;                                   // 파트 안에서 유일("P1-n12")
  startTick: number;
  durationTicks: number;
  pitch: number;                                // MIDI 음번호
  velocity: number;                             // 1..127
}

// 편집 연산 — part 는 0부터 센 파트 번호
export type EditOp =
  | { op: 'add_instrument'; instrument: string }
  | { op: 'remove_track'; part: number }            // 2026-09-30: 추가한 트랙(melody_copy)만 (UC_06 BR-EDT-08)
  | { op: 'change_instrument'; part: number; instrument: string }
  | { op: 'transpose'; semitones: number }
  | { op: 'set_track_volume'; part: number; velocity: number }
  | { op: 'set_note_volume'; note_id: string; velocity: number }
  | { op: 'set_note_pitch'; note_id: string; midi_pitch: number }
  /** 곡 전체 빠르기(4분음표 BPM) — 2026-09-30 황송해 161번(T164 결정 변경): 재생 빠르기를 받기 파일에도 */
  | { op: 'set_tempo'; bpm: number };

export interface EditSummary {
  edited: boolean;
  instrument_changes: InstrumentChange[];
  transpose_semitones: number;
  volume_changes: { tracks: Record<string, number>; notes: number };
  pitch_fixes: number;
  /** 곡 전체 빠르기를 바꿨으면 그 BPM(2026-09-30 161번) */
  tempo_bpm?: number;
}

export type InstrumentChange =
  | { kind: 'add'; instrument: string }
  | { kind: 'change'; part: number; instrument: string }
  | { kind: 'remove'; part: number };

// 악기 목록 항목 — shared/instruments.json 의 instruments[] 모양. 패키지 밖 JSON 은 읽지 않고 인자로 받는다.
export interface InstrumentInfo {
  code: string;
  name_ko: string;
  gm_program: number | null;                    // 0부터 센 GM 호환 번호 — 내려받는 MIDI·MusicXML, gugak.sf2 가 없을 때
  is_percussion: boolean;
  // 서비스 음원(화면 연주·MP3)에서 소리를 고르는 번호(결정 C11): 일반 악기 bank 0 = GM, 국악기 bank 1 · program 0~5,
  // 장구·북 bank 128 · program 1(국악 타악 세트). 없으면 gm_program(bank 0)으로 대신한다.
  bank?: number | null;
  program?: number | null;
  range_low?: number | null;
  range_high?: number | null;
  family?: string;
  soundfont?: string | null;
  default_role?: string;
}
export type InstrumentCatalog = InstrumentInfo[];
export interface EnsembleEntry { part_role: string; instrument: string }

// shared/instruments.json 과 같은 내용의 기본값(목록을 넘기지 않았을 때). 시험(roundtrip.test)이 두 파일이 같은지 확인한다.
export const BUILTIN_INSTRUMENTS: InstrumentCatalog = [
  { code: 'gayageum', name_ko: '가야금', family: 'gugak', gm_program: 107, bank: 1, program: 0, is_percussion: false, range_low: 43, range_high: 81 },
  { code: 'geomungo', name_ko: '거문고', family: 'gugak', gm_program: 106, bank: 1, program: 1, is_percussion: false, range_low: 36, range_high: 72 },
  { code: 'daegeum', name_ko: '대금', family: 'gugak', gm_program: 77, bank: 1, program: 2, is_percussion: false, range_low: 58, range_high: 87 },
  { code: 'haegeum', name_ko: '해금', family: 'gugak', gm_program: 110, bank: 1, program: 3, is_percussion: false, range_low: 55, range_high: 86 },
  { code: 'piri', name_ko: '피리', family: 'gugak', gm_program: 111, bank: 1, program: 4, is_percussion: false, range_low: 58, range_high: 84 },
  { code: 'ajaeng', name_ko: '아쟁', family: 'gugak', gm_program: 42, bank: 1, program: 5, is_percussion: false, range_low: 38, range_high: 72 },
  { code: 'janggu', name_ko: '장구', family: 'gugak', gm_program: 0, bank: 128, program: 1, is_percussion: true, range_low: null, range_high: null },
  { code: 'buk', name_ko: '북', family: 'gugak', gm_program: 0, bank: 128, program: 1, is_percussion: true, range_low: null, range_high: null },
  { code: 'piano', name_ko: '피아노', family: 'other', gm_program: 0, bank: 0, program: 0, is_percussion: false, range_low: 21, range_high: 108 },
  { code: 'acoustic_guitar', name_ko: '어쿠스틱 기타', family: 'other', gm_program: 24, bank: 0, program: 24, is_percussion: false, range_low: 40, range_high: 88 },
  { code: 'violin', name_ko: '바이올린', family: 'other', gm_program: 40, bank: 0, program: 40, is_percussion: false, range_low: 55, range_high: 103 },
  { code: 'cello', name_ko: '첼로', family: 'other', gm_program: 42, bank: 0, program: 42, is_percussion: false, range_low: 36, range_high: 76 },
  { code: 'harp', name_ko: '하프', family: 'other', gm_program: 46, bank: 0, program: 46, is_percussion: false, range_low: 24, range_high: 103 },
  { code: 'flute', name_ko: '플루트', family: 'other', gm_program: 73, bank: 0, program: 73, is_percussion: false, range_low: 60, range_high: 96 },
  { code: 'clarinet', name_ko: '클라리넷', family: 'other', gm_program: 71, bank: 0, program: 71, is_percussion: false, range_low: 50, range_high: 94 },
  { code: 'strings', name_ko: '현악 합주', family: 'other', gm_program: 48, bank: 0, program: 48, is_percussion: false, range_low: 28, range_high: 96 },
  { code: 'marimba', name_ko: '마림바', family: 'other', gm_program: 12, bank: 0, program: 12, is_percussion: false, range_low: 45, range_high: 96 },
];

export const BUILTIN_DEFAULT_ENSEMBLE: EnsembleEntry[] = [
  { part_role: 'melody', instrument: 'gayageum' },
  { part_role: 'percussion', instrument: 'janggu' },
];

export const ORIGINAL_PREFIX = 'original:';

/** 'original:<program>' 코드를 만든다 (원래 악기로 듣기, FR-056) */
export function originalCode(program: number | null): string {
  return `${ORIGINAL_PREFIX}${program ?? 0}`;
}

/** 'original:<program>' 이면 GM 번호, 아니면 null */
export function parseOriginalCode(code: string): number | null {
  if (!code.startsWith(ORIGINAL_PREFIX)) return null;
  const n = Number(code.slice(ORIGINAL_PREFIX.length));
  return Number.isInteger(n) && n >= 0 && n <= 127 ? n : 0;
}

export function findInstrument(code: string, catalog: InstrumentCatalog = BUILTIN_INSTRUMENTS): InstrumentInfo | undefined {
  return catalog.find((i) => i.code === code);
}

/** 한글 이름(또는 코드)으로 목록에서 악기를 찾는다 — 우리 서비스가 만든 파일을 다시 읽을 때 */
export function findInstrumentByName(name: string | undefined | null, catalog: InstrumentCatalog = BUILTIN_INSTRUMENTS): InstrumentInfo | undefined {
  if (!name) return undefined;
  const key = name.trim().toLowerCase();
  return catalog.find((i) => i.name_ko === name.trim() || i.code === key);
}

export interface ResolvedInstrument {
  name: string;                                 // 파일에 적을 한글 이름
  program: number;                              // 0부터 센 GM 번호
  isPercussion: boolean;
}

/** 파트의 악기 코드를 파일에 적을 이름·GM 번호로 푼다 */
export function resolveInstrument(part: Part, catalog: InstrumentCatalog = BUILTIN_INSTRUMENTS): ResolvedInstrument {
  const orig = parseOriginalCode(part.instrument);
  if (orig !== null) {
    return { name: part.sourceInstrument?.name || part.name || '원래 악기', program: orig, isPercussion: part.isPercussion };
  }
  const info = findInstrument(part.instrument, catalog);
  if (info) return { name: info.name_ko, program: info.gm_program ?? 0, isPercussion: info.is_percussion };
  return { name: part.name || part.instrument, program: 0, isPercussion: part.isPercussion };
}

export interface ServiceSound {
  bank: number;                                 // 0 = GM(FluidR3_GM), 1 = 국악기(gugak.sf2), 128 = 타악 세트
  program: number;                              // 그 bank 안의 번호(0부터)
  isPercussion: boolean;
}

/**
 * 서비스 음원(화면 연주·MP3)에서 이 파트가 부를 소리 (bank, program) — 결정 C11.
 * 악기 목록의 악기는 목록의 bank·program(일반 악기 = GM bank 0, 국악기 = bank 1, 장구·북 = 128/1),
 * 원래 악기('original:N')와 목록에 없는 악기는 GM 번호 그대로(bank 0 · 타악은 128/0 표준 드럼 세트).
 */
export function serviceSound(part: Part, catalog: InstrumentCatalog = BUILTIN_INSTRUMENTS): ServiceSound {
  const r = resolveInstrument(part, catalog);
  const perc = r.isPercussion || part.isPercussion;
  const info = parseOriginalCode(part.instrument) === null ? findInstrument(part.instrument, catalog) : undefined;
  if (info && info.bank != null && info.program != null && (info.bank >= 128) === perc) {
    return { bank: info.bank, program: info.program, isPercussion: perc };
  }
  return perc ? { bank: 128, program: 0, isPercussion: true } : { bank: 0, program: r.program, isPercussion: false };
}

/** 악기 코드에 맞는 표시 이름 */
export function instrumentDisplayName(code: string, part: Pick<Part, 'name' | 'sourceInstrument'> | null, catalog: InstrumentCatalog = BUILTIN_INSTRUMENTS): string {
  if (parseOriginalCode(code) !== null) return part?.sourceInstrument?.name || part?.name || '원래 악기';
  return findInstrument(code, catalog)?.name_ko ?? part?.name ?? code;
}

export function noteId(partId: string, index: number): string {
  return `${partId}-n${index + 1}`;
}

export function createScoreDoc(init: Partial<ScoreDoc> = {}): ScoreDoc {
  return {
    version: 1,
    ...(init.title !== undefined ? { title: init.title } : {}),
    ppq: init.ppq ?? PPQ,
    tempoBpm: init.tempoBpm ?? 120,
    timeSignature: init.timeSignature ?? { beats: 4, beatType: 4 },
    keyFifths: init.keyFifths ?? 0,
    parts: init.parts ?? [],
  };
}

/** 깊은 복사(원본은 절대 건드리지 않는다, BR-EDT-04) */
export function cloneDoc(doc: ScoreDoc): ScoreDoc {
  return {
    ...doc,
    timeSignature: { ...doc.timeSignature },
    parts: doc.parts.map((p) => ({
      ...p,
      sourceInstrument: p.sourceInstrument ? { ...p.sourceInstrument } : p.sourceInstrument,
      notes: p.notes.map((n) => ({ ...n })),
    })),
  };
}

export function sortNotes(notes: Note[]): Note[] {
  return notes.sort((a, b) => a.startTick - b.startTick || b.pitch - a.pitch || a.durationTicks - b.durationTicks);
}

/** ppq 가 480 이 아니면 틱을 480 기준으로 바꾼 사본 */
export function normalizePpq(doc: ScoreDoc): ScoreDoc {
  const out = cloneDoc(doc);
  if (doc.ppq === PPQ) return out;
  const f = PPQ / doc.ppq;
  out.ppq = PPQ;
  for (const p of out.parts) {
    for (const n of p.notes) {
      const end = Math.round((n.startTick + n.durationTicks) * f);
      n.startTick = Math.round(n.startTick * f);
      n.durationTicks = Math.max(1, end - n.startTick);
    }
  }
  return out;
}

/** 한 마디 길이(틱) */
export function measureTicks(doc: Pick<ScoreDoc, 'ppq' | 'timeSignature'>): number {
  return Math.round((doc.timeSignature.beats * doc.ppq * 4) / doc.timeSignature.beatType);
}

/** 마지막 음표가 끝나는 틱 */
export function endTick(doc: ScoreDoc): number {
  let end = 0;
  for (const p of doc.parts) for (const n of p.notes) end = Math.max(end, n.startTick + n.durationTicks);
  return end;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 다음 파트 id ("P{n}") */
export function nextPartId(doc: ScoreDoc): string {
  let max = 0;
  for (const p of doc.parts) {
    const m = /^P(\d+)$/.exec(p.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `P${Math.max(max, doc.parts.length) + 1}`;
}

// 문자열 ↔ UTF-8 바이트 (브라우저·Node 공통)
export function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
export function utf8Decode(b: Uint8Array): string {
  return new TextDecoder('utf-8').decode(b);
}

/** shared/instruments.json 내용(이미 읽은 객체)을 악기 목록·기본 구성으로 바꾼다 */
export interface InstrumentsJson { default_ensemble?: EnsembleEntry[]; instruments?: InstrumentInfo[] }
export function instrumentsCatalog(json: InstrumentsJson | null | undefined): { catalog: InstrumentCatalog; defaultEnsemble: EnsembleEntry[] } {
  const catalog = Array.isArray(json?.instruments) && json.instruments.length ? json.instruments : BUILTIN_INSTRUMENTS;
  const defaultEnsemble = Array.isArray(json?.default_ensemble) && json.default_ensemble.length ? json.default_ensemble : BUILTIN_DEFAULT_ENSEMBLE;
  return { catalog, defaultEnsemble };
}
