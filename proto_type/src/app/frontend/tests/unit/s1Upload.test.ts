// S1 올리기 화면 — 사진 또는 PDF 한 개(2026-09-29 황송해 결정 · 사진·PDF 입력, SD_02 §4-3 · §4-4): 문구 · 받는 형식 · 예시 그림 말풍선 · 그림으로 고르기
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import S1Upload from '@/pages/S1Upload.vue';
import { ACCEPT, ACCEPT_LABEL, guessKind, kindLabel } from '@/lib/uploadKind';
import { useRequestStore } from '@/stores/request';
import errorCodes from '../../../shared/error-codes.json';

const mountPage = () => mount(S1Upload, {
  attachTo: document.body,
  global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
});

describe('uploadKind — 사진 · PDF', () => {
  it('사진 · PDF 확장자만 알아본다(MIDI · MusicXML 은 null)', () => {
    expect(guessKind('a.PNG')).toBe('image');
    expect(guessKind('a.jpeg')).toBe('image');
    expect(guessKind('a.webp')).toBe('image');
    expect(guessKind('Score.PDF')).toBe('pdf');
    for (const n of ['a.mid', 'a.midi', 'a.musicxml', 'a.xml', 'a.mxl']) expect(guessKind(n)).toBeNull();
    expect(kindLabel('pdf')).toBe('PDF');
    expect(kindLabel('image')).toBe('사진');
  });
  it('파일 고르기 창 형식 · 받는 형식 이름', () => {
    expect(ACCEPT).toContain('.png');
    expect(ACCEPT).toContain('.pdf');
    expect(ACCEPT).toContain('application/pdf');
    expect(ACCEPT).not.toMatch(/\.mid|musicxml|\.xml|\.mxl/);
    expect(ACCEPT_LABEL).toBe('PNG · JPG(JPEG) · WEBP');
  });
});

describe('S1Upload', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('설계서(SD_02 S1) 문구 — 제목 · 안내 · 받는 파일 · 조건 · 힌트, MIDI · MusicXML · 짧은 변 없음', async () => {
    const w = mountPage();
    await flushPromises();
    expect(w.get('h1').text()).toBe('국악보 사진이나 파일을 올리십시오');
    // (2026-09-30 T188 여러 쪽) SD_02 S1 올리기 도면 문구
    expect(w.get('.page-head p').text()).toBe('악보 종류를 먼저 고른 뒤 사진 여러 장이나 PDF 한 개를 올리십시오 (한 곡, 최대 10쪽)');
    // (2026-09-30 황송해) 받는 형식 · 올리기 영역 첫 줄 문구
    expect(w.get('[data-test="accepted-formats"]').text()).toBe('변환 가능한 파일 형식 : PNG · JPG(JPEG) · WEBP · PDF');
    expect(w.get('.dropzone .lead').text()).toBe('파일을 여기에 끌어 놓거나 골라 주십시오');
    // (2026-09-30 120번) "사진 크기 650px 이상" 삭제 — 작은 사진은 서버가 키워 읽는다 · (121번) 형식 안내는 고르기 버튼 줄 바로 아래
    expect(w.get('[data-test="limits"]').text()).toBe('사진 1장 20MB 이하 · PDF는 파일 20MB'); // (2026-09-30 139번)
    expect(w.get('.dropzone .row + [data-test="accepted-formats"]').exists()).toBe(true);
    expect(w.get('input[type="file"]').attributes('multiple')).toBeDefined();
    // (2026-09-30 122번) "그림에 마우스를 올리면 설명이 나옵니다" 삭제
    expect(w.find('[data-test="type-hint"]').exists()).toBe(false);
    expect(w.text()).not.toContain('650');
    expect(w.find('[data-test="jeongganbo-note"]').exists()).toBe(false); // 제목 아래 고정 설명 문단은 없앴다
    expect(w.text()).not.toMatch(/MIDI|MusicXML|짧은 변/);
    // (2026-09-30 황송해) 진행 상황(C1) · 오른쪽 숫자 칸(사진 용량 · 사진 크기 · 결과 보관)을 없앴다
    expect(w.find('.keynums').exists()).toBe(false);
    expect(w.find('[aria-label="진행 상황"]').exists()).toBe(false);
    expect(w.text()).not.toContain('사진 용량');
    expect(w.text()).not.toContain('—');
    expect(w.get('input[type="file"]').attributes('accept')).toBe(ACCEPT);
    // 종류 알약 — 설계서 순서(오선보 · 정간보), 별표 유지
    expect(w.findAll('.type-pill span').map((s) => s.text())).toEqual(['오선보', '정간보']);   // 2026-09-30 68번: * 뺌
    // 69번: "악보 종류" 제목은 없고 읽기 이름(aria-label)만
    expect(w.find('#kind-l').exists()).toBe(false);
    expect(w.get('[data-test="score-type"]').attributes('aria-label')).toBe('악보 종류');
    expect(w.text()).not.toContain('*');
    // 63번: 1단계는 [이전] 없음, [다음]이 변환 시작(파일 · 종류 전엔 막힘)
    expect(w.find('[data-test="step-prev"]').exists()).toBe(false);
    // (2026-09-30 82번) "다음 (변환 시작)" → "다음" · (81번) 파일을 고르기 전 사유 글자는 화면에 보이지 않는다(읽기 이름만)
    expect(w.get('[data-test="step-next"] button').text()).toBe('다음 →');
    expect(w.get('[data-test="step-next"] .why').classes()).toContain('sr-only');
    expect(w.get('[data-test="step-next"] button').attributes('aria-disabled')).toBe('true');
  });

  it('예시 그림에 마우스를 올리면 말풍선(role=tooltip, aria-describedby) · 떠나면 닫힘', async () => {
    const w = mountPage();
    const tipJ = w.get('[data-test="tip-jeongganbo"]');
    expect(tipJ.attributes('role')).toBe('tooltip');
    expect(tipJ.text()).toBe(`${errorCodes.status_codes.JEONGGANBO_NOTE} ${errorCodes.status_codes.JEONGGANBO_SCOPE}`); // 본문 + 보조 안내(2026-09-30)
    expect(w.get('#score-type-jeongganbo').attributes('aria-describedby')).toBe('tip-jeongganbo');
    expect(tipJ.classes()).not.toContain('open');
    await w.get('[data-test="pic-jeongganbo"]').trigger('mouseenter');
    expect(tipJ.classes()).toContain('open');
    await w.get('[data-test="type-jeongganbo"]').trigger('mouseleave');
    expect(tipJ.classes()).not.toContain('open');
    await w.get('[data-test="pic-staff"]').trigger('mouseenter');
    expect(w.get('[data-test="tip-staff"]').classes()).toContain('open');
    expect(w.get('[data-test="tip-staff"]').text()).toBe(errorCodes.status_codes.STAFF_NOTE);
  });

  it('말풍선 문구(2026-09-30 황송해) — 짧은 설명', () => {
    const w = mountPage();
    expect(w.get('[data-test="tip-staff"]').text()).toBe('오선보 : 오선 위에 음표를 그려 음의 높이와 길이를 나타내는 악보.');
    expect(w.get('[data-test="tip-jeongganbo"]').text()).toBe('정간보 : 우리 전통 음악을 적는 악보. 현재 「2021 정악보」 형식을 기준으로 인식합니다.');
  });

  // 2026-09-30 황송해: "클릭해야 말풍선이 나온다" — 알약 안의 투명 radio(.segmented input, absolute · inset:0)가
  // 기준 상자 없이 .type-opt 전체(그림 포함)를 덮어 그림의 mouseenter 가 오지 않았다. 알약을 기준 상자로 고쳤다.
  it('클릭 없이 마우스만 올려도(알약 · 그림 어디든) 말풍선이 바로 뜬다', async () => {
    const w = mountPage();
    const tip = w.get('[data-test="tip-staff"]');
    await w.get('[data-test="type-staff"]').trigger('mouseenter');
    expect(tip.classes()).toContain('open');
    expect((w.get('#score-type-staff').element as HTMLInputElement).checked).toBe(false); // 고르지는 않는다
    await w.get('[data-test="type-staff"]').trigger('mouseleave');
    expect(tip.classes()).not.toContain('open');
  });

  it('스타일 — 투명 radio 가 알약만 덮고(hover 가 그림에 닿음), 그림은 마우스 · 키보드 초점에 갈색(clay-brown)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/pages/S1Upload.vue'), 'utf8');
    const css = src.slice(src.indexOf('<style scoped>'));
    expect(css).toMatch(/\.type-pill\s*\{[^}]*position:\s*relative/);
    expect(css).toMatch(/\.type-pic:hover,\s*\.type-opt:has\(input:focus-visible\) \.type-pic\s*\{[^}]*color:\s*var\(--color-clay-brown\)[^}]*border-color:\s*var\(--color-clay-brown\)/);
    // 전역 규칙이 그대로면(.segmented input 이 absolute · inset:0) 알약에 기준 상자가 꼭 있어야 한다
    const global = readFileSync(resolve(process.cwd(), 'src/styles/styleguide.css'), 'utf8');
    expect(global).toMatch(/\.segmented input\s*\{[^}]*position:\s*absolute/);
  });

  it('키보드 초점이 가면 말풍선이 뜨고, Esc 로 닫힌다', async () => {
    const w = mountPage();
    await w.get('#score-type-staff').trigger('focus');
    expect(w.get('[data-test="tip-staff"]').classes()).toContain('open');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.get('[data-test="tip-staff"]').classes()).not.toContain('open');
  });

  it('그림을 누르면(터치 포함) 그 종류가 골라지고 설명이 열린다 · 지원 범위는 작은 보조 안내(2026-09-30 박예은)', async () => {
    const w = mountPage();
    await w.get('[data-test="pic-jeongganbo"]').trigger('click');
    expect((w.get('#score-type-jeongganbo').element as HTMLInputElement).checked).toBe(true);
    expect(w.get('[data-test="tip-jeongganbo"]').classes()).toContain('open');
    // (2026-09-30 박예은) 지원 범위는 말풍선 본문 아래 한 단계 작은 보조 안내로
    expect(w.get('[data-test="jeongganbo-scope"]').text()).toBe('현재 「2021 정악보」 형식을 기준으로 인식합니다.');
    expect(w.get('[data-test="jeongganbo-scope"]').classes()).toContain('tip-sub');
    // 고르기 칸 밖을 누르면 닫힌다(터치)
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flushPromises();
    expect(w.get('[data-test="tip-jeongganbo"]').classes()).not.toContain('open');
  });

  it.each(['song.mid', 'song.musicxml'])('%s 를 놓으면 바로 G1 형식 반려(사진·PDF 를 받는다는 안내)', async (name) => {
    const w = mountPage();
    const file = new File(['MThd'], name);
    await w.get('.dropzone').trigger('drop', { dataTransfer: { files: [file] } });
    const req = useRequestStore();
    expect(req.gate).toMatchObject({ code: 'UPLOAD_UNSUPPORTED_TYPE', gate: 'G1', reason: '받을 수 없는 파일 형식입니다.' });
    expect(req.gate!.fix).toContain('사진');
    expect(req.gate!.fix).toContain('PDF');
    expect(w.find('.picked').exists()).toBe(false);
  });

  it('PDF 를 놓으면 받고 종류 칩은 "PDF"', async () => {
    const w = mountPage();
    const file = new File(['%PDF-1.7'], 'score.pdf', { type: 'application/pdf' });
    await w.get('.dropzone').trigger('drop', { dataTransfer: { files: [file] } });
    expect(useRequestStore().gate).toBeNull();
    expect(w.get('[data-test="kind-chip"]').text()).toBe('PDF');
    expect(w.get('.picked').text()).toContain('score.pdf');
  });

  // T188 (2026-09-30 여러 쪽, SD_02 S1 올리기 도면 · §4-4): 사진 여러 장 · 쪽 목록 · [빼기]
  const png = (name: string) => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });
  const drop = async (w: ReturnType<typeof mountPage>, files: File[]) => {
    await w.get('.dropzone').trigger('drop', { dataTransfer: { files } });
    await flushPromises();
  };
  const rows = (w: ReturnType<typeof mountPage>) => w.findAll('[data-test="page-row"]').map((r) => r.findAll('th, td').slice(0, 2).map((c) => c.text()));

  it('사진 여러 장을 끌어 놓거나 나눠 더하면 쪽 목록에 올린 순서대로 · [빼기]로 빼면 번호를 다시 매긴다', async () => {
    const w = mountPage();
    await drop(w, [png('page1.png'), png('page2.png')]);
    await drop(w, [png('page3.png')]);
    expect(useRequestStore().gate).toBeNull();
    expect(w.find('[data-test="kind-chip"]').exists()).toBe(false);
    expect(w.get('[data-test="page-list"] thead').text()).toBe('순서파일사진 크기빼기');
    expect(w.get('[data-test="page-list"] caption').text()).toContain('3/10쪽');
    expect(rows(w).map((r) => r[0])).toEqual(['1쪽', '2쪽', '3쪽']);
    expect(rows(w).map((r) => r[1].split(' ')[0])).toEqual(['page1.png', 'page2.png', 'page3.png']);
    // 사진 크기는 브라우저가 잰다(jsdom 은 못 재서 '알 수 없음')
    expect(w.findAll('[data-test="page-row"] td')[1].text()).toBe('알 수 없음');
    await w.findAll('[data-test="remove-page"]')[1].trigger('click');
    expect(rows(w).map((r) => `${r[0]} ${r[1].split(' ')[0]}`)).toEqual(['1쪽 page1.png', '2쪽 page3.png']);
    expect(w.get('[data-test="remove-page"]').attributes('aria-label')).toBe('1쪽 page1.png 빼기');
    // (2026-09-30 황송해 78 · 79 · 107번) 버튼 이름: [-] · [돌아가기] · [파일 추가]([제거하기]는 [돌아가기]로 합침), 칸 머리 '빼기'
    expect(w.get('[data-test="remove-page"]').text()).toBe('-');
    expect(w.get('[data-test="go-back"]').text()).toBe('돌아가기');
    expect(w.get('[data-test="add-photos"]').text()).toBe('파일 추가');
    expect(w.find('[data-test="remove-files"]').exists()).toBe(false);
    expect(w.text()).not.toMatch(/악보 추가|다른 악보/);
    expect(w.text()).not.toMatch(/사진 더하기|다른 파일 고르기/);
  });

  it('[변환 시작] 은 사진을 올린 순서대로 file 여러 개로 보낸다', async () => {
    const w = mountPage();
    await drop(w, [png('b.png'), png('a.png')]);
    await w.get('#score-type-staff').setValue(true);
    const store = useRequestStore();
    const spy = vi.spyOn(store, 'upload').mockResolvedValue(true);
    await w.get('[data-test="step-next"] button').trigger('click');
    expect(spy).toHaveBeenCalledTimes(1);
    const [sent, type] = spy.mock.calls[0];
    expect((sent as File[]).map((f) => f.name)).toEqual(['b.png', 'a.png']);
    expect(type).toBe('staff');
  });

  it('PDF 와 사진 섞기 · PDF 두 개 → UPLOAD_TOO_MANY_FILES, 11장 → UPLOAD_TOO_MANY_PAGES (고른 목록은 그대로)', async () => {
    const w = mountPage();
    const store = useRequestStore();
    await drop(w, [png('p1.png')]);
    await drop(w, [new File(['%PDF'], 's.pdf')]);
    expect(store.gate).toMatchObject({ code: 'UPLOAD_TOO_MANY_FILES', gate: 'G1', reason: errorCodes.gate_codes.UPLOAD_TOO_MANY_FILES.message });
    expect(rows(w).length).toBe(1);
    await drop(w, Array.from({ length: 10 }, (_, i) => png(`q${i}.png`)));
    expect(store.gate).toMatchObject({ code: 'UPLOAD_TOO_MANY_PAGES', reason: '한 번에 10쪽까지 올릴 수 있습니다.' });
    expect(rows(w).length).toBe(1);
    // 목록을 고치면(더하기 성공) 반려 안내가 사라진다
    await drop(w, [png('p2.png')]);
    expect(store.gate).toBeNull();
    expect(rows(w).length).toBe(2);
  });

  it('서버가 2쪽 사진 크기로 반려하면 "2쪽(파일 이름)" 을 사유에 붙이고, 그 쪽을 빼면 반려가 풀린다', async () => {
    const w = mountPage();
    await drop(w, [png('page1.jpg'), png('page2.jpg')]);
    await w.get('#score-type-staff').setValue(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'UPLOAD_RESOLUTION_TOO_LOW', message: '더 선명한 사진이 필요합니다.', gate: 'G1', retry_after: null,
      details: { page: 2, min_short_edge_px: 650, actual_short_edge_px: 600 } } }), { status: 422, headers: { 'Content-Type': 'application/json' } })));
    await w.get('[data-test="step-next"] button').trigger('click');
    await flushPromises();
    const store = useRequestStore();
    expect(store.gate?.reason).toBe('2쪽(page2.jpg) 해상도가 너무 낮습니다 (사진 크기 600px, 기준 650px)');
    await w.findAll('[data-test="remove-page"]')[1].trigger('click');
    expect(store.gate).toBeNull();
    expect(rows(w).length).toBe(1);
  });
});

describe('S1Upload [예시 파일 고르기](2026-09-30 황송해, SD_02 ㊹ · 72번 서버 전용 폴더)', () => {
  beforeEach(() => { setActivePinia(createPinia()); });
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  it('예시를 고르면 원본을 받지 않고 이름만 보이며, [다음]은 예시 id 로 접수한다(정간보)', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (url === '/api/examples') return json({ items: [
        { id: 'arirang-semachi-staff', title: '아리랑 세마치 (오선보)', score_type: 'staff' },
        { id: 'doraji-jeongganbo', title: '도라지 (정간보)', score_type: 'jeongganbo' }] });
      if (url === '/api/requests/example') return json({ id: 'R-0930-EXAMPLE1', status: 'queued', route: 'recognize', score_type: 'jeongganbo' }, 202);
      return json({ models: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const w = mountPage();
    await flushPromises();
    expect(w.find('[data-test="example-list"]').exists()).toBe(false);
    await w.get('[data-test="examples-toggle"]').trigger('click');
    await flushPromises();
    // (2026-09-30 189번) 카드 이름은 화면에서만 괄호 부분을 뗀다 · 오선보/정간보 묶음, 묶음 아래 이름표
    expect(w.get('[data-test="example-doraji-jeongganbo"]').text()).toBe('도라지');
    expect(w.get('[data-test="example-list"]').text()).not.toContain('도라지 (정간보)');
    const groups = w.findAll('[role="group"][aria-label]').filter((g) => g.attributes('data-test')?.startsWith('example-group-'));
    expect(groups.map((g) => g.attributes('aria-label'))).toEqual(['오선보', '정간보']);
    expect(groups[1].find('[data-test="example-doraji-jeongganbo"]').exists()).toBe(true);
    expect(groups[0].find('[data-test="example-arirang-semachi-staff"]').exists()).toBe(true);
    const g0 = groups[0].html();
    expect(g0.indexOf('example-group-label')).toBeGreaterThan(g0.indexOf('example-arirang-semachi-staff')); // 이름표는 묶음 아래
    expect(groups[0].get('.example-group-label').text()).toBe('오선보');
    expect(w.get('[data-test="example-arirang-semachi-staff"] img').attributes('src')).toBe('/api/examples/arirang-semachi-staff/thumb');
    await w.get('[data-test="example-doraji-jeongganbo"]').trigger('click');
    await flushPromises();
    expect(calls.some((c) => c.url.startsWith('/examples/') || /\.(png|jpe?g)$/.test(c.url))).toBe(false);
    expect((w.get('#score-type-jeongganbo').element as HTMLInputElement).checked).toBe(true);
    expect(w.get('[data-test="example-picked"]').text()).toContain('도라지'); // 193번: 괄호 뗌
    expect(w.get('[data-test="example-picked"]').text()).not.toContain('(정간보)');
    expect(w.find('[data-test="example-list"]').exists()).toBe(false);
    // (2026-10-01 217번) 고른 예시 그림 카드 하나만 · [-] 없음 · [돌아가기]는 그대로
    expect(w.get('[data-test="example-picked"] img').attributes('src')).toBe('/api/examples/doraji-jeongganbo/thumb');
    expect(w.findAll('.example-card').length).toBe(0);
    expect(w.find('[data-test="remove-example"]').exists()).toBe(false);
    expect(w.find('[data-test="go-back"]').exists()).toBe(true);
    await w.get('[data-test="step-next"] button').trigger('click');
    await flushPromises();
    const post = calls.find((c) => c.url === '/api/requests/example');
    expect(post).toBeTruthy();
    expect(JSON.parse(String(post!.init!.body))).toEqual({ example_id: 'doraji-jeongganbo', score_type: 'jeongganbo' });
    expect(useRequestStore().status?.id).toBe('R-0930-EXAMPLE1');
  });
  it('예시 목록을 받지 못하면 안내한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/examples' ? json({ error: { code: 'X' } }, 500) : json({ models: [] }))));
    const w = mountPage();
    await flushPromises();
    await w.get('[data-test="examples-toggle"]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('예시 목록을 받지 못했습니다');
  });
});
