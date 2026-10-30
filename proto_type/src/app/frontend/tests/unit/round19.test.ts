// 173~179 (2026-09-30 황송해 결정 — SD_02 머리말 · §4-3 · §4-6 · §7-1 · §9B · UC_07 A9 · A10 · UC_06 A8 · UC_18 · 스타일가이드 §3-4)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import MyScoresList from '@/components/MyScoresList.vue';
import SharedScoreList from '@/components/SharedScoreList.vue';
import { setAutosaveBackend, useEditorStore } from '@/stores/editor';
import { memoryBackend } from '@/stores/autosaveBackend';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const tpl = (p: string) => read(p).split('<template>').slice(1).join('<template>').split('<style')[0].replace(/<!--[\s\S]*?-->/g, '');
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const item = (n: number, extra: Record<string, unknown> = {}) => ({ id: `R-${n}`, title: `곡 ${n}`, file_name: 'a.png', score_type: 'staff', created_at: '2026-09-30T05:02:00Z', expires_at: 'x', remaining_seconds: 3600 * 5, edited: false, edit_ops: null, midi_available: true, fallback: false, ...extra });

let mem: ReturnType<typeof memoryBackend>;
beforeEach(() => { setActivePinia(createPinia()); mem = memoryBackend(); setAutosaveBackend(mem); });
afterEach(() => { vi.unstubAllGlobals(); setAutosaveBackend(null); document.body.innerHTML = ''; });

function makeRouter() {
  return createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', name: 'home', component: { template: '<div />' } },
    { path: '/r/:requestNo/listen', name: 'listen', component: { template: '<div />' } },
  ] });
}

describe('173 · 174 큰 눈썹 제목', () => {
  it('S4-A: 제목 문장 없음 · "API활용" 눈썹이 h1 · 로그인도 같은 클래스 · 스타일가이드 클래스 하나', () => {
    const a = tpl('src/pages/S4AApiGuide.vue');
    expect(a).not.toContain('내 프로그램에서 국악보 인식');
    expect(a).toContain('<h1 class="eyebrow eyebrow-title">API활용</h1>');
    const l = tpl('src/pages/S0Login.vue');
    expect(l).toContain('<h1 v-if="tab === \'login\'" class="eyebrow eyebrow-title">로그인</h1>');
    expect(l).toContain('<span class="eyebrow eyebrow-title">가입하기</span>');
    expect(read('src/styles/styleguide.css')).toContain('.eyebrow.eyebrow-title { font: 700 28px/1.2 var(--font-sans);');
    // 원본 design/ 이 없으면(제출물처럼 app 만 있을 때) app/docs/reference 사본 — 2026-10-01
    const guide = ['../../design/style-guide/스타일가이드_mastercard.html', '../docs/reference/style-guide/스타일가이드_mastercard.html']
      .find((p) => existsSync(resolve(process.cwd(), p)))!;
    expect(read(guide)).toContain('.eyebrow.eyebrow-title');
  });
});

describe('175 바닥글', () => {
  it('링크 · 24시간 문장 · 3팀 없음, Klassic · 음원 출처(MIT) 그대로', () => {
    const f = tpl('src/App.vue').split('<footer')[1];
    for (const gone of ['악보 올리기', 'API활용', '24시간', '3팀', 'RouterLink']) expect(f).not.toContain(gone);
    expect(f).toContain('Klassic');
    expect(f).toContain('FluidR3_GM (Frank Wen, MIT 라이선스)');
    expect(f).toContain('공공누리 제1유형');
  });
});

describe('176~178 내가 만든 악보', () => {
  it('4개씩 쪽 나누기 · 쪽 넘기기(aria-current) · 5개 이상일 때만', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [1, 2, 3, 4, 5, 6].map((n) => item(n)) })));
    const w = mount(MyScoresList, { global: { plugins: [makeRouter()] } });
    await flushPromises();
    expect(w.findAll('[data-test="my-row"]').map((r) => r.find('th').text())).toEqual(['곡 1', '곡 2', '곡 3', '곡 4']);
    expect(w.get('[data-test="page-1"]').attributes('aria-current')).toBe('page');
    expect(w.get('[data-test="page-prev"]').attributes('disabled')).toBeDefined();
    await w.get('[data-test="page-next"]').trigger('click');
    expect(w.findAll('[data-test="my-row"]').map((r) => r.find('th').text())).toEqual(['곡 5', '곡 6']);
    expect(w.get('[data-test="page-2"]').attributes('aria-current')).toBe('page');
    expect(w.get('[data-test="page-next"]').attributes('disabled')).toBeDefined();
  });
  it('4개 이하면 쪽 넘기기 없음', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [1, 2, 3, 4].map((n) => item(n)) })));
    const w = mount(MyScoresList, { global: { plugins: [makeRouter()] } });
    await flushPromises();
    expect(w.find('[data-test="page-nav"]').exists()).toBe(false);
  });
  it('[제거] → 확인 창(합쇼체) → DELETE · 목록에서 빠짐 · 기기 자동 저장본도 지움, [취소]면 그대로', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return json({ items: [item(1), item(2)] });
    }));
    await mem.put({ request_no: 'R-1', ops: [{ op: 'transpose', semitones: 1 }], listen_mode: 'edit', saved_at: new Date().toISOString() });
    const w = mount(MyScoresList, { attachTo: document.body, global: { plugins: [makeRouter()] } });
    await flushPromises();
    await w.findAll('[data-test="my-remove"]')[0].trigger('click');
    expect(w.get('[role="dialog"]').text()).toContain('이 악보를 지우시겠습니까?');
    expect(w.get('[role="dialog"]').text()).toContain('바로 지워지고 되살릴 수 없습니다.');
    await w.get('[data-test="leave-cancel"]').trigger('click');
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(false);
    await w.findAll('[data-test="my-remove"]')[0].trigger('click');
    expect(w.get('[data-test="leave-ok"]').text()).toBe('지우기');
    await w.get('[data-test="leave-ok"]').trigger('click');
    await flushPromises();
    expect(calls).toContain('DELETE /api/my-scores/R-1');
    expect(w.findAll('[data-test="my-row"]').map((r) => r.find('th').text())).toEqual(['곡 2']);
    expect(w.get('[data-test="my-notice"]').text()).toBe('"곡 1" 악보를 지웠습니다.');
    expect(mem.data.has('R-1')).toBe(false);
    w.unmount();
  });
  it('[편집하기] → 2단계로(184번), 기기 저장본이 없으면 서버 편집 기록으로 · 복원 질문 없음', async () => {
    const serverOps = [{ op: 'transpose', semitones: 2 }];
    const ls = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => { ls.set(k, v); }, removeItem: (k: string) => { ls.delete(k); } });
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [item(1, { edited: true, edit_ops: serverOps })] })));
    const router = makeRouter();
    const w = mount(MyScoresList, { global: { plugins: [router] } });
    await flushPromises();
    await w.get('[data-test="my-edit"]').trigger('click');
    await flushPromises();
    // (184번) 2단계(/?r=)로 · 판별 화면 건너뜀
    expect(router.currentRoute.value.name).toBe('home');
    expect(router.currentRoute.value.query.r).toBe('R-1');
    expect(ls.get('gugak.accept.R-1')).toBe('1');
    const ed = useEditorStore();
    expect(ed.ops).toEqual(serverOps);
    expect(await ed.open('R-1')).toBeNull(); // 편집 화면이 열어도 복원 질문 없음
    expect(ed.ops).toEqual(serverOps);
    expect(mem.data.get('R-1')?.ops).toEqual(serverOps);
  });
  it('[편집하기] — 이 기기 자동 저장본이 있으면 그것(더 최근)', async () => {
    const local = [{ op: 'transpose', semitones: -1 }];
    await mem.put({ request_no: 'R-1', ops: local as never, listen_mode: 'edit', saved_at: new Date().toISOString() });
    const ed = useEditorStore();
    await ed.resume('R-1', [{ op: 'transpose', semitones: 2 }] as never);
    expect(ed.ops).toEqual(local);
    expect(ed.pendingRestore).toBeNull();
  });
});

describe('179 악보 공유하기 4개씩', () => {
  it('limit=4 · 쪽 넘기기(다음 쪽은 offset=4) · [더 보기] 없음', async () => {
    const urls: string[] = [];
    const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ share_no: `S-${from + i}`, title: `공유 ${from + i}`, score_type: 'staff', shared_at: 'x', expires_at: null, likes: 0, liked_by_me: false }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('offset=4')) return json({ sort: 'likes', items: rows(5, 2), has_more: false });
      if (url.includes('/api/shared-scores?')) return json({ sort: 'likes', items: rows(1, 4), has_more: true });
      return json({ items: [] });
    }));
    const w = mount(SharedScoreList);
    await flushPromises();
    expect(urls).toContain('/api/shared-scores?sort=likes&limit=4&offset=0');
    expect(w.findAll('[data-test="shared-row"]')).toHaveLength(4);
    expect(w.find('[data-test="more"]').exists()).toBe(false);
    expect(w.get('[data-test="page-1"]').attributes('aria-current')).toBe('page');
    await w.get('[data-test="page-next"]').trigger('click');
    await flushPromises();
    expect(urls).toContain('/api/shared-scores?sort=likes&limit=4&offset=4');
    expect(w.findAll('[data-test="shared-row"]').map((r) => r.find('th').text())).toEqual(['공유 5', '공유 6']);
    expect(w.get('[data-test="page-2"]').attributes('aria-current')).toBe('page');
    expect(w.get('[data-test="page-next"]').attributes('disabled')).toBeDefined();
    await w.get('[data-test="page-1"]').trigger('click');
    await flushPromises();
    expect(w.findAll('[data-test="shared-row"]')).toHaveLength(4);
  });
});

describe('180 · 181 (2026-09-30 황송해)', () => {
  it('180 · 190 공유 악보로 만든 항목(오면)에는 [제거] 없음 · "공유 악보에서" 표시 없음, 내 악보에는 있음 · 악보 공유하기 목록엔 [제거] 없음', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [item(1), item(2, { from_shared: true })] })));
    const w = mount(MyScoresList, { global: { plugins: [makeRouter()] } });
    await flushPromises();
    const rows = w.findAll('[data-test="my-row"]');
    expect(rows[0].find('[data-test="my-remove"]').exists()).toBe(true);
    expect(rows[1].find('[data-test="my-remove"]').exists()).toBe(false);
    expect(w.find('[data-test="my-from-shared"]').exists()).toBe(false); // 190번: "공유 악보에서" 표시는 없앰(서버가 목록에서 뺌)
    expect(rows[1].find('[data-test="my-edit"]').exists()).toBe(true);
    expect(tpl('src/components/SharedScoreList.vue')).not.toContain('제거');
  });
  it('181 로그인 입력칸 세로(레이블 : 입력칸 한 줄씩) — 가입도 같은 배치', () => {
    const src = read('src/pages/S0Login.vue');
    expect(tpl('src/pages/S0Login.vue')).toContain('<div class="fields rows">');
    expect(src).toContain('.form-band .fields.rows { grid-template-columns: 1fr;');
    expect(src).toContain('.rows .field { display: grid; grid-template-columns: 150px minmax(0, 1fr); align-items: center;');
  });
});

describe('185 · 186 (2026-09-30 황송해)', () => {
  it('[저장하기] · 카드 제목 "(곡) 저장하기" · "편집" 칸 없음 · "공유 악보에서" 없음(190)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [item(1, { edited: true }), item(2, { from_shared: true })] })));
    const w = mount(MyScoresList, { global: { plugins: [makeRouter()] } });
    await flushPromises();
    expect(w.findAll('thead th').map((t) => t.text())).toEqual(['곡', '만든 시각', '남은 시간', '작업']);
    expect(w.text()).not.toContain('편집본');
    const btn = w.findAll('[data-test="my-download"]')[0];
    expect(btn.text()).toBe('저장하기');
    expect(btn.attributes('aria-label')).toBe('곡 1 저장하기');
    await btn.trigger('click');
    expect(w.get('[data-test="save-title"]').text()).toBe('곡 1 저장하기');
    expect(w.text()).not.toContain('공유 악보에서'); // 190번
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
    expect(read('src/components/MyScoresList.vue')).toContain('thead th { text-align: center; }');
    expect(read('src/components/SharedScoreList.vue')).toContain('thead th { text-align: center; }');
    expect(read('src/pages/S1Upload.vue')).toContain('.table-scroll thead th { text-align: center; }');
  });
  it('192 예시로 올린 것은 예시 이름(괄호 뗌)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [item(1, { title: '아리랑 세마치 (오선보)', from_example: true }), item(2, { title: 'a (1).png' })] })));
    const w = mount(MyScoresList, { global: { plugins: [makeRouter()] } });
    await flushPromises();
    expect(w.findAll('[data-test="my-row"] th').map((t) => t.text())).toEqual(['아리랑 세마치', 'a (1).png']);
    expect(w.findAll('[data-test="my-download"]')[0].attributes('aria-label')).toBe('아리랑 세마치 저장하기');
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
