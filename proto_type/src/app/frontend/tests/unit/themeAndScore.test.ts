// 2026-09-30 황송해: 갈색 기본 색 · 반려 구분 · 대비(AA) · 바닥글 두 줄 · 연주 막대 배치 · 악보에서 음표/음자리표 고르기 (SD_02 ㉔~㉙)
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { ScoreDoc } from '@/types/score';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const hex = (css: string, name: string) => new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)?.[1] ?? '';
function lum(h: string) {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('갈색 기본 색(스타일가이드 §3-3)', () => {
  const tokens = read('src/styles/tokens.css');
  const sg = read('src/styles/styleguide.css');
  it('주요 버튼 = clay-brown, 누름 · 마우스 = clay-deep, 버튼 글자(한지) 대비 AA', () => {
    expect(tokens).toMatch(/--color-primary:\s*var\(--color-clay-brown\)/);
    expect(tokens).toMatch(/--color-primary-strong:\s*var\(--color-clay-deep\)/);
    const clay = hex(tokens, 'color-clay-brown'); const deep = hex(tokens, 'color-clay-deep'); const cream = hex(tokens, 'color-canvas-cream');
    expect(contrast(cream, clay)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(cream, deep)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(deep, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(sg).toMatch(/\.btn-primary:not\(\[disabled\]\):not\(\[aria-disabled="true"\]\):hover[^{]*\{[^}]*var\(--color-primary-strong\)/);
    expect(sg).toMatch(/\.segmented input:checked \+ span \{[^}]*var\(--color-primary\)/);
  });
  it('반려는 갈색 채움이 아니라 흰 바탕 + 짙은 갈색 테두리 칩(버튼과 구분)', () => {
    expect(tokens).toMatch(/--status-rejected:\s*var\(--color-clay-deep\)/);
    expect(sg).toMatch(/\.chip\.s-rejected \{[^}]*background: var\(--color-white\)[^}]*border: 2px solid var\(--status-rejected\)/);
  });
});

describe('화면 배치(CSS)', () => {
  it('S1 종류: 가운데 · 그림 아래 알약 · 고른 그림은 갈색', () => {
    const src = read('src/pages/S1Upload.vue');
    expect(src).toMatch(/\.type-row \{[^}]*justify-content: center/);
    expect(src).toMatch(/\.type-opt \{[^}]*flex-direction: column/);
    expect(src).toMatch(/\.type-pic\.on \{[^}]*color: var\(--color-clay-brown\)[^}]*border-color: var\(--color-clay-brown\)/);
    expect(src).toContain('width="168" height="114"');
  });
  it('C5 연주 막대: 재생 빠르기 막대와 [악기 바꾸기] 높이 44px, 글자 줄바꿈 허용', () => {
    const src = read('src/components/C5PlayerBar.vue');
    expect(src).toMatch(/\.rate-range \{[^}]*height: 44px/);
    expect(src).toMatch(/\.player > \.btn-secondary \{[^}]*height: 44px/);
    expect(src).toMatch(/\.now \{[^}]*min-width: 0/);
  });
  it('바닥글은 두 줄(서비스 · 보관 · 문의 / 음원 출처)', () => {
    const src = read('src/App.vue');
    expect(src).toContain('footer-slim');
    expect(src).not.toContain('foot-cols');
    expect(src).toContain('공공누리 제1유형');
    expect(read('src/app.css')).toMatch(/\.footer\.footer-slim \{ padding: var\(--spacing-24\) 0; \}/);
  });
});

// 악보에서 음표 · 음자리표 누르기 — OSMD 대신 가짜(그려진 svg 와 측정값만 흉내)
vi.mock('opensheetmusicdisplay', () => ({
  OpenSheetMusicDisplay: class {
    host: HTMLElement; Zoom = 1; Sheet: { Instruments: string[] }; GraphicSheet: unknown;
    constructor(host: HTMLElement) {
      this.host = host;
      this.Sheet = { Instruments: ['I0', 'I1'] };
      this.GraphicSheet = null;
    }
    async load() { return true; }
    render() {
      this.host.innerHTML = '<svg><g id="n-a"><path/></g><g id="n-x"><path/></g></svg>';
      const g = (id: string) => this.host.querySelector(`#${id}`) as SVGGElement;
      const note = (id: string, inst: string, whole: number, half: number) => ({
        sourceNote: { isRest: () => false, Pitch: { getHalfTone: () => half }, getAbsoluteTimestamp: () => ({ RealValue: whole }), ParentStaff: { ParentInstrument: inst } },
        getSVGGElement: () => g(id),
      });
      this.GraphicSheet = { MeasureList: [[
        { beginInstructionsWidth: 3, ParentStaff: { ParentInstrument: 'I0' }, PositionAndShape: { AbsolutePosition: { x: 0, y: 2 } }, staffEntries: [{ graphicalVoiceEntries: [{ notes: [note('n-a', 'I0', 0, 12)] }] }] },
        { beginInstructionsWidth: 3, ParentStaff: { ParentInstrument: 'I1' }, PositionAndShape: { AbsolutePosition: { x: 0, y: 12 } }, staffEntries: [{ graphicalVoiceEntries: [{ notes: [note('n-x', 'I1', 0, 0)] }] }] },
      ]] };
    }
  },
}));

describe('ScoreView — 악보에서 음표 · 음자리표 누르기', () => {
  const doc = {
    ppq: 480, tempoBpm: 120, timeSignature: { beats: 4, beatType: 4 },
    parts: [
      { id: 'p0', notes: [{ id: 'a', startTick: 0, durationTicks: 480, pitch: 60, velocity: 90 }] },
      { id: 'p1', notes: [{ id: 'x', startTick: 0, durationTicks: 480, pitch: 48, velocity: 90 }] },
    ],
  } as unknown as ScoreDoc;

  it('음표를 누르면 그 ScoreDoc 음표 id · 고른 음표는 note-sel · 음자리표 자리를 누르면 그 트랙', async () => {
    const { default: ScoreView } = await import('@/components/ScoreView.vue');
    const w = mount(ScoreView, { props: { musicxml: '<score-partwise><part id="P1"><measure><note><pitch><step>C</step><octave>4</octave></pitch></note></measure></part></score-partwise>', doc, selectedNoteId: 'x' }, attachTo: document.body });
    await flushPromises(); await flushPromises();
    await w.get('#n-a path').trigger('click');
    expect(w.emitted('select')![0]).toEqual(['a']);
    expect(w.get('#n-x').classes()).toContain('note-sel');
    // 가짜 svg 는 화면 좌표 (0,0) — 1단위 = 10px. 2번 보표(y 12~16단위) 앞머리 x 1단위
    await w.get('svg').trigger('click', { clientX: 10, clientY: 140 });
    expect(w.emitted('pickPart')![0]).toEqual([1]);
    await w.get('svg').trigger('click', { clientX: 10, clientY: 40 });
    expect(w.emitted('pickPart')![1]).toEqual([0]);
    await w.get('svg').trigger('click', { clientX: 500, clientY: 40 });
    expect(w.emitted('pickPart')).toHaveLength(2);
    w.unmount();
  });
});

describe('2026-09-30 황송해 36~49 (소스 확인)', () => {
  it('글꼴 토큰은 마루 부리 부분집합 GugakBuri(서비스가 싣는 woff2 · OFL · swap · core/rest 나눔, 예스 명조 없음)', () => {
    const t = read('src/styles/tokens.css');
    expect(t).toMatch(/--font-sans:\s*"GugakBuri"/);
    expect(t).not.toMatch(/YesMyungjo|noonfonts/);
    for (const f of ['GugakBuri-Regular.core.woff2', 'GugakBuri-Bold.core.woff2', 'GugakBuri-Regular.rest.woff2', 'GugakBuri-Bold.rest.woff2']) {
      expect(t).toContain(`/fonts/${f}`);
      const size = readFileSync(resolve(process.cwd(), 'public/fonts', f)).length;
      expect(size).toBeLessThan(200 * 1024);   // 파일마다 200KB 아래
    }
    // (2026-10-01 203번) 로고 글자 KlassicWordmark 하나가 더해져 5
    expect(t.match(/font-display: swap/g)?.length).toBe(5);
    // rest 를 먼저, core 를 나중에(브라우저는 뒤에서부터 맞춰 본다 — 흔한 글자는 core 만)
    expect(t.indexOf('Regular.rest')).toBeLessThan(t.indexOf('Regular.core'));
    expect(read('public/fonts/OFL-MaruBuri.txt')).toContain('SIL Open Font License, Version 1.1');
    expect(read('public/fonts/SOURCES.md')).toContain('hangeul.pstatic.net');
  });
  it('2단계: [파일로 받기] · [새 악보 올리기] 없음, 단계 이동 [이전] [다음](StepNav), 받기 카드 제목 · 설명 없음, 재생만', () => {
    const src = read('src/pages/S1Result.vue');
    expect(src).not.toMatch(/>파일로 받기</);
    expect(src).not.toMatch(/>새 악보 올리기</);
    expect(src).not.toContain('편집 전 결과 받기');
    // (2026-09-30 112번) 악기 바꾸기(C4 한 악기)와 재생 빠르기는 2단계로 옮겼다 · (113번) 받기 카드 없음
    expect(src).toContain('C4InstrumentPicker');
    expect(src).not.toContain('<C6DownloadCard');
    expect(src).toMatch(/<StepNav prev next :next-to="\{ name: 'listen'/);
    expect(src).not.toContain(':show-rate="false"');
    const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('예상 완료 시간');
    expect(code).not.toContain('결과 악보가 나왔습니다');
  });
  it('3단계: 화면에 "트랙" 글자 없음 · 악기 추가 · [빼기] 없음 · 음량 칸에 크게/작게 없음', () => {
    const src = read('src/pages/S2Edit.vue');
    const template = src.slice(src.indexOf('<template>'), src.indexOf('<style'));
    const visible = template.replace(/<!--[\s\S]*?-->/g, '').replace(/"[^"]*"/g, '');
    expect(visible).not.toContain('트랙');
    expect(template).not.toContain('add_instrument');
    expect(template).not.toContain('remove-track');
    expect(src).not.toMatch(/volName|'크게'|'작게'/);
    // (2026-09-30 96번) 칸 이름 "현재 악기 · 음량 · 변경할 악기"
    // (2026-09-30 115번) 3단계 악기 표는 현재 악기 · 음량만
    expect(template).toContain('<th scope="col">악기</th><th scope="col">음량</th></tr>'); // (2026-09-30 136번)
  });
  it('1단계: 두 예시 그림 상자 크기가 같다(아래선 · 알약 줄 맞춤)', () => {
    expect(read('src/pages/S1Upload.vue')).toMatch(/\.type-pic \{[^}]*box-sizing: border-box; width: 196px; height: 148px/);
  });
});

describe('예시 파일(72번 서버 전용 폴더 · 출처)', () => {
  it('예시 파일은 정적 공개 폴더에 없고, 서버 전용 폴더의 목록 파일이 모두 SOURCES.md 에 적혀 있다', () => {
    expect(existsSync(resolve(process.cwd(), 'public/examples'))).toBe(false);
    const dir = resolve(process.cwd(), '../assets/examples');
    const list = JSON.parse(readFileSync(resolve(dir, 'examples.json'), 'utf8')).items as { id: string; file: string; score_type: string }[];
    const sources = readFileSync(resolve(dir, 'SOURCES.md'), 'utf8');
    // (2026-09-30 박예은 팀장 결정) 도라지(오선보 · 정간보) 예시는 뺐다
    expect(list.map((e) => e.id)).toEqual(['arirang-semachi-staff', 'arirang-98-staff', 'minuet-staff', 'taryeong-gayageum-jeongganbo']);
    for (const e of list) {
      expect(readFileSync(resolve(dir, e.file)).length).toBeGreaterThan(1000);
      expect(sources).toContain(e.file);
    }
    expect(list.some((e) => /타령|arirang-staff\.png/.test(e.file))).toBe(false);
    expect(read('src/lib/examples.ts')).not.toMatch(/fetch\(`\/examples/);
  });
});
