// S6 '모델' 탭 — 불러오기 진행 계산, 2초 새로 고침, 모델 추가 검증 (INTERFACES §5 · §7, OLLAMA 설정 참조 §7.3·§7.5).
import type { AdminModel, EngineOrderKey, ModelKind } from '../types';

export const POLL_INTERVAL_MS = 2000;
export const KIND_ORDER: ModelKind[] = ['omr_staff', 'omr_jeongganbo', 'recommend'];
export const KIND_TO_ORDER: Record<ModelKind, EngineOrderKey> = { omr_staff: 'staff', omr_jeongganbo: 'jeongganbo', recommend: 'recommend' };

export interface LoadProgress {
  elapsedSeconds: number;
  expectedSeconds: number | null;
  /** 0~100. 예상을 모르면 null(막대 없이 글자만) */
  percent: number | null;
  overdue: boolean;
  text: string;
}

/**
 * 불러오는 중 진행 — 경과 / 예상. 끝나기 전에는 100% 를 보이지 않는다(최대 99).
 */
export function computeLoadProgress(elapsedSeconds: number, expectedSeconds: number | null | undefined): LoadProgress {
  const el = Math.max(0, Math.floor(elapsedSeconds));
  const ex = expectedSeconds && expectedSeconds > 0 ? Math.round(expectedSeconds) : null;
  if (ex === null) {
    return { elapsedSeconds: el, expectedSeconds: null, percent: null, overdue: false, text: `처음 한 번은 시간이 더 걸릴 수 있습니다 (지금 ${el}초)` };
  }
  const overdue = el > ex;
  const percent = Math.min(99, Math.round((el / ex) * 100));
  const text = overdue ? `예상(약 ${ex}초)보다 오래 걸리고 있습니다(지금 ${el}초)` : `약 ${ex}초 중 ${el}초 지났습니다`;
  return { elapsedSeconds: el, expectedSeconds: ex, percent, overdue, text };
}

/**
 * 경과 초 — 서버가 준 elapsed_seconds → load_started_at → 이 화면에서 처음 본(또는 [불러오기]를 누른) 시각 순으로 쓴다.
 */
export function elapsedFor(m: AdminModel, now: number, localStart: Record<string, number>): number {
  if (typeof m.elapsed_seconds === 'number') return m.elapsed_seconds;
  const start = m.load_started_at ? Date.parse(m.load_started_at) : localStart[m.model_name];
  if (!start || Number.isNaN(start)) return 0;
  return Math.max(0, (now - start) / 1000);
}

export function anyLoading(list: AdminModel[]): boolean {
  return list.some((m) => m.state === 'loading');
}

export interface Poller {
  /**
   * 지금 한 번 읽고, 불러오는 모델이 있으면 2초 뒤 또 읽는다.
   * @param minTicks 불러오는 모델이 없어도 이만큼은 더 읽는다([불러오기] 직후 서버 상태가 늦게 바뀌는 경우)
   */
  start(minTicks?: number): Promise<void>;
  stop(): void;
  readonly active: boolean;
}

/**
 * 불러오는 중인 모델이 있을 때만 2초마다 GET /admin/models. 없으면 멈춘다.
 * setTimeout 사슬이라 앞 요청이 끝난 뒤에만 다음 요청이 나간다.
 */
export function createModelPoller(opts: {
  fetch: () => Promise<AdminModel[]>;
  onUpdate: (list: AdminModel[]) => void;
  onError?: (e: unknown) => void;
  intervalMs?: number;
}): Poller {
  const interval = opts.intervalMs ?? POLL_INTERVAL_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let generation = 0;
  let extra = 0;

  const clear = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };

  async function tick(gen: number) {
    let list: AdminModel[] | null = null;
    try {
      list = await opts.fetch();
    } catch (e) {
      opts.onError?.(e);
    }
    if (gen !== generation) return; // 그 사이 stop() 됨
    if (list) opts.onUpdate(list);
    // 읽기에 실패하면 한 번 더 시도(불러오는 중일 수 있으므로), 성공했으면 불러오는 중일 때만
    const forced = extra > 0;
    if (forced) extra -= 1;
    if (list === null || anyLoading(list) || forced) {
      running = true;
      timer = setTimeout(() => void tick(gen), interval);
    } else {
      running = false;
      timer = null;
    }
  }

  return {
    async start(minTicks = 0) {
      clear();
      extra = minTicks;
      generation += 1;
      running = true;
      await tick(generation);
    },
    stop() {
      generation += 1;
      clear();
      running = false;
    },
    get active() { return running; },
  };
}

/** 'gemma3:4b' → 'llm-gemma3-4b' (model_name 규칙 ^[a-z0-9][a-z0-9._-]{1,39}$) */
export function suggestModelName(tag: string): string {
  const slug = tag.toLowerCase().replace(/^hf\.co\//, '').replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `llm-${slug}`.slice(0, 40).replace(/-$/, '');
}

export const MODEL_NAME_RE = /^[a-z0-9][a-z0-9._-]{1,39}$/;
export const VENV_ADAPTERS = ['homr', 'audiveris', 'jeongganbo'] as const;
export type VenvAdapter = (typeof VENV_ADAPTERS)[number];
export const ADAPTER_KIND: Record<VenvAdapter, ModelKind> = { homr: 'omr_staff', audiveris: 'omr_staff', jeongganbo: 'omr_jeongganbo' };

/** Ollama 태그 검사 — ':cloud' 금지, 태그 명시(:latest 생략 금지) */
export function ollamaTagProblem(tag: string): string | null {
  const t = tag.trim();
  if (!t) return '받을 모델 태그를 넣어 주십시오.';
  if (/:cloud\b|-cloud$/.test(t)) return "':cloud' 모델은 외부 과금 계정을 써서 쓰지 않습니다.";
  if (!t.includes(':')) return '태그를 꼭 붙여 주십시오 (예: gemma3:4b). :latest 를 생략하면 어떤 크기가 받아질지 모릅니다.';
  if (/:latest$/.test(t)) return ':latest 대신 크기가 드러나는 태그를 써 주십시오 (예: llama3.2:3b).';
  if (/[\s;&|`$]/.test(t)) return '태그에 빈칸이나 특수 기호를 넣을 수 없습니다.';
  return null;
}

export interface NewModelDraft {
  provider: 'venv' | 'ollama';
  model_name: string;
  display_name: string;
  kind: ModelKind;
  provider_ref: string;
  adapter: VenvAdapter | '';
}

export function validateNewModel(d: NewModelDraft, existing: string[]): Partial<Record<keyof NewModelDraft, string>> {
  const e: Partial<Record<keyof NewModelDraft, string>> = {};
  if (!MODEL_NAME_RE.test(d.model_name)) e.model_name = '영어 소문자·숫자로 시작하고, 소문자·숫자·. _ - 만 2~40자로 써 주십시오.';
  else if (existing.includes(d.model_name)) e.model_name = '이미 등록된 이름입니다.';
  if (!d.display_name.trim()) e.display_name = '화면에 보일 이름을 넣어 주십시오.';
  if (!d.provider_ref.trim()) e.provider_ref = d.provider === 'venv' ? '가상환경 폴더를 넣어 주십시오 (예: ~/venvs/homr).' : '서버에 있는 모델을 골라 주십시오.';
  else if (d.provider === 'ollama') {
    const p = ollamaTagProblem(d.provider_ref);
    if (p) e.provider_ref = p;
  }
  if (d.provider === 'venv') {
    if (!d.adapter) e.adapter = '어댑터를 골라 주십시오.';
    else if (ADAPTER_KIND[d.adapter] !== d.kind) e.kind = `${d.adapter} 어댑터는 ${ADAPTER_KIND[d.adapter] === 'omr_staff' ? '오선보 인식' : '정간보 인식'}에만 쓸 수 있습니다.`;
  }
  return e;
}
