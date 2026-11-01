// 결과 판별(2026-09-30 황송해 결정 130번, SD_02 머리말 · SD_01 1.13a · UC_01 · UC_02)
// 신뢰 · 직행이면 바로 2단계, 주의 · 대체이면 1단계에서 "왜 믿기 어려운지"를 보인다.
// 사유는 모델 API 가 적은 타당성 점검 항목 값(validity_items) · 대체 사유 · 쪽별 실패 사유로 만든다(모델 API 는 바꾸지 않음).
import type { RequestStatus } from '@/types/api';

/** 이 결과를 2단계로 넘기기 전에 1단계에서 판별을 보여야 하나 */
export function needsJudgment(s: RequestStatus | null | undefined): boolean {
  if (!s || s.status !== 'completed') return false;
  if (s.route === 'direct') return false;
  if (s.fallback || s.route === 'fallback') return true;
  return (s.result_band ?? 'trust') !== 'trust';
}

// 항목별로 "문제로 볼" 기준 — 모델 API 타당성 점수(checks/validity.py)의 만점 기준을 따른다
const NOTE_FULL = 16; // 이만큼 음이 있어야 음 개수 만점
const BEAT_OK = 0.9;
const RANGE_OK = 0.8;
const YUL_OK = 0.8;
const CONF_OK = 0.6;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** MusicXML 의 마디 수(첫 성부 기준) — 박자가 틀린 마디 수를 어림하는 데 쓴다 */
export function measureCount(musicxml: string | null | undefined): number | null {
  if (!musicxml) return null;
  const parts = (musicxml.match(/<part\s+id=/g) ?? []).length || 1;
  const measures = (musicxml.match(/<measure[\s>]/g) ?? []).length;
  return measures ? Math.round(measures / parts) : null;
}

/** 판별 사유 문장(합쇼체). 앞에서부터 중요한 것 */
export function judgmentReasons(s: RequestStatus, measures: number | null = null): string[] {
  const out: string[] = [];
  if (s.fallback || s.route === 'fallback') {
    out.push(s.fallback_message ? `${s.fallback_message.replace(/\.?$/, '.')} 그래서 인식 결과 대신 서비스가 준비한 대체 악보를 드렸습니다.` : '인식 결과를 쓰지 못해 대체 악보를 드렸습니다.');
  }
  const failed = (s.pages ?? []).filter((p) => p.outcome === 'failed' && p.fallback_message);
  if ((s.pages?.length ?? 0) > 1) for (const p of failed) out.push(`${p.page_no}쪽: ${p.fallback_message}`);
  const v = s.validity_items;
  if (v) {
    if (v.note_count != null && v.note_count < NOTE_FULL) {
      out.push(v.note_count === 0 ? '악보에서 음표를 하나도 찾지 못했습니다.' : `음표가 ${Math.round(v.note_count)}개뿐이라 악보를 제대로 읽었는지 믿기 어렵습니다.`);
    }
    if (v.beat_sum != null && v.beat_sum < BEAT_OK) {
      const bad = measures ? Math.max(1, Math.round((1 - v.beat_sum) * measures)) : null;
      out.push(`박자표와 길이가 맞지 않는 마디가 ${bad ? `약 ${bad}개(${pct(1 - v.beat_sum)})` : pct(1 - v.beat_sum)} 있습니다.`);
    }
    if (v.range_leap != null && v.range_leap < RANGE_OK) {
      out.push(`음역이 지나치게 넓거나 한 옥타브보다 큰 도약이 많습니다(음역 · 도약 점수 ${pct(v.range_leap)}).`);
    }
    if (v.yulmyeong_ratio != null && v.yulmyeong_ratio < YUL_OK) {
      out.push(`정간보 칸 가운데 율명으로 읽은 칸이 ${pct(v.yulmyeong_ratio)}뿐입니다.`);
    }
    if (v.engine_confidence != null && v.engine_confidence < CONF_OK) {
      out.push(`인식 엔진의 확신도가 ${pct(v.engine_confidence)}로 낮습니다.`);
    }
  }
  if (!out.length) {
    out.push(s.result_band === 'caution' ? '타당성 점검 점수가 기준보다 낮아 틀린 음이 있을 수 있습니다.' : '인식 결과를 믿기 어렵습니다.');
  }
  return out;
}

const KEY = (no: string) => `gugak.accept.${no}`;
/** [그래도 계속]을 눌렀는지 — 이 브라우저에 기억(새로 고쳐도 2단계). 저장소를 못 쓰면 이 화면에서만 */
export function loadAccepted(no: string): boolean {
  try { return window.localStorage.getItem(KEY(no)) === '1'; } catch { return false; }
}
export function saveAccepted(no: string): void {
  try { window.localStorage.setItem(KEY(no), '1'); } catch { /* 기억만 못 한다 */ }
}
