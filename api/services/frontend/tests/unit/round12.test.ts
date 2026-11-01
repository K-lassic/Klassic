// 화면 다듬기 12차 (2026-09-30 황송해 결정 123~128, SD_02 머리말 · UC_03)
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import C3ResultBand from '@/components/C3ResultBand.vue';
import { LIMITS } from '@/lib/uploadKind';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const noComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '');

describe('123 · 125 사진 크기 기준', () => {
  it('반려 300px · 경고 500px(규칙 파일)', () => {
    expect(LIMITS.minEdge).toBe(300);
    expect(LIMITS.warnEdge).toBe(500);
    const up = read('src/pages/S1Upload.vue');
    expect(up).toContain('px 미만 사진은 부정확한 결과가 나올 수 있습니다.');
    expect(up).toContain('e >= LIMITS.minEdge && e < LIMITS.warnEdge');
    expect(read('src/pages/S1Result.vue')).toContain('data-test="low-pages"');
  });
});

describe('124 흰 막대 그림자', () => {
  it('토큰 · 머리 막대 아래쪽 · 연주 막대 위쪽', () => {
    expect(read('src/styles/tokens.css')).toContain('--shadow-bar-down: rgba(20, 20, 19, .14) 0px 8px 18px -6px;');
    expect(read('src/styles/styleguide.css')).toContain('box-shadow: var(--elevation-1), var(--shadow-bar-down);');
    expect(read('src/components/C5PlayerBar.vue')).toContain('box-shadow: var(--shadow-bar-up);');
  });
});

describe('126 MusicXML [?]', () => {
  it('(2026-09-30 149번) 직행 결과 안내와 그 [?] 는 뺐다', () => {
    const w = mount(C3ResultBand, { props: { band: 'direct', fileKind: 'musicxml' } });
    expect(w.find('[data-test="band-direct"]').exists()).toBe(false);
    expect(w.text()).not.toContain('그대로 악보로 만들었습니다');
  });
});

describe('127 · 128 2단계 악기 고르기', () => {
  it('표 오른쪽 패널 · 고르면 바로 적용([확인] · [취소] 없음)', () => {
    const src = read('src/pages/S1Result.vue');
    const t = noComments(src.slice(src.indexOf('<template>')));
    const picker = t.slice(t.indexOf('<C4InstrumentPicker'), t.indexOf('/>', t.indexOf('<C4InstrumentPicker')));
    expect(picker).not.toContain('confirm');
    expect(picker).not.toContain('@cancel');
    expect(picker).toContain('class="track-panel"');
    expect(src).toContain('.track-layout.split { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); }'); // 156번: 패널이 열렸을 때만 두 칸
  });
});
