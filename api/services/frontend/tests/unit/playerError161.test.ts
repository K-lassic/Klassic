// (#161) 안전하지 않은 주소(https · localhost 가 아닌 곳)에서는 말없이 소리만 안 나던 문제
// — 연주기는 음원을 받기 전에 주소 탓임을 알리고, 연주 막대는 연주기 오류 문구를 화면에 보인다
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

const fonts = vi.hoisted(() => ({ fetchFont: vi.fn(), clearOldFontCaches: vi.fn() }));
vi.mock('@/player/fontCache', () => fonts);
vi.mock('spessasynth_lib', () => ({ Sequencer: class {}, Synthetizer: class {} }));
vi.mock('spessasynth_lib/synthetizer/worklet_processor.min.js?url', () => ({ default: '/worklet.js' }));

import { player } from '@/player/player';
import C5PlayerBar from '@/components/C5PlayerBar.vue';
import type { ScoreDoc } from '@/types/score';

const doc = { tempoBpm: 120, parts: [] } as unknown as ScoreDoc;
const setSecure = (v: boolean) => Object.defineProperty(window, 'isSecureContext', { value: v, configurable: true });

describe('#161 연주기 오류 안내', () => {
  afterEach(() => { setSecure(true); fonts.fetchFont.mockReset(); });

  it('안전하지 않은 주소면 음원을 받지 않고 주소 탓임을 알린다', async () => {
    setSecure(false);
    const seen: [string, string | undefined][] = [];
    const off = player.on((s, d) => seen.push([s, d]));
    expect(await player.ensureReady()).toBe(false);
    expect(fonts.fetchFont).not.toHaveBeenCalled();
    expect(seen.at(-1)?.[0]).toBe('error');
    expect(seen.at(-1)?.[1]).toContain('https 주소나 이 컴퓨터(localhost)');
    // 실패를 담아 두지 않는다 — 다시 [재생]해도 또 알린다
    seen.length = 0;
    expect(await player.ensureReady()).toBe(false);
    expect(seen.map(([s]) => s)).toEqual(['error']);
    off();
  });

  it('연주 막대는 연주기 오류 문구를 화면에 보인다(role="status")', async () => {
    setSecure(false);
    const w = mount(C5PlayerBar, { props: { doc } });
    expect(w.find('[data-test="player-error"]').exists()).toBe(false);
    await w.find('[data-test="play"]').trigger('click');
    await nextTick();
    const p = w.find('[data-test="player-error"]');
    expect(p.exists()).toBe(true);
    expect(p.attributes('role')).toBe('status');
    expect(p.text()).toContain('이 주소에서는 소리를 낼 수 없습니다');
    w.unmount();
  });
});
