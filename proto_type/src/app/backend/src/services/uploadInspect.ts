// PDF 업로드 검사 위임 (2026-09-29 황송해 결정 — 사진·PDF 입력, UC3 A7 · E2 · SD_01 1.2a).
// 웹은 PDF 의 형식(%PDF)·용량·악보 종류만 스스로 보고, 열기(손상·암호) · 첫 쪽 300dpi 변환 · 사진 크기(반려 300px, 650px 미만은 늘려 읽음 — 2026-09-30 119번)는
// 모델 API 의 같은 검사기(checks/upload.py, pypdfium2)에 맡긴다 → 웹과 연주 API·/v1/omr 의 판정이 같다(SC-015).
// ~~모델 API 가 닿지 않으면 null — 부르는 쪽은 웹 자체 판정으로 접수~~ (2026-09-29 황송해 결정, BR-UPL-06)
// 모델 API 가 닿지 않거나 검사하지 못하면 null — 부르는 쪽은 PDF 를 접수하지 않고 503 UPLOAD_CHECK_UNAVAILABLE 로 반려한다.
// (2026-09-29 여러 쪽) 모델 API 는 PDF 의 모든 쪽(최대 10쪽)을 본다 — 11쪽 이상이면 UPLOAD_TOO_MANY_PAGES.
import { modelJson, ModelApiDown, blobOf } from './modelApiClient.js';
import { logger } from '../lib/logger.js';

export interface RemoteUploadVerdict {
  ok: boolean;
  code: string | null;
  details: Record<string, unknown>;
  shortEdgePx: number | null;
  pdfPageCount: number | null;
}

interface CheckBody { ok: boolean; kind: string; short_edge_px: number | null; pdf_page_count: number | null; page_count?: number }
interface ErrorBody { error?: { code?: string; details?: Record<string, unknown> } }

export async function inspectUploadRemote(name: string, data: Buffer, scoreType: string | undefined): Promise<RemoteUploadVerdict | null> {
  const form = new FormData();
  form.set('file', blobOf(data, 'application/pdf'), name);
  if (scoreType) form.set('score_type', scoreType);
  try {
    const r = await modelJson<CheckBody>('POST', '/v1/internal/upload-check', form, { timeoutMs: 20000 });
    return { ok: true, code: null, details: {}, shortEdgePx: r.short_edge_px ?? null, pdfPageCount: r.pdf_page_count ?? null };
  } catch (e) {
    if (e instanceof ModelApiDown && e.reason === 'http') {
      const err = (e.body as ErrorBody | null)?.error;
      // G1 반려(UPLOAD_*)는 그대로 웹 반려로. 그 밖(키 오류·서버 오류)은 검사를 못 한 것으로 본다
      if (err?.code?.startsWith('UPLOAD_')) {
        return { ok: false, code: err.code, details: err.details ?? {}, shortEdgePx: null, pdfPageCount: null };
      }
    }
    logger.warn({ err: e }, 'pdf upload check could not reach model api — rejecting (UPLOAD_CHECK_UNAVAILABLE)');
    return null;
  }
}
