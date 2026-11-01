// #34 PDF 검사 위임 — 형식 · 용량 · 악보 종류는 웹이 보고, 열기(손상 · 암호) · 쪽 수 · 쪽마다 크기는 model-api 검사기(#28)에 맡긴다.
//
//   구조에서의 위치: requests.ts → 이 파일 → model-api POST /v1/internal/upload-check (서비스 키 전용, 요청을 만들지 않음).
//     같은 검사기라 웹 · 외부 API 판정이 같다. 닿지 않으면 null → 부르는 쪽이 503 UPLOAD_CHECK_UNAVAILABLE 로 반려한다 (접수 안 함).
//   v0.1.1 services/uploadInspect.ts 와 같은 동작.
import { blobOf, ModelApiDown, modelJson } from './modelApiClient.js';
import { logger } from '../lib/logger.js';

export interface RemoteVerdict {
  ok: boolean;
  code: string | null;
  details: Record<string, unknown>;
  shortEdgePx: number | null;
  pdfPageCount: number | null;
}

interface CheckBody { ok: boolean; kind: string; short_edge_px: number | null; pdf_page_count: number | null }
interface ErrorBody { error?: { code?: string; details?: Record<string, unknown> } }

export async function inspectPdf(name: string, data: Buffer, scoreType: string | undefined): Promise<RemoteVerdict | null> {
  const form = new FormData();
  form.set('file', blobOf(data, 'application/pdf'), name);
  if (scoreType) form.set('score_type', scoreType);
  try {
    const r = await modelJson<CheckBody>('POST', '/v1/internal/upload-check', form, { timeoutMs: 20000 });
    return { ok: true, code: null, details: {}, shortEdgePx: r.short_edge_px ?? null, pdfPageCount: r.pdf_page_count ?? null };
  } catch (e) {
    const err = e instanceof ModelApiDown && e.reason === 'http' ? (e.body as ErrorBody | null)?.error : undefined;
    // G1 반려(UPLOAD_*)는 그대로 웹 반려로. 그 밖(키 오류 · 서버 오류)은 검사를 못 한 것으로 본다
    if (err?.code?.startsWith('UPLOAD_')) {
      return { ok: false, code: err.code, details: err.details ?? {}, shortEdgePx: null, pdfPageCount: null };
    }
    logger.warn({ err: e }, 'PDF 검사 불가 — model-api 에 닿지 않아 반려(UPLOAD_CHECK_UNAVAILABLE)');
    return null;
  }
}
