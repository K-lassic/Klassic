// #34 업로드 검사(게이트 G1) — api/shared/upload-rules.json 순서: 개수 → 형식 → 섞기 → 손상 → 용량 → 사진 짧은 변 → 악보 종류.
//
//   구조에서의 위치: requests.ts 가 파일을 저장하기 전에 부른다. 반려하면 요청 행을 만들지 않는다.
//     PDF 는 형식 · 용량 · 악보 종류만 여기서 보고 나머지는 model-api 검사기에 맡긴다(remoteCheck → uploadInspect.ts). 코드는 model-api 와 같다.
//   v0.1.1 web/uploadCheck.ts 에서 달라진 점: 사용자가 올릴 수 있는 사진 · PDF 만 검사한다.
//   #33 후속: 사진 화소·긴 변도 shared 기준(자동 확대 후 크기 포함)으로 검사해 접수 뒤 대체 악보가 되는 것을 막는다.
//     MIDI · MusicXML 은 형식 단계에서 반려되므로 구조 검사(fast-xml-parser · fflate · @tonejs/midi)는 옮기지 않았다.
import { shared, type UploadKindRule } from '../config/shared.js';

export interface UploadInput { originalName: string; data: Buffer }
/** 사진 한 장의 판정 — 올린 순서대로 */
export interface UploadPageInfo { fileNo: number; shortEdgePx: number }
export interface UploadVerdict {
  ok: boolean;
  code: string | null;
  kind: string | null;
  shortEdgePx: number | null;
  details: Record<string, unknown>;
  /** PDF: 손상 · 암호 · 쪽 수 · 쪽 크기는 model-api 검사기에 맡겨야 한다 */
  remoteCheck?: boolean;
  pages?: UploadPageInfo[];
}

const reject = (code: string, kind: string | null = null, details: Record<string, unknown> = {}): UploadVerdict =>
  ({ ok: false, code, kind, shortEdgePx: null, details });

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

function hexAt(buf: Buffer, offset: number, hex: string): boolean {
  const want = Buffer.from(hex, 'hex');
  return buf.length >= offset + want.length && buf.subarray(offset, offset + want.length).equals(want);
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

/** 확장자와 파일 머리가 모두 맞는 종류. 받지 않는 종류(MIDI 등)도 알아본다 — 반려 details 에 쓴다 */
function detectKind(input: UploadInput): string | null {
  const e = ext(input.originalName);
  for (const [kind, rule] of Object.entries(shared().uploadRules.kinds)) {
    if (rule.extensions.includes(e) && matchesMagic(rule, input.data)) return kind;
  }
  return null;
}

// --- 사진 머리 읽기: 크기와 손상 여부 ---------------------------------------------------
function pngInfo(b: Buffer): { w: number; h: number } | null {
  if (b.length < 33 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  // 끝 청크 IEND 가 있어야 온전한 파일로 본다
  if (b.toString('ascii', b.length - 8, b.length - 4) !== 'IEND') return null;
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

const validScoreType = (t: string | undefined): boolean => shared().uploadRules.score_types.includes(t ?? '');

/** 한 요청 = 악보 한 곡 — PDF 한 개 또는 사진 여러 장(올린 순서), 최대 max_pages 쪽. 여러 장이면 반려에 details.page 를 붙인다 */
export function checkUpload(files: UploadInput[], scoreType: string | undefined): UploadVerdict {
  const rules = shared().uploadRules;
  const maxPages = rules.max_pages ?? 30;
  if (files.length === 0) return reject('BAD_REQUEST', null, { count: 0 });
  if (files.length > maxPages) return reject('UPLOAD_TOO_MANY_PAGES', null, { count: files.length, max_pages: maxPages });
  const many = files.length > 1;
  const where = (i: number): Record<string, unknown> => (many ? { page: i } : {});

  const kinds: string[] = [];
  for (const [n, f] of files.entries()) {
    const k = detectKind(f);
    if (!k) return reject('UPLOAD_UNSUPPORTED_TYPE', null, { extension: ext(f.originalName), allowed: rules.user_upload_kinds, ...where(n + 1) });
    if (!rules.user_upload_kinds.includes(k)) {
      return reject('UPLOAD_UNSUPPORTED_TYPE', k, { extension: ext(f.originalName), kind: k, allowed: rules.user_upload_kinds, ...where(n + 1) });
    }
    kinds.push(k);
  }
  // 섞기: PDF 는 한 개만, PDF 와 사진을 섞지 않는다
  if (many && kinds.includes('pdf')) {
    return reject('UPLOAD_TOO_MANY_FILES', null, { count: files.length, pdf_count: kinds.filter((k) => k === 'pdf').length });
  }

  if (kinds[0] === 'pdf') {
    const max = rules.kinds.pdf.max_bytes;
    if (files[0].data.length > max) return { ...reject('UPLOAD_TOO_LARGE', 'pdf', { max_bytes: max, actual_bytes: files[0].data.length }), remoteCheck: true };
    if (!validScoreType(scoreType)) return { ...reject('UPLOAD_SCORE_TYPE_REQUIRED', 'pdf'), remoteCheck: true };
    return { ok: true, code: null, kind: 'pdf', shortEdgePx: null, details: {}, remoteCheck: true };
  }

  const sizes: { w: number; h: number }[] = [];
  for (const [n, f] of files.entries()) {
    const size = imageSize(f.data);
    if (!size) return reject('UPLOAD_CORRUPTED', 'image', where(n + 1));
    sizes.push(size);
  }
  const rule = rules.kinds.image;
  for (const [n, f] of files.entries()) {
    if (f.data.length > rule.max_bytes) return reject('UPLOAD_TOO_LARGE', 'image', { max_bytes: rule.max_bytes, actual_bytes: f.data.length, ...where(n + 1) });
  }
  for (const [n, size] of sizes.entries()) {
    const edge = Math.min(size.w, size.h);
    const below = rule.upscale_below_short_edge_px, target = rule.upscale_to_short_edge_px;
    const scale = below && target && edge < below ? target / edge : 1;
    if ((rule.max_edge_px !== undefined && Math.max(size.w, size.h) * scale > rule.max_edge_px)
      || (rule.max_pixels !== undefined && size.w * size.h * scale * scale > rule.max_pixels)) {
      return reject('UPLOAD_TOO_LARGE', 'image', {
        reason: 'image_pixels', max_edge: rule.max_edge_px, max_pixels: rule.max_pixels,
        width: size.w, height: size.h, after_upscale: scale > 1, ...where(n + 1),
      });
    }
  }
  // 짧은 변 300px 미만만 반려. 650px 미만은 model-api 가 인식할 때 늘려 읽는다 (upload-rules.json upscale_below_short_edge_px)
  const min = rule.min_short_edge_px ?? 300;
  const pages: UploadPageInfo[] = [];
  for (const [n, size] of sizes.entries()) {
    const edge = Math.min(size.w, size.h);
    if (edge < min) return reject('UPLOAD_RESOLUTION_TOO_LOW', 'image', { min_short_edge_px: min, actual_short_edge_px: edge, ...where(n + 1) });
    pages.push({ fileNo: n + 1, shortEdgePx: edge });
  }
  if (!validScoreType(scoreType)) return reject('UPLOAD_SCORE_TYPE_REQUIRED', 'image');
  return { ok: true, code: null, kind: 'image', shortEdgePx: Math.min(...pages.map((p) => p.shortEdgePx)),
    details: many ? { page_count: files.length } : {}, pages };
}
