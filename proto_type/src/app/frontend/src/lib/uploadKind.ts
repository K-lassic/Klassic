// 파일 종류 짐작(확장자) — 원본 규칙: app/shared/upload-rules.json. 최종 판정은 서버(G1)가 한다.
// 받는 파일은 PNG · JPG(JPEG) · WEBP 사진 또는 PDF 한 개(2026-09-29 황송해 결정, SD_02 §4-3 — 웹·API 같음).
// (2026-09-29 여러 쪽 · 2026-09-30 T188) 사진은 여러 장(올린 순서, 최대 10장) — 한 곡. PDF 는 한 개만, 사진과 섞지 않는다.
// 받는 종류는 upload-rules.json user_upload_kinds 하나에서 읽는다(서버 config/shared.ts userUploadKinds · 모델 API 와 같은 값).
import rules from '../../../shared/upload-rules.json';
import type { FileKind } from '@/types/api';

export const USER_UPLOAD_KINDS: readonly FileKind[] = rules.user_upload_kinds as FileKind[];

type KindRule = { extensions: string[]; mime_types: string[]; max_bytes: number; min_short_edge_px?: number };
const kindRule = (k: FileKind): KindRule => (rules.kinds as Record<string, KindRule>)[k];

/** 받는 종류면 그 종류, 아니면 null(MIDI · MusicXML 등 — 화면에서 바로 G1 형식 반려로 안내) */
export function guessKind(fileName: string): FileKind | null {
  const lower = fileName.toLowerCase();
  for (const kind of USER_UPLOAD_KINDS) {
    if (kindRule(kind).extensions.some((ext) => lower.endsWith(ext))) return kind;
  }
  return null;
}

/** 고른 파일 종류 칩 문구 */
export function kindLabel(kind: FileKind | null): string {
  if (kind === 'image') return '사진';
  if (kind === 'pdf') return 'PDF';
  return '알 수 없는 형식';
}

export const LIMITS = {
  imageMb: Math.round(rules.kinds.image.max_bytes / 1024 / 1024),
  minEdge: rules.kinds.image.min_short_edge_px,
  /** 이보다 짧은 변이 작으면 "부정확할 수 있음" 경고(반려 아님, 2026-09-30 125번) */
  warnEdge: (rules.kinds.image as { warn_below_short_edge_px?: number }).warn_below_short_edge_px ?? 500,
  maxFiles: rules.max_files,
  /** 한 요청 최대 쪽 수(사진 장수 또는 PDF 쪽수, 2026-09-29 여러 쪽) */
  maxPages: (rules as { max_pages?: number }).max_pages ?? 10,
  pdfMb: Math.round(rules.kinds.pdf.max_bytes / 1024 / 1024),
};

/**
 * 올릴 파일 목록에 새 파일을 더해 본다(2026-09-30 T188 여러 쪽 — SD_02 S1 · UC3 E5·E9). 서버(G1)와 같은 순서의 앞부분만:
 * 쪽 수(10 넘음 → UPLOAD_TOO_MANY_PAGES) → 형식(UPLOAD_UNSUPPORTED_TYPE) → 섞기(PDF 둘 이상 · PDF 와 사진 → UPLOAD_TOO_MANY_FILES).
 * 통과하면 올린 순서대로 이어 붙인 목록. 손상·용량·사진 크기는 서버가 본다.
 */
export function addFiles(current: File[], incoming: File[]): { files: File[]; code: null } | { files: null; code: string } {
  const all = [...current, ...incoming];
  if (all.length > LIMITS.maxPages) return { files: null, code: 'UPLOAD_TOO_MANY_PAGES' };
  const kinds = all.map((f) => guessKind(f.name));
  if (kinds.some((k) => k === null)) return { files: null, code: 'UPLOAD_UNSUPPORTED_TYPE' };
  if (all.length > 1 && kinds.includes('pdf')) return { files: null, code: 'UPLOAD_TOO_MANY_FILES' };
  return { files: all, code: null };
}

/** 사진의 짧은 변(px) — 쪽 목록의 '사진 크기'. 읽을 수 없으면(브라우저가 못 여는 형식 등) null. 최종 판정은 서버 */
export async function readShortEdge(file: File): Promise<number | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bmp = await createImageBitmap(file);
    const edge = Math.min(bmp.width, bmp.height);
    bmp.close?.();
    return edge > 0 ? edge : null;
  } catch {
    return null;
  }
}

/** 파일 고르기 창에 보일 형식 — 사진 확장자 + .pdf */
export const ACCEPT = USER_UPLOAD_KINDS.flatMap((k) => [...kindRule(k).extensions, ...kindRule(k).mime_types]).join(',');

/** 받는 사진 형식 이름 — "PNG · JPG(JPEG) · WEBP" (upload-rules.json image 확장자에서 만든다) */
export const ACCEPT_LABEL = (() => {
  const names = rules.kinds.image.extensions.map((e) => e.slice(1).toUpperCase());
  const out: string[] = [];
  for (const n of names) {
    if (n === 'JPEG' && names.includes('JPG')) continue;
    out.push(n === 'JPG' && names.includes('JPEG') ? 'JPG(JPEG)' : n);
  }
  return out.join(' · ');
})();

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}
