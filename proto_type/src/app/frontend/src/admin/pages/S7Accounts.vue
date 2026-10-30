<script setup lang="ts">
// S7 계정·권한 (SD_02 §10A · UC17 · FR-069 · 2026-09-29 RBAC 운영자 메뉴 — 조성기).
// 탭 3개(계정 · 권한표 · 접근 기록) + 계정 상세. 조작은 확인 창만 거치고 사유는 받지 않는다(사유는 API 키 신청 때만).
// 막히면 C2 차단 블록(G16). api_caller·service 역할은 보이지 않는다(BR-ADM-05).
import { computed, onMounted, ref, watch } from 'vue';
import { GateError } from '@/api/client';
import { adminApi } from '../api';
import TabList from '../components/TabList.vue';
import GateBlock from '../components/GateBlock.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { dateTime } from '../lib/format';
import type { AccountDetail, AccountRow, AuthEvents, PermissionTable } from '../types';

const TABS = [
  { id: 'accounts', label: '계정' },
  { id: 'permissions', label: '권한표' },
  { id: 'events', label: '접근 기록' },
];
const tab = ref('accounts');

const flash = ref('');
function say(msg: string) { flash.value = msg; setTimeout(() => { if (flash.value === msg) flash.value = ''; }, 4000); }
const errText = (e: unknown) => (e instanceof GateError ? `${e.body.message}${e.body.fix ? ` ${e.body.fix}` : ''}` : (e as Error)?.message || '처리하지 못했습니다.');

const ROLE_LABEL: Record<string, string> = { user: '사용자', operator: '운영자', api_caller: 'API 호출자', service: '서비스' };
const STATUS_CHIP: Record<AccountRow['status'], { cls: string; text: string }> = {
  active: { cls: 's-done', text: '사용 중' },
  locked: { cls: 's-caution', text: '잠김' },
  disabled: { cls: 's-expired', text: '사용 중지' },
};

// ---------- 계정 목록 ----------
const q = ref('');
const roleFilter = ref('');
const statusFilter = ref('');
const page = ref(1);
const list = ref<AccountRow[]>([]);
const total = ref(0);
const pageSize = ref(50);
const listError = ref('');
const loading = ref(false);
async function loadList() {
  loading.value = true;
  try {
    const r = await adminApi.accounts({ q: q.value.trim(), role: roleFilter.value, status: statusFilter.value, page: page.value });
    list.value = r.items; total.value = r.total; pageSize.value = r.page_size;
    listError.value = '';
  } catch (e) { listError.value = errText(e); } finally { loading.value = false; }
}
function search() { page.value = 1; void loadList(); }
const lastPage = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
function go(p: number) { page.value = p; void loadList(); }

// ---------- 계정 상세 ----------
const detail = ref<AccountDetail | null>(null);
const detailError = ref('');
const revealed = ref<string | null>(null);
const gate = ref<GateError | null>(null);
async function openAccount(id: number) {
  gate.value = null; revealed.value = null;
  try { detail.value = await adminApi.account(id); detailError.value = ''; } catch (e) { detailError.value = errText(e); }
}
const acc = computed(() => detail.value?.account ?? null);
const lockedLeft = computed(() => {
  const u = acc.value?.locked_until;
  if (!u || acc.value?.status !== 'locked') return '';
  const min = Math.max(1, Math.ceil((new Date(u).getTime() - Date.now()) / 60000));
  return `${min}분 남음`;
});

type Action =
  | { kind: 'grant' | 'revoke'; role: 'user' | 'operator' }
  | { kind: 'unlock' | 'disable' | 'enable' };
const pending = ref<Action | null>(null);
const busy = ref(false);
const actionError = ref('');
const confirmTitle = computed(() => {
  const a = pending.value;
  if (!a || !acc.value) return '';
  const who = acc.value.login_id_masked;
  if (a.kind === 'grant') return `${who} 에 ${ROLE_LABEL[a.role]} 역할을 주시겠습니까?`;
  if (a.kind === 'revoke') return `${who} 에서 ${ROLE_LABEL[a.role]} 역할을 빼시겠습니까?`;
  if (a.kind === 'unlock') return `${who} 의 잠금을 푸시겠습니까?`;
  if (a.kind === 'disable') return `${who} 를 사용 중지하시겠습니까?`;
  return `${who} 를 다시 사용하게 하시겠습니까?`;
});
function ask(a: Action) { actionError.value = ''; pending.value = a; }
async function run() {
  const a = pending.value;
  const id = acc.value?.account_id;
  if (!a || !id) return;
  busy.value = true; actionError.value = '';
  try {
    if (a.kind === 'grant') detail.value = await adminApi.setRoles(id, { grant: [a.role] });
    else if (a.kind === 'revoke') detail.value = await adminApi.setRoles(id, { revoke: [a.role] });
    else if (a.kind === 'unlock') detail.value = await adminApi.unlockAccount(id);
    else if (a.kind === 'disable') detail.value = await adminApi.disableAccount(id);
    else detail.value = await adminApi.enableAccount(id);
    pending.value = null; gate.value = null;
    say('반영했습니다. 변경 이력에 남았습니다.');
    void loadList();
  } catch (e) {
    if (e instanceof GateError && e.gate === 'G16') { gate.value = e; pending.value = null; }
    else actionError.value = errText(e);
  } finally { busy.value = false; }
}
const gateOwner = computed(() => (gate.value?.code === 'ROLE_NOT_ASSIGNABLE' ? '운영자(나)가 줄 수 있는 역할만 고릅니다' : '운영자(나)가 다른 계정에 먼저 operator 역할을 줍니다'));
const gateNext = computed(() => (gate.value?.code === 'ADMIN_SELF_PROTECTED' ? '다른 운영자에게 부탁해 주십시오' : gate.value?.code === 'ADMIN_LAST_OPERATOR' ? '계정 목록에서 다른 팀원 계정을 열어 [역할 주기: 운영자]' : undefined));

async function revealAndKeep() {
  const id = acc.value?.account_id;
  if (!id) return;
  try {
    const r = await adminApi.revealEmail(id);
    detail.value = await adminApi.account(id);   // 조회 기록 줄이 새로 보이게
    revealed.value = r.login_id;
  } catch (e) { say(errText(e)); }
}

const HISTORY_LABEL: Record<string, string> = {
  role_granted: '역할 줌', role_revoked: '역할 뺌', disabled: '사용 중지', enabled: '다시 사용', unlocked: '잠금 풀기', email_revealed: '이메일 전체 보기',
};
function historyText(h: AccountDetail['history'][number]) {
  const label = HISTORY_LABEL[h.field_name] ?? h.field_name;
  const role = h.after_value && h.field_name === 'role_granted' ? h.after_value : h.before_value && h.field_name === 'role_revoked' ? h.before_value : '';
  return role ? `${label}: ${ROLE_LABEL[role] ?? role}` : label;
}

// ---------- 권한표 ----------
const perms = ref<PermissionTable | null>(null);
const permsError = ref('');
const ROLE_COLS = ['user', 'operator', 'api_caller', 'service'];
const ucRows = computed(() => Array.from({ length: 17 }, (_, i) => `UC${i + 1}`));
async function loadPerms() {
  try { perms.value = await adminApi.permissions(); permsError.value = ''; } catch (e) { permsError.value = errText(e); }
}
const has = (role: string, uc: string) => perms.value?.table[role]?.includes(uc) ?? false;

// ---------- 접근 기록 ----------
const GATE_LABEL: Record<string, string> = { G5: 'G5 관리자 로그인', G13: 'G13 로그인', G14: 'G14 가입', G15: 'G15 권한', G16: 'G16 관리 조작 보호' };
const evGate = ref('');
const evHours = ref(24);
const evAccount = ref('');
const events = ref<AuthEvents | null>(null);
const eventsError = ref('');
async function loadEvents() {
  try {
    events.value = await adminApi.authEvents({ gate: evGate.value, hours: evHours.value, account: evAccount.value ? Number(evAccount.value) : undefined });
    eventsError.value = '';
  } catch (e) { eventsError.value = errText(e); }
}

onMounted(() => { void loadList(); });
watch(tab, (t) => {
  if (t === 'accounts') void loadList();
  if (t === 'permissions') void loadPerms();
  if (t === 'events') void loadEvents();
});
</script>

<template>
  <main id="admin-main" class="admin-main">
    <header>
      <span class="eyebrow">계정·권한</span>
      <h1 class="h2">계정과 역할</h1>
      <p class="small muted" style="margin: 0">계정을 찾아 역할(사용자·운영자)을 주거나 빼고, 잠금을 풀고, 사용 중지할 수 있습니다. 모든 조작은 변경 이력에 남습니다. 비밀번호는 보지도 바꾸지도 않습니다.</p>
    </header>

    <TabList v-model="tab" :tabs="TABS" id-prefix="acc" label="계정·권한 메뉴" />
    <p class="small" role="status" aria-live="polite" style="margin: 0; min-height: 20px">{{ flash }}</p>

    <!-- 계정 -->
    <section v-show="tab === 'accounts'" id="acc-panel-accounts" role="tabpanel" aria-labelledby="acc-tab-accounts" tabindex="0" class="stack">
      <form class="row" style="align-items: flex-end" @submit.prevent="search">
        <div class="field">
          <label for="acc-q">이메일·이름</label>
          <input id="acc-q" v-model="q" class="input" type="search" autocomplete="off" />
        </div>
        <div class="field">
          <label for="acc-role">역할</label>
          <select id="acc-role" v-model="roleFilter" class="input">
            <option value="">모두</option><option value="user">사용자</option><option value="operator">운영자</option><option value="none">역할 없음</option>
          </select>
        </div>
        <div class="field">
          <label for="acc-status">상태</label>
          <select id="acc-status" v-model="statusFilter" class="input">
            <option value="">모두</option><option value="active">사용 중</option><option value="locked">잠김</option><option value="disabled">사용 중지</option>
          </select>
        </div>
        <button type="submit" class="btn btn-secondary" :disabled="loading">{{ loading ? '찾는 중…' : '찾기' }}</button>
      </form>
      <div v-if="listError" class="notice n-rejected" role="alert"><span class="title">계정 목록을 불러오지 못했습니다</span><p>{{ listError }}</p></div>
      <div class="table-scroll">
        <table class="spec">
          <caption class="sr-only">계정 목록</caption>
          <thead>
            <tr>
              <th scope="col">이메일(가림)</th><th scope="col">이름</th><th scope="col">역할</th><th scope="col">상태</th>
              <th scope="col">가입</th><th scope="col">마지막 로그인</th><th scope="col" class="num-col">최근 7일 요청</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!list.length"><td colspan="7" class="muted">{{ loading ? '불러오는 중…' : '맞는 계정이 없습니다.' }}</td></tr>
            <tr v-for="a in list" :key="a.account_id" :class="{ 'is-selected': acc?.account_id === a.account_id }">
              <th scope="row"><button type="button" class="link-btn" @click="openAccount(a.account_id)">{{ a.login_id_masked }}</button></th>
              <td>{{ a.display_name }}</td>
              <td>
                <span v-if="!a.roles.length" class="muted">없음</span>
                <span v-for="r in a.roles" :key="r" class="chip s-waiting" style="margin-right: 4px">{{ ROLE_LABEL[r] ?? r }}</span>
              </td>
              <td><span :class="['chip', STATUS_CHIP[a.status].cls]">{{ STATUS_CHIP[a.status].text }}</span></td>
              <td class="nowrap">{{ dateTime(a.created_at) }}</td>
              <td class="nowrap">{{ dateTime(a.last_login_at) }}</td>
              <td class="num-col">{{ a.requests_7d }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="lastPage > 1" class="row small">
        <button type="button" class="btn btn-secondary btn-sm" :disabled="page <= 1" @click="go(page - 1)">이전</button>
        <span>{{ page }} / {{ lastPage }} 쪽 · 모두 {{ total }}개</span>
        <button type="button" class="btn btn-secondary btn-sm" :disabled="page >= lastPage" @click="go(page + 1)">다음</button>
      </div>

      <div v-if="detailError" class="notice n-rejected" role="alert"><span class="title">계정을 열지 못했습니다</span><p>{{ detailError }}</p></div>

      <!-- 계정 상세 -->
      <div v-if="acc && detail" class="panel white stack" aria-live="polite">
        <h2 class="h3">{{ revealed ?? acc.login_id_masked }} · {{ acc.display_name }}</h2>
        <dl class="kv">
          <dt>역할</dt>
          <dd>
            <span v-for="r in ['user', 'operator']" :key="r" style="margin-right: 12px">
              <span :class="['chip', acc.roles.includes(r) ? 's-done' : 's-expired']">{{ acc.roles.includes(r) ? '켜짐' : '꺼짐' }}</span> {{ ROLE_LABEL[r] }}
            </span>
          </dd>
          <dt>상태</dt>
          <dd>
            <span :class="['chip', STATUS_CHIP[acc.status].cls]">{{ STATUS_CHIP[acc.status].text }}</span>
            <span v-if="lockedLeft"> · {{ lockedLeft }}</span>
            · 마지막 로그인 {{ dateTime(acc.last_login_at) }} · 연속 실패 {{ acc.failed_logins }}
          </dd>
        </dl>
        <div class="row">
          <template v-for="r in (['user', 'operator'] as const)" :key="r">
            <button v-if="acc.roles.includes(r)" type="button" class="btn btn-secondary btn-sm" @click="ask({ kind: 'revoke', role: r })">역할 빼기: {{ ROLE_LABEL[r] }}</button>
            <button v-else type="button" class="btn btn-secondary btn-sm" @click="ask({ kind: 'grant', role: r })">역할 주기: {{ ROLE_LABEL[r] }}</button>
          </template>
          <button type="button" class="btn btn-secondary btn-sm" :disabled="acc.status !== 'locked'" aria-describedby="unlock-reason" @click="ask({ kind: 'unlock' })">잠금 풀기</button>
          <span id="unlock-reason" class="disabled-reason">{{ acc.status !== 'locked' ? '잠겨 있지 않습니다' : '' }}</span>
          <button v-if="acc.status === 'disabled'" type="button" class="btn btn-secondary btn-sm" @click="ask({ kind: 'enable' })">다시 사용</button>
          <button v-else type="button" class="btn btn-secondary btn-sm" @click="ask({ kind: 'disable' })">사용 중지</button>
          <button v-if="!revealed" type="button" class="btn btn-secondary btn-sm" @click="revealAndKeep">이메일 전체 보기</button>
          <button type="button" class="btn btn-secondary btn-sm" @click="detail = null; gate = null">닫기</button>
        </div>
        <p v-if="!revealed" class="small muted" style="margin: 0">이메일 전체 보기는 누가 언제 봤는지 변경 이력에 남습니다.</p>

        <GateBlock v-if="gate" :gate="`${gate.gate} 관리 조작 보호`" title="바꿀 수 없습니다" :reason="gate.body.message" :owner="gateOwner" :next="gateNext" />

        <h3 class="h4">최근 요청 (번호만)</h3>
        <p v-if="!detail.requests.length" class="small muted" style="margin: 0">최근 웹 요청이 없습니다.</p>
        <ul v-else class="small" style="margin: 0">
          <li v-for="r in detail.requests" :key="r.request_no">
            <RouterLink :to="{ path: '/ops/jobs', query: { channel: 'web' } }">{{ r.request_no }}</RouterLink> · {{ r.status }} · {{ dateTime(r.received_at) }}
          </li>
        </ul>
        <h3 class="h4">신청한 키</h3>
        <p v-if="!detail.keys.length" class="small muted" style="margin: 0">신청한 키가 없습니다.</p>
        <ul v-else class="small" style="margin: 0">
          <li v-for="k in detail.keys" :key="k.key_prefix"><code>{{ k.key_prefix }}…</code> · {{ k.status === 'active' ? '사용 중' : '폐기' }} · {{ dateTime(k.issued_at) }}</li>
        </ul>
        <h3 class="h4">변경 이력</h3>
        <p v-if="!detail.history.length" class="small muted" style="margin: 0">변경 이력이 없습니다.</p>
        <ul v-else class="small" style="margin: 0">
          <li v-for="(h, i) in detail.history" :key="i">{{ dateTime(h.changed_at) }} · {{ h.operator ?? '—' }} · {{ historyText(h) }}</li>
        </ul>
        <h3 class="h4">최근 접근 기록</h3>
        <p v-if="!detail.events.length" class="small muted" style="margin: 0">최근 접근 기록이 없습니다.</p>
        <ul v-else class="small" style="margin: 0">
          <li v-for="(ev, i) in detail.events" :key="i">{{ dateTime(ev.occurred_at) }} · {{ GATE_LABEL[ev.gate_code] ?? ev.gate_code }} · {{ ev.reason_code }}</li>
        </ul>
      </div>
    </section>

    <!-- 권한표 -->
    <section v-show="tab === 'permissions'" id="acc-panel-permissions" role="tabpanel" aria-labelledby="acc-tab-permissions" tabindex="0" class="stack">
      <p class="small" style="margin: 0">권한표는 <b>읽기 전용</b>입니다. 바꾸려면 설계서 {{ perms?.design_source ?? 'design/UC_00 §4-1' }} 를 먼저 고친 뒤 마이그레이션으로 반영합니다.</p>
      <div v-if="permsError" class="notice n-rejected" role="alert"><span class="title">권한표를 불러오지 못했습니다</span><p>{{ permsError }}</p></div>
      <div v-if="perms?.design_differs.length" class="notice n-caution" role="alert">
        <span class="title">설계서와 다른 역할이 있습니다</span>
        <p>{{ perms.design_differs.map((r) => ROLE_LABEL[r] ?? r).join(' · ') }}: 설계서 §4-1 과 DB 권한표(role_permission)를 맞춰 주십시오.</p>
      </div>
      <div v-if="perms" class="table-scroll">
        <table class="spec">
          <caption class="sr-only">역할별 유스케이스 권한표</caption>
          <thead>
            <tr><th scope="col">유스케이스</th><th scope="col">방문자</th><th v-for="r in ROLE_COLS" :key="r" scope="col">{{ ROLE_LABEL[r] }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="uc in ucRows" :key="uc">
              <th scope="row">{{ uc }}</th>
              <td>{{ perms.public.includes(uc) ? 'O' : '—' }}</td>
              <td v-for="r in ROLE_COLS" :key="r">{{ has(r, uc) ? 'O' : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 접근 기록 -->
    <section v-show="tab === 'events'" id="acc-panel-events" role="tabpanel" aria-labelledby="acc-tab-events" tabindex="0" class="stack">
      <div v-if="events" class="row small">
        <span v-for="(n, g) in events.summary" :key="g" class="chip s-waiting">{{ GATE_LABEL[g] ?? g }} · 24시간 {{ n }}건</span>
        <span class="chip s-caution">잠긴 계정 {{ events.locked_accounts }}개</span>
      </div>
      <form class="row" style="align-items: flex-end" @submit.prevent="loadEvents">
        <div class="field">
          <label for="ev-gate">게이트</label>
          <select id="ev-gate" v-model="evGate" class="input">
            <option value="">모두</option>
            <option v-for="(label, g) in GATE_LABEL" :key="g" :value="g">{{ label }}</option>
          </select>
        </div>
        <div class="field">
          <label for="ev-hours">기간</label>
          <select id="ev-hours" v-model.number="evHours" class="input">
            <option :value="1">1시간</option><option :value="24">24시간</option><option :value="168">7일</option><option :value="720">30일</option>
          </select>
        </div>
        <div class="field">
          <label for="ev-account">계정 번호</label>
          <input id="ev-account" v-model="evAccount" class="input num" inputmode="numeric" />
        </div>
        <button type="submit" class="btn btn-secondary">보기</button>
      </form>
      <div v-if="eventsError" class="notice n-rejected" role="alert"><span class="title">접근 기록을 불러오지 못했습니다</span><p>{{ eventsError }}</p></div>
      <div v-if="events" class="table-scroll">
        <table class="spec">
          <caption class="sr-only">접근 기록</caption>
          <thead><tr><th scope="col">시각</th><th scope="col">게이트</th><th scope="col">경로</th><th scope="col">대상</th><th scope="col">사유 코드</th></tr></thead>
          <tbody>
            <tr v-if="!events.items.length"><td colspan="5" class="muted">이 기간에 기록이 없습니다.</td></tr>
            <tr v-for="ev in events.items" :key="ev.event_id">
              <td class="nowrap">{{ dateTime(ev.occurred_at) }}</td>
              <td>{{ GATE_LABEL[ev.gate_code] ?? ev.gate_code }}</td>
              <td>{{ ev.channel }}</td>
              <td>{{ ev.subject_type }}{{ ev.subject_ref ? ` #${ev.subject_ref}` : '' }}</td>
              <td><code>{{ ev.reason_code }}</code></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <ConfirmDialog v-if="pending" :title="confirmTitle" confirm-label="반영" :busy="busy" :error="actionError" @confirm="run" @cancel="pending = null">
      <p v-if="pending.kind === 'disable'">이 계정은 <b>바로 로그아웃</b>됩니다. [다시 사용]으로 되돌릴 수 있습니다.</p>
      <p v-else-if="pending.kind === 'revoke' && pending.role === 'operator'">빼면 이 계정은 다음 요청부터 관리자 화면을 쓸 수 없습니다.</p>
      <p v-else>다음 요청부터 적용됩니다.</p>
      <p class="small muted">누가 언제 바꿨는지 변경 이력에 남습니다.</p>
    </ConfirmDialog>
  </main>
</template>
