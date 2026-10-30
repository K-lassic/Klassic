// 업로드 검사 (tasks T079, FR-002·FR-003): shared/upload-rules.json 순서 count → type → corrupted/MusicXML 구조 → size → resolution.
// 반려하면 score_request 를 만들지 않고 gate_event(G1)만 남긴다(BR-UPL-04). 모델 API 서버의 Python 검사와 같은 코드를 낸다(SC-015).
// 2026-09-29 황송해 결정(사진·PDF 입력): 받는 종류는 upload-rules.json user_upload_kinds(사진·PDF). MIDI·MusicXML 은 형식 반려.
// PDF 는 여기서 형식(%PDF)·용량·악보 종류만 보고 remoteCheck=true 로 돌려준다 — 열기(손상·암호)·첫 쪽 300dpi 변환·사진 크기는
// 모델 API 검사기(pypdfium2)가 한다(POST /v1/internal/upload-check, web/requests.ts). 같은 검사기라 웹·API 판정이 같다.
// (2026-09-30 T187 여러 쪽) 사진 여러 장(최대 10장, 올린 순서)을 받는다 — 순서는 checks/upload.py(multi_page=True)와 같다:
// count(11장 → UPLOAD_TOO_MANY_PAGES) → type → 섞기(PDF 둘 이상·PDF+사진 → UPLOAD_TOO_MANY_FILES) → corrupted → size → resolution.
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { unzipSync, strFromU8 } from 'fflate';
import tonejsMidi from '@tonejs/midi';

// @tonejs/midi 는 CommonJS 라 기본 내보내기에서 꺼낸다(컴파일된 ESM 에서 이름 가져오기가 안 된다)
const { Midi } = tonejsMidi;
import { uploadRules, userUploadKinds, type UploadKind, type UploadKindRule } from '../config/shared.js';

export type FileKind = UploadKind;
export interface UploadInput { originalName: string; data: Buffer }
export interface UploadVerdict {
  ok: boolean;
  code: string | null;
  kind: FileKind | null;
  shortEdgePx: number | null;
  details: Record<string, unknown>;
  musicxmlText?: string;     // .mxl 을 풀었으면 본문
  /** PDF: 손상·암호·사진 크기는 모델 API 검사기에 맡겨야 한다 */
  remoteCheck?: boolean;
  /** 사진: 장마다 짧은 변(올린 순서, 2026-09-29 여러 쪽) */
  pages?: UploadPageInfo[];
}

const reject = (code: string, kind: FileKind | null = null, details: Record<string, unknown> = {}): UploadVerdict =>
  ({ ok: false, code, kind, shortEdgePx: null, details });

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

function hexAt(buf: Buffer, offset: number, hex: string): boolean {
  const want = Buffer.from(hex, 'hex');
  return buf.length >= offset + want.length && buf.subarray(offset, offset + want.length).equals(want);
}

function detectKind(input: UploadInput): FileKind | null {
  const e = ext(input.originalName);
  for (const kind of Object.keys(uploadRules.kinds) as FileKind[]) {
    const rule = uploadRules.kinds[kind];
    if (!rule.extensions.includes(e)) continue;
    if (matchesMagic(rule, input.data)) return kind;
  }
  return null;
}

function matchesMagic(rule: UploadKindRule, data: Buffer): boolean {
  return rule.magic.some((m) => {
    if (m.hex_prefix && !hexAt(data, 0, m.hex_prefix)) return false;
    if (m.hex_at_8 && !hexAt(data, 8, m.hex_at_8)) return false;
    if (m.text_contains_any) {
      const head = data.subarray(0, 4096).toString('utf8');
      if (!m.text_contains_any.some((t) => head.includes(t))) return false;
    }
    return true;
  });
}

// --- 이미지 머리 읽기: 크기와 손상 여부 ------------------------------------------------
function pngInfo(b: Buffer): { w: number; h: number } | null {
  if (b.length < 33 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  // 끝 청크 IEND 가 있어야 온전한 파일로 본다
  if (b.length < 12 || b.toString('ascii', b.length - 8, b.length - 4) !== 'IEND') return null;
  return w > 0 && h > 0 ? { w, h } : null;
}

function jpegInfo(b: Buffer): { w: number; h: number } | null {
  let i = 2;
  let size: { w: number; h: number } | null = null;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;
    if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      size = { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    if (marker === 0xda) break; // 스캔 시작 — 이후는 압축 자료
    i += 2 + len;
  }
  // 끝 표시(EOI)가 있어야 온전한 파일
  const tail = b.subarray(Math.max(0, b.length - 64));
  if (tail.indexOf(Buffer.from([0xff, 0xd9])) < 0) return null;
  return size && size.w > 0 && size.h > 0 ? size : null;
}

function webpInfo(b: Buffer): { w: number; h: number } | null {
  if (b.length < 30) return null;
  if (b.readUInt32LE(4) + 8 > b.length) return null; // RIFF 길이보다 짧으면 잘린 파일
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  return null;
}

function imageSize(b: Buffer): { w: number; h: number } | null {
  if (hexAt(b, 0, '89504e470d0a1a0a')) return pngInfo(b);
  if (hexAt(b, 0, 'ffd8ff')) return jpegInfo(b);
  if (hexAt(b, 0, '52494646')) return webpInfo(b);
  return null;
}

// --- MusicXML 구조: 파트 1개 이상 · 마디 1개 이상 · 음표나 쉼표 ---------------------------
const xml = new XMLParser({ ignoreAttributes: false, processEntities: false, allowBooleanAttributes: true });

function musicxmlText(b: Buffer, name: string): string | null {
  if (hexAt(b, 0, '504b0304') || ext(name) === '.mxl') {
    const files = unzipSync(new Uint8Array(b));
    const container = files['META-INF/container.xml'];
    let root: string | undefined;
    if (container) root = /full-path="([^"]+)"/.exec(strFromU8(container))?.[1];
    root ??= Object.keys(files).find((f) => /\.(musicxml|xml)$/i.test(f) && !f.startsWith('META-INF'));
    return root && files[root] ? strFromU8(files[root]) : null;
  }
  return b.toString('utf8');
}

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function musicxmlStructureOk(text: string): boolean {
  const doc = xml.parse(text) as Record<string, unknown>;
  const root = (doc['score-partwise'] ?? doc['score-timewise']) as Record<string, unknown> | undefined;
  if (!root) return false;
  if (doc['score-partwise']) {
    const parts = asArray(root.part as Record<string, unknown> | Record<string, unknown>[]);
    if (parts.length < 1) return false;
    const measures = parts.flatMap((p) => asArray(p.measure as Record<string, unknown> | Record<string, unknown>[]));
    if (measures.length < 1) return false;
    return measures.some((m) => asArray(m.note as unknown).length > 0);
  }
  const measures = asArray(root.measure as Record<string, unknown> | Record<string, unknown>[]);
  if (measures.length < 1) return false;
  return measures.some((m) => asArray(m.part as Record<string, unknown>).some((p) => asArray((p as Record<string, unknown>).note).length > 0));
}

export interface UploadLimits {
  imageMaxBytes?: number; scoreFileMaxBytes?: number; minShortEdgePx?: number;
  /** 받는 종류. 없으면 upload-rules.json user_upload_kinds(사진·PDF) */
  allowedKinds?: readonly FileKind[];
}

/** 사진 한 장의 판정 — 여러 장이면 장마다(file_no 순서) */
export interface UploadPageInfo { fileNo: number; shortEdgePx: number }

export function checkUpload(files: UploadInput[], scoreType: string | undefined, limits: UploadLimits = {}): UploadVerdict {
  // (2026-09-29 여러 쪽, T187) 한 요청 = 악보 한 곡 — PDF 한 개(모든 쪽) 또는 사진 여러 장(올린 순서), 최대 max_pages 쪽.
  // 모델 API checks/upload.py(multi_page=True)와 같은 순서: count → type(파일마다) → 섞기 → corrupted → size → resolution(장마다) → 악보 종류.
  // 여러 장일 때 장마다의 반려에는 details.page(몇 번째 장인지)를 붙인다.
  const maxPages = uploadRules.max_pages ?? 10;
  if (files.length === 0) return reject('BAD_REQUEST', null, { count: 0 });
  if (files.length > maxPages) return reject('UPLOAD_TOO_MANY_PAGES', null, { count: files.length, max_pages: maxPages });
  const many = files.length > 1;
  const where = (i: number): Record<string, unknown> => (many ? { page: i } : {});

  // type — 파일마다. 종류는 알아봤지만 받지 않는 종류(MIDI·MusicXML)도 모델 API 의 allowed_kinds 반려와 같은 코드
  const allowed = limits.allowedKinds ?? userUploadKinds;
  const kinds: FileKind[] = [];
  for (const [n, f] of files.entries()) {
    const k = detectKind(f);
    if (!k) return reject('UPLOAD_UNSUPPORTED_TYPE', null, { extension: ext(f.originalName), ...where(n + 1) });
    if (!allowed.includes(k)) {
      return reject('UPLOAD_UNSUPPORTED_TYPE', k, { extension: ext(f.originalName), kind: k, allowed: [...allowed], ...where(n + 1) });
    }
    kinds.push(k);
  }
  // 섞기: PDF 는 한 개만, PDF 와 사진을 섞지 않는다(UC3 E5). 여러 파일은 사진만 된다
  if (many && kinds.includes('pdf')) {
    return reject('UPLOAD_TOO_MANY_FILES', null, { count: files.length, pdf_count: kinds.filter((k) => k === 'pdf').length });
  }
  if (many && kinds.some((k) => k !== 'image')) {
    return reject('UPLOAD_TOO_MANY_FILES', null, { count: files.length, kinds: [...new Set(kinds)].sort() });
  }
  const kind = kinds[0];

  if (kind === 'pdf') {
    const file = files[0];
    // 열기(손상·암호)·쪽수·쪽마다 사진 크기는 모델 API 검사기가 본다(check_order: corrupted → size → resolution). 여기서는 용량·악보 종류만
    const max = limits.imageMaxBytes ?? uploadRules.kinds.pdf.max_bytes;
    if (file.data.length > max) return { ...reject('UPLOAD_TOO_LARGE', kind, { max_bytes: max, actual_bytes: file.data.length }), remoteCheck: true };
    if (!scoreType || !['staff', 'jeongganbo'].includes(scoreType)) return { ...reject('UPLOAD_SCORE_TYPE_REQUIRED', kind), remoteCheck: true };
    return { ok: true, code: null, kind, shortEdgePx: null, details: {}, remoteCheck: true };
  }

  if (kind === 'image') {
    // corrupted — 장마다 열어 본다
    const sizes: { w: number; h: number }[] = [];
    for (const [n, f] of files.entries()) {
      const size = imageSize(f.data);
      if (!size) return reject('UPLOAD_CORRUPTED', kind, where(n + 1));
      sizes.push(size);
    }
    // size — 장마다
    const rule = uploadRules.kinds.image;
    const maxBytes = limits.imageMaxBytes ?? rule.max_bytes;
    for (const [n, f] of files.entries()) {
      if (f.data.length > maxBytes) return reject('UPLOAD_TOO_LARGE', kind, { max_bytes: maxBytes, actual_bytes: f.data.length, ...where(n + 1) });
    }
    // resolution — 장마다 짧은 변 min_short_edge_px(2026-09-30 황송해 119번: 300px) 이상. 300~649px 은 반려하지 않고
    // 모델 API 가 인식할 때 1000px 로 늘려 읽는다(upscale_below/to_short_edge_px, checks/upload.py)
    const min = limits.minShortEdgePx ?? rule.min_short_edge_px ?? 300;
    const pages: UploadPageInfo[] = [];
    for (const [n, size] of sizes.entries()) {
      const edge = Math.min(size.w, size.h);
      if (edge < min) return reject('UPLOAD_RESOLUTION_TOO_LOW', kind, { min_short_edge_px: min, actual_short_edge_px: edge, ...where(n + 1) });
      pages.push({ fileNo: n + 1, shortEdgePx: edge });
    }
    if (!scoreType || !['staff', 'jeongganbo'].includes(scoreType)) return reject('UPLOAD_SCORE_TYPE_REQUIRED', kind);
    const shortEdge = Math.min(...pages.map((p) => p.shortEdgePx));
    return { ok: true, code: null, kind, shortEdgePx: shortEdge, details: many ? { page_count: files.length } : {}, pages };
  }

  // MIDI · MusicXML — 사용자 업로드에서는 위 type 단계에서 반려된다(allowedKinds 로 넓힌 내부 검사만 여기 온다). 파일 한 개
  const file = files[0];
  let text: string | undefined;
  if (kind === 'midi') {
    try {
      const midi = new Midi(new Uint8Array(file.data));
      if (midi.tracks.length === 0) return reject('UPLOAD_CORRUPTED', kind);
    } catch {
      return reject('UPLOAD_CORRUPTED', kind);
    }
  } else {
    let t: string | null;
    try { t = musicxmlText(file.data, file.originalName); } catch { return reject('UPLOAD_CORRUPTED', kind); }
    if (t == null) return reject('UPLOAD_CORRUPTED', kind);
    // 잘린·깨진 XML 은 "악보 내용을 읽을 수 없음"으로 본다(shared/fixtures expected.json, 모델 API 와 같게)
    if (XMLValidator.validate(t) !== true) return reject('UPLOAD_MUSICXML_UNREADABLE', kind);
    let structureOk = false;
    try { structureOk = musicxmlStructureOk(t); } catch { return reject('UPLOAD_MUSICXML_UNREADABLE', kind); }
    if (!structureOk) return reject('UPLOAD_MUSICXML_UNREADABLE', kind);
    text = t;
  }
  const maxBytes = limits.scoreFileMaxBytes ?? uploadRules.kinds[kind].max_bytes;
  if (file.data.length > maxBytes) return reject('UPLOAD_TOO_LARGE', kind, { max_bytes: maxBytes, actual_bytes: file.data.length });
  return { ok: true, code: null, kind, shortEdgePx: null, details: {}, musicxmlText: text };
}
