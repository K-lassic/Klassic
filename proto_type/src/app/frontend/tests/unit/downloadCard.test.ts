// C6 내려받기 카드(2026-09-30 황송해 결정, SD_02 §3-7) — 형식 토글 여러 개 · [고른 파일 받기] 한 번 · 형식마다 따로 받기
// 나가기 확인 창(SD_02 §4-4 · §5-3 · §6-3) — [새 악보 올리기]
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import C6DownloadCard from '@/components/C6DownloadCard.vue';
import LeaveConfirm from '@/components/LeaveConfirm.vue';
import errorCodes from '../../../shared/error-codes.json';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('C6DownloadCard', () => {
  let clicked: string[];
  beforeEach(() => {
    vi.useFakeTimers();
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.getAttribute('href') ?? ''); });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('형식을 고르지 않으면 버튼만 막히고 사유 글자는 없다(2026-09-30) · 토글은 네 형식(MP3 · PDF · MIDI · MusicXML)', () => {
    const w = mount(C6DownloadCard, { props: { requestNo: 'R-1' } });
    expect(w.findAll('.formats span').map((s) => s.text())).toEqual(['MP3', 'PDF', 'MIDI', 'MusicXML']);
    expect(w.get('[data-test="download-picked"] button').attributes('aria-disabled')).toBe('true');
    expect(w.text()).not.toContain('받을 형식을 골라');
    expect(w.text()).not.toContain('사유');
    expect(w.text()).not.toContain('—');
  });

  it('(74번) 결과에 MIDI 가 없으면 MIDI 칸이 막히고 사유가 보인다 · 다른 형식은 그대로', () => {
    const w = mount(C6DownloadCard, { props: { requestNo: 'R-1', midiAvailable: false } });
    expect((w.get('[data-test="pick-midi"]').element as HTMLInputElement).disabled).toBe(true);
    expect((w.get('[data-test="pick-musicxml"]').element as HTMLInputElement).disabled).toBe(false);
    expect(w.get('[data-test="midi-off"]').text()).toBe('이 악보는 MIDI 를 만들지 못했습니다.');
    const ok = mount(C6DownloadCard, { props: { requestNo: 'R-1', midiAvailable: true } });
    expect((ok.get('[data-test="pick-midi"]').element as HTMLInputElement).disabled).toBe(false);
    expect(ok.find('[data-test="midi-off"]').exists()).toBe(false);
  });

  it('MP3 라이선스 안내는 카드 안에 한 번만 — 서버가 같은 안내를 보내도 겹치지 않는다(2026-09-30)', async () => {
    const license = errorCodes.status_codes.LICENSE_UNCONFIRMED;
    vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'e3', format: 'mp3', basis: 'original', status: 'queued', queue_position: 1, failure_reason: null, notices: [license], download_url: null, renderer: null })));
    const w = mount(C6DownloadCard, { props: { requestNo: 'R-1', notes: { mp3: ['연주 악기: 기본 국악기 구성'] } } });
    expect(w.text()).not.toContain(license);
    await w.get('[data-test="pick-mp3"]').setValue(true);
    expect(w.text().split(license).length - 1).toBe(1);
    await w.get('[data-test="download-picked"] button').trigger('click');
    await flushPromises();
    expect(w.text().split(license).length - 1).toBe(1);
  });

  it('여러 형식을 골라 한 번에 — MIDI · MusicXML 은 원본을 바로, MP3 는 다 만들어지면 저절로 받는다', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return json({ id: 'e1', format: 'mp3', basis: 'original', status: 'queued', queue_position: 2, failure_reason: null, notices: [], download_url: null, renderer: null });
      if (url.endsWith('/exports/e1')) return json({ id: 'e1', format: 'mp3', basis: 'original', status: 'ready', queue_position: null, failure_reason: null, notices: [], download_url: '/dl/e1.mp3', renderer: 'fluidsynth' });
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const w = mount(C6DownloadCard, { props: { requestNo: 'R-1', instruments: { mode: 'default' } }, attachTo: document.body });
    await w.get('[data-test="pick-mp3"]').setValue(true);
    await w.get('[data-test="pick-midi"]').setValue(true);
    await w.get('[data-test="pick-musicxml"]').setValue(true);
    expect(w.get('[data-test="download-picked"] button').text()).toBe('악보 다운받기 (3개)');
    await w.get('[data-test="download-picked"] button').trigger('click');
    await flushPromises();
    expect(w.get('[data-test="download-states"] [data-format="mp3"]').text()).toContain('차례를 기다립니다 (앞에 2건)');
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({ format: 'mp3', instruments: { mode: 'default' } });
    await vi.advanceTimersByTimeAsync(3000);
    await flushPromises();
    expect(clicked).toEqual(['/api/requests/R-1/original/midi', '/api/requests/R-1/original/musicxml', '/dl/e1.mp3']);
    expect(w.get('[data-format="mp3"]').text()).toContain('받았습니다');
  });

  it('실패한 형식에만 [다시 시도] · 보관 기간이 지나면 토글과 버튼이 막힌다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'e2', format: 'pdf', basis: 'original', status: 'failed', queue_position: null, failure_reason: 'RENDER_TIMEOUT', notices: [], download_url: null, renderer: null })));
    const w = mount(C6DownloadCard, { props: { requestNo: 'R-1' } });
    await w.get('[data-test="pick-pdf"]').setValue(true);
    await w.get('[data-test="download-picked"] button').trigger('click');
    await flushPromises();
    const row = w.get('[data-format="pdf"]');
    expect(row.text()).toContain('만들지 못했습니다. 시간이 너무 오래 걸려 멈췄습니다.');
    expect(row.find('button').text()).toBe('다시 시도');
    await w.setProps({ expired: true });
    expect(w.get('[data-test="pick-mp3"]').attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('보관 기간이 지나 받을 수 없습니다.');
  });
});

describe('LeaveConfirm', () => {
  it('제목 · 문구 · [취소]에 초점 · Esc 는 취소 · [나가기]는 confirm', async () => {
    const w = mount(LeaveConfirm, { props: { title: '편집 중인 악보에서 나가시겠습니까?', lines: ['아직 편집을 마치지 않았습니다. 고친 내용은 이 기기에 자동 저장되어 있습니다.'] }, attachTo: document.body });
    expect(w.get('[role="dialog"]').attributes('aria-modal')).toBe('true');
    expect(w.text()).toContain('편집 중인 악보에서 나가시겠습니까?');
    expect(w.text()).toContain('아직 편집을 마치지 않았습니다');
    expect(w.text()).not.toContain('—');
    expect(document.activeElement).toBe(w.get('[data-test="leave-cancel"]').element);
    await w.get('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    expect(w.emitted('cancel')).toHaveLength(1);
    await w.get('[data-test="leave-ok"]').trigger('click');
    expect(w.emitted('confirm')).toHaveLength(1);
    w.unmount();
  });
});
