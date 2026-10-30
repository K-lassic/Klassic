<script setup lang="ts">
// [모델 추가] 대화상자 (INTERFACES §7): 가상환경(이름·종류·폴더·어댑터) / Ollama(공유 서버에 이미 있는 10GB 이하 모델에서 고르기).
// 서버에 없는 모델은 `ollama pull <태그>` 명령만 안내한다 — 이 화면은 pull 을 하지 않는다(OLLAMA 설정 참조 §7.3·§7.5).
import { computed, ref, watch } from 'vue';
import { GateError } from '@/api/client';
import { adminApi } from '../../api';
import ModalDialog from '../../components/ModalDialog.vue';
import CopyCode from '../../components/CopyCode.vue';
import { ADAPTER_KIND, VENV_ADAPTERS, ollamaTagProblem, suggestModelName, validateNewModel, type NewModelDraft } from '../../lib/models';
import { KIND_LABEL } from '../../lib/format';
import type { AdminModel, OllamaAvailable } from '../../types';

const props = defineProps<{ existing: string[] }>();
const emit = defineEmits<{ close: []; added: [model: AdminModel | null, name: string] }>();

const draft = ref<NewModelDraft>({ provider: 'venv', model_name: '', display_name: '', kind: 'omr_staff', provider_ref: '', adapter: '' });
const nameTouched = ref(false);
const tried = ref(false);
const saving = ref(false);
const serverError = ref<{ title: string; text: string } | null>(null);

const ollama = ref<OllamaAvailable | null>(null);
const ollamaState = ref<'idle' | 'loading' | 'ok' | 'unreachable' | 'error'>('idle');
const ollamaError = ref('');
const pullTag = ref('');

async function loadOllama() {
  ollamaState.value = 'loading';
  ollamaError.value = '';
  try {
    const r = await adminApi.ollamaAvailable();
    ollama.value = r;
    ollamaState.value = r.ollama === 'unreachable' ? 'unreachable' : 'ok';
  } catch (e) {
    if (e instanceof GateError && e.code === 'OLLAMA_UNAVAILABLE') ollamaState.value = 'unreachable';
    else { ollamaState.value = 'error'; ollamaError.value = (e as Error).message; }
  }
}

watch(() => draft.value.provider, (p) => {
  draft.value.provider_ref = '';
  if (!nameTouched.value) { draft.value.model_name = ''; draft.value.display_name = ''; }
  if (p === 'ollama') {
    draft.value.kind = 'recommend';
    draft.value.adapter = '';
    if (ollamaState.value === 'idle') void loadOllama();
  } else {
    draft.value.kind = 'omr_staff';
  }
});
watch(() => draft.value.adapter, (a) => { if (a) draft.value.kind = ADAPTER_KIND[a]; });

function pickTag(tag: string) {
  draft.value.provider_ref = tag;
  if (!nameTouched.value) {
    draft.value.model_name = suggestModelName(tag);
    draft.value.display_name = `AI 추천 (${tag})`;
  }
}

const errors = computed(() => validateNewModel(draft.value, props.existing));
const shownErrors = computed(() => (tried.value ? errors.value : {}));
const pullProblem = computed(() => (pullTag.value ? ollamaTagProblem(pullTag.value) : null));
const pullCommand = computed(() => `ollama pull ${pullTag.value.trim() || '<모델:태그>'}`);

async function submit() {
  tried.value = true;
  serverError.value = null;
  if (Object.keys(errors.value).length) {
    const first = Object.keys(errors.value)[0];
    document.getElementById(`am-${first}`)?.focus();
    return;
  }
  saving.value = true;
  const d = draft.value;
  try {
    const created = await adminApi.addModel({
      model_name: d.model_name,
      kind: d.kind,
      provider: d.provider,
      display_name: d.display_name.trim(),
      provider_ref: d.provider_ref.trim(),
      config: d.provider === 'venv' ? { adapter: d.adapter } : null,
    });
    emit('added', created && typeof created === 'object' ? created : null, d.model_name);
  } catch (e) {
    if (e instanceof GateError) {
      serverError.value = {
        title: e.code === 'MODEL_INVALID' ? '모델 정보를 저장할 수 없습니다' : e.code === 'OLLAMA_UNAVAILABLE' ? '공유 Ollama 서버에 연결할 수 없습니다' : '모델을 추가하지 못했습니다',
        text: `${e.body.message}${e.body.fix ? ` ${e.body.fix}` : ''}`,
      };
    } else serverError.value = { title: '모델을 추가하지 못했습니다', text: (e as Error).message };
  } finally {
    saving.value = false;
  }
}

function describedBy(field: keyof NewModelDraft, hint?: string) {
  return [shownErrors.value[field] ? `am-${field}-err` : '', hint ?? ''].filter(Boolean).join(' ') || undefined;
}
</script>

<template>
  <ModalDialog title="모델 추가" @close="emit('close')">
    <form class="stack" novalidate @submit.prevent="submit">
      <div class="field">
        <span id="am-prov-l" class="label">어디서 불러옵니까</span>
        <div class="segmented" role="radiogroup" aria-labelledby="am-prov-l">
          <label><input v-model="draft.provider" type="radio" name="am-provider" value="venv" /><span>가상환경</span></label>
          <label><input v-model="draft.provider" type="radio" name="am-provider" value="ollama" /><span>Ollama</span></label>
        </div>
        <span class="hint">{{ draft.provider === 'venv' ? '인식 엔진을 설치한 Python 가상환경을 모델 API 서버가 부릅니다.' : '팀이 함께 쓰는 Ollama 서버에 이미 있는 모델만 등록할 수 있습니다.' }}</span>
      </div>

      <!-- Ollama: 서버에 있는 모델 고르기 -->
      <template v-if="draft.provider === 'ollama'">
        <p v-if="ollamaState === 'loading'" class="small muted" aria-live="polite">공유 서버의 모델 목록을 읽는 중…</p>
        <div v-else-if="ollamaState === 'unreachable'" class="notice n-rejected" role="alert">
          <span class="chip s-rejected">OLLAMA_UNAVAILABLE</span>
          <span class="title">공유 Ollama 서버에 연결할 수 없습니다</span>
          <p>관리자에게 Ollama 서버 확인을 요청해 주십시오. 직접 <code class="inline">ollama serve</code> 를 실행하지 않습니다.</p>
          <div class="row"><button type="button" class="btn btn-secondary" @click="loadOllama">다시 확인</button></div>
        </div>
        <div v-else-if="ollamaState === 'error'" class="notice n-rejected" role="alert"><span class="title">모델 목록을 읽지 못했습니다</span><p>{{ ollamaError }}</p></div>
        <fieldset v-else-if="ollama" class="stack-8" style="border: 0; padding: 0; margin: 0">
          <legend class="h4">서버에 있는 모델 (10GB 이하 · :cloud 제외)</legend>
          <span v-if="ollama.version" class="small muted">Ollama {{ ollama.version }}</span>
          <div class="table-scroll">
            <table class="spec" aria-describedby="am-provider_ref-err">
              <thead><tr><th scope="col"><span class="sr-only">고르기</span></th><th scope="col">태그</th><th scope="col" class="num-col">크기</th><th scope="col">계열 · 크기</th><th scope="col">상태</th></tr></thead>
              <tbody>
                <tr v-if="!ollama.models.length"><td colspan="5" class="muted">쓸 수 있는 모델이 없습니다. 아래 안내대로 사람이 먼저 받아 두어야 합니다.</td></tr>
                <tr v-for="(o, i) in ollama.models" :key="o.tag">
                  <td>
                    <input
                      :id="i === 0 ? 'am-provider_ref' : `am-tag-${i}`" type="radio" name="am-tag" :value="o.tag" :checked="draft.provider_ref === o.tag"
                      :disabled="o.registered" :aria-label="`${o.tag} 고르기`" @change="pickTag(o.tag)"
                    />
                  </td>
                  <th scope="row"><code>{{ o.tag }}</code></th>
                  <td class="num-col">{{ o.size_gb === null ? '—' : `${o.size_gb.toFixed(1)}GB` }}</td>
                  <td>{{ [o.family, o.parameter_size].filter(Boolean).join(' · ') || '—' }}</td>
                  <td><span v-if="o.registered" class="chip s-done">이미 등록됨</span><span v-else class="chip s-waiting">등록 가능</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <span v-if="shownErrors.provider_ref" id="am-provider_ref-err" class="field-error">{{ shownErrors.provider_ref }}</span>
          <div class="row"><button type="button" class="btn btn-secondary btn-sm" @click="loadOllama">목록 새로 고침</button></div>
        </fieldset>

        <details class="panel white">
          <summary class="h4" style="cursor: pointer">목록에 없는 모델을 쓰고 싶습니다</summary>
          <div class="stack-16" style="margin-top: 16px">
            <p class="small" style="margin: 0">
              공유 서버에 모델을 받는 일은 <b>사람이 한 번</b> 직접 합니다. 이 화면은 명령만 보여 주고 실행하지 않습니다(공유 서버 규칙).
              받으면 서버 전체에 추가되어 다른 사람도 함께 씁니다.
            </p>
            <ul class="small" style="margin: 0; padding-left: 20px">
              <li>먼저 <code class="inline">ollama list</code> 로 이미 있는지 확인합니다. 있으면 받지 않습니다.</li>
              <li>크기는 <b>10GB 이하</b>만 (대략 14B 이하, Q4). 넘으면 관리자와 협의합니다.</li>
              <li>태그를 꼭 붙입니다 (예: <code class="inline">gemma3:4b</code>). <code class="inline">:latest</code> 생략 금지.</li>
              <li>이름에 <code class="inline">:cloud</code> 가 붙은 모델은 쓰지 않습니다.</li>
              <li>한 사람이 새로 받는 모델은 3개 이하. 서버의 모델을 지우거나(rm) 내리지(stop) 않습니다.</li>
            </ul>
            <div class="field">
              <label for="am-pull">받을 모델 태그</label>
              <input id="am-pull" v-model="pullTag" class="input compact" placeholder="예: qwen3:4b" :aria-invalid="pullProblem ? 'true' : undefined" :aria-describedby="pullProblem ? 'am-pull-err' : undefined" />
              <span v-if="pullProblem" id="am-pull-err" class="field-error">{{ pullProblem }}</span>
            </div>
            <CopyCode :text="pullCommand" label="서버에서 사람이 한 번 실행할 명령" />
            <p class="small muted" style="margin: 0">받은 뒤 [목록 새로 고침]을 누르면 여기서 고를 수 있습니다.</p>
          </div>
        </details>
      </template>

      <div class="form-band" style="padding: 32px">
        <div class="fields">
          <div class="field">
            <label for="am-model_name">모델 이름 (설정에 쓰는 이름)</label>
            <input
              id="am-model_name" v-model="draft.model_name" class="input compact" autocomplete="off" placeholder="예: homr-v2" spellcheck="false"
              :aria-invalid="shownErrors.model_name ? 'true' : undefined" :aria-describedby="describedBy('model_name', 'am-model_name-hint')" @input="nameTouched = true"
            />
            <span v-if="shownErrors.model_name" id="am-model_name-err" class="field-error">{{ shownErrors.model_name }}</span>
            <span id="am-model_name-hint" class="hint">영어 소문자·숫자·. _ - (2~40자)</span>
          </div>
          <div class="field">
            <label for="am-display_name">화면에 보일 이름</label>
            <input
              id="am-display_name" v-model="draft.display_name" class="input compact" placeholder="예: homr 오선보 인식 v2"
              :aria-invalid="shownErrors.display_name ? 'true' : undefined" :aria-describedby="describedBy('display_name')"
            />
            <span v-if="shownErrors.display_name" id="am-display_name-err" class="field-error">{{ shownErrors.display_name }}</span>
          </div>
          <template v-if="draft.provider === 'venv'">
            <div class="field">
              <label for="am-adapter">어댑터</label>
              <select id="am-adapter" v-model="draft.adapter" class="input compact" :aria-invalid="shownErrors.adapter ? 'true' : undefined" :aria-describedby="describedBy('adapter')">
                <option value="">고르기</option>
                <option v-for="a in VENV_ADAPTERS" :key="a" :value="a">{{ a }}</option>
              </select>
              <span v-if="shownErrors.adapter" id="am-adapter-err" class="field-error">{{ shownErrors.adapter }}</span>
            </div>
            <div class="field">
              <label for="am-kind">맡는 기능</label>
              <select id="am-kind" v-model="draft.kind" class="input compact" :aria-invalid="shownErrors.kind ? 'true' : undefined" :aria-describedby="describedBy('kind')">
                <option value="omr_staff">{{ KIND_LABEL.omr_staff }}</option>
                <option value="omr_jeongganbo">{{ KIND_LABEL.omr_jeongganbo }}</option>
              </select>
              <span v-if="shownErrors.kind" id="am-kind-err" class="field-error">{{ shownErrors.kind }}</span>
            </div>
            <div class="field" style="grid-column: 1 / -1">
              <label for="am-provider_ref">가상환경 폴더</label>
              <input
                id="am-provider_ref" v-model="draft.provider_ref" class="input compact" placeholder="예: ~/venvs/homr" spellcheck="false"
                :aria-invalid="shownErrors.provider_ref ? 'true' : undefined" :aria-describedby="describedBy('provider_ref', 'am-ref-hint')"
              />
              <span v-if="shownErrors.provider_ref" id="am-provider_ref-err" class="field-error">{{ shownErrors.provider_ref }}</span>
              <span id="am-ref-hint" class="hint">모델 API 서버가 &lt;폴더&gt;/bin/python 으로 엔진을 부릅니다. 없으면 "설치 안 됨"으로 보입니다.</span>
            </div>
          </template>
          <div v-else class="field">
            <span class="label">맡는 기능</span>
            <span class="small">{{ KIND_LABEL.recommend }}: 규칙표(rules)는 늘 마지막 안전판으로 남습니다.</span>
          </div>
        </div>
      </div>

      <div v-if="serverError" class="notice n-rejected" role="alert">
        <span class="chip s-rejected">반려 · G6 운영 값 검증</span>
        <span class="title">{{ serverError.title }}</span>
        <p>{{ serverError.text }}</p>
      </div>

      <p class="small muted" style="margin: 0">등록한 뒤 [불러오기]를 한 번 해 두면 첫 사용자가 기다리지 않습니다. 불러오기는 10~60초 걸릴 수 있고, 그동안에도 사용자는 대체 결과로 늘 결과를 받습니다.</p>
      <div class="dialog-foot">
        <button type="button" class="btn btn-secondary" @click="emit('close')">그만두기</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? '등록하는 중…' : '모델 등록' }}</button>
      </div>
    </form>
  </ModalDialog>
</template>
