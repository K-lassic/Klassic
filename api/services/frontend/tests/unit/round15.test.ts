// 화면 다듬기 15차 (2026-09-30 황송해 결정 145~155, SD_02 머리말 · UC_06 · UC_18)
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import C4InstrumentPicker from '@/components/C4InstrumentPicker.vue';
import C6DownloadCard from '@/components/C6DownloadCard.vue';
import type { InstrumentCatalog } from '@/types/api';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const tpl = (p: string) => { const s = read(p); return s.slice(s.indexOf('<template>')).replace(/<!--[\s\S]*?-->/g, ''); };
const catalog = {
  default_set: ['gayageum', 'janggu'],
  gugak: [{ id: 'gayageum', name: '가야금', percussion: false }, { id: 'daegeum', name: '대금', percussion: false }, { id: 'janggu', name: '장구', percussion: true }, { id: 'buk', name: '북', percussion: true }],
  others: [{ id: 'piano', name: '피아노', percussion: false }],
} as unknown as InstrumentCatalog;
const names = (w: ReturnType<typeof mount>) => w.findAll('label.opt span').map((x) => x.text());

describe('145 · 146 악기 선택 목록', () => {
  it('선율 성부는 선율 악기만(장구 · 북 없음) · 기본 구성 항목 없음', () => {
    const w = mount(C4InstrumentPicker, { props: { catalog, modelValue: { kind: 'instrument', code: 'gayageum' }, scope: 'track', percussionTrack: false } });
    expect(names(w)).toEqual(['가야금', '대금', '피아노']);
    expect(w.text()).not.toContain('기본 국악기 구성');
  });
  it('타악 성부는 타악기만', () => {
    const w = mount(C4InstrumentPicker, { props: { catalog, modelValue: { kind: 'instrument', code: 'janggu' }, scope: 'track', percussionTrack: true } });
    expect(names(w)).toEqual(['장구', '북']);
  });
});

describe('147~155 소스 · 문구', () => {
  it('2단계: 고르면 패널 닫힘 · 문구 · 제목', () => {
    const src = read('src/pages/S1Result.vue');
    expect(src).toMatch(/if \(ops\.length\) await ed\.pushMany\(ops\);[\s\S]*?trackPicker\.value = null;/);
    expect(tpl('src/pages/S1Result.vue')).not.toContain('고르면 바로 바뀝니다');
    expect(tpl('src/pages/S1Result.vue')).toContain('악기 변경하기');
  });
  it('3단계: 상태 줄은 두 단 안 · [원본으로 되돌리기]는 단계 이동 가운데', () => {
    const t = tpl('src/pages/S2Edit.vue');
    const layoutStart = t.indexOf('class="edit-layout"');
    const status = t.indexOf('data-test="edit-status"');
    const nav = t.indexOf('<StepNav');
    expect(status).toBeGreaterThan(layoutStart);
    expect(status).toBeLessThan(nav);
    expect(t.slice(nav)).toContain('data-test="revert"');
  });
  it('전체: 머리 막대는 따라 붙지 않는다 · 그림자는 그대로', () => {
    const css = read('src/styles/styleguide.css');
    expect(css).toMatch(/\.site-nav \{ position: relative;/);
    expect(css).toContain('var(--shadow-bar-down)');
  });
  it('4단계: 카드 안 제목 · [공유하기]', () => {
    const w = mount(C6DownloadCard, { props: { requestNo: 'R-1', title: '변환한 악보 저장하기' } });
    expect(w.get('[data-test="download-card"] [data-test="save-title"]').text()).toBe('변환한 악보 저장하기');
    expect(tpl('src/components/SharePanel.vue')).toContain('>공유하기</button>');
  });
});
