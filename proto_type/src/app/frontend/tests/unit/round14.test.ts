// 화면 다듬기 14차 (2026-09-30 황송해 결정 131~144, SD_02 머리말 · UC_06 · UC_18)
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chordHeadIds, osmdHalfToneToMidi } from '@/lib/noteMatch';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const tpl = (p: string) => { const s = read(p); return s.slice(s.indexOf('<template>')).replace(/<!--[\s\S]*?-->/g, ''); };

describe('131 화음의 음 하나씩', () => {
  it('OSMD 가운데 도(48) → MIDI 60 · 화음 머리는 낮은 음부터 음 하나씩', () => {
    expect(osmdHalfToneToMidi(48)).toBe(60);
    expect(chordHeadIds([{ id: 'e', midi: 64 }, { id: 'c', midi: 60 }, { id: 'd', midi: 62 }], 3)).toEqual(['c', 'd', 'e']);
    expect(chordHeadIds([{ id: 'c', midi: 60 }], 1)).toBeNull();
    expect(chordHeadIds([{ id: 'c', midi: 60 }, { id: 'e', midi: 64 }], 3)).toBeNull();
  });
  it('ScoreView 는 화음 머리마다 음표 연결 · 음표 수정에 화음 몇 번째인지', () => {
    const src = read('src/components/ScoreView.vue');
    expect(src).toContain("g.querySelectorAll('.vf-notehead')");
    expect(read('src/components/NoteInspector.vue')).toContain('data-test="note-chord"');
  });
});

describe('132 스크롤 위치', () => {
  it('다시 그리는 동안 높이를 붙잡고 스크롤을 되살린다(확대 때도)', () => {
    const src = read('src/components/ScoreView.vue');
    expect(src).toContain('function holdScroll()');
    expect(src).toMatch(/finally \{\s*keep\(\);/);
    expect(src).toContain('const keep = holdScroll();\n  try { osmd.Zoom = next;');
  });
});

describe('133~144 문구 · 배치', () => {
  it('3단계', () => {
    const t = tpl('src/pages/S2Edit.vue');
    expect(t).toContain('<h1 class="h2 center-h" data-test="s2-lede">악기를 바꾸고, 음을 고쳐 우리나라의 전통 악기를 즐겨보십시오.</h1>');
    expect(t).not.toContain('바로 들어 보십시오');
    expect(t).toContain('악기 음량 조절하기');
    expect(t.indexOf('data-test="edit-status"')).toBeGreaterThan(t.indexOf('id="tracks-h"'));
    expect(t.indexOf('data-test="edit-status"')).toBeLessThan(t.indexOf('<StepNav'));
    expect(t).not.toContain(':show-rate="false"');
    expect(tpl('src/components/NoteInspector.vue')).not.toContain('note-track-');
  });
  it('2단계 · 1단계 · 전체 · 4단계', () => {
    expect(tpl('src/pages/S1Result.vue')).toMatch(/dock\s+:show-now="false"/);
    expect(tpl('src/components/C3ResultBand.vue')).not.toContain('바로 연주');
    expect(tpl('src/pages/S3Download.vue')).toContain('변환한 악보 저장하기');
  });
});

describe('141 4단계 받기 카드가 제목과 함께 보인다(v-if 사슬)', () => {
  it('제목과 카드가 같은 v-else-if 묶음 안', () => {
    const t = tpl('src/pages/S3Download.vue');
    // (2026-10-01 214번) 제목은 받기 카드 바깥 위 — 같은 v-else-if 묶음(section) 안
    expect(t).toMatch(/<section v-else-if="s" class="save-wrap"[^>]*>\s*<h2 id="save-h" class="h2 center-h"[^>]*>변환한 악보 저장하기<\/h2>\s*<C6DownloadCard/);
  });
});
