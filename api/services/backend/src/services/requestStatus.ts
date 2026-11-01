// #34 RequestStatus 응답 만들기 — 화면이 1초마다 읽는 요청 상태 (web-api.yaml RequestStatus · INTERFACES §4).
//
//   구조에서의 위치: requests.ts → 이 파일 → DB 뷰(v_request_stage_label 상태 낱말 · v_request_retention 보관 기한 · v_job_engine 등)
//     + model-api 상태 캐시(model_wait). 쪽별 결과 · 타당성 값은 model-api 가 DB 에 적은 것을 읽기만 한다.
//   v0.1.1 services/requestStatus.ts 와 같은 동작.
import { one, query } from '../db/pool.js';
import { fallbackCode, shared } from '../config/shared.js';
import { currentSettings } from '../config/settings.js';
import { firstUsable, modelStates } from './modelStatus.js';
import { PAGE_COUNT_SQL, requestDeadlineMs } from './requestWorker.js';

export async function buildRequestStatus(requestId: number) {
  const { errorCodes } = shared();
  const r = await one<Record<string, any>>(
    `SELECT r.request_no, r.file_kind, r.chosen_score_type, r.status, r.route, r.fallback_reason, r.received_at,
            r.setting_version_id, s.timeout_seconds, v.expires_at, v.remaining_seconds, v.is_expired,
            l.stage_label, l.result_band, j.type_mismatch, j.confirmed_score_type, j.validity_grade,
            e.engine_name, e.engine_version, q.queue_position,
            (SELECT a.outcome FROM engine_attempt a WHERE a.request_id = r.request_id ORDER BY a.page_no DESC, a.attempt_no DESC LIMIT 1) AS last_outcome,
            (SELECT t.ended_at FROM stage_timing t WHERE t.request_id = r.request_id AND t.stage_code = 'queue') AS queue_ended_at,
            (SELECT sr.original_ensemble_id FROM score_result sr WHERE sr.request_id = r.request_id AND sr.origin = 'direct') AS original_ensemble_id,
            (SELECT MAX(u.pdf_page_count) FROM upload_file u WHERE u.request_id = r.request_id) AS pdf_page_count,
            r.from_share_id,
            (SELECT cr.midi_uri IS NOT NULL FROM v_current_result cr WHERE cr.request_id = r.request_id AND cr.deleted_at IS NULL LIMIT 1) AS midi_ok,
            ${PAGE_COUNT_SQL} AS page_count
       FROM score_request r
       JOIN v_request_retention v ON v.request_id = r.request_id
       JOIN v_request_stage_label l ON l.request_id = r.request_id
       JOIN processing_setting_version s ON s.setting_version_id = r.setting_version_id
       LEFT JOIN processing_job j ON j.request_id = r.request_id
       LEFT JOIN v_job_engine e ON e.request_id = r.request_id
       LEFT JOIN v_request_queue_position q ON q.request_id = r.request_id
      WHERE r.request_id = ?`, [requestId]);
  if (!r) return null;
  const code = fallbackCode(r.fallback_reason, r.last_outcome);
  const reasonDef = code ? errorCodes.fallback_reasons[code] : null;
  const receivedAt = new Date(r.received_at);
  const pageCount = Math.max(1, Number(r.page_count) || 1);
  const deadline = new Date(requestDeadlineMs(receivedAt, r.queue_ended_at ?? null, r.timeout_seconds, pageCount, false));
  const pageRows = await query<{ page_no: number; file_no: number; source: string; outcome: string; fallback_reason: string | null; validity_grade: string | null;
    image_short_side_px: number | null; upscaled_short_side_px: number | null }>(
    'SELECT page_no, file_no, source, outcome, fallback_reason, validity_grade, image_short_side_px, upscaled_short_side_px FROM request_page WHERE request_id = ? ORDER BY page_no', [requestId]);

  // 타당성 점검 항목 값 — 1단계 판별 화면이 "왜 믿기 어려운지" 문장을 만든다
  const itemRows = await query<{ item_code: string; measured_value: string | number }>(
    'SELECT item_code, measured_value FROM validity_check_item WHERE request_id = ?', [requestId]);
  const validity_items = itemRows.length
    ? Object.fromEntries(itemRows.map((x) => [x.item_code, Number(x.measured_value)])) as Record<string, number>
    : null;

  // 모델이 아직 올라오지 않았으면 기다리는 이유와 예상 시간을 보인다
  let model_wait: null | Record<string, unknown> = null;
  if (r.status === 'converting' && r.route === 'recognize' && r.chosen_score_type) {
    const models = await modelStates();
    const settings = await currentSettings();
    const order = r.chosen_score_type === 'staff' ? settings.engine_order.staff : settings.engine_order.jeongganbo;
    const m = models ? firstUsable(models, order) : null;
    if (m && (m.state === 'cold' || m.state === 'loading')) {
      const since = r.queue_ended_at ? new Date(r.queue_ended_at).getTime() : receivedAt.getTime();
      model_wait = {
        model: m.name, display_name: m.display_name, state: m.state,
        expected_seconds: m.expected_seconds, elapsed_seconds: Math.max(0, Math.round((Date.now() - since) / 1000)),
      };
    }
  }

  return {
    id: r.request_no,
    file_kind: r.file_kind,
    score_type: r.chosen_score_type,
    status: r.is_expired ? 'expired' : r.status,
    status_label: r.is_expired ? '만료' : r.stage_label,
    queue_position: r.queue_position ?? null,
    route: r.route,
    result_band: r.result_band ?? null,
    fallback: r.route === 'fallback',
    fallback_reason: code,
    fallback_message: reasonDef?.message ?? null,
    retry_hint: reasonDef?.retry_hint ?? null,
    type_mismatch: Boolean(r.type_mismatch),
    detected_type: r.type_mismatch ? (r.chosen_score_type === 'staff' ? 'jeongganbo' : 'staff') : null,
    validity_grade: r.validity_grade ?? null,
    engine: r.engine_name ? { name: r.engine_name, version: r.engine_version } : null,
    received_at: receivedAt.toISOString(),
    expires_at: new Date(r.expires_at).toISOString(),
    remaining_seconds: Number(r.remaining_seconds),
    deadline_at: deadline.toISOString(),
    model_wait,
    has_original_instruments: r.original_ensemble_id != null,
    pdf_page_count: r.pdf_page_count != null ? Number(r.pdf_page_count) : null,
    // 지금 결과에 원본 MIDI 가 있는가 (MIDI 변환 실패면 false, 결과 전이면 null)
    midi_available: r.midi_ok == null ? null : Boolean(Number(r.midi_ok)),
    from_shared: r.from_share_id != null,
    validity_items,
    page_count: pageCount,
    pages: pageRows.map((p) => {
      const pc = p.fallback_reason ? fallbackCode(p.fallback_reason) : null;
      return {
        page_no: Number(p.page_no), file_no: Number(p.file_no), source: p.source, outcome: p.outcome,
        fallback_reason: pc, fallback_message: pc ? errorCodes.fallback_reasons[pc]?.message ?? null : null,
        validity_grade: p.validity_grade,
        short_edge_px: p.image_short_side_px != null ? Number(p.image_short_side_px) : null,
        upscaled_short_side_px: p.upscaled_short_side_px != null ? Number(p.upscaled_short_side_px) : null,
      };
    }),
    notice: pagesNotice(pageRows),
  };
}

/** 여러 쪽 요청에서 일부 쪽만 못 읽었으면 "N쪽 중 M쪽 변환했습니다 (못 읽은 쪽: 3·7쪽)". 모두 실패면 대체 결과라 안내 없음 */
export function pagesNotice(rows: { page_no: number; outcome: string }[]):
  { code: 'PAGES_PARTIAL'; message: string; pages: number; converted: number; failed_pages: number[] } | null {
  if (rows.length <= 1 || rows.some((p) => p.outcome === 'pending')) return null;
  const failed = rows.filter((p) => p.outcome === 'failed').map((p) => Number(p.page_no)).sort((a, b) => a - b);
  if (failed.length === 0 || failed.length >= rows.length) return null;
  const pages = rows.length;
  const converted = pages - failed.length;
  const message = shared().errorCodes.status_codes.PAGES_PARTIAL
    .replace('{pages}', String(pages)).replace('{converted}', String(converted)).replace('{failed_pages}', failed.join('·'));
  return { code: 'PAGES_PARTIAL', message, pages, converted, failed_pages: failed };
}
