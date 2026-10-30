<script setup lang="ts">
// 모델 탭 (INTERFACES §5 모델 · §7 관리자). 기능별 모델 표 · 상태 칩 · 불러오기(2초마다 새로 고침) · 켜기/끄기 · 순서 · 등록 해제 · 모델 추가.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { GateError } from '@/api/client';
import { adminApi } from '../../api';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import LoadProgress from '../../components/LoadProgress.vue';
import AddModelDialog from './AddModelDialog.vue';
import { KIND_ORDER, KIND_TO_ORDER, POLL_INTERVAL_MS, anyLoading, createModelPoller, elapsedFor } from '../../lib/models';
import { KIND_LABEL, PROVIDER_LABEL, dateTime, inUseLabel, secondsFromMs } from '../../lib/format';
import type { AdminModel, EngineOrder, EngineOrderKey } from '../../types';

const models = ref<AdminModel[]>([]);
const order = ref<EngineOrder | null>(null);
const loadError = ref('');
const pollError = ref('');
const now = ref(Date.now());
const localStart = ref<Record<string, number>>({});
const rowMsg = ref<Record<string, { kind: 'ok' | 'err'; text: string }>>({});
const busy = ref<Record<string, boolean>>({});
const showAdd = ref(false);
const justAdded = ref<AdminModel | null>(null);
const confirmRemove = ref<AdminModel | null>(null);
const removeError = ref('');
const confirmDisable = ref<AdminModel | null>(null);
let ticker: ReturnType<typeof setInterval> | null = null;

function applyList(list: AdminModel[]) {
  const t = Date.now();
  const starts = { ...localStart.value };
  for (const m of list) {
    if (m.state === 'loading') { if (!starts[m.model_name]) starts[m.model_name] = t; }
    else if (starts[m.model_name]) {
      // 불러오기가 끝났다 — 결과를 그 줄에 남긴다
      delete starts[m.model_name];
      if (m.state === 'ready') setMsg(m.model_name, 'ok', '불러오기를 마쳤습니다. 이제 첫 사용자가 기다리지 않습니다.');
      else if (m.state === 'failed') setMsg(m.model_name, 'err', `불러오지 못했습니다${m.last_error ? `: ${m.last_error}` : ''}`);
    }
  }
  localStart.value = starts;
  models.value = list;
  now.value = t;
}

const poller = createModelPoller({
  fetch: () => adminApi.models(),
  onUpdate: (list) => { pollError.value = ''; loadError.value = ''; applyList(list); },
  onError: (e) => { pollError.value = (e as Error).message || '모델 상태를 새로 고치지 못했습니다.'; },
});
const polling = ref(false);
async function refresh(minTicks = 0) {
  await poller.start(minTicks);
  polling.value = poller.active;
  if (!models.value.length && pollError.value) { loadError.value = pollError.value; poller.stop(); polling.value = false; }
}
async function loadOrder() {
  try { order.value = (await adminApi.settings()).engine_order; } catch { order.value = null; }
}
onMounted(() => { void refresh(); void loadOrder(); });
onBeforeUnmount(() => { poller.stop(); if (ticker) clearInterval(ticker); });

const loadingNow = computed(() => anyLoading(models.value));
watch(loadingNow, (on) => {
  if (on && !ticker) ticker = setInterval(() => { now.value = Date.now(); polling.value = poller.active; }, 1000);
  if (!on && ticker) { clearInterval(ticker); ticker = null; polling.value = poller.active; }
});

function setMsg(name: string, kind: 'ok' | 'err', text: string) {
  rowMsg.value = { ...rowMsg.value, [name]: { kind, text } };
}
function errText(e: unknown) {
  if (e instanceof GateError) return `${e.body.message}${e.body.fix ? ` ${e.body.fix}` : ''}`;
  return (e as Error)?.message || '처리하지 못했습니다.';
}

function orderKey(m: AdminModel): EngineOrderKey { return KIND_TO_ORDER[m.kind]; }
function position(m: AdminModel): number {
  const list = order.value?.[orderKey(m)];
  if (list) return list.indexOf(m.model_name);
  const tag = m.in_use_by.find((t) => t.startsWith(`${orderKey(m)}#`));
  return tag ? Number(tag.split('#')[1]) - 1 : -1;
}
function usedIn(m: AdminModel): string[] {
  if (m.in_use_by?.length) return m.in_use_by;
  const p = position(m);
  return p >= 0 ? [`${orderKey(m)}#${p + 1}`] : [];
}

const groups = computed(() =>
  KIND_ORDER.map((kind) => {
    const list = models.value.filter((m) => m.kind === kind);
    list.sort((a, b) => {
      const pa = position(a), pb = position(b);
      if (pa >= 0 && pb >= 0) return pa - pb;
      if (pa >= 0) return -1;
      if (pb >= 0) return 1;
      return a.model_name.localeCompare(b.model_name);
    });
    return { kind, key: KIND_TO_ORDER[kind], list, orderLen: order.value?.[KIND_TO_ORDER[kind]]?.length ?? list.filter((m) => position(m) >= 0).length };
  }),
);

function stateChip(m: AdminModel) {
  switch (m.state) {
    case 'ready': return { cls: 's-done', text: '준비됨' };
    case 'cold': return { cls: 's-waiting', text: '대기(콜드)' };
    case 'loading': return { cls: 's-progress', text: '불러오는 중' };
    case 'failed': return { cls: 's-rejected', text: '실패' };
    default: return { cls: 's-expired', text: '설치 안 됨' };
  }
}
function loadBlockReason(m: AdminModel): string {
  if (m.provider === 'builtin') return '내장 모델은 늘 준비돼 있습니다';
  if (m.state === 'unavailable' || m.installed === false) return '설치 안 됨. 먼저 설치가 필요합니다';
  if (m.state === 'loading') return '불러오는 중입니다';
  return '';
}
function removeBlockReason(m: AdminModel): string {
  const used = usedIn(m);
  if (used.length) return `${used.map(inUseLabel).join(', ')}에서 쓰는 중이라 해제할 수 없습니다. 먼저 설정 순서에서 빼 주십시오`;
  if (m.provider === 'builtin') return '내장 모델은 해제할 수 없습니다';
  return '';
}

async function load(m: AdminModel) {
  if (loadBlockReason(m)) return;
  busy.value = { ...busy.value, [m.model_name]: true };
  try {
    const r = await adminApi.loadModel(m.model_name);
    localStart.value = { ...localStart.value, [m.model_name]: Date.now() };
    // 곧바로 상태를 '불러오는 중'으로 보이고 예상 시간을 채운다(다음 새로 고침에서 서버 값으로 바뀐다)
    models.value = models.value.map((x) => (x.model_name === m.model_name ? { ...x, state: 'loading', expected_seconds: r?.expected_seconds ?? x.expected_seconds } : x));
    setMsg(m.model_name, 'ok', '불러오기를 시작했습니다. 10~60초쯤 걸릴 수 있습니다.');
    await refresh(2);
  } catch (e) {
    setMsg(m.model_name, 'err', errText(e));
  } finally {
    busy.value = { ...busy.value, [m.model_name]: false };
  }
}

async function toggle(m: AdminModel, confirmed = false) {
  if (m.enabled && usedIn(m).length && !confirmed) { confirmDisable.value = m; return; }
  confirmDisable.value = null;
  busy.value = { ...busy.value, [m.model_name]: true };
  try {
    await adminApi.updateModel(m.model_name, { enabled: !m.enabled });
    setMsg(m.model_name, 'ok', m.enabled ? '껐습니다.' : '켰습니다. 순서에 넣어야 실제로 쓰입니다.');
    await Promise.all([refresh(), loadOrder()]);
  } catch (e) {
    setMsg(m.model_name, 'err', errText(e));
  } finally {
    busy.value = { ...busy.value, [m.model_name]: false };
  }
}

async function writeOrder(m: AdminModel, list: string[], msg: string) {
  const key = orderKey(m);
  busy.value = { ...busy.value, [m.model_name]: true };
  try {
    const s = await adminApi.saveSettings({ engine_order: { [key]: list } });
    order.value = s.engine_order;
    const st = s.api_apply_status === 'unapplied' ? ' 다만 모델 서버에는 아직 반영하지 못했습니다(미반영).' : '';
    setMsg(m.model_name, s.api_apply_status === 'unapplied' ? 'err' : 'ok', `${msg} 설정에 저장했습니다. 이후 요청부터 적용됩니다.${st}`);
    await refresh();
  } catch (e) {
    setMsg(m.model_name, 'err', errText(e));
  } finally {
    busy.value = { ...busy.value, [m.model_name]: false };
  }
}
function currentList(m: AdminModel): string[] {
  const key = orderKey(m);
  if (order.value) return [...order.value[key]];
  return groups.value.find((g) => g.key === key)!.list.filter((x) => position(x) >= 0).map((x) => x.model_name);
}
function moveOrder(m: AdminModel, d: -1 | 1) {
  const list = currentList(m);
  const i = list.indexOf(m.model_name), j = i + d;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  void writeOrder(m, list, d < 0 ? '한 칸 올렸습니다.' : '한 칸 내렸습니다.');
}
function addToOrder(m: AdminModel) {
  const list = currentList(m);
  // 추천은 규칙표(rules)가 늘 마지막 안전판 — 그 앞에 넣는다
  const rulesAt = m.kind === 'recommend' ? list.indexOf('rules') : -1;
  if (rulesAt >= 0) list.splice(rulesAt, 0, m.model_name); else list.push(m.model_name);
  void writeOrder(m, list, '순서에 넣었습니다.');
}
function removeFromOrder(m: AdminModel) {
  const list = currentList(m).filter((n) => n !== m.model_name);
  if (m.kind !== 'recommend' && list.length === 0) { setMsg(m.model_name, 'err', '순서에 엔진이 하나는 있어야 합니다.'); return; }
  void writeOrder(m, list, '순서에서 뺐습니다.');
}

async function doRemove() {
  const m = confirmRemove.value;
  if (!m) return;
  removeError.value = '';
  busy.value = { ...busy.value, [m.model_name]: true };
  try {
    await adminApi.removeModel(m.model_name);
    confirmRemove.value = null;
    await refresh();
  } catch (e) {
    removeError.value = e instanceof GateError && e.code === 'MODEL_INVALID'
      ? '설정 순서에서 쓰는 중이라 해제할 수 없습니다. 먼저 순서에서 빼 주십시오.'
      : errText(e);
  } finally {
    busy.value = { ...busy.value, [m.model_name]: false };
  }
}

async function onAdded(m: AdminModel | null, name: string) {
  showAdd.value = false;
  await refresh();
  justAdded.value = models.value.find((x) => x.model_name === name) ?? m;
}
</script>

<template>
  <section class="stack" aria-labelledby="models-h">
    <h2 id="models-h" class="sr-only">모델</h2>

    <div class="notice">
      <span class="title">모델 불러오기와 결과 보장</span>
      <p>
        처음 쓰는 모델은 메모리에 올리는 데 <b>10~60초</b>쯤 걸릴 수 있습니다. [불러오기]를 미리 해 두면 첫 사용자가 기다리지 않습니다.
        불러오는 동안에도 사용자는 <b>늘 결과를 받습니다</b>. 준비되지 않은 모델은 건너뛰고 다음 엔진이나 대체 결과로 갑니다.
      </p>
      <div class="row">
        <button type="button" class="btn btn-primary" @click="showAdd = true">모델 추가</button>
        <button type="button" class="btn btn-secondary" @click="refresh(); loadOrder()">새로 고침</button>
        <span class="small muted" aria-live="polite">{{ polling ? `불러오는 모델이 있어 ${POLL_INTERVAL_MS / 1000}초마다 새로 고치고 있습니다` : '' }}</span>
      </div>
    </div>

    <div v-if="justAdded" class="notice n-fallback" role="status">
      <span class="chip s-done">추가됨</span>
      <span class="title">{{ justAdded.display_name }} 을(를) 등록했습니다</span>
      <p>불러오기를 한 번 해 두면 첫 사용자가 기다리지 않습니다. 실제로 쓰려면 순서에도 넣어 주십시오.</p>
      <div class="row">
        <button v-if="!loadBlockReason(justAdded)" type="button" class="btn btn-secondary" @click="load(justAdded); justAdded = null">지금 불러오기</button>
        <button type="button" class="btn btn-secondary" @click="justAdded = null">나중에</button>
      </div>
    </div>

    <div v-if="loadError" class="notice n-rejected" role="alert">
      <span class="title">모델 목록을 불러오지 못했습니다</span><p>{{ loadError }}</p>
      <div class="row"><button type="button" class="btn btn-secondary" @click="refresh()">다시 시도</button></div>
    </div>
    <p v-else-if="pollError" class="small" role="status">새로 고치다 한 번 실패했습니다. 다시 시도하고 있습니다. ({{ pollError }})</p>

    <div v-for="g in groups" :key="g.kind" class="panel">
      <h3 :id="`kind-${g.kind}`" class="h3">{{ KIND_LABEL[g.kind] }} <span class="small muted">· {{ g.list.length }}개</span></h3>
      <p v-if="!g.list.length" class="small muted" style="margin: 0">등록된 모델이 없습니다.</p>
      <div v-else class="table-scroll">
        <table class="spec" :aria-labelledby="`kind-${g.kind}`">
          <thead>
            <tr>
              <th scope="col">순서</th><th scope="col">모델</th><th scope="col">제공 방식</th><th scope="col">상태</th><th scope="col">버전</th>
              <th scope="col">불러오기 시간<br /><span class="muted">평균 · 최대</span></th><th scope="col">쓰는 곳</th><th scope="col">행동</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in g.list" :key="m.model_name">
              <td>
                <div v-if="position(m) >= 0" class="row" style="gap: 4px">
                  <span class="h4">{{ position(m) + 1 }}</span>
                  <button type="button" class="btn btn-secondary btn-sm" :disabled="position(m) === 0 || busy[m.model_name]" :aria-label="`${m.display_name} 순서 올리기`" @click="moveOrder(m, -1)">↑</button>
                  <button type="button" class="btn btn-secondary btn-sm" :disabled="position(m) === g.orderLen - 1 || busy[m.model_name]" :aria-label="`${m.display_name} 순서 내리기`" @click="moveOrder(m, 1)">↓</button>
                </div>
                <span v-else class="muted">—</span>
              </td>
              <th scope="row">
                {{ m.display_name }}<br /><code class="small">{{ m.model_name }}</code>
                <span v-if="m.provider_ref" class="small muted"><br />{{ m.provider_ref }}</span>
                <span v-if="!m.enabled" class="chip s-expired" style="margin-top: 4px">꺼짐</span>
              </th>
              <td><span class="chip on-white">{{ PROVIDER_LABEL[m.provider] ?? m.provider }}</span></td>
              <td>
                <div class="stack-8">
                  <span :class="['chip', stateChip(m).cls]">{{ stateChip(m).text }}</span>
                  <LoadProgress v-if="m.state === 'loading'" :elapsed="elapsedFor(m, now, localStart)" :expected="m.expected_seconds" :label="m.display_name" />
                  <span v-else-if="m.state === 'failed' && m.last_error" class="small">{{ m.last_error }}</span>
                  <span v-else-if="m.state === 'ready' && m.loaded_at" class="small muted">올린 시각 {{ dateTime(m.loaded_at) }}</span>
                  <span v-else-if="m.state === 'cold' && m.expected_seconds" class="small muted">처음 부르면 약 {{ m.expected_seconds }}초</span>
                </div>
              </td>
              <td>{{ m.version ?? '—' }}</td>
              <td class="nowrap">{{ secondsFromMs(m.avg_load_ms) }} · {{ secondsFromMs(m.max_load_ms) }}</td>
              <td>
                <span v-if="usedIn(m).length">{{ usedIn(m).map(inUseLabel).join(', ') }}</span>
                <span v-else class="muted">순서에 없음</span>
              </td>
              <td>
                <div class="stack-8">
                  <div class="row-actions">
                    <button
                      type="button" class="btn btn-secondary btn-sm" :aria-disabled="loadBlockReason(m) ? 'true' : undefined" :disabled="busy[m.model_name]"
                      :aria-describedby="loadBlockReason(m) ? `lr-${m.model_name}` : undefined" @click="load(m)"
                    >
                      불러오기
                    </button>
                    <button
                      v-if="m.provider !== 'builtin'" type="button" class="btn btn-secondary btn-sm" :aria-pressed="m.enabled ? 'true' : 'false'" :disabled="busy[m.model_name]"
                      @click="toggle(m)"
                    >
                      {{ m.enabled ? '끄기' : '켜기' }}
                    </button>
                    <button v-if="position(m) < 0 && m.enabled" type="button" class="btn btn-secondary btn-sm" :disabled="busy[m.model_name]" @click="addToOrder(m)">순서에 넣기</button>
                    <button v-if="position(m) >= 0" type="button" class="btn btn-secondary btn-sm" :disabled="busy[m.model_name]" @click="removeFromOrder(m)">순서에서 빼기</button>
                    <button
                      type="button" class="btn btn-secondary btn-sm" :aria-disabled="removeBlockReason(m) ? 'true' : undefined" :disabled="busy[m.model_name]"
                      :aria-describedby="removeBlockReason(m) ? `rr-${m.model_name}` : undefined"
                      @click="removeBlockReason(m) ? undefined : ((removeError = ''), (confirmRemove = m))"
                    >
                      등록 해제
                    </button>
                  </div>
                  <span v-if="loadBlockReason(m)" :id="`lr-${m.model_name}`" class="small muted">{{ loadBlockReason(m) }}</span>
                  <span v-if="removeBlockReason(m)" :id="`rr-${m.model_name}`" class="small muted">{{ removeBlockReason(m) }}</span>
                  <span v-if="rowMsg[m.model_name]" :class="rowMsg[m.model_name].kind === 'err' ? 'field-error' : 'small'" role="status" style="padding-left: 0">{{ rowMsg[m.model_name].text }}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <AddModelDialog v-if="showAdd" :existing="models.map((m) => m.model_name)" @close="showAdd = false" @added="onAdded" />

    <ConfirmDialog
      v-if="confirmRemove" :title="`${confirmRemove.display_name} 등록을 해제하시겠습니까?`" confirm-label="등록 해제" :busy="busy[confirmRemove.model_name]" :error="removeError"
      @confirm="doRemove" @cancel="confirmRemove = null"
    >
      <p>등록부에서 빠지고, 설정 순서에 다시 넣을 수 없게 됩니다. 불러오기 기록도 함께 지워집니다. 변경 이력에는 남습니다.</p>
      <p v-if="confirmRemove.provider === 'ollama'" class="small muted">공유 Ollama 서버의 모델 파일은 그대로 둡니다(이 화면은 서버의 모델을 지우지 않습니다).</p>
    </ConfirmDialog>

    <ConfirmDialog
      v-if="confirmDisable" :title="`${confirmDisable.display_name} 을(를) 끄시겠습니까?`" confirm-label="끄기" :busy="busy[confirmDisable.model_name]"
      @confirm="toggle(confirmDisable, true)" @cancel="confirmDisable = null"
    >
      <p>{{ usedIn(confirmDisable).map(inUseLabel).join(', ') }}에서 쓰고 있습니다. 끄면 그 순서에서는 건너뛰고 다음 엔진(또는 대체 결과)으로 갑니다.</p>
      <p class="small muted">끈 모델은 설정 순서에 새로 넣을 수 없습니다. 서버가 막으면 먼저 순서에서 빼 주십시오.</p>
    </ConfirmDialog>
  </section>
</template>
