// #46: 173 · 174(S4-A) · 176~180 · 185 · 186 · 192(내가 만든 악보 · 공유 악보)는 P2 — 그 화면을 옮길 때 v0.1.1 에서 되살린다
// 173~179 (2026-09-30 황송해 결정 — SD_02 머리말 · §4-3 · §4-6 · §7-1 · §9B · UC_07 A9 · A10 · UC_06 A8 · UC_18 · 스타일가이드 §3-4)
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const tpl = (p: string) => read(p).split('<template>').slice(1).join('<template>').split('<style')[0].replace(/<!--[\s\S]*?-->/g, '');

describe('175 바닥글', () => {
  it('링크 · 24시간 문장 · 3팀 없음, Klassic · 음원 출처(MIT) 그대로', () => {
    const f = tpl('src/App.vue').split('<footer')[1];
    for (const gone of ['악보 올리기', 'API활용', '24시간', '3팀', 'RouterLink']) expect(f).not.toContain(gone);
    expect(f).toContain('Klassic');
    expect(f).toContain('FluidR3_GM (Frank Wen, MIT 라이선스)');
    expect(f).toContain('공공누리 제1유형');
  });
});

describe('180 · 181 (2026-09-30 황송해)', () => {
  it('181 로그인 입력칸 세로(레이블 : 입력칸 한 줄씩) — 가입도 같은 배치', () => {
    const src = read('src/pages/S0Login.vue');
    expect(tpl('src/pages/S0Login.vue')).toContain('<div class="fields rows">');
    expect(src).toContain('.form-band .fields.rows { grid-template-columns: 1fr;');
    expect(src).toContain('.rows .field { display: grid; grid-template-columns: 150px minmax(0, 1fr); align-items: center;');
  });
});

describe('189 예시 이름 · 묶음 (2026-09-30 황송해)', () => {
  it('끝 괄호만 떼고 데이터는 그대로 · 종류별 묶음(빈 묶음 없음)', async () => {
    const { exampleDisplayTitle, groupExamples } = await import('@/lib/examples');
    expect(exampleDisplayTitle('타령 (가야금 정간보)')).toBe('타령');
    expect(exampleDisplayTitle('미뉴에트 G장조 (피아노 오선보)')).toBe('미뉴에트 G장조');
    expect(exampleDisplayTitle('아리랑 9/8 (가사 오선보)')).toBe('아리랑 9/8');
    expect(exampleDisplayTitle('괄호 없음')).toBe('괄호 없음');
    expect(exampleDisplayTitle('(전부 괄호)')).toBe('(전부 괄호)');
    const g = groupExamples([{ id: 'a', title: 'A (오선보)', score_type: 'staff' }]);
    expect(g.map((x) => x.label)).toEqual(['오선보']);
  });
});

describe('191 · 194~196 (2026-09-30 황송해)', () => {
  it('191 1단계 표 열 머리 가운데', () => {
    expect(read('src/pages/S1Upload.vue')).toContain('.table-scroll thead th { text-align: center; }');
  });
  it('194 · 195 제목 h3 · [−] 값 [+] 한 줄(SVG 아이콘) · 196 음표 수정 버튼 두 칸 · 패널 최소 360px', () => {
    const s2 = read('src/pages/S2Edit.vue');
    expect(s2).toContain('<h2 id="tr-l" class="h3 center-h">전체 음 반음씩 옮기기</h2>');
    expect(s2).toContain('.tr-stepper { display: flex; flex-wrap: nowrap;');
    expect(s2).toMatch(/aria-label="반음 올리기"[^>]*>\s*<svg/);
    const ni = read('src/components/NoteInspector.vue');
    expect(ni).toContain('.pitch-btns { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));');
    expect(ni).toContain('white-space: nowrap');
  });
});
