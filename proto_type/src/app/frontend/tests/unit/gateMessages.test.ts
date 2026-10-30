import { describe, expect, it } from 'vitest';
import errorCodes from '../../../shared/error-codes.json';
import { gateFromError, gateMessage, gateCodesFor, statusText } from '@/i18n/gateMessages';
import { fallbackReasonText, fallbackRetryHint, fallbackShortName, toScreenCode } from '@/i18n/fallbackReasons';
import { GateError } from '@/api/client';
import { parseRetryAfter } from '@/lib/time';

describe('gateMessages — shared/error-codes.json 에서 만든 C2 문구', () => {
  it('모든 G1 코드는 사유·고치는 방법이 공유 원본과 같다', () => {
    for (const [code, v] of Object.entries(errorCodes.gate_codes)) {
      if (v.gate !== 'G1') continue;
      const g = gateMessage(code);
      expect(g.reason).toBe(v.message);
      // 웹 화면은 웹 전용 고치는 방법(web_fix)이 있으면 그것 — 2026-09-29 사진·PDF 입력 뒤로는 웹·API 같은 fix
      expect(g.fix).toBe((v as { web_fix?: string }).web_fix ?? v.fix);
      expect(g.title).toBe('반려 · 접수하지 않았습니다 (G1 파일 검사)');
      expect(g.chip).toBe('반려 · G1');
      expect(g.chipKind).toBe('s-rejected');
      expect(g.releaser).toBe('올린 사람(나)');
    }
  });
  it('형식 반려: 사진·PDF 를 받는다고 안내 · MIDI·MusicXML 은 받지 않는다(웹·API 같음, 2026-09-29)', () => {
    const g = gateMessage('UPLOAD_UNSUPPORTED_TYPE');
    expect(g.reason).toBe('받을 수 없는 파일 형식입니다.');
    expect(g.fix).toContain('PNG·JPG(JPEG)·WEBP');
    expect(g.fix).toContain('PDF');
    expect(g.fix).not.toMatch(/\.mid|\.musicxml/i);
    expect(gateMessage('UPLOAD_TOO_LARGE').fix).toBe('사진·PDF를 20MB 이하로 줄여 올려 주십시오.');
    // API활용 오류표(연주 API)도 같은 문구 — 웹 전용 문구(web_fix)가 더는 없다
    expect(gateCodesFor(['G1']).find((r) => r.code === 'UPLOAD_UNSUPPORTED_TYPE')!.fix).toBe(g.fix);
    expect(statusText('PDF_FIRST_PAGE_ONLY')).toBe('PDF 첫 쪽만 변환했습니다 (전체 {pages}쪽)');
  });
  it('해상도 반려: "짧은 변" 대신 "사진 크기" · 서버 숫자가 있으면 사유에 붙인다', () => {
    for (const v of Object.values(errorCodes.gate_codes)) expect(`${v.message} ${v.fix}`).not.toContain('짧은 변');
    expect(gateMessage('UPLOAD_RESOLUTION_TOO_LOW').fix).toContain('사진 크기');
    const e = new GateError(422, { code: 'UPLOAD_RESOLUTION_TOO_LOW', message: '더 선명한 사진이 필요합니다.', gate: 'G1', retry_after: null,
      details: { min_short_edge_px: 650, actual_short_edge_px: 600 } });
    expect(gateFromError(e).reason).toBe('해상도가 너무 낮습니다 (사진 크기 600px, 기준 650px)');
  });
  it('여러 쪽(2026-09-29): UPLOAD_TOO_MANY_FILES 는 공유 원본 뜻(PDF 여러 개 · 섞음) · 쪽 반려는 어느 쪽인지 붙인다', () => {
    expect(gateMessage('UPLOAD_TOO_MANY_FILES').reason).toBe('PDF 한 개 또는 사진 여러 장으로 올려 주십시오.');
    expect(gateMessage('UPLOAD_TOO_MANY_FILES').reason).not.toContain('한 장만');
    expect(gateMessage('UPLOAD_TOO_MANY_PAGES').reason).toBe('한 번에 10쪽까지 올릴 수 있습니다.');
    const e = new GateError(422, { code: 'UPLOAD_CORRUPTED', message: '파일이 손상되었습니다.', gate: 'G1', retry_after: null, details: { page: 3 } });
    expect(gateFromError(e, ['a.png', 'b.png', 'c.png']).reason).toBe('3쪽(c.png) 파일이 손상되었습니다.');
    expect(gateFromError(e).reason).toBe('3쪽 파일이 손상되었습니다.');
  });
  it('G4 만료는 회색 만료 칩 + [악보 다시 올리기]', () => {
    const g = gateMessage('RESULT_EXPIRED');
    expect(g).toMatchObject({ gate: 'G4', chipKind: 's-expired', chip: '만료 · G4', actionLabel: '악보 다시 올리기', railLabel: 'G4 만료' });
  });
  it('G12 · G11 은 직접 해제 버튼 없이 시각 안내', () => {
    expect(gateMessage('WEB_ACTIVE_REQUEST_EXISTS').actionLabel).toBeNull();
    expect(gateMessage('APPLICATION_RATE_LIMITED').actionLabel).toBeNull();
    expect(gateMessage('APPLICATION_RATE_LIMITED').title).toContain('G11');
  });
  it('G10 제목 · G8(사용자 음원, 2026-09-29 삭제) 코드는 없다', () => {
    expect(gateMessage('SF2_TOO_LARGE').gate).toBeNull();
    expect(gateMessage('APPLICATION_MISSING_FIELD').actionLabel).toBe('빠진 항목으로 가기');
  });
  it('서버 오류 본문 → 화면 문구(서버 문구 우선) · retry_after 초/ISO 둘 다', () => {
    const e = new GateError(429, { code: 'WEB_HOURLY_LIMIT', message: '서버 문구', fix: '서버 고침', gate: 'G12', retry_after: '60' });
    const now = Date.now();
    const g = gateFromError(e);
    expect(g.reason).toBe('서버 문구');
    expect(g.gate).toBe('G12');
    expect(Math.abs(g.retryAt!.getTime() - (now + 60000))).toBeLessThan(2000);
    expect(parseRetryAfter('2026-09-28T10:30:00Z')?.toISOString()).toBe('2026-09-28T10:30:00.000Z');
    expect(parseRetryAfter(null)).toBeNull();
  });
  it('해제 주체 문구에 긴 줄표(—)가 없다(2026-09-30 황송해)', () => {
    for (const code of Object.keys(errorCodes.gate_codes)) expect(gateMessage(code).releaser).not.toContain('—');
    expect(gateMessage('RESULT_EXPIRED').releaser).toBe('올린 사람(나)이 악보를 다시 올려 새 요청을 만듭니다');
  });
  it('알 수 없는 오류도 문구가 빈 칸이 아니다', () => {
    const g = gateFromError(new Error('x'));
    expect(g.reason.length).toBeGreaterThan(0);
  });
  it('상태 문구 · 매뉴얼 오류표', () => {
    expect(statusText('RENDER_TIMEOUT')).toBe(errorCodes.status_codes.RENDER_TIMEOUT);
    // 정간보 지원 범위 보조 안내(JEONGGANBO_SCOPE) — 2026-09-30 황송해 결정으로 지웠다가 같은 날 박예은 팀장 결정으로 작은 보조 안내로 다시 둠
    expect(statusText('JEONGGANBO_SCOPE')).toBe('현재 「2021 정악보」 형식을 기준으로 인식합니다.');
    // 올리기 화면 예시 그림 말풍선(2026-09-30 황송해 결정으로 짧게)
    expect(statusText('JEONGGANBO_NOTE')).toBe('정간보 : 우리 전통 음악을 적는 악보.');
    expect(statusText('STAFF_NOTE')).toBe('오선보 : 오선 위에 음표를 그려 음의 높이와 길이를 나타내는 악보.');
    const rows = gateCodesFor(['G2']);
    expect(rows.map((r) => r.code)).toEqual([
      'AUTH_KEY_MISSING',
      'AUTH_KEY_INVALID',
      'AUTH_KEY_REVOKED',
      'AUTH_SERVICE_KEY_REQUIRED',
    ]);
  });
});

describe('fallbackReasons (T075)', () => {
  it('DB 소문자 → 화면 코드, no_notes 구분', () => {
    expect(toScreenCode('recognition_failed')).toBe('RECOGNITION_FAILED');
    expect(toScreenCode('recognition_failed', 'no_notes')).toBe('NO_NOTES');
    expect(toScreenCode('engine_stopped')).toBe('ENGINE_DOWN');
    expect(toScreenCode('distrust')).toBe('UNTRUSTED_RESULT');
    expect(toScreenCode('nope')).toBeNull();
  });
  it('문구 · 다시 해 볼 방법', () => {
    expect(fallbackReasonText('NO_NOTES')).toBe('악보에서 음표를 찾지 못했습니다.');
    expect(fallbackRetryHint('NO_SCORE_STRUCTURE')).toBe('악보 사진을 다시 올려 보십시오.');
    expect(fallbackRetryHint('USER_REQUEST')).toBeNull();
    expect(fallbackShortName('TIMEOUT')).toBe('시간 초과');
  });
});
