// 설정 탭 G6 운영 값 검증 — 화면에서 먼저 막는다(주의 > 불신, 양의 정수, 웹 몫 ≤ 인식 상한, 엔진 순서)
import { describe, expect, it } from 'vitest';
import { diffSettings, fieldFromServer, formFromSnapshot, validateSettings } from '../../src/admin/lib/settings';
import { normalizeSettings } from '../../src/admin/api';
import type { SettingsSnapshot } from '../../src/admin/types';

function snapshot(over: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return normalizeSettings({
    setting_version_id: 3, api_apply_status: 'applied',
    timeout_seconds: 120, max_concurrency_recognize: 2, max_concurrency_render: 1, web_concurrency_share: 1,
    default_call_limit_per_hour: 100, apply_rate_limit_count: 1, apply_rate_window_minutes: 60,
    structure_threshold: null, grade_caution_boundary: null, grade_distrust_boundary: null,
    web_max_active_per_client: 1, web_hourly_request_cap: 20, score_file_max_bytes: 5242880,
    recommend_timeout_ms: 3000, llm_recommend_timeout_ms: 300000, login_max_failures: 5, login_lock_minutes: 15,
    fallback_enabled: true,
    engine_order: { staff: ['homr', 'audiveris'], jeongganbo: ['jeongganbo-omr'], recommend: ['llm-gemma3-4b', 'rules'] },
    ...over,
  });
}

describe('validateSettings (G6)', () => {
  it('처음 값은 통과한다', () => {
    const s = snapshot();
    expect(validateSettings(formFromSnapshot(s), s)).toEqual({});
  });

  it('0·음수·소수·글자는 양의 정수 칸에서 막는다', () => {
    const s = snapshot();
    const f = formFromSnapshot(s);
    f.values.max_concurrency_recognize = '-1';
    f.values.timeout_seconds = '0';
    f.values.default_call_limit_per_hour = '1.5';
    f.values.login_max_failures = 'abc';
    const e = validateSettings(f, s);
    expect(e.max_concurrency_recognize).toContain('1 이상');
    expect(e.timeout_seconds).toContain('1 이상');
    expect(e.default_call_limit_per_hour).toContain('정수');
    expect(e.login_max_failures).toContain('숫자');
  });

  it('신청 빈도 기간은 7일(10080분)을 넘을 수 없다', () => {
    const s = snapshot();
    const f = formFromSnapshot(s);
    f.values.apply_rate_window_minutes = '10081';
    expect(validateSettings(f, s).apply_rate_window_minutes).toContain('10080');
  });

  it('값이 있던 칸은 비울 수 없고, 미정이던 칸은 비워 둬도 된다', () => {
    const s = snapshot();
    const f = formFromSnapshot(s);
    f.values.timeout_seconds = '';
    const e = validateSettings(f, s);
    expect(e.timeout_seconds).toContain('비워');
    expect(e.structure_threshold).toBeUndefined();
  });

  it('주의 경계는 불신 경계보다 커야 한다', () => {
    const s = snapshot();
    const f = formFromSnapshot(s);
    f.values.grade_caution_boundary = '0.4';
    f.values.grade_distrust_boundary = '0.6';
    expect(validateSettings(f, s).grade_caution_boundary).toContain('불신 경계');
    f.values.grade_caution_boundary = '0.5';
    f.values.grade_distrust_boundary = '0.5';
    expect(validateSettings(f, s).grade_caution_boundary).toBeDefined(); // 같아도 안 된다
    f.values.grade_caution_boundary = '0.7';
    f.values.grade_distrust_boundary = '0.4';
    expect(validateSettings(f, s)).toEqual({});
  });

  it('등급 경계는 함께 정하거나 함께 비운다, 0~1 범위', () => {
    const s = snapshot();
    const f = formFromSnapshot(s);
    f.values.grade_caution_boundary = '0.7';
    expect(validateSettings(f, s).grade_distrust_boundary).toContain('함께');
    f.values.grade_distrust_boundary = '1.2';
    expect(validateSettings(f, s).grade_distrust_boundary).toContain('0~1');
    f.values.grade_distrust_boundary = '';
    f.values.structure_threshold = '-0.1';
    expect(validateSettings(f, s).structure_threshold).toContain('0~1');
  });

  it('웹 몫은 인식 동시 처리 상한보다 클 수 없다', () => {
    const s = snapshot();
    const f = formFromSnapshot(s);
    f.values.web_concurrency_share = '3';
    expect(validateSettings(f, s).web_concurrency_share).toContain('인식 동시 처리 상한');
  });

  it('엔진 순서: 비면 안 되고(추천 제외), 겹치면 안 되고, 등록·켜짐 모델만', () => {
    const s = snapshot();
    const f = formFromSnapshot(s);
    f.engine_order.staff = [];
    f.engine_order.jeongganbo = ['jeongganbo-omr', 'jeongganbo-omr'];
    f.engine_order.recommend = ['llm-qwen3-8b', 'rules'];
    const e = validateSettings(f, s, { staff: ['homr', 'audiveris'], jeongganbo: ['jeongganbo-omr'], recommend: ['llm-gemma3-4b', 'rules'] });
    expect(e['engine_order.staff']).toContain('하나 이상');
    expect(e['engine_order.jeongganbo']).toContain('두 번');
    expect(e['engine_order.recommend']).toContain('llm-qwen3-8b');
  });
});

describe('diffSettings', () => {
  it('바뀐 값만 보낸다 (Q4)', () => {
    const s = snapshot();
    const f = formFromSnapshot(s);
    expect(diffSettings(f, s)).toEqual({});
    f.values.timeout_seconds = '90';
    f.values.grade_caution_boundary = '0.7';
    f.values.grade_distrust_boundary = '0.4';
    f.fallback_enabled = false;
    f.engine_order.staff = ['audiveris', 'homr'];
    expect(diffSettings(f, s)).toEqual({
      timeout_seconds: 90, grade_caution_boundary: 0.7, grade_distrust_boundary: 0.4, fallback_enabled: false,
      engine_order: { staff: ['audiveris', 'homr'] },
    });
  });
});

describe('fieldFromServer', () => {
  it('서버 422 details.field 를 화면 칸으로 옮긴다', () => {
    expect(fieldFromServer('max_concurrency_recognize')).toBe('max_concurrency_recognize');
    expect(fieldFromServer('staff_engine_order')).toBe('engine_order.staff');
    expect(fieldFromServer('engine_order', 'recommend')).toBe('engine_order.recommend');
    expect(fieldFromServer('engine_order[jeongganbo]')).toBe('engine_order.jeongganbo');
    expect(fieldFromServer(undefined, 'staff')).toBe('engine_order.staff');
    expect(fieldFromServer(undefined)).toBeNull();
  });
});
