// 공유 악보 · 좋아요 화면 (2026-09-30 황송해 — design/UC_18 UC18 · UC19 · SD_02 §4-6 · §10B)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const fakePlayer = vi.hoisted(() => ({ played: 0, stopped: 0, on: () => () => {}, stop() { this.stopped++; }, async play() { this.played++; return true; } }));
vi.mock('@/player/player', () => ({ player: fakePlayer }));
vi.mock('@/lib/scoreCore', () => ({ parseMusicXml: () => ({ ppq: 480, tempoBpm: 100, timeSignature: { beats: 4, beatType: 4 }, keyFifths: 0, parts: [] }) }));

import SharePanel from '@/components/SharePanel.vue';
import SharedScoreList from '@/components/SharedScoreList.vue';
import S8SharedScores from '@/admin/pages/S8SharedScores.vue';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => { setActivePinia(createPinia()); fakePlayer.played = 0; fakePlayer.stopped = 0; });
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('SharePanel — 모두에게 공유(S1 결과)', () => {
  it('기본은 공유 안 함 · 제목 없으면 막음 · 공유하면 "모두에게 공유했습니다" · [공유 거두기]', async () => {
    const calls: [string, string][] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([init?.method ?? 'GET', String(url)]);
      if (init?.method === 'PUT') return json({ shared: true, share_no: 'S-0930-AAAA2222', title: JSON.parse(String(init.body)).title, shared_at: 'x', taken_down: false });
      if (init?.method === 'DELETE') return json({ shared: false });
      return json({ shared: false });
    }));
    const w = mount(SharePanel, { props: { requestNo: 'R-1' } });
    await flushPromises();
    // (2026-09-30 143 · 144번) 황송해 님 지정 문구
    expect(w.get('#share-h').text()).toBe('제작한 악보를 다른 사람들에게 공유해보아요.');
    expect(w.get('[data-test="share-note"]').text()).toBe('공유된 악보는 공유게시판에 3일간 저장됩니다. 올린 사람의 이름과 개인정보는 보이지 않으니 안심하세요.');
    await w.get('[data-test="share"]').trigger('click');
    expect(w.text()).toContain('제목을 적어 주십시오.');
    expect(calls.some(([m]) => m === 'PUT')).toBe(false);
    await w.get('[data-test="share-title"]').setValue('아리랑');
    await w.get('[data-test="share"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-test="share-done"]').text()).toBe('모두에게 공유했습니다: 아리랑');
    await w.get('[data-test="unshare"]').trigger('click');
    await flushPromises();
    expect(calls.map(([m, u]) => `${m} ${u}`)).toEqual(['GET /api/requests/R-1/share', 'PUT /api/requests/R-1/share', 'DELETE /api/requests/R-1/share']);
    expect(w.find('[data-test="share-done"]').exists()).toBe(false);
    expect(w.text()).not.toContain('—');
  });
  it('보관 기간이 지나면 공유할 수 없다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ shared: false })));
    const w = mount(SharePanel, { props: { requestNo: 'R-1', expired: true } });
    await flushPromises();
    expect(w.get('[data-test="share"]').attributes('aria-disabled')).toBe('true');
    expect(w.text()).toContain('보관 기간이 지나 공유할 수 없습니다.');
  });
});

describe('SharedScoreList — 공유 악보 목록(S1 아래)', () => {
  const list = { sort: 'likes', has_more: false, items: [
    { share_no: 'S-1', title: '아리랑', score_type: 'staff', shared_at: 'x', expires_at: new Date(Date.now() + 2.5 * 86_400_000).toISOString(), likes: 3, liked_by_me: false },
    { share_no: 'S-2', title: '도라지', score_type: 'jeongganbo', shared_at: 'x', likes: 1, liked_by_me: true },
  ] };
  it('제목 · 종류 · 좋아요 · 듣기, 정렬 바꾸기, 좋아요 누르기, 듣기(기본 국악기로 연주)', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(`${init?.method ?? 'GET'} ${url}`);
      if (String(url).startsWith('/api/shared-scores?')) return json(list);
      if (String(url).endsWith('/like')) return json({ liked: true, likes: 4 });
      if (String(url).endsWith('/score')) return json({ share_no: 'S-1', title: '아리랑', score_type: 'staff', musicxml: '<score-partwise/>' });
      return json({ gugak: [], others: [], default_set: [] });
    }));
    const w = mount(SharedScoreList);
    await flushPromises();
    const rows = w.findAll('[data-test="shared-row"]');
    expect(rows.map((r) => r.find('th').text())).toEqual(['아리랑3일 남음', '도라지']);
    expect(rows[0].get('[data-test="days-left"]').text()).toBe('3일 남음');
    expect(rows[1].text()).toContain('정간보');
    expect(rows[1].get('[data-test="like"]').attributes('aria-pressed')).toBe('true');
    expect(urls).toContain('GET /api/shared-scores?sort=likes&limit=4&offset=0');
    await w.get('[data-test="sort-recent"]').trigger('change');
    await flushPromises();
    expect(urls).toContain('GET /api/shared-scores?sort=recent&limit=4&offset=0');
    await w.findAll('[data-test="like"]')[0].trigger('click');
    await flushPromises();
    expect(w.findAll('[data-test="like"]')[0].text()).toContain('♥ 4');
    await w.findAll('[data-test="listen"]')[0].trigger('click');
    await flushPromises();
    expect(fakePlayer.played).toBe(1);
    expect(w.findAll('[data-test="listen"]')[0].text()).toContain('멈추기');
    expect(w.text()).not.toMatch(/R-\d|@/);
  });
  it('공유 악보가 없으면 안내', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ sort: 'likes', items: [], has_more: false })));
    const w = mount(SharedScoreList);
    await flushPromises();
    expect(w.get('[data-test="shared-empty"]').text()).toBe('아직 공유된 악보가 없습니다.');
  });
});

describe('S8 공유 악보 관리(관리자)', () => {
  it('목록 · 상태 · [내리기](사유 · 확인 창) · [다시 올리기]', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}${init?.body ? ` ${init.body}` : ''}`);
      if (String(url).startsWith('/admin/shared-scores?')) return json({ items: [
        { share_no: 'S-1', title: '아리랑', score_type: 'staff', shared_at: '2026-09-30T01:00:00Z', likes: 2, status: 'visible', taken_down_at: null, take_down_reason: null },
        { share_no: 'S-2', title: '도라지', score_type: 'jeongganbo', shared_at: '2026-09-30T01:00:00Z', likes: 0, status: 'taken_down', taken_down_at: 'x', take_down_reason: '시험' },
      ] });
      return json({ share_no: 'S-1', status: 'taken_down' });
    }));
    const w = mount(S8SharedScores, { attachTo: document.body });
    await flushPromises();
    expect(w.findAll('[data-test="shared-admin-row"]')).toHaveLength(2);
    expect(w.text()).toContain('내림');
    await w.get('[data-test="take-down"]').trigger('click');
    await w.get('[data-test="take-down-reason"]').setValue('부적절');
    const ok = w.findAll('button').find((b) => b.text() === '내리기' && b.classes().includes('btn-primary'))!;
    await ok.trigger('click');
    await flushPromises();
    expect(calls).toContain('POST /admin/shared-scores/S-1/take-down {"reason":"부적절"}');
    await w.get('[data-test="restore"]').trigger('click');
    await flushPromises();
    expect(calls).toContain('POST /admin/shared-scores/S-2/restore {}');
    w.unmount();
  });
});
