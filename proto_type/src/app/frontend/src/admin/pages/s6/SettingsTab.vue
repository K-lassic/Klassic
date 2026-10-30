<script setup lang="ts">
// 설정 탭 (SD_02 §10-2 · FR-018 · UC10). 지금 값과 새 값을 나란히, G6 값 검증은 입력마다 바로, 서버 422 는 같은 칸에.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { GateError } from '@/api/client';
import { adminApi } from '../../api';
import GateBlock from '../../components/GateBlock.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import { useSessionStore } from '../../stores/session';
import {
  ORDER_KEYS, ORDER_KIND, SETTING_GROUPS, diffSettings, fieldFromServer, fieldId, fieldLabel, formFromSnapshot, validateSettings,
  type SettingsForm,
} from '../../lib/settings';
import { ORDER_LABEL, dateTime } from '../../lib/format';
import type { AdminModel, EngineOrderKey, SettingsSnapshot } from '../../types';

const session = useSessionStore();
const original = ref<SettingsSnapshot | null>(null);
const form = ref<SettingsForm | null>(null);
const models = ref<AdminModel[]>([]);
const modelsFailed = ref(false);
const loadError = ref('');
const serverErrors = ref<Record<string, string>>({});
const saving = ref(false);
const saveError = ref('');
const lastSaved = ref<SettingsSnapshot | null>(null);
const confirmFallbackOff = ref(false);
const addPick = ref<Record<EngineOrderKey, string>>({ staff: '', jeongganbo: '', recommend: '' });

async function load() {
  loadError.value = '';
  try {
    const s = await adminApi.settings();
    original.value = s;
    form.value = formFromSnapshot(s);
    serverErrors.value = {};
  } catch (e) {
    loadError.value = (e as Error).message || '설정을 불러오지 못했습니다.';
  }
  try { models.value = await adminApi.models(); modelsFailed.value = false; } catch { modelsFailed.value = true; }
}
onMounted(load);
onBeforeUnmount(() => { session.settingsBlocked = false; });

const allowed = computed(() => {
  if (modelsFailed.value || !models.value.length) return undefined; // 모르면 서버가 판정
  const out: Partial<Record<EngineOrderKey, string[]>> = {};
  for (const k of ORDER_KEYS) out[k] = models.value.filter((m) => m.kind === ORDER_KIND[k] && m.enabled).map((m) => m.model_name);
  return out;
});
const clientErrors = computed(() => (form.value ? validateSettings(form.value, original.value, allowed.value) : {}));
const errors = computed<Record<string, string>>(() => ({ ...serverErrors.value, ...(clientErrors.value as Record<string, string>) }));
const errorKeys = computed(() => Object.keys(errors.value));
watch(errorKeys, (k) => { session.settingsBlocked = k.length > 0; }, { immediate: true });

const patch = computed(() => (form.value && original.value ? diffSettings(form.value, original.value) : {}));
const dirty = computed(() => Object.keys(patch.value).length > 0);
const saveReason = computed(() => {
  if (errorKeys.value.length) return '올바르지 않은 값이 있습니다';
  if (!dirty.value) return '바뀐 값이 없습니다';
  return '';
});

function onEdit(field: string) {
  if (serverErrors.value[field]) {
    const next = { ...serverErrors.value };
    delete next[field];
    serverErrors.value = next;
  }
}

function modelLabel(name: string) {
  const m = models.value.find((x) => x.model_name === name);
  return m ? m.display_name : name;
}
function modelNote(name: string) {
  const m = models.value.find((x) => x.model_name === name);
  if (!m) return modelsFailed.value ? '' : '등록되지 않음';
  return m.enabled ? '' : '꺼짐';
}
function candidates(k: EngineOrderKey) {
  if (!form.value) return [];
  return models.value.filter((m) => m.kind === ORDER_KIND[k] && m.enabled && !form.value!.engine_order[k].includes(m.model_name));
}
function move(k: EngineOrderKey, i: number, d: -1 | 1) {
  const list = form.value!.engine_order[k];
  const j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  onEdit(`engine_order.${k}`);
  void nextTick(() => document.getElementById(`ord-${k}-${j}-${d < 0 ? 'up' : 'down'}`)?.focus());
}
function removeAt(k: EngineOrderKey, i: number) {
  form.value!.engine_order[k].splice(i, 1);
  onEdit(`engine_order.${k}`);
}
function addTo(k: EngineOrderKey) {
  const name = addPick.value[k];
  if (!name) return;
  form.value!.engine_order[k].push(name);
  addPick.value[k] = '';
  onEdit(`engine_order.${k}`);
}

const firstError = computed(() => {
  const order = [...SETTING_GROUPS.flatMap((g) => g.fields.map((f) => f.key as string)), ...ORDER_KEYS.map((k) => `engine_order.${k}`)];
  const keys = errorKeys.value;
  return order.find((k) => keys.includes(k)) ?? keys[0] ?? null;
});
function goToFirstError() {
  const f = firstError.value;
  if (f) document.getElementById(fieldId(f))?.focus();
}

function requestSave() {
  if (saveReason.value || saving.value) return;
  if (patch.value.fallback_enabled === false) { confirmFallbackOff.value = true; return; }
  void save();
}

async function save() {
  confirmFallbackOff.value = false;
  saving.value = true;
  saveError.value = '';
  try {
    const s = await adminApi.saveSettings(patch.value);
    lastSaved.value = s;
    original.value = s;
    form.value = formFromSnapshot(s);
    serverErrors.value = {};
  } catch (e) {
    if (e instanceof GateError && (e.code === 'SETTINGS_INVALID_VALUE' || e.code === 'SETTINGS_UNKNOWN_ENGINE')) {
      serverErrors.value = serverFieldErrors(e);
      await nextTick();
      goToFirstError();
    } else {
      saveError.value = e instanceof Error ? e.message : '저장하지 못했습니다.';
    }
  } finally {
    saving.value = false;
  }
}

/** 422 details → 칸별 문구. details: {field, reason?|message?, engine?, score_type?} 또는 {fields:[…]} */
function serverFieldErrors(e: GateError): Record<string, string> {
  const d = (e.body.details ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  const items = Array.isArray(d.fields) ? (d.fields as Record<string, unknown>[]) : [d];
  for (const it of items) {
    const field = fieldFromServer(it.field, it.score_type ?? it.order ?? it.kind);
    const msg = (typeof it.message === 'string' && it.message) || (typeof it.reason === 'string' && it.reason) || '';
    const engine = typeof it.engine === 'string' ? it.engine : Array.isArray(it.engines) ? (it.engines as string[]).join(', ') : '';
    const text = e.code === 'SETTINGS_UNKNOWN_ENGINE'
      ? `등록되지 않았거나 꺼진 모델입니다${engine ? `: ${engine}` : ''}. '모델' 탭에서 확인해 주십시오.`
      : msg || e.body.fix || e.body.message;
    out[field ?? '_form'] = text;
  }
  return out;
}

const formLevelError = computed(() => serverErrors.value._form ?? '');
const applyStatus = computed(() => lastSaved.value?.api_apply_status ?? null);
</script>

<template>
  <section class="stack" aria-labelledby="settings-h">
    <h2 id="settings-h" class="sr-only">설정</h2>
    <div v-if="loadError" class="notice n-rejected" role="alert">
      <span class="title">설정을 불러오지 못했습니다</span><p>{{ loadError }}</p>
      <div class="row"><button type="button" class="btn btn-secondary" @click="load">다시 시도</button></div>
    </div>

    <template v-if="form && original">
      <p class="small muted" style="margin: 0">
        지금 판본 #{{ original.setting_version_id ?? '—' }} · {{ dateTime(original.created_at) }}.
        저장하면 바뀐 값만 새 판본으로 남고, 누가 바꿨는지 변경 이력에 기록됩니다.
      </p>

      <GateBlock
        v-if="errorKeys.length"
        id="settings-gate"
        gate="G6 운영 값 검증"
        title="저장할 수 없습니다"
        :reason="`${fieldLabel(firstError!)}: ${errors[firstError!]}${errorKeys.length > 1 ? ` (그 밖에 ${errorKeys.length - 1}칸 더)` : ''}`"
        owner="운영자(나)가 값을 고쳐 다시 저장합니다"
        :action-label="`${fieldLabel(firstError!)} 칸으로 가기`"
        @action="goToFirstError"
      />

      <div v-for="g in SETTING_GROUPS" :key="g.title" class="panel">
        <h3 class="h3">{{ g.title }}</h3>
        <div class="table-scroll">
          <table class="spec">
            <caption class="sr-only">{{ g.title }} 설정: 지금 값과 새 값</caption>
            <thead><tr><th scope="col" style="width: 38%">설정 항목</th><th scope="col" style="width: 18%">지금 값</th><th scope="col">새 값</th></tr></thead>
            <tbody>
              <tr v-for="f in g.fields" :key="f.key">
                <th scope="row"><label :for="fieldId(f.key)">{{ f.label }}</label><span v-if="f.unit" class="muted"> ({{ f.unit }})</span></th>
                <td>{{ original[f.key] ?? '미정' }}</td>
                <td>
                  <div class="stack-8">
                    <input
                      :id="fieldId(f.key)"
                      v-model="form.values[f.key]"
                      class="input num"
                      type="text"
                      :inputmode="f.type === 'int' ? 'numeric' : 'decimal'"
                      :placeholder="original[f.key] === null ? '미정' : ''"
                      :aria-invalid="errors[f.key] ? 'true' : undefined"
                      :aria-describedby="[errors[f.key] ? `${fieldId(f.key)}-err` : '', f.hint ? `${fieldId(f.key)}-hint` : ''].filter(Boolean).join(' ') || undefined"
                      @input="onEdit(f.key)"
                    />
                    <span v-if="errors[f.key]" :id="`${fieldId(f.key)}-err`" class="field-error">{{ errors[f.key] }}</span>
                    <span v-if="f.hint" :id="`${fieldId(f.key)}-hint`" class="hint">{{ f.hint }}</span>
                  </div>
                </td>
              </tr>
              <tr v-if="g.title === '처리'">
                <th scope="row"><span id="fb-l">대체 경로 사용</span></th>
                <td>{{ original.fallback_enabled ? '켬' : '끔' }}</td>
                <td>
                  <div class="stack-8">
                    <div class="segmented" role="radiogroup" aria-labelledby="fb-l" aria-describedby="fb-hint">
                      <label><input v-model="form.fallback_enabled" type="radio" name="fallback" :value="true" /><span>켬</span></label>
                      <label><input v-model="form.fallback_enabled" type="radio" name="fallback" :value="false" /><span>끔</span></label>
                    </div>
                    <span id="fb-hint" class="hint">끄면 인식이 안 될 때 결과를 보장하지 못합니다. 저장 전에 한 번 더 묻습니다.</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <h3 class="h3">엔진 호출 순서</h3>
        <p class="small" style="margin: 0">
          위에서부터 차례로 부릅니다. 앞 엔진이 실패하면 다음 엔진으로, 모두 실패하면 대체 결과를 드립니다.
          등록·켜짐 상태인 모델만 넣을 수 있습니다. 모델을 더하거나 끄려면 <RouterLink to="/ops/models">모델 탭</RouterLink>으로 가십시오.
        </p>
        <p v-if="modelsFailed" class="small muted" style="margin: 0">모델 목록을 불러오지 못해 이름만 보입니다. 저장할 때 서버가 확인합니다.</p>
        <div class="grid-3">
          <div v-for="k in ORDER_KEYS" :key="k" class="stack-16">
            <span :id="fieldId(`engine_order.${k}`) + '-l'" class="h4">{{ ORDER_LABEL[k] }} {{ k === 'recommend' ? '모델' : '엔진' }} 순서</span>
            <ol
              :id="fieldId(`engine_order.${k}`)"
              class="order-list"
              tabindex="-1"
              :aria-labelledby="fieldId(`engine_order.${k}`) + '-l'"
              :aria-invalid="errors[`engine_order.${k}`] ? 'true' : undefined"
              :aria-describedby="errors[`engine_order.${k}`] ? fieldId(`engine_order.${k}`) + '-err' : undefined"
            >
              <li v-if="!form.engine_order[k].length" class="muted">비어 있습니다</li>
              <li v-for="(name, i) in form.engine_order[k]" :key="name">
                <span class="pos">{{ i + 1 }}</span>
                <span class="name">{{ modelLabel(name) }} <code>{{ name }}</code><span v-if="modelNote(name)" class="chip s-rejected" style="margin-left: 8px">{{ modelNote(name) }}</span></span>
                <button :id="`ord-${k}-${i}-up`" type="button" class="btn btn-secondary btn-sm" :disabled="i === 0" :aria-label="`${modelLabel(name)} 한 칸 올리기`" @click="move(k, i, -1)">↑</button>
                <button :id="`ord-${k}-${i}-down`" type="button" class="btn btn-secondary btn-sm" :disabled="i === form.engine_order[k].length - 1" :aria-label="`${modelLabel(name)} 한 칸 내리기`" @click="move(k, i, 1)">↓</button>
                <button type="button" class="btn btn-secondary btn-sm" :aria-label="`${modelLabel(name)} 순서에서 빼기`" @click="removeAt(k, i)">빼기</button>
              </li>
            </ol>
            <span v-if="errors[`engine_order.${k}`]" :id="fieldId(`engine_order.${k}`) + '-err'" class="field-error">{{ errors[`engine_order.${k}`] }}</span>
            <div v-if="candidates(k).length" class="row">
              <label class="sr-only" :for="`add-${k}`">{{ ORDER_LABEL[k] }} 순서에 넣을 모델</label>
              <select :id="`add-${k}`" v-model="addPick[k]" class="input compact" style="max-width: 220px">
                <option value="">넣을 모델 고르기</option>
                <option v-for="m in candidates(k)" :key="m.model_name" :value="m.model_name">{{ m.display_name }} ({{ m.model_name }})</option>
              </select>
              <button type="button" class="btn btn-secondary btn-sm" :disabled="!addPick[k]" @click="addTo(k)">맨 뒤에 넣기</button>
            </div>
          </div>
        </div>
      </div>

      <div class="panel white">
        <p class="small" style="margin: 0">저장한 값은 <b>이후 들어오는 요청부터</b> 적용됩니다. 처리 중인 요청은 이전 값 그대로입니다.</p>
        <div v-if="formLevelError" class="notice n-rejected" role="alert"><p>{{ formLevelError }}</p></div>
        <div v-if="saveError" class="notice n-rejected" role="alert"><span class="title">저장하지 못했습니다</span><p>{{ saveError }}</p></div>
        <div class="row">
          <button
            type="button" class="btn btn-primary" :disabled="saving" :aria-disabled="saveReason ? 'true' : undefined" aria-describedby="save-reason"
            @click="requestSave"
          >
            {{ saving ? '저장하는 중…' : '저장하고 모델 서버에 반영' }}
          </button>
          <span id="save-reason" class="disabled-reason">{{ saveReason }}</span>
          <button type="button" class="btn btn-secondary" :disabled="!dirty || saving" @click="form = formFromSnapshot(original); serverErrors = {}">바꾼 값 되돌리기</button>
        </div>
        <div v-if="lastSaved" aria-live="polite" class="stack-8">
          <div v-if="applyStatus === 'applied'" class="row"><span class="chip s-done">모델 서버에 반영됨</span><span class="small">판본 #{{ lastSaved.setting_version_id }} · {{ dateTime(lastSaved.api_applied_at) }}</span></div>
          <div v-else-if="applyStatus === 'unapplied'" class="notice n-caution">
            <span class="chip s-caution">미반영</span>
            <span class="title">저장은 했지만 모델 서버에 반영하지 못했습니다</span>
            <p>모델 서버는 이전 값으로 동작하고 있습니다. 서버가 다시 응답하면 반영됩니다. 위 서버 상태 줄을 확인해 주십시오.</p>
          </div>
          <div v-else class="row"><span class="chip s-progress">반영 중</span><span class="small">판본 #{{ lastSaved.setting_version_id }} 저장됨. 모델 서버에 반영하고 있습니다.</span></div>
        </div>
      </div>
    </template>

    <ConfirmDialog v-if="confirmFallbackOff" title="대체 경로를 끄시겠습니까?" confirm-label="끄고 저장" :busy="saving" @confirm="save" @cancel="confirmFallbackOff = false">
      <p>대체 경로를 끄면 인식이 안 되거나 시간이 넘을 때 <b>사용자에게 결과를 보장하지 못합니다</b>. 서비스의 기본 약속(결과 보장)과 부딪힙니다.</p>
      <p class="small muted">점검 같은 짧은 시간에만 끄고, 끝나면 바로 켜 주십시오.</p>
    </ConfirmDialog>
  </section>
</template>
