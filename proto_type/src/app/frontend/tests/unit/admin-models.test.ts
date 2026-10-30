// 관리자 '모델' 탭 — 불러오기 진행 계산과 2초 새로 고침(불러오는 중일 때만)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  POLL_INTERVAL_MS, computeLoadProgress, createModelPoller, elapsedFor, ollamaTagProblem, suggestModelName, validateNewModel,
} from '../../src/admin/lib/models';
import type { AdminModel, ModelState } from '../../src/admin/types';

function model(name: string, state: ModelState, extra: Partial<AdminModel> = {}): AdminModel {
  return {
    model_name: name, kind: 'omr_staff', provider: 'venv', display_name: name, provider_ref: '~/venvs/x', enabled: true, in_use_by: [],
    state, loaded_at: null, expected_seconds: 30, avg_load_ms: null, max_load_ms: null, last_outcome: null, last_error: null,
    installed: true, version: '0.1', ...extra,
  };
}

describe('computeLoadProgress', () => {
  it('경과 / 예상 비율을 퍼센트로 준다', () => {
    const p = computeLoadProgress(15, 30);
    expect(p.percent).toBe(50);
    expect(p.overdue).toBe(false);
    expect(p.text).toContain('30초');
    expect(p.text).toContain('15초');
  });
  it('끝나기 전에는 100% 를 보이지 않는다 (예상을 넘으면 99 + 넘었다는 안내)', () => {
    expect(computeLoadProgress(30, 30).percent).toBe(99);
    const late = computeLoadProgress(45, 30);
    expect(late.percent).toBe(99);
    expect(late.overdue).toBe(true);
    expect(late.text).toContain('오래 걸리고');
  });
  it('예상을 모르면 막대 비율 없이 안내 글만', () => {
    const p = computeLoadProgress(7.6, null);
    expect(p.percent).toBeNull();
    expect(p.elapsedSeconds).toBe(7);
    expect(p.text).toContain('처음 한 번은 시간이 더 걸릴 수 있습니다');
  });
  it('음수·0 예상은 모름으로 본다', () => {
    expect(computeLoadProgress(-3, 0)).toMatchObject({ percent: null, elapsedSeconds: 0 });
  });
});

describe('elapsedFor', () => {
  it('서버 경과 → 시작 시각 → 화면에서 본 시각 순으로 쓴다', () => {
    const now = Date.parse('2026-09-28T10:00:20Z');
    expect(elapsedFor(model('a', 'loading', { elapsed_seconds: 12 }), now, {})).toBe(12);
    expect(elapsedFor(model('a', 'loading', { load_started_at: '2026-09-28T10:00:05Z' }), now, {})).toBe(15);
    expect(elapsedFor(model('a', 'loading'), now, { a: now - 4000 })).toBe(4);
    expect(elapsedFor(model('a', 'loading'), now, {})).toBe(0);
  });
});

describe('createModelPoller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('불러오는 모델이 있으면 2초마다 읽고, 모두 끝나면 멈춘다', async () => {
    const responses: AdminModel[][] = [
      [model('homr', 'loading'), model('audiveris', 'ready')],
      [model('homr', 'loading'), model('audiveris', 'ready')],
      [model('homr', 'ready'), model('audiveris', 'ready')],
    ];
    let i = 0;
    const fetch = vi.fn(async () => responses[Math.min(i++, responses.length - 1)]);
    const onUpdate = vi.fn();
    const poller = createModelPoller({ fetch, onUpdate });

    await poller.start();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(poller.active).toBe(true);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(1); // 2초가 되기 전에는 안 읽는다
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(poller.active).toBe(false); // 모두 준비됨 → 멈춤

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(onUpdate).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('불러오는 모델이 없으면 한 번만 읽고 새로 고침을 걸지 않는다', async () => {
    const fetch = vi.fn(async () => [model('homr', 'ready'), model('jg', 'cold')]);
    const poller = createModelPoller({ fetch, onUpdate: () => {} });
    await poller.start();
    expect(poller.active).toBe(false);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stop() 하면 (화면을 떠나면) 더 읽지 않는다 — 읽는 도중에 멈춰도', async () => {
    let resolve!: (v: AdminModel[]) => void;
    const fetch = vi.fn()
      .mockResolvedValueOnce([model('homr', 'loading')])
      .mockImplementationOnce(() => new Promise<AdminModel[]>((r) => { resolve = r; }));
    const onUpdate = vi.fn();
    const poller = createModelPoller({ fetch, onUpdate });
    await poller.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // 두 번째 읽기 시작(아직 응답 없음)
    expect(fetch).toHaveBeenCalledTimes(2);
    poller.stop();
    resolve([model('homr', 'loading')]);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenCalledTimes(1); // 멈춘 뒤 온 응답은 버린다
    expect(poller.active).toBe(false);
  });

  it('[불러오기] 직후에는 서버가 아직 loading 을 안 보여도 minTicks 만큼 더 읽는다', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce([model('homr', 'cold')])
      .mockResolvedValueOnce([model('homr', 'loading')])
      .mockResolvedValue([model('homr', 'ready')]);
    const poller = createModelPoller({ fetch, onUpdate: () => {} });
    await poller.start(1);
    expect(poller.active).toBe(true);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(poller.active).toBe(false);
  });

  it('읽기에 실패하면 알려 주고 2초 뒤 다시 시도한다', async () => {
    const onError = vi.fn();
    const fetch = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue([model('a', 'ready')]);
    const poller = createModelPoller({ fetch, onUpdate: () => {}, onError });
    await poller.start();
    expect(onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(poller.active).toBe(false);
  });
});

describe('모델 추가 검사', () => {
  it('Ollama 태그: :cloud 금지, 태그 명시, :latest 금지', () => {
    expect(ollamaTagProblem('gemma3:4b')).toBeNull();
    expect(ollamaTagProblem('gpt-oss:120b-cloud')).toContain(':cloud');
    expect(ollamaTagProblem('qwen3:cloud')).toContain(':cloud');
    expect(ollamaTagProblem('llama3.2')).toContain('태그');
    expect(ollamaTagProblem('llama3.2:latest')).toContain(':latest');
    expect(ollamaTagProblem('a:1; rm -rf /')).not.toBeNull();
  });
  it('이름 제안은 등록부 규칙에 맞는다', () => {
    expect(suggestModelName('gemma3:4b')).toBe('llm-gemma3-4b');
    expect(suggestModelName('hf.co/User/Repo-GGUF:Q4_K_M')).toMatch(/^[a-z0-9][a-z0-9._-]{1,39}$/);
  });
  it('가상환경: 어댑터와 기능이 맞아야 하고 이름은 겹치면 안 된다', () => {
    const base = { provider: 'venv' as const, model_name: 'homr-v2', display_name: 'homr v2', kind: 'omr_staff' as const, provider_ref: '~/venvs/homr', adapter: 'homr' as const };
    expect(validateNewModel(base, ['homr'])).toEqual({});
    expect(validateNewModel({ ...base, adapter: 'jeongganbo' }, [])).toHaveProperty('kind');
    expect(validateNewModel({ ...base, model_name: 'Homr' }, [])).toHaveProperty('model_name');
    expect(validateNewModel(base, ['homr-v2'])).toHaveProperty('model_name');
    expect(validateNewModel({ ...base, provider_ref: ' ' }, [])).toHaveProperty('provider_ref');
  });
});
