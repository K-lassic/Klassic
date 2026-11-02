// 화면 다듬기 10차 (2026-09-30 황송해 결정 106~116, SD_02 머리말 · UC_18 기본흐름 5)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fake = vi.hoisted(() => ({
  state: 'idle', base: 'gugak', rate: 1, position: 0, duration: 0,
  on() { return () => {}; }, stop() {}, async play() { return true; }, pause() {}, async resume() { return true; }, seek() {}, setRate() {},
}));
vi.mock('@/player/player', () => ({ player: fake, PLAYBACK_RATE_MIN: 0.5, PLAYBACK_RATE_MAX: 2, PLAYBACK_BASE_BPM: 100 }));

import SharedScoreList from '@/components/SharedScoreList.vue';
import C5PlayerBar from '@/components/C5PlayerBar.vue';
import { useRequestStore } from '@/stores/request';
import type { ScoreDoc } from '@/types/score';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const noComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/[^\n]*/g, '');

beforeEach(() => { setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; document.body.className = ''; });

describe('108 · 109 악보 공유하기 · [이 악보로 작업하기]', () => {
  const list = { sort: 'likes', has_more: false, items: [{ share_no: 'S-1', title: '아리랑', score_type: 'staff', shared_at: 'x', likes: 0, liked_by_me: false }] };
  it('제목 "악보 공유하기" · 누르면 공유 번호로 새 요청을 만들고 요청 상태 · 악보를 받는다', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (String(url).startsWith('/api/shared-scores?')) return json(list);
      if (url === '/api/shared-scores/S-1/use') return json({ id: 'R-0930-NEW00001', status: 'completed', route: 'direct', file_kind: 'musicxml', from_shared: true }, 202);
      if (url === '/api/requests/R-0930-NEW00001/score') return json({ scoredoc: { parts: [] }, musicxml: '<score-partwise/>' });
      return json({ gugak: [], others: [], default_set: [] });
    }));
    const w = mount(SharedScoreList);
    await flushPromises();
    expect(w.get('#shared-h').text()).toBe('악보 공유하기');
    expect(w.get('thead').text()).toContain('작업');
    await w.get('[data-test="work"]').trigger('click');
    await flushPromises();
    expect(calls).toContain('POST /api/shared-scores/S-1/use');
    expect(calls).toContain('GET /api/requests/R-0930-NEW00001/score');
    const req = useRequestStore();
    expect(req.status?.id).toBe('R-0930-NEW00001');
    expect(req.status?.from_shared).toBe(true);
  });
  it('정리 · 거둔 공유 악보(404)는 안내하고 목록을 새로 부른다', async () => {
    let listCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/shared-scores?')) { listCalls++; return json(list); }
      if (url === '/api/shared-scores/S-1/use') return json({ error: { code: 'REQUEST_NOT_FOUND', message: '없음' } }, 404);
      return json({ gugak: [], others: [], default_set: [] });
    }));
    const w = mount(SharedScoreList);
    await flushPromises();
    await w.get('[data-test="work"]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('이 공유 악보는 더 이상 쓸 수 없습니다');
    expect(listCalls).toBe(2);
    expect(useRequestStore().status).toBeNull();
  });
});

describe('111 연주 막대 아래 고정', () => {
  it('dock 이면 고정 막대 · body 아래 여백 표시(떠나면 지움)', () => {
    const w = mount(C5PlayerBar, { props: { doc: { parts: [] } as unknown as ScoreDoc, label: '', dock: true } });
    expect(w.get('[data-test="player"]').classes()).toContain('dock');
    expect(document.body.classList.contains('has-dock')).toBe(true);
    w.unmount();
    expect(document.body.classList.contains('has-dock')).toBe(false);
    expect(read('src/app.css')).toContain('body.has-dock #app > .footer { padding-bottom: calc(var(--spacing-24) + 112px); }'); // 162번: 여백은 바닥글 안
    expect(read('src/components/C5PlayerBar.vue')).toMatch(/\.player\.dock \{\s*position: fixed;/);
  });
});

describe('소스 확인', () => {
  it('107 [돌아가기] 하나로', () => {
    const t = noComments(read('src/pages/S1Upload.vue'));
    expect(t).toContain('data-test="go-back"');
    expect(t).not.toContain('제거하기');
  });
  it('112 · 113 2단계: 악기 선택 · 재생 빠르기 · 고정 막대 · 받기 카드 없음 · 편집 기록으로 3 · 4단계에 이어짐', () => {
    const src = read('src/pages/S1Result.vue');
    const t = noComments(src.slice(src.indexOf('<template>')));
    expect(t).toContain('data-test="step2-tracks"');
    expect(t).toContain('<C4InstrumentPicker');
    expect(t).toMatch(/<C5PlayerBar[\s\S]*?dock/);
    expect(t).not.toContain(':show-rate="false"');
    expect(t).not.toContain('<C6DownloadCard');
    expect(src).toContain("await ed.pushMany(ops)");
    expect(src).toContain('applyOps(baseDoc.value, ed.ops)');
  });
  it('114 · 115 3단계: 기준 악보 = 결과 + 기본 국악기(목소리 이름 없음) · 악기 바꾸기 없음 · 고정 막대', () => {
    const src = read('src/pages/S2Edit.vue');
    expect(src).toContain('try { return applyDefaultEnsemble(base, inst.catalog); } catch { return base; }');
    expect(src).not.toContain('if (!ed.isEdited) return req.score?.musicxml');
    const t = noComments(src.slice(src.indexOf('<template>')));
    expect(t).not.toContain('C4InstrumentPicker');
    expect(t).not.toContain('변경할 악기');
    expect(t).toMatch(/:show-now="false" :tempo-rate="tempoRate" dock/); // (135 · 161번) 3단계에도 재생 빠르기, 편집 기록과 이어짐
    const s3 = read('src/pages/S3Download.vue');
    expect(s3).toContain('base = applyDefaultEnsemble(raw, inst.catalog)');
  });
  it('116 악보 음표 수정 [?] 에 쓰는 도구', () => {
    const ni = read('src/components/NoteInspector.vue');
    expect(ni).toMatch(/KEYS_HELP = '[^']*OpenSheetMusicDisplay[^']*score-core[^']*SpessaSynth/);
  });
});
