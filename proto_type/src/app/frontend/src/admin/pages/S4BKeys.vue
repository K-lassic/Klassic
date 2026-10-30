<script setup lang="ts">
// S4-B 키 관리 (SD_02 §8 · T115 · UC14). 자동 발급 뒤 운영자의 일은 사후 확인: 최근 7일 신청 · 보관 처리 · 키 폐기 · 한도 조정 · 서비스 키 교체 · 변경 이력.
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { GateError } from '@/api/client';
import { adminApi } from '../api';
import TabList from '../components/TabList.vue';
import GateBlock from '../components/GateBlock.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import CopyCode from '../components/CopyCode.vue';
import AuditTable from '../components/AuditTable.vue';
import { dateTime } from '../lib/format';
import { keyLimitProblem, maskedKey } from '../lib/keys';
import type { ApplicationRow, AuditRow, IssuedServiceKey, KeyRow, LicenseState } from '../types';

const TABS = [
  { id: 'applications', label: '최근 7일 신청 내용' },
  { id: 'keys', label: '발급된 키' },
  { id: 'service', label: '서비스 전용 키' },
  { id: 'license', label: 'MP3 외부 제공' },
  { id: 'history', label: '변경 이력' },
];
const tab = ref('applications');

// ---------- 데이터 ----------
const keys = ref<KeyRow[]>([]);
const apps = ref<ApplicationRow[]>([]);
const history = ref<AuditRow[]>([]);
const license = ref<LicenseState | null>(null);
const licenseUnknown = ref(false);
const errors = ref<Record<string, string>>({});

async function loadKeys() {
  try { keys.value = await adminApi.keys(); delete errors.value.keys; } catch (e) { errors.value.keys = (e as Error).message; }
}
async function loadApps() {
  try { apps.value = await adminApi.applications(); delete errors.value.apps; } catch (e) { errors.value.apps = (e as Error).message; }
}
async function loadHistory() {
  try {
    const rows = await adminApi.audit({ limit: 200 });
    history.value = rows.filter((r) => ['access_key', 'key_application', 'license_policy'].includes(r.target_type)).sort((a, b) => (a.changed_at < b.changed_at ? 1 : -1));
    delete errors.value.history;
  } catch (e) { errors.value.history = (e as Error).message; }
}
async function loadLicense() {
  try { license.value = await adminApi.license(); licenseUnknown.value = false; } catch { licenseUnknown.value = true; }
}
onMounted(() => { void loadApps(); void loadKeys(); });
watch(tab, (t) => {
  if (t === 'history') void loadHistory();
  if (t === 'license' && !license.value) void loadLicense();
  if (t === 'keys' || t === 'service') void loadKeys();
  if (t === 'applications') void loadApps();
});

const flash = ref('');
function say(msg: string) { flash.value = msg; setTimeout(() => { if (flash.value === msg) flash.value = ''; }, 4000); }
const errText = (e: unknown) => (e instanceof GateError ? `${e.body.message}${e.body.fix ? ` ${e.body.fix}` : ''}` : (e as Error)?.message || '처리하지 못했습니다.');

// ---------- 신청 보관 처리 ----------
const selectedApp = ref<string | null>(null);
const appMsg = ref<Record<string, string>>({});
const archiving = ref<string | null>(null);
async function archive(a: ApplicationRow) {
  archiving.value = a.application_no;
  try {
    await adminApi.archiveApplication(a.application_no);
    say(`${a.application_no} 을(를) 보관 처리했습니다. 7일 자동 삭제에서 빠지고 변경 이력에 남습니다.`);
    await loadApps();
  } catch (e) {
    appMsg.value = {
      ...appMsg.value,
      [a.application_no]: e instanceof GateError && (e.status === 404 || e.status === 410) ? '이미 삭제된 신청입니다. 키 관리는 계속 할 수 있습니다.' : errText(e),
    };
  } finally {
    archiving.value = null;
  }
}
const appDetail = computed(() => apps.value.find((a) => a.application_no === selectedApp.value) ?? null);

// ---------- 키 한도 · 폐기 ----------
const selectedKey = ref<KeyRow | null>(null);
const limitInput = ref('');
const limitServerError = ref('');
const savingLimit = ref(false);
const limitProblem = computed(() => (selectedKey.value ? limitServerError.value || keyLimitProblem(limitInput.value) : null));
const limitUnchanged = computed(() => selectedKey.value && Number(limitInput.value) === selectedKey.value.call_limit_per_hour);
const limitReason = computed(() => (limitProblem.value ? '한도 값이 올바르지 않습니다' : limitUnchanged.value ? '지금 값과 같습니다' : selectedKey.value?.status !== 'active' ? '폐기된 키입니다' : ''));

function focusLimit() { document.getElementById('key-limit')?.focus(); }
async function chooseKey(k: KeyRow) {
  selectedKey.value = k;
  limitInput.value = k.call_limit_per_hour === null ? '' : String(k.call_limit_per_hour);
  limitServerError.value = '';
  await nextTick();
  document.getElementById('key-limit')?.focus();
}
async function saveLimit() {
  const k = selectedKey.value;
  if (!k || limitReason.value || savingLimit.value) return;
  savingLimit.value = true;
  try {
    await adminApi.setKeyLimit(k.key_id, Number(limitInput.value));
    say(`${maskedKey(k.key_prefix)} 한도를 시간당 ${limitInput.value}회로 바꿨습니다. 이후 호출부터 적용됩니다.`);
    await loadKeys();
    selectedKey.value = keys.value.find((x) => x.key_id === k.key_id) ?? null;
  } catch (e) {
    if (e instanceof GateError && e.gate === 'G6') limitServerError.value = e.body.message + (e.body.fix ? ` ${e.body.fix}` : '');
    else say(errText(e));
  } finally {
    savingLimit.value = false;
  }
}

const revokeTarget = ref<KeyRow | null>(null);
const revokeBusy = ref(false);
const revokeError = ref('');
async function doRevoke() {
  const k = revokeTarget.value;
  if (!k) return;
  revokeBusy.value = true;
  revokeError.value = '';
  try {
    await adminApi.revokeKey(k.key_id);
    revokeTarget.value = null;
    if (selectedKey.value?.key_id === k.key_id) selectedKey.value = null;
    say(`${maskedKey(k.key_prefix)} 키를 폐기했습니다. 이 키로 오는 호출은 이제 거절됩니다.`);
    await loadKeys();
  } catch (e) {
    revokeError.value = errText(e);
  } finally {
    revokeBusy.value = false;
  }
}

// ---------- 서비스 전용 키 ----------
const serviceKeys = computed(() => keys.value.filter((k) => k.key_kind === 'service'));
const activeServiceKey = computed(() => serviceKeys.value.find((k) => k.status === 'active') ?? null);
const confirmIssue = ref(false);
const issuing = ref(false);
const issueError = ref('');
const issued = ref<IssuedServiceKey | null>(null);
const storedAck = ref(false);
async function issue() {
  issuing.value = true;
  issueError.value = '';
  try {
    issued.value = await adminApi.issueServiceKey();
    storedAck.value = false;
    confirmIssue.value = false;
    await loadKeys();
  } catch (e) {
    issueError.value = errText(e);
  } finally {
    issuing.value = false;
  }
}
function closeIssued() { issued.value = null; storedAck.value = false; }

// ---------- MP3 라이선스 (G7) ----------
const licenseConfirm = ref<boolean | null>(null);
const licenseBusy = ref(false);
const licenseError = ref('');
async function setLicense() {
  if (licenseConfirm.value === null) return;
  licenseBusy.value = true;
  licenseError.value = '';
  try {
    const r = await adminApi.setLicense(licenseConfirm.value);
    license.value = r && typeof r === 'object' ? r : { confirmed: licenseConfirm.value, decided_at: new Date().toISOString() };
    licenseUnknown.value = false;
    say(licenseConfirm.value ? 'MP3 외부 제공을 열었습니다. 변경 이력에 남았습니다.' : 'MP3 외부 제공을 닫았습니다. 변경 이력에 남았습니다.');
    licenseConfirm.value = null;
  } catch (e) {
    licenseError.value = errText(e);
  } finally {
    licenseBusy.value = false;
  }
}

function keyStatusChip(k: KeyRow) {
  return k.status === 'active' ? { cls: 's-done', text: '사용 중' } : { cls: 's-expired', text: '폐기' };
}
</script>

<template>
  <main id="admin-main" class="admin-main">
    <header>
      <span class="eyebrow">키 관리</span>
      <h1 class="h2">API 키와 신청 내용</h1>
      <p class="small muted" style="margin: 0">키는 신청하면 자동으로 발급됩니다. 여기서는 사후 확인을 합니다: 신청 내용 보기·보관 처리, 키 폐기, 한도 조정, 서비스 키 교체.</p>
    </header>

    <TabList v-model="tab" :tabs="TABS" id-prefix="keys" label="키 관리 메뉴" />
    <p class="small" role="status" aria-live="polite" style="margin: 0; min-height: 20px">{{ flash }}</p>

    <!-- 최근 7일 신청 -->
    <section v-show="tab === 'applications'" id="keys-panel-applications" role="tabpanel" aria-labelledby="keys-tab-applications" tabindex="0" class="stack">
      <p class="small" style="margin: 0">신청 내용(이름·소속·이메일·목적)은 <b>7일 뒤 자동으로 지워집니다</b>. 남겨야 할 신청만 [보관 처리] 하십시오. 개인정보는 가린 값만 보입니다.</p>
      <div v-if="errors.apps" class="notice n-rejected" role="alert"><span class="title">신청 내용을 불러오지 못했습니다</span><p>{{ errors.apps }}</p></div>
      <div class="table-scroll">
        <table class="spec">
          <caption class="sr-only">최근 7일 신청 내용</caption>
          <thead>
            <tr>
              <th scope="col">신청 번호</th><th scope="col">이름</th><th scope="col">소속</th><th scope="col">이메일</th><th scope="col">신청 시각</th>
              <th scope="col">삭제 예정</th><th scope="col">키</th><th scope="col">행동</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!apps.length"><td colspan="8" class="muted">최근 7일 안의 신청이 없습니다.</td></tr>
            <tr v-for="a in apps" :key="a.application_no" :class="{ 'is-selected': selectedApp === a.application_no }">
              <th scope="row"><button type="button" class="link-btn" :aria-expanded="selectedApp === a.application_no ? 'true' : 'false'" @click="selectedApp = selectedApp === a.application_no ? null : a.application_no">{{ a.application_no }}</button></th>
              <td>{{ a.applicant_name_masked }}</td>
              <td>{{ a.affiliation ?? '—' }}</td>
              <td>{{ a.contact_email_masked }}</td>
              <td class="nowrap">{{ dateTime(a.applied_at) }}</td>
              <td class="nowrap"><span v-if="a.is_retained" class="chip s-done">보관 처리됨</span><span v-else>{{ dateTime(a.delete_due_at) }}</span></td>
              <td><code>{{ maskedKey(a.key_prefix) }}</code><span v-if="a.key_status === 'revoked'" class="muted"> · 폐기</span></td>
              <td>
                <div class="stack-8">
                  <button type="button" class="btn btn-secondary btn-sm" :disabled="!!a.is_retained || archiving === a.application_no" @click="archive(a)">
                    {{ a.is_retained ? '보관 처리됨' : archiving === a.application_no ? '처리 중…' : '보관 처리' }}
                  </button>
                  <span v-if="appMsg[a.application_no]" class="field-error" style="padding-left: 0">{{ appMsg[a.application_no] }}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="appDetail" class="panel white" aria-live="polite">
        <h2 class="h3">신청 {{ appDetail.application_no }}</h2>
        <dl class="kv">
          <dt>이름</dt><dd>{{ appDetail.applicant_name_masked }}</dd>
          <dt>소속</dt><dd>{{ appDetail.affiliation ?? '—' }}</dd>
          <dt>연락 이메일</dt><dd>{{ appDetail.contact_email_masked }}</dd>
          <dt>사용 목적</dt><dd>{{ appDetail.purpose ?? '—' }}</dd>
          <dt>신청 시각</dt><dd>{{ dateTime(appDetail.applied_at) }}</dd>
          <dt>삭제 예정</dt><dd>{{ appDetail.is_retained ? '보관 처리됨(자동 삭제하지 않습니다)' : dateTime(appDetail.delete_due_at) }}</dd>
          <dt>연결된 키</dt><dd><code>{{ maskedKey(appDetail.key_prefix) }}</code> · {{ appDetail.key_status === 'revoked' ? '폐기' : '사용 중' }}</dd>
        </dl>
      </div>
    </section>

    <!-- 발급된 키 -->
    <section v-show="tab === 'keys'" id="keys-panel-keys" role="tabpanel" aria-labelledby="keys-tab-keys" tabindex="0" class="stack">
      <p class="small" style="margin: 0">키 원문은 어디에도 저장하지 않습니다. 앞자리만 보입니다.</p>
      <div v-if="errors.keys" class="notice n-rejected" role="alert"><span class="title">키 목록을 불러오지 못했습니다</span><p>{{ errors.keys }}</p></div>
      <div class="table-scroll">
        <table class="spec">
          <caption class="sr-only">발급된 키</caption>
          <thead>
            <tr><th scope="col">키 앞자리</th><th scope="col">종류</th><th scope="col" class="num-col">호출 한도(시간당)</th><th scope="col">발급 시각</th><th scope="col">상태</th><th scope="col">신청 번호</th><th scope="col">행동</th></tr>
          </thead>
          <tbody>
            <tr v-if="!keys.length"><td colspan="7" class="muted">발급된 키가 없습니다.</td></tr>
            <tr v-for="k in keys" :key="k.key_id" :class="{ 'is-selected': selectedKey?.key_id === k.key_id }">
              <th scope="row"><code>{{ maskedKey(k.key_prefix) }}</code></th>
              <td>{{ k.key_kind === 'service' ? '서비스 전용' : '외부' }}</td>
              <td class="num-col">{{ k.call_limit_per_hour ?? (k.key_kind === 'service' ? '제한 없음' : '—') }}</td>
              <td class="nowrap">{{ dateTime(k.issued_at) }}</td>
              <td><span :class="['chip', keyStatusChip(k).cls]">{{ keyStatusChip(k).text }}</span></td>
              <td>
                {{ k.application_no ?? '—' }}
                <span v-if="k.application_purged" class="small muted"><br />신청 내용은 7일이 지나 지워졌습니다</span>
              </td>
              <td>
                <div v-if="k.status === 'active'" class="row-actions">
                  <button v-if="k.key_kind !== 'service'" type="button" class="btn btn-secondary btn-sm" :aria-label="`${maskedKey(k.key_prefix)} 한도 조정`" @click="chooseKey(k)">한도 조정</button>
                  <button type="button" class="btn btn-secondary btn-sm" :aria-label="`${maskedKey(k.key_prefix)} 폐기`" @click="revokeError = ''; revokeTarget = k">폐기</button>
                </div>
                <span v-else class="muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <form v-if="selectedKey" class="panel white" aria-labelledby="limit-h" @submit.prevent="saveLimit">
        <h2 id="limit-h" class="h3">키 <code>{{ maskedKey(selectedKey.key_prefix) }}</code> 한도 조정</h2>
        <div class="row" style="align-items: flex-start">
          <div class="field">
            <label for="key-limit">호출 한도 (시간당)</label>
            <input
              id="key-limit" v-model="limitInput" class="input num" inputmode="numeric" :aria-invalid="limitProblem ? 'true' : undefined"
              :aria-describedby="limitProblem ? 'key-limit-err' : 'key-limit-now'" @input="limitServerError = ''"
            />
            <span v-if="limitProblem" id="key-limit-err" class="field-error">{{ limitProblem }}</span>
          </div>
          <p id="key-limit-now" class="small" style="margin: 36px 0 0">지금 값: {{ selectedKey.call_limit_per_hour ?? '—' }}</p>
        </div>
        <GateBlock
          v-if="limitProblem"
          gate="G6 운영 값 검증"
          title="저장할 수 없습니다"
          :reason="limitProblem"
          owner="운영자(나)가 값을 고쳐 다시 저장합니다"
          action-label="한도 입력칸으로 가기"
          @action="focusLimit"
        />
        <div class="row">
          <button type="submit" class="btn btn-secondary" :aria-disabled="limitReason ? 'true' : undefined" :disabled="savingLimit" aria-describedby="limit-reason">
            {{ savingLimit ? '저장하는 중…' : '한도 저장' }}
          </button>
          <span id="limit-reason" class="disabled-reason">{{ limitReason }}</span>
          <button type="button" class="btn btn-secondary" @click="selectedKey = null">닫기</button>
        </div>
        <p class="small muted" style="margin: 0">저장하면 이후 호출부터 적용됩니다. 변경 이력에 남습니다.</p>
      </form>
    </section>

    <!-- 서비스 전용 키 -->
    <section v-show="tab === 'service'" id="keys-panel-service" role="tabpanel" aria-labelledby="keys-tab-service" tabindex="0" class="stack">
      <div class="panel">
        <h2 class="h3">서비스 전용 키</h2>
        <p style="margin: 0">웹 서비스가 모델 API 서버를 부를 때 쓰는 키입니다. 새로 발급하면 <b>지금 쓰는 키는 바로 폐기</b>됩니다.</p>
        <dl class="kv">
          <dt>지금 키</dt>
          <dd><code v-if="activeServiceKey">{{ maskedKey(activeServiceKey.key_prefix) }}</code><span v-else>없음</span></dd>
          <dt>발급 시각</dt><dd>{{ dateTime(activeServiceKey?.issued_at) }}</dd>
        </dl>
        <div v-if="issueError" class="notice n-rejected" role="alert"><span class="title">발급하지 못했습니다</span><p>{{ issueError }}</p></div>
        <div class="row">
          <button type="button" class="btn btn-secondary" @click="confirmIssue = true">{{ activeServiceKey ? '새 키로 교체' : '서비스 키 발급' }}</button>
        </div>
      </div>

      <div v-if="issued" class="notice n-caution" role="alert">
        <span class="chip s-caution">한 번만 보입니다 (G9)</span>
        <span class="title">새 서비스 키입니다. 지금 복사해 두십시오</span>
        <p>이 화면을 닫으면 다시 볼 수 없습니다. 원문은 저장하지 않습니다.</p>
        <CopyCode :text="issued.api_key" label="새 서비스 키 원문" />
        <p>웹 서비스 설정 <code class="inline">SERVICE_API_KEY</code> 에 넣고 웹 서비스를 다시 시작해 주십시오. 그 전까지는 웹이 모델 서버를 부르지 못해 <b>대체 결과만</b> 나갑니다.</p>
        <label class="row small" style="gap: 8px"><input v-model="storedAck" type="checkbox" /> 키를 안전한 곳에 보관했습니다</label>
        <div class="row">
          <button type="button" class="btn btn-secondary" :aria-disabled="!storedAck ? 'true' : undefined" aria-describedby="issued-reason" @click="storedAck && closeIssued()">닫기</button>
          <span id="issued-reason" class="disabled-reason">{{ storedAck ? '' : '보관했다고 표시해야 닫을 수 있습니다' }}</span>
        </div>
      </div>
    </section>

    <!-- MP3 외부 제공 (G7) -->
    <section v-show="tab === 'license'" id="keys-panel-license" role="tabpanel" aria-labelledby="keys-tab-license" tabindex="0" class="stack">
      <div class="panel">
        <h2 class="h3">MP3 외부 제공 (라이선스 확인 · G7)</h2>
        <p style="margin: 0">
          API 호출자에게 MP3를 줄지는 음원(사운드폰트)·렌더러 <b>라이선스를 확인한 뒤 팀장이 정합니다</b>.
          확인 전에는 API 결과에서 MP3를 빼고 보냅니다. 이 화면은 <b>팀장의 결정을 기록</b>하는 곳입니다. 결정 없이 바꾸지 마십시오.
        </p>
        <dl class="kv">
          <dt>지금 상태</dt>
          <dd>
            <span v-if="licenseUnknown && !license" class="chip s-waiting">확인 못 함</span>
            <span v-else-if="license?.confirmed" class="chip s-done">확인됨 · MP3 제공</span>
            <span v-else-if="license" class="chip s-expired">확인 전 · MP3 빼고 보냄</span>
          </dd>
          <dt>결정 기록</dt>
          <dd>{{ license?.decided_at ? `${license.decided_by_masked ?? (license.decided_by ? `운영자 #${license.decided_by}` : '')} · ${dateTime(license.decided_at)}` : '—' }}</dd>
        </dl>
        <p v-if="licenseUnknown && !license" class="small muted" style="margin: 0">지금 상태를 불러오지 못했습니다. 바꾸면 변경 이력에서 확인할 수 있습니다.</p>
        <div v-if="licenseError" class="notice n-rejected" role="alert"><p>{{ licenseError }}</p></div>
        <div class="row">
          <button v-if="!license?.confirmed" type="button" class="btn btn-secondary" @click="licenseConfirm = true">팀장 확인 기록 · MP3 제공 열기</button>
          <button v-if="license?.confirmed || licenseUnknown" type="button" class="btn btn-secondary" @click="licenseConfirm = false">MP3 제공 닫기</button>
        </div>
      </div>
    </section>

    <!-- 변경 이력 -->
    <section v-show="tab === 'history'" id="keys-panel-history" role="tabpanel" aria-labelledby="keys-tab-history" tabindex="0" class="stack">
      <div v-if="errors.history" class="notice n-rejected" role="alert"><span class="title">변경 이력을 불러오지 못했습니다</span><p>{{ errors.history }}</p></div>
      <AuditTable :rows="history" caption="키·신청·라이선스 변경 이력" />
    </section>

    <!-- 확인 대화상자 -->
    <ConfirmDialog
      v-if="revokeTarget" :title="`키 ${maskedKey(revokeTarget.key_prefix)} 를 폐기하시겠습니까?`" confirm-label="폐기" :busy="revokeBusy" :error="revokeError"
      @confirm="doRevoke" @cancel="revokeTarget = null"
    >
      <p>폐기하면 되돌릴 수 없습니다. 이 키로 오는 호출은 바로 거절됩니다(G2).</p>
      <p v-if="revokeTarget.key_kind === 'service'"><b>서비스 전용 키입니다.</b> 폐기하면 웹이 모델 서버를 부르지 못해 사용자에게 <b>대체 결과만</b> 나갑니다. 보통은 [새 키로 교체]를 쓰십시오.</p>
    </ConfirmDialog>
    <ConfirmDialog v-if="confirmIssue" :title="activeServiceKey ? '서비스 키를 교체하시겠습니까?' : '서비스 키를 발급하시겠습니까?'" confirm-label="발급" :busy="issuing" :error="issueError" @confirm="issue" @cancel="confirmIssue = false">
      <p v-if="activeServiceKey">지금 키 <code>{{ maskedKey(activeServiceKey.key_prefix) }}</code> 는 바로 폐기됩니다. 새 키를 웹 서비스 설정에 넣기 전까지는 사용자에게 대체 결과만 나갑니다.</p>
      <p>새 키 원문은 발급 직후 <b>한 번만</b> 보입니다.</p>
    </ConfirmDialog>
    <ConfirmDialog
      v-if="licenseConfirm !== null" :title="licenseConfirm ? 'MP3 외부 제공을 여시겠습니까?' : 'MP3 외부 제공을 닫으시겠습니까?'" confirm-label="기록하기" :busy="licenseBusy" :error="licenseError"
      @confirm="setLicense" @cancel="licenseConfirm = null"
    >
      <p v-if="licenseConfirm">팀장이 음원·렌더러 라이선스를 확인하고 MP3 제공을 결정했습니까? 누가 언제 바꿨는지 변경 이력에 남습니다.</p>
      <p v-else>닫으면 API 결과에서 다시 MP3를 빼고 보냅니다. 누가 언제 바꿨는지 변경 이력에 남습니다.</p>
    </ConfirmDialog>
  </main>
</template>
