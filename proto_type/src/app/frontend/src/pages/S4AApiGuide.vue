<script setup lang="ts">
// S4-A API활용과 키 신청 (T112 · T113) — SD_02 §7. 신청 즉시 발급, 키 원문은 제출 직후 한 번만(FR-053·054).
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import C2GateBlock from '@/components/C2GateBlock.vue';
import C8MaskedKey from '@/components/C8MaskedKey.vue';
import GuardedButton from '@/components/GuardedButton.vue';
import { api } from '@/api/client';
import { gateFromError, gateMessage, type GateView } from '@/i18n/gateMessages';
import type { ApiDocs, ApiEndpointDoc, KeyApplicationResult } from '@/types/api';
import { formatClock } from '@/lib/time';
import errorCodes from '../../../shared/error-codes.json';
import { useAuthStore } from '@/stores/auth';
// 2026-09-29 RBAC(FR-053·068): 안내는 누구나, 키 신청은 로그인한 사용자만
// (2026-09-30 황송해) 진행 레일(C1)을 뺐다(SD_02 §7-3) — 서버가 멈췄을 때만 엔드포인트 목록의 '서버 중지' 안내가 알린다.
const auth = useAuthStore();

// ---------- 안내 문서 ----------
const docs = ref<ApiDocs | null>(null);
const docsError = ref(false);
onMounted(async () => {
  void auth.fetchMe();
  try { docs.value = await api.get<ApiDocs>('/api/api-docs'); } catch { docsError.value = true; }
});
const serverOk = computed(() => docs.value?.server_status === 'running' || docs.value?.server_status === 'ok');
const lastKnown = computed(() => docs.value?.spec_source === 'last_known');

// ---------- 탭 ----------
// (2026-09-30 황송해 197번, SD_02 §7) 가이드라인 · 매뉴얼을 [시작하기] 하나로 합쳤다(초보자용 다섯 부분 + "자세히 보기" 접기)
const TABS = [
  { id: 'start', name: '시작하기' },
  { id: 'endpoints', name: '엔드포인트 목록' },
  { id: 'apply', name: '접근 키 신청' },
] as const;
type TabId = typeof TABS[number]['id'];
// 주소의 ?tab= 로 탭을 고른다(S4-C 의 [접근 키 신청] 단추 — 2026-09-30). 예전 주소 guideline · manual 은 [시작하기]로
const route = useRoute();
const qTab = route.query.tab === 'guideline' || route.query.tab === 'manual' ? 'start' : route.query.tab;
const tab = ref<TabId>(TABS.some((t) => t.id === qTab) ? (qTab as TabId) : 'start');
const tabEls = ref<HTMLElement[]>([]);
function onTabKey(e: KeyboardEvent, i: number) {
  let n = i;
  if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
  else if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = TABS.length - 1;
  else return;
  e.preventDefault();
  tab.value = TABS[n].id;
  void nextTick(() => tabEls.value[n]?.focus());
}

// 서버가 준 안내 값(모양이 자유로움)을 글로
function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(asText).join('\n');
  return JSON.stringify(v, null, 2);
}
const endpointInput = (e: ApiEndpointDoc) => asText(e.input ?? e.request);

// (2026-09-30 황송해 198번, SD_02 §7) 엔드포인트 목록을 쓰임새 묶음으로 — 쉬운 설명은 화면이 경로별로 가진다.
// 목록 자체는 서버 명세 그대로(BR-API-02): 화면이 모르는 경로는 "그 밖" 묶음에 서버 설명으로 보인다.
type EpGroupId = 'read' | 'play' | 'more' | 'server' | 'other';
const EP_GROUPS: { id: EpGroupId; name: string; lead: string }[] = [
  { id: 'read', name: '악보 읽기', lead: '악보 사진을 보내면 디지털 악보(MusicXML)와 MIDI 를 돌려받습니다.' },
  { id: 'play', name: '연주 만들기', lead: '악보 사진으로 국악기 연주를 만듭니다. 위에서 아래 순서로 부릅니다.' },
  { id: 'more', name: '더 해 보기', lead: '추천 · 소리 파일 · PDF 만들기와 악기 · 공유 악보 목록입니다.' },
  { id: 'server', name: '서버 확인', lead: '서버가 켜져 있는지, 어떤 모델이 준비됐는지 봅니다.' },
  { id: 'other', name: '그 밖', lead: '서버에 새로 생긴 기능입니다.' },
];
const EP_PLAIN: Record<string, { group: EpGroupId; does: string; send: string }> = {
  'POST /v1/omr/staff': { group: 'read', does: '오선보 사진을 디지털 악보로 바꿉니다', send: '악보 사진' },
  'POST /v1/omr/jeongganbo': { group: 'read', does: '정간보 사진을 디지털 악보로 바꿉니다', send: '악보 사진' },
  'POST /v1/performances': { group: 'play', does: '연주를 만들어 달라고 요청합니다. 응답의 id 가 요청 번호입니다', send: '악보 사진' },
  'GET /v1/performances/{request_no}': { group: 'play', does: '요청이 어디까지 됐는지 봅니다', send: '요청 번호' },
  'GET /v1/performances/{request_no}/result': { group: 'play', does: '다 만든 연주 결과를 받습니다', send: '요청 번호' },
  'GET /v1/files/{token}': { group: 'play', does: '결과 파일을 내려받습니다', send: '결과에 있는 파일 주소' },
  'POST /v1/recommend': { group: 'more', does: '악보에 어울리는 국악기 조합을 추천받습니다', send: '악보 파일(MIDI · MusicXML)' },
  'POST /v1/render/mp3': { group: 'more', does: '악보를 MP3 소리 파일로 만듭니다', send: '악보 파일(MIDI · MusicXML)' },
  'POST /v1/render/pdf': { group: 'more', does: '악보를 PDF 로 만듭니다', send: '악보 파일(MusicXML)' },
  'GET /v1/instruments': { group: 'more', does: '쓸 수 있는 악기 목록을 봅니다', send: '없음' },
  'GET /v1/shared-scores': { group: 'more', does: '공유된 악보 목록을 봅니다', send: '없음' },
  'GET /v1/shared-scores/{share_no}/score': { group: 'more', does: '공유 악보 하나를 MusicXML 로 받습니다', send: '공유 번호' },
  'GET /v1/health': { group: 'server', does: '서버가 켜져 있는지 봅니다', send: '없음' },
  'GET /v1/versions': { group: 'server', does: '엔진 이름과 버전을 봅니다', send: '없음' },
  'GET /v1/models': { group: 'server', does: '모델 목록과 준비 상태를 봅니다', send: '없음' },
};
// 서버 설명의 괄호 속 내부 참조(UC11 기본흐름 1 · FR-044 등)는 화면에 보이지 않는다
const plainServerText = (t: string) => t.replace(/\s*\([^)]*\b(UC|FR|BR)[-\d][^)]*\)/g, '').trim();
const endpointGroups = computed(() => {
  const rows = (docs.value?.endpoints ?? []).map((e, i) => {
    const method = String(e.method ?? '').toUpperCase();
    const path = String(e.path ?? '');
    const plain = EP_PLAIN[`${method} ${path}`];
    const serverText = String(e.feature ?? e.summary ?? e.description ?? path);
    return {
      key: `${method} ${path} ${i}`, method, path, e,
      group: plain?.group ?? 'other',
      does: plain?.does ?? plainServerText(serverText),
      send: plain?.send ?? (String(e.input ?? '') === '없음' ? '없음' : '파일 · 값'),
    };
  });
  // 묶음 안 순서는 EP_PLAIN 순서(연주 만들기는 부르는 순서), 모르는 경로는 서버 순서
  const order = Object.keys(EP_PLAIN);
  const rank = (r: { method: string; path: string }) => { const k = order.indexOf(`${r.method} ${r.path}`); return k < 0 ? order.length : k; };
  return EP_GROUPS
    .map((g) => ({ ...g, rows: rows.filter((r) => r.group === g.id).sort((a, b) => rank(a) - rank(b)) }))
    .filter((g) => g.rows.length);
});
// 오류 표는 모델 API 기준 HTTP(api_http 가 있으면 그 값) + 입력 오류 VALIDATION_ERROR(게이트 없음) — 2026-09-30 SD_02 §7
const CODE_TABLE = errorCodes.gate_codes as Record<string, { http: number; api_http?: number; message: string; fix: string }>;
// (197번) 자주 나오는 오류 — 초보자가 첫 호출에서 흔히 만나는 다섯 개(문구는 error-codes.json 그대로, HTTP 는 모델 API 기준)
const COMMON_CODES = ['AUTH_KEY_MISSING', 'AUTH_KEY_INVALID', 'VALIDATION_ERROR', 'UPLOAD_TOO_LARGE', 'RATE_LIMIT_EXCEEDED'] as const;
const commonRows = COMMON_CODES.filter((c) => CODE_TABLE[c]).map((c) => ({ code: c, http: CODE_TABLE[c].api_http ?? CODE_TABLE[c].http, message: CODE_TABLE[c].message }));
// (2026-10-01 조성기) 전체 오류 코드 — 서버 안내의 error_codes 와 같은 범위로 하나로 합친다(apiDocs.ts 와 같은 기준:
// 관리 · 내부 게이트 G5 · G6 · G12 는 API 호출자와 상관없어 뺀다, 게이트 없는 코드는 넣는다). HTTP 는 모델 API 기준.
const HIDDEN_GATES = new Set(['G5', 'G6', 'G12']);
const errorRows = computed(() => Object.entries(CODE_TABLE as Record<string, { http: number; api_http?: number; gate?: string | null; message: string; fix: string }>)
  .filter(([code, v]) => !code.startsWith('$') && !HIDDEN_GATES.has(v.gate ?? ''))
  .map(([code, v]) => ({ code, gate: v.gate ?? (code === 'VALIDATION_ERROR' ? '입력' : '—'), http: v.api_http ?? v.http, message: v.message, fix: v.fix }))
  .sort((a, b) => Number(b.code === 'VALIDATION_ERROR') - Number(a.code === 'VALIDATION_ERROR')));

// (2026-10-01 조성기) 서버 안내 값 중 '항목 목록'(같은 열을 가진 객체 배열)은 JSON 원문 대신 표로 보인다
type Row = Record<string, unknown>;
const COL_NAMES: Record<string, string> = { value: '값', label: '표시', code: '코드', message: '뜻', http: 'HTTP', gate: '게이트' };
function asTable(v: unknown): { cols: string[]; rows: Row[] } | null {
  if (!Array.isArray(v) || !v.length || !v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return null;
  const cols = [...new Set((v as Row[]).flatMap((r) => Object.keys(r)))];
  return { cols, rows: v as Row[] };
}
/** error_codes 는 '전체 오류 코드' 표로 합쳐 서버 안내에는 보이지 않는다 */
const serverManual = computed(() => Object.fromEntries(Object.entries(docs.value?.manual ?? {}).filter(([k]) => k !== 'error_codes')));
// 실제로 돌아가는 예시(2026-09-30 외부 검증, SD_02 §7): 파일 필드는 image, 주소는 이 사이트의 /api/v1,
// 선언 밖 필드(score_type 등)는 모델 API 가 422 로 거절하므로 넣지 않는다. 오선보는 /omr/staff
const exampleCurl = `curl -X POST \\
  -H "X-API-Key: (여기에 키)" \\
  -F "image=@score.png" \\
  ${window.location.origin}/api/v1/omr/jeongganbo`;
// (198번) 엔드포인트 목록의 주소 앞부분 — 이 사이트의 /api
const apiBase = `${window.location.origin}/api`;
const copyMsg = ref('');
async function copyExample() {
  try { await navigator.clipboard.writeText(exampleCurl); copyMsg.value = '예시를 복사했습니다.'; }
  catch { copyMsg.value = '복사하지 못했습니다.'; }
}

// ---------- 신청 ----------
const form = ref({ name: '', organization: '', contact_email: '', purpose: '' });
const consent = ref(false);
const tried = ref(false);
const submitting = ref(false);
const gate = ref<GateView | null>(null);
const retryOpen = ref(true);
const issued = ref<KeyApplicationResult | null>(null);
const issuedAt = ref<Date | null>(null);
const kept = ref(false);

const FIELDS = [
  { key: 'name', label: '이름', type: 'text', auto: 'name', placeholder: '' },
  { key: 'organization', label: '소속', type: 'text', auto: 'organization', placeholder: '' },
  { key: 'contact_email', label: '연락 이메일', type: 'email', auto: 'email', placeholder: '' },
  { key: 'purpose', label: '사용 목적', type: 'text', auto: 'off', placeholder: '예: 수업용 정간보 연주 앱' },
] as const;
type FieldKey = typeof FIELDS[number]['key'];
const emailOk = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.value.contact_email.trim()));
const missing = computed<FieldKey[]>(() => FIELDS.filter((f) => !form.value[f.key].trim()).map((f) => f.key));
const fieldError = (k: FieldKey): string | null => {
  if (!tried.value) return null;
  if (!form.value[k].trim()) return `${FIELDS.find((f) => f.key === k)!.label}을(를) 적어 주십시오`;
  if (k === 'contact_email' && !emailOk.value) return '이메일 형식을 확인해 주십시오';
  return null;
};
const submitReason = computed(() => {
  if (gate.value?.gate === 'G11' && !retryOpen.value) return '안내된 시각 뒤에 다시 신청할 수 있습니다';
  if (missing.value.length || !consent.value || !emailOk.value) return '빠진 항목과 동의를 채워 주십시오';
  return null;
});

function g10View(): GateView {
  const names = missing.value.map((k) => FIELDS.find((f) => f.key === k)!.label);
  const parts: string[] = [];
  if (names.length) parts.push(`${names.join(' · ')}이(가) 비었습니다`);
  if (!emailOk.value && form.value.contact_email.trim()) parts.push('이메일 형식이 맞지 않습니다');
  if (!consent.value) parts.push('동의하지 않았습니다');
  const code = !consent.value && !names.length ? 'APPLICATION_CONSENT_REQUIRED' : 'APPLICATION_MISSING_FIELD';
  return { ...gateMessage(code), reason: parts.join(' · ') };
}

async function submit() {
  tried.value = true;
  if (gate.value?.gate === 'G11' && !retryOpen.value) return;
  if (missing.value.length || !consent.value || !emailOk.value) { gate.value = g10View(); return; }
  gate.value = null;
  submitting.value = true;
  try {
    const res = await api.post<KeyApplicationResult>('/api/key-applications', {
      name: form.value.name.trim(), organization: form.value.organization.trim(),
      contact_email: form.value.contact_email.trim(), purpose: form.value.purpose.trim(), consent: true,
    });
    issued.value = res; issuedAt.value = new Date(); kept.value = false;
    form.value = { name: '', organization: '', contact_email: '', purpose: '' };
    consent.value = false; tried.value = false;
  } catch (e) {
    const g = gateFromError(e);
    gate.value = g.gate ? g : { ...g, title: '신청을 끝내지 못했습니다', reason: `${g.reason} 다시 신청해 주십시오.` };
    if (g.gate === 'G11') retryOpen.value = !g.retryAt;
  } finally {
    submitting.value = false;
  }
}
async function goMissing() {
  const first = missing.value[0] ?? (!emailOk.value ? 'contact_email' : null);
  await nextTick();
  if (first) document.getElementById(`ka-${first}`)?.focus();
  else document.getElementById('consent-btn')?.focus();
}
/** [닫고 시작하기 보기] — 키 원문을 화면(메모리)에서 지운다. 다시 볼 수 없다(G9). */
function closeKey() {
  if (!kept.value) return;
  issued.value = null; issuedAt.value = null; kept.value = false;
  tab.value = 'start';
}
const g9 = gateMessage('APPLICATION_MISSING_FIELD'); // 모양만 빌림 — 아래에서 G9 문구로 덮음
const g9View: GateView = { ...g9, code: 'KEY_ONCE', gate: 'G9', chip: '한 번만 · G9', title: '한 번만 보입니다 (G9 키 한 번 확인)', reason: '키는 이 화면에서만 보입니다. 닫으면 다시 볼 수 없습니다.', releaser: '신청하는 사람(나)이 보관합니다. 잃어버리면 다시 신청해 새 키를 받습니다', fix: '키를 복사해 안전한 곳에 보관하십시오.', actionLabel: null, retryAt: null };
</script>

<template>
  <div class="page">
    <div class="wrap">
      <div class="page-head">
        <!-- (2026-09-30 황송해 173번) 제목 문장은 뺐다. 큰 눈썹 제목 "API활용"이 h1 -->
        <h1 class="eyebrow eyebrow-title">API활용</h1>
        <p>가입·로그인한 뒤 접근 키를 신청하면 바로 받습니다(운영자 승인 없음). 키는 신청 직후 한 번만 보여 드립니다.</p>
        <!-- S4-C 로 가는 단추는 [시작하기] 3번에만 둔다(2026-10-01 조성기 — 머리말 단추 뺌, SD_02 §7-1) -->
      </div>

      <!-- 키 한 번 확인 (G9) -->
      <section v-if="issued" class="section key-once" aria-labelledby="key-h">
        <h2 id="key-h" class="h3">접근 키를 받았습니다</h2>
        <C8MaskedKey mode="once" :value="issued.api_key" />
        <p class="body">기본 호출 한도: 한 시간에 {{ issued.call_limit_per_hour }}회 · 발급 시각: {{ issuedAt ? formatClock(issuedAt) : '' }} · 앞자리 <C8MaskedKey mode="masked" :prefix="issued.key_prefix" /></p>
        <C2GateBlock :view="g9View" />
        <label class="check"><input v-model="kept" type="checkbox" /> <span class="body">키를 복사해 안전한 곳에 보관했습니다</span></label>
        <GuardedButton variant="primary" :reason="kept ? null : '보관했는지 먼저 확인해 주십시오'" @click="closeKey">닫고 시작하기 보기</GuardedButton>
      </section>

      <template v-else>
        <div class="tab-row">
          <div class="tabs" role="tablist" aria-label="API활용 목차">
            <button
              v-for="(t, i) in TABS" :id="`tab-${t.id}`" :key="t.id" :ref="(el) => { if (el) tabEls[i] = el as HTMLElement }"
              type="button" role="tab" class="chip tab" :class="{ on: tab === t.id }"
              :aria-selected="tab === t.id" :aria-controls="`panel-${t.id}`" :tabindex="tab === t.id ? 0 : -1"
              @click="tab = t.id" @keydown="onTabKey($event, i)"
            >
              {{ t.name }}
            </button>
          </div>
          <!-- 예시 홈페이지(2026-10-01 조성기 — SD_02 §7-2): [접근 키 신청] 탭 옆. 탭이 아니라 새 창 링크라 tablist 밖에 둔다 -->
          <a class="chip tab demo-link" href="/demo/" target="_blank" rel="noopener" data-test="demo-link">
            API 활용 예시 홈페이지 보기 <span aria-hidden="true">↗</span><span class="sr-only">(새 창)</span>
          </a>
        </div>

        <!-- 엔드포인트 목록 -->
        <section v-show="tab === 'endpoints'" id="panel-endpoints" role="tabpanel" aria-labelledby="tab-endpoints" class="section">
          <div v-if="docs && !serverOk" class="notice n-expired">
            <span class="chip s-expired">서버 중지</span>
            <span class="title">지금은 호출할 수 없습니다</span>
            <p v-if="lastKnown">아래는 마지막으로 확인한 명세입니다{{ docs.checked_at ? ` (${new Date(docs.checked_at).toLocaleString('ko-KR')})` : '' }}. 가이드라인과 매뉴얼은 그대로 읽을 수 있습니다.</p>
            <p v-else>점검 중입니다. 가이드라인과 매뉴얼은 그대로 읽을 수 있습니다.</p>
          </div>
          <p v-else-if="lastKnown" class="small"><span class="chip s-waiting">마지막 확인본</span> 실행 중인 서버 명세를 읽지 못해 마지막 확인본을 보여 드립니다.</p>
          <p v-if="docsError" class="body" role="status">안내를 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.</p>
          <p v-else-if="!docs" class="body" role="status">안내를 불러오는 중입니다.</p>
          <!-- (198번) 쓰임새 묶음 · 세 칸(하는 일 · 주소 · 보내는 것) · 줄마다 "자세히"(UC11 A2) -->
          <div v-else-if="docs.endpoints.length" class="ep-groups">
            <p class="body">주소 앞에 <code class="inline">{{ apiBase }}</code> 를 붙여 부릅니다. 키는 <code class="inline">X-API-Key</code> 머리글에 넣습니다.</p>
            <div v-for="g in endpointGroups" :key="g.id" class="ep-group" :data-test="`ep-group-${g.id}`">
              <h2 class="h3">{{ g.name }}</h2>
              <p class="small muted">{{ g.lead }}</p>
              <div class="table-scroll">
                <table class="spec plain ep">
                  <thead><tr><th scope="col">하는 일</th><th scope="col">주소</th><th scope="col">보내는 것</th></tr></thead>
                  <tbody>
                    <tr v-for="r in g.rows" :key="r.key" data-test="ep-row">
                      <td class="desc">
                        {{ r.does }}
                        <details class="ep-more">
                          <summary>자세히</summary>
                          <dl>
                            <dt>입력</dt><dd><pre class="mono">{{ endpointInput(r.e) }}</pre></dd>
                            <dt>응답</dt><dd><pre class="mono">{{ asText(r.e.response) }}</pre></dd>
                            <template v-if="r.e.example"><dt>예시</dt><dd><pre class="mono">{{ r.e.example }}</pre></dd></template>
                          </dl>
                        </details>
                      </td>
                      <td><span class="ep-method" :class="`m-${r.method.toLowerCase()}`">{{ r.method }}</span> <code class="inline">{{ r.path }}</code></td>
                      <td>{{ r.send }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <p v-else-if="docs" class="body">알려 드릴 엔드포인트가 아직 없습니다.</p>
        </section>

        <!-- 시작하기 (2026-09-30 황송해 197번 — 전 가이드라인 · 매뉴얼). 초보자용 다섯 부분만 먼저, 나머지는 "자세히 보기" 접기 안에 그대로 -->
        <section v-show="tab === 'start'" id="panel-start" role="tabpanel" aria-labelledby="tab-start" class="section start">
          <div class="step">
            <h2 class="h3">1. 무엇을 할 수 있나요</h2>
            <p class="body">내 프로그램에서 악보 사진을 보내면 디지털 악보(MusicXML)와 MIDI 를 돌려받습니다. 오선보와 정간보를 읽습니다.</p>
          </div>
          <div class="step">
            <h2 class="h3">2. API 키 받기</h2>
            <p class="body">API 키는 내 프로그램임을 알리는 비밀번호입니다. 로그인한 뒤 신청하면 바로 받고, 한 번만 보여 드립니다.</p>
            <div class="row"><button type="button" class="btn btn-secondary" data-test="go-apply" @click="tab = 'apply'">접근 키 신청</button></div>
          </div>
          <div class="step">
            <h2 class="h3">3. 악보 보내기</h2>
            <p class="body">아래 명령에서 키 자리에 받은 키를 넣어 실행하십시오. 오선보는 주소 끝을 <code class="inline">/omr/staff</code> 로 바꾸고, 사진이 여러 장이면 <code class="inline">-F "image=@…"</code> 를 장마다 넣습니다.</p>
            <div class="code on-ink">
              <pre>{{ exampleCurl }}</pre>
              <button type="button" class="copy-btn" @click="copyExample">복사</button>
            </div>
            <p class="sr-only" role="status" aria-live="polite">{{ copyMsg }}</p>
            <div class="row"><RouterLink class="btn btn-secondary" :to="{ name: 'api-examples' }">단계별 활용 예시 보기 (curl · Python · JavaScript)</RouterLink></div>
          </div>
          <div class="step">
            <h2 class="h3">4. 결과 받기</h2>
            <p class="body">응답은 JSON 한 개입니다. 꼭 볼 칸은 넷입니다.</p>
            <ul class="plain-list body">
              <li><code class="inline">musicxml</code>: 악보 파일 내용입니다.</li>
              <li><code class="inline">midi_base64</code>: MIDI 파일(base64 글자)입니다. 만들지 못하면 비어 있습니다.</li>
              <li><code class="inline">fallback</code>: true 면 인식 대신 대체 악보입니다. 오류가 아닙니다.</li>
              <li><code class="inline">validity_grade</code>: 인식 결과를 믿을 만한 정도입니다(trust · caution · distrust).</li>
            </ul>
          </div>
          <div class="step">
            <h2 class="h3">5. 자주 나오는 오류</h2>
            <div class="table-scroll">
              <table class="spec plain">
                <thead><tr><th scope="col">코드</th><th scope="col">HTTP</th><th scope="col">뜻</th></tr></thead>
                <tbody>
                  <tr v-for="r in commonRows" :key="r.code" data-test="common-error">
                    <td><code class="inline">{{ r.code }}</code></td><td>{{ r.http }}</td><td class="desc">{{ r.message }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 자세히 보기 — 내용은 지우지 않고 접어 둔다(전 가이드라인 · 매뉴얼) -->
          <details class="more" data-test="more-rules">
            <summary>자세히 보기: 지켜 주실 규칙</summary>
            <ul class="plain-list body">
              <li>요청에 <code class="inline">X-API-Key</code> 머리글로 접근 키를 넣습니다. 상태·버전·모델 목록·문서와 결과 파일 받기는 키 없이 됩니다.</li>
              <li>키마다 호출 한도가 있습니다. 넘으면 429와 다시 시도할 시각을 알려 드립니다.</li>
              <li>오류는 늘 같은 모양 <code class="inline">{ error: { code, message, fix, gate, retry_after, details } }</code>입니다. 입력이 약속과 다르면(필수 누락·모르는 필드·형식·범위·빈 파일) <code class="inline">422 VALIDATION_ERROR</code>이고, <code class="inline">details.errors</code>에 어느 칸이 왜 틀렸는지 있습니다.</li>
              <li>모든 응답에 <code class="inline">X-Request-ID</code>가 붙습니다. 문의할 때 알려 주십시오.</li>
              <li>자기 서버·앱·명령줄에서 부르십시오. 다른 사이트의 웹페이지(브라우저)에서 직접 부르면 막힙니다. 접근 키를 브라우저 코드에 넣지 마십시오.</li>
              <li>버전은 경로(<code class="inline">/v1</code>)로 나눕니다. 바뀌면 이 화면에 먼저 알립니다.</li>
              <li>올린 파일과 결과는 24시간 뒤 지워집니다.</li>
              <li>음원 라이선스 확인 전이라 MP3는 외부 호출자에게 주지 않습니다.</li>
              <li>국악기 음원을 쓴 결과를 공개할 때는 "국립국악원 국악기 디지털 음원(공공누리 제1유형)" 출처를 적어 주십시오.</li>
            </ul>
          </details>
          <details class="more" data-test="more-errors">
            <summary>자세히 보기: 전체 오류 코드</summary>
            <div class="table-scroll">
              <table class="spec err-table">
                <thead><tr><th scope="col">게이트</th><th scope="col">코드</th><th scope="col">HTTP</th><th scope="col">뜻</th><th scope="col">고치는 방법</th></tr></thead>
                <tbody>
                  <tr v-for="r in errorRows" :key="r.code">
                    <td>{{ r.gate }}</td><td><code class="inline">{{ r.code }}</code></td><td>{{ r.http }}</td>
                    <td class="desc">{{ r.message }}</td><td class="desc">{{ r.fix }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
          <details class="more" data-test="more-server">
            <summary>자세히 보기: 서버 안내(가이드라인 · 매뉴얼 · 연주 API 순서)</summary>
            <template v-if="docs && Object.keys(docs.guideline ?? {}).length">
              <div v-for="(v, k) in docs.guideline" :key="`g-${k}`" class="field">
                <span class="label">{{ k }}</span>
                <p class="body pre">{{ asText(v) }}</p>
              </div>
            </template>
            <template v-if="Object.keys(serverManual).length">
              <div v-for="(v, k) in serverManual" :key="`m-${k}`" class="field">
                <span class="label">{{ k }}</span>
                <div v-if="asTable(v)" class="table-scroll" :data-test="`server-table-${k}`">
                  <table class="spec srv-table">
                    <thead><tr><th v-for="c in asTable(v)!.cols" :key="c" scope="col">{{ COL_NAMES[c] ?? c }}</th></tr></thead>
                    <tbody>
                      <tr v-for="(r, i) in asTable(v)!.rows" :key="i">
                        <td v-for="c in asTable(v)!.cols" :key="c" :class="{ desc: c === 'message' || c === 'label' }">
                          <code v-if="c === 'code' || c === 'value'" class="inline">{{ r[c] }}</code><template v-else>{{ r[c] ?? '' }}</template>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p v-else class="body pre">{{ asText(v) }}</p>
              </div>
              <p v-if="docs?.manual && 'error_codes' in docs.manual" class="small muted">오류 코드(error_codes)는 위 '자세히 보기: 전체 오류 코드' 표에 합쳤습니다.</p>
            </template>
            <p v-if="!docs || (!Object.keys(docs.guideline ?? {}).length && !Object.keys(serverManual).length)" class="small muted">서버 안내가 아직 없습니다.</p>
          </details>
        </section>

        <!-- 접근 키 신청 -->
        <section v-show="tab === 'apply'" id="panel-apply" role="tabpanel" aria-labelledby="tab-apply" class="section">
          <div v-if="auth.loaded && !auth.loggedIn" class="form-band">
            <h2 class="h3">접근 키 신청은 로그인한 뒤에 할 수 있습니다</h2>
            <p>가입은 이메일로 바로 할 수 있습니다. 로그인하면 이 화면으로 돌아옵니다.</p>
            <div class="row"><RouterLink class="btn btn-primary" :to="{ name: 'login', query: { next: '/api-guide' } }">로그인하고 키 신청하기</RouterLink></div>
          </div>
          <form v-else class="form-band" novalidate aria-labelledby="apply-h" @submit.prevent="submit">
            <h2 id="apply-h" class="h3">접근 키를 신청하면 바로 받습니다</h2>
            <div class="fields">
              <div v-for="f in FIELDS" :key="f.key" class="field">
                <label :for="`ka-${f.key}`">{{ f.label }}</label>
                <input
                  :id="`ka-${f.key}`" v-model="form[f.key]" class="input" :type="f.type" :autocomplete="f.auto" :placeholder="f.placeholder || undefined"
                  required :aria-invalid="fieldError(f.key) ? 'true' : undefined" :aria-describedby="fieldError(f.key) ? `ka-${f.key}-e` : undefined"
                />
                <span v-if="fieldError(f.key)" :id="`ka-${f.key}-e`" class="field-error">{{ fieldError(f.key) }}</span>
              </div>
            </div>
            <div class="consent">
              <p id="consent-d">
                수집 항목: 이름 · 소속 · 연락 이메일 · 사용 목적<br />
                이용 목적: 키 발급과 남용 확인<br />
                보관 기간: 신청 뒤 7일 동안 보관하고 자동으로 지웁니다. 동의해야 신청할 수 있습니다.
              </p>
              <button id="consent-btn" type="button" class="btn btn-consent" :aria-pressed="consent ? 'true' : 'false'" aria-describedby="consent-d" @click="consent = !consent">
                {{ consent ? ' 동의했습니다' : '개인정보 수집 · 이용에 동의' }}
              </button>
            </div>
            <div class="row">
              <GuardedButton variant="primary" type="submit" :reason="submitReason" :busy="submitting">{{ submitting ? '신청하는 중…' : '신청하고 키 받기' }}</GuardedButton>
            </div>
          </form>
          <C2GateBlock v-if="gate" :view="gate" @action="goMissing" @retry-ready="retryOpen = true" />
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tabs { display: flex; flex-wrap: wrap; gap: var(--spacing-8); }
.tab-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-8); }
.demo-link { display: inline-flex; align-items: center; gap: 4px; text-decoration: none; color: inherit; }
.tab { min-height: 44px; cursor: pointer; border-color: var(--color-hairline); font-size: 16px; }
.tab.on { background: var(--color-primary); color: var(--color-canvas-cream); border-color: var(--color-primary); }
.mono { margin: 0; font: 400 var(--text-caption)/1.5 var(--font-mono); white-space: pre-wrap; word-break: break-word; }
.pre { white-space: pre-wrap; margin: 0; }
.plain-list { margin: 0; padding-left: 20px; display: grid; gap: var(--spacing-8); color: var(--color-charcoal); }
.key-once { max-width: 880px; }
.key-once > p { margin: 0; }
.check { display: flex; align-items: center; gap: 12px; min-height: 44px; }
.check input { width: 20px; height: 20px; accent-color: var(--color-primary); }
.form-band .h3 { margin: 0; }
/* (197번) 시작하기 — 다섯 부분 · 자세히 보기(접기) */
.start { display: grid; gap: var(--spacing-32); }
/* (2026-10-01 조성기) 1~5 안내는 읽기 좋은 폭(880px), '자세히 보기' 접기(표)는 화면 폭 전체 — 표 칸이 좁아 줄바꿈이 심하지 않게 */
.start > .step { max-width: 880px; }
.step { display: grid; gap: var(--spacing-8); }
.step > h2, .step > p { margin: 0; }
.more { border-top: 1px solid var(--color-hairline); padding-top: var(--spacing-16); }
/* (2026-10-01 조성기) 칸(grid) 안의 넓은 표가 칸을 넓혀 휴대폰에서 화면 밖으로 밀리지 않게 — 표는 .table-scroll 안에서만 가로로 */
.wrap > *, .section > *, .more, .step > * { min-width: 0; }
.step .inline { overflow-wrap: anywhere; } /* 단락 안 긴 코드 글자가 휴대폰 폭을 넘지 않게 */
.step .btn { max-width: 100%; white-space: normal; height: auto; text-align: center; } /* 긴 단추 글자는 좁은 화면에서 줄을 바꾼다 */
/* (2026-10-01 조성기) 전체 오류 코드 표 — 게이트 · 코드 · HTTP 는 한 줄(제목 줄 포함), 남는 폭은 뜻 · 고치는 방법. 넓으면 .table-scroll 안에서 가로로 */
.err-table th, .err-table td:not(.desc) { white-space: nowrap; }
.err-table code.inline { white-space: nowrap; word-break: keep-all; }
.err-table td.desc { min-width: 12em; }
/* (2026-10-01 조성기) 서버 안내 표(상태 값 · 대체 이유)는 내용 폭에 맞춘다 — 화면 폭으로 늘이지 않고, 값 · 코드는 한 줄, 뜻은 길면 36em 에서 줄바꿈 */
.srv-table { width: auto; min-width: 0; max-width: 100%; }
.srv-table th, .srv-table td { white-space: nowrap; padding-right: var(--spacing-32); }
.srv-table td.desc { white-space: normal; max-width: 36em; }
@media (max-width: 720px) { .srv-table th, .srv-table td { padding-right: var(--spacing-12); } .srv-table td.desc { min-width: 10em; } }
/* (2026-10-01 조성기) 주의가 필요한 내용이라 위 1~5 제목(.h3 24px)과 같은 크기로, 굵게 · 강조색 */
.more > summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; font: 700 24px/28.8px var(--font-sans); letter-spacing: -0.48px; color: var(--color-primary); }
.more[open] > summary { margin-bottom: var(--spacing-16); }
.more .field { margin-bottom: var(--spacing-16); }
/* (198번) 엔드포인트 목록 — 쓰임새 묶음 · 세 칸 · 줄마다 자세히 */
.ep-groups { display: grid; gap: var(--spacing-32); max-width: 960px; }
.ep-groups > p { margin: 0; }
.ep-group { display: grid; gap: var(--spacing-8); }
.ep-group > h2, .ep-group > p { margin: 0; }
.ep { table-layout: fixed; width: 100%; min-width: 640px; }
.ep th:nth-child(1) { width: 40%; } .ep th:nth-child(2) { width: 40%; } .ep th:nth-child(3) { width: 20%; }
.ep td { vertical-align: top; }
.ep td code.inline { white-space: nowrap; }
.ep-method { display: inline-block; min-width: 44px; padding: 0 8px; border: 1px solid var(--color-ink-black); border-radius: 999px; font: 700 var(--text-caption)/1.6 var(--font-mono); text-align: center; color: var(--color-ink-black); background: var(--color-white); }
.ep-method.m-post { background: var(--color-ink-black); color: var(--color-canvas-cream); }
.ep-more { margin-top: var(--spacing-8); }
.ep-more > summary { cursor: pointer; min-height: 32px; display: inline-flex; align-items: center; font: 700 var(--text-caption)/1.3 var(--font-sans); color: var(--color-primary); }
.ep-more dl { margin: var(--spacing-8) 0 0; display: grid; grid-template-columns: auto 1fr; gap: var(--spacing-8) var(--spacing-16); }
.ep-more dt { font-weight: 700; color: var(--color-charcoal); }
.ep-more dd { margin: 0; min-width: 0; }
/* (198번) 좁은 화면 — 표를 줄마다 세로로 쌓는다(옆으로 밀지 않음) */
@media (max-width: 640px) {
  .ep { min-width: 0; table-layout: auto; }
  .ep thead { display: none; }
  .ep, .ep tbody, .ep tr, .ep td { display: block; width: auto; }
  .ep tr { padding: var(--spacing-8) 0; border-bottom: 1px solid var(--color-hairline); }
  .ep td { border: 0; padding: 4px 0; }
  .ep td code.inline { white-space: normal; word-break: break-all; }
  .ep td:nth-child(3)::before { content: '보내는 것: '; font-weight: 700; }
}
</style>
