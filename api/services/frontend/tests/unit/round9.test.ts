// 화면 다듬기 9차 (2026-09-30 황송해 결정 75~105, SD_02 머리말 · §3-6 · §3-10 · §3-11 · §4 · §5 · §6)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fake = vi.hoisted(() => ({
  state: 'idle', base: 'gugak', rate: 1, position: 0, duration: 0,
  listeners: new Set<(s: string, d?: string) => void>(),
  calls: [] as string[],
  on(fn: (s: string, d?: string) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit(s: string) { this.state = s; this.listeners.forEach((l) => l(s)); },
  stop() { this.calls.push('stop'); if (this.state === 'playing' || this.state === 'paused') this.emit('ready'); },
  // 실제 player 처럼 처음에는 음원을 불러오며 'loading' → 'ready' 를 먼저 알린 뒤 'playing'
  async play() { this.calls.push('play'); this.emit('loading'); this.emit('ready'); this.duration = 48; this.emit('playing'); return true; },
  pause() { this.calls.push('pause'); this.emit('paused'); },
  async resume() { this.calls.push('resume'); this.emit('playing'); return true; },
  seek(t: number) { this.calls.push(`seek ${t}`); this.position = t; },
  setRate() {},
}));
vi.mock('@/player/player', () => ({ player: fake, PLAYBACK_RATE_MIN: 0.5, PLAYBACK_RATE_MAX: 2, PLAYBACK_BASE_BPM: 100 }));

import HelpTip from '@/components/HelpTip.vue';
import C5PlayerBar from '@/components/C5PlayerBar.vue';
import SharedScoreList from '@/components/SharedScoreList.vue';
import C6DownloadCard from '@/components/C6DownloadCard.vue';
import type { ScoreDoc } from '@/types/score';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const noComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/[^\n]*/g, '');
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const doc = { tempoBpm: 100, parts: [] } as unknown as ScoreDoc;

beforeEach(() => { setActivePinia(createPinia()); fake.calls = []; fake.state = 'idle'; fake.position = 0; fake.duration = 0; fake.listeners.clear(); });
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('C10 도움말 [?] (공용 부품)', () => {
  it('초점 · 마우스 올림에서 열리고 Esc · 떠남에서 닫힌다 · aria-describedby 로 설명을 가리킨다', async () => {
    const w = mount(HelpTip, { props: { label: '파일 형식', text: '설명 글' }, attachTo: document.body });
    const btn = w.get('[data-test="help"]');
    const tip = w.get('[data-test="help-tip"]');
    expect(btn.attributes('aria-label')).toBe('도움말: 파일 형식');
    expect(btn.attributes('aria-describedby')).toBe(tip.attributes('id'));
    expect(tip.attributes('role')).toBe('tooltip');
    expect(tip.text()).toBe('설명 글');
    expect(tip.classes()).not.toContain('open');
    await btn.trigger('focus');
    expect(tip.classes()).toContain('open');
    await btn.trigger('keydown', { key: 'Escape' });
    expect(tip.classes()).not.toContain('open');
    await w.get('.help').trigger('mouseenter');
    expect(tip.classes()).toContain('open');
    await w.get('.help').trigger('mouseleave');
    expect(tip.classes()).not.toContain('open');
    await btn.trigger('click');
    expect(tip.classes()).toContain('open');
    w.unmount();
  });
});

describe('88 · 89 · 91 연주 막대 — 진행 막대 · 재생/멈춤 · [?]', () => {
  it('진행 막대는 재생 전엔 막힘, 재생하면 [멈춤] · 멈추면 이어서 · 막대를 옮기면 그 자리로', async () => {
    const w = mount(C5PlayerBar, { props: { doc, label: '기본 국악기 구성' } });
    const seek = () => w.get('[data-test="seek"]');
    expect(seek().attributes('type')).toBe('range');
    expect(seek().attributes('disabled')).toBeDefined();
    expect(seek().attributes('aria-valuetext')).toBe('0:00 / --:--');
    await w.get('[data-test="play"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-test="play"]').text()).toContain('멈춤');
    expect(seek().attributes('disabled')).toBeUndefined();
    expect(seek().attributes('max')).toBe('48');
    await seek().setValue('12');
    expect(fake.calls).toContain('seek 12');
    expect(seek().attributes('aria-valuetext')).toBe('0:12 / 0:48');
    await w.get('[data-test="play"]').trigger('click');
    expect(fake.calls).toContain('pause');
    expect(w.get('[data-test="play"]').text()).toContain('재생');
    await w.get('[data-test="play"]').trigger('click');
    await flushPromises();
    expect(fake.calls.filter((c) => c === 'play')).toHaveLength(1);
    expect(fake.calls).toContain('resume');
    // [?] 소리 내는 방법 — 실제로 쓰는 신시사이저 · 음원
    const help = w.get('[data-test="help-tip"]').text();
    expect(help).toContain('SpessaSynth');
    expect(help).toContain('gugak.sf2');
    expect(help).toContain('FluidR3_GM.sf2');
  });
  it('3단계(show-now=false)는 "지금 연주" 줄이 없다', () => {
    const w = mount(C5PlayerBar, { props: { doc, label: '피아노 · 목소리(Voice Oohs)', showNow: false } });
    expect(w.text()).not.toContain('지금 연주');
    expect(w.text()).not.toContain('Voice Oohs');
  });
});

describe('76 공유 악보 [듣기] ↔ [멈추기]', () => {
  it('음원을 처음 불러오며 player 가 ready 를 먼저 알려도 [멈추기]가 유지되고, 누르면 멈춘다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/shared-scores?')) return json({ sort: 'likes', has_more: false, items: [{ share_no: 'S-1', title: '아리랑', score_type: 'staff', shared_at: 'x', likes: 0, liked_by_me: false }] });
      if (String(url).endsWith('/score')) return json({ share_no: 'S-1', title: '아리랑', score_type: 'staff', musicxml: '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>A</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>' });
      return json({ gugak: [], others: [], default_set: [] });
    }));
    const w = mount(SharedScoreList);
    await flushPromises();
    await w.get('[data-test="listen"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-test="listen"]').text()).toContain('멈추기');
    await w.get('[data-test="listen"]').trigger('click');
    expect(fake.calls).toContain('stop');
    expect(w.get('[data-test="listen"]').text()).toContain('듣기');
  });
});

describe('104 형식 [?] · 102 · 103 카드 문장 없음', () => {
  it('형식 고르기 옆 [?] 에 형식 설명', () => {
    const w = mount(C6DownloadCard, { props: { requestNo: 'R-1', title: '' } });
    expect(w.get('[data-test="help-tip"]').text()).toBe('MP3는 연주 음원, PDF는 인쇄용 악보, MIDI는 다른 음악 프로그램용, MusicXML은 악보 프로그램용입니다.');
    expect(w.find('.h3').exists()).toBe(false);
  });
});

describe('화면 다듬기 9차(소스 확인)', () => {
  it('77~82 1단계: 고른 쪽 갈색 · [돌아가기] · [파일 추가] · [제거하기] · "다음"', () => {
    const src = read('src/pages/S1Upload.vue');
    expect(src).toContain(`:class="examplesOpen ? 'btn-secondary' : 'btn-primary'" data-test="pick-files"`);
    expect(src).toContain(`:class="examplesOpen ? 'btn-primary' : 'btn-secondary'" data-test="examples-toggle"`);
    expect(src).toContain(`: '다음'"`);
    expect(src).not.toContain('다음 (변환 시작)\'"');
    expect(src).toContain(':quiet-reason="files.length === 0 && !chosenExample"');
  });
  it('83 글자 크기 토큰 · 84 · 85 단계 표시 · 86 로고 금색 K', () => {
    const tokens = read('src/styles/tokens.css');
    expect(tokens).toContain('--text-small: 15px;');
    expect(tokens).toContain('--text-caption: 14px;');
    expect(tokens).toContain('--text-micro: 13px;');
    expect(tokens).toContain('--color-gold: #9C7A1F;');
    expect(read('src/styles/styleguide.css')).toContain('.small { font: 450 var(--text-small)/22px var(--font-sans); }');
    const step = read('src/components/C9StepBar.vue');
    expect(step).toContain('0 0 0 6px var(--color-gold)');
    expect(step).not.toContain('var(--color-orbit)');
    expect(step).toContain('right: calc(50% + 62px); left: calc(-50% + 62px)');
    const app = read('src/App.vue');
    // (2026-10-01 203번) 로고 K 금색은 뺐다 — 로고는 logo203.test.ts
    expect(app).not.toContain('brand-k');
    expect(app).toContain('.brand { font-size: 22px; }');
  });
  it('75 · 100 악보 그리기: 원인별 사유 · OSMD 스스로 다시 그리기 끔 · 폭이 바뀌면 다시 그리고 음표 연결 새로', () => {
    const src = read('src/components/ScoreView.vue');
    expect(src).toContain('autoResize: false');
    expect(src).not.toContain('autoResize: true');
    expect(src).toContain('new ResizeObserver');
    expect(src).toMatch(/osmd\.render\(\); buildNoteMap\(\);/);
    expect(src).toContain('제한 시간(');
    expect(src).toContain('마디를 하나도 찾지 못했습니다');
    expect(src).toContain('악보 파일을 받지 못해 그리지 못했습니다');
  });
  it('87 · 105 2단계: 결과 악보 [?] 엔진 정보 · 공유는 4단계로', () => {
    const src = read('src/pages/S1Result.vue');
    expect(src).toContain('<HelpTip label="인식 엔진" :text="engineHelp" />');
    expect(noComments(src)).not.toContain('SharePanel');
    const s3 = read('src/pages/S3Download.vue');
    expect(s3).toContain('<SharePanel v-if="s && s.status === \'completed\'"');
  });
  it('90~99 3단계', () => {
    const src = read('src/pages/S2Edit.vue');
    const t = noComments(src.slice(src.indexOf('<template>'), src.indexOf('<style')));
    expect(t).toContain('악기를 바꾸고, 음을 고쳐 우리나라의 전통 악기를 즐겨보십시오.');
    expect(t).toContain(':show-now="false"');
    expect(t).not.toContain('새 악보 올리기');
    expect(t).not.toContain('big-legend');
    expect(t).not.toContain('vol-num');
    // (2026-09-30 115번) 3단계에는 악기 바꾸기 없음(2단계로 옮김)
    expect(t).not.toContain('악기 선택');
    expect(t).not.toContain("'악기 바꾸기'");
    // 98: "전체 음 반음씩 옮기기"는 악보 음표 수정(NoteInspector) 바로 다음
    expect(t.indexOf('data-test="transpose"')).toBeGreaterThan(t.indexOf('<NoteInspector'));
    expect(t.indexOf('data-test="transpose"')).toBeLessThan(t.indexOf('id="tracks-h"'));
    expect(src).toMatch(/\.track-card \{[^}]*background: var\(--color-white\)/);
    expect(src).toContain('.track-card table.spec th, .track-card table.spec td { text-align: center; }');
    const ni = read('src/components/NoteInspector.vue');
    expect(ni).toContain('<HelpTip label="악보 음표 수정" :text="KEYS_HELP" />');
    expect(noComments(ni.slice(ni.indexOf('<template>')))).not.toContain('id="note-keys"');
  });
  it('101 4단계: [메인으로 돌아가기] · 102 · 103 문장 없음', () => {
    const src = read('src/pages/S3Download.vue');
    const t = noComments(src.slice(src.indexOf('<template>')));
    expect(t).toContain('메인으로 돌아가기');
    expect(t).not.toContain('새 악보 올리기');
    expect(t).not.toContain('필요한 형식만 골라 받으십시오');
    expect(t).not.toContain('받을 형식을 골라 한 번에 받으십시오');
    expect(t).not.toContain('받을 악보:');
    expect(t).not.toContain('파일 받기 (');
    expect(t).not.toContain('MP3는 연주 음원, PDF는 인쇄용 악보');
  });
});
