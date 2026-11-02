<script setup lang="ts">
// 내가 만든 악보 (2026-09-30 황송해 160번 — UC_07 A9 · SD_02 S3 · SD_01 3.8) — (164번) 1단계 [다음] 줄 아래 · 악보 공유하기 위, 로그인했을 때만(S1Upload 가 정함). 전에는 4단계 아래
// 이 계정이 만든 악보 중 보관 기간(24시간) 안인 것만. 항목마다 [받기]로 그 악보의 받기 카드(MP3 · PDF · MIDI · MusicXML)를 연다.
// 편집한 악보는 서버에 남은 편집 기록으로 편집 반영 파일을 만든다(다른 기기에서도).
// (176번) [제거] — 확인 창 뒤 바로 지운다(DELETE /api/my-scores/:no, SD_01 3.9). 이 기기 자동 저장본도 지운다.
// (177번) [편집하기] — 그 악보의 3단계로 가서 이어 편집(UC6 A8: 기기 자동 저장본 우선, 없으면 서버 편집 기록).
// (178번) 한 쪽에 4개, 5개 이상이면 쪽 넘기기. 서버는 최근 50개를 한 번에 주고 화면이 나눈다.
// (184번) [편집하기]는 2단계(/?r=)로 — 판별 화면은 건너뛴다(전에 만든 악보). (185번) [받기] → [저장하기]. (186번) "편집" 칸 뺌.
// (187번) 목록은 서버 응답(로그인한 계정의 요청)만 — 이 브라우저 자동 저장본은 섞지 않는다.
// (180번) [제거]는 내 악보만(서버 DELETE 403). (190번) 공유 악보에서 만든 요청은 서버가 목록에서 빼므로 "공유 악보에서" 표시는 없앴다
//   (from_shared 가 오면 [제거]만 숨기는 안전장치는 남김).
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/client';
import C6DownloadCard from '@/components/C6DownloadCard.vue';
import LeaveConfirm from '@/components/LeaveConfirm.vue';
import PageNav from '@/components/PageNav.vue';
import { useEditorStore } from '@/stores/editor';
import { saveAccepted } from '@/lib/judgment';
import { exampleDisplayTitle } from '@/lib/examples';
import type { MyScoreItem } from '@/types/api';
import type { EditOp } from '@/types/score';

const PER_PAGE = 4;
const props = defineProps<{ currentNo?: string | null }>();
const router = useRouter();
const ed = useEditorStore();
const items = ref<MyScoreItem[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const open = ref<string | null>(null);
const page = ref(1);
const removing = ref<MyScoreItem | null>(null);
const busy = ref<string | null>(null);
const notice = ref<string | null>(null);

onMounted(async () => {
  try { items.value = (await api.get<{ items: MyScoreItem[] }>('/api/my-scores')).items ?? []; }
  catch { error.value = '내가 만든 악보 목록을 불러오지 못했습니다.'; }
  finally { loading.value = false; }
});

const pages = computed(() => Math.max(1, Math.ceil(items.value.length / PER_PAGE)));
const shown = computed(() => items.value.slice((page.value - 1) * PER_PAGE, page.value * PER_PAGE));
function go(n: number) { page.value = Math.min(Math.max(1, n), pages.value); open.value = null; }

const left = (sec: number) => (sec >= 3600 ? `${Math.floor(sec / 3600)}시간 남음` : `${Math.max(1, Math.ceil(sec / 60))}분 남음`);
const clock = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
/** 화면 이름 — 예시로 올린 것은 끝 괄호를 뗀 예시 이름(192번) */
const nm = (it: MyScoreItem) => (it.from_example ? exampleDisplayTitle(it.title) : it.title);
const ops = (it: MyScoreItem) => (it.edit_ops ?? []) as EditOp[];

async function editIt(it: MyScoreItem) {
  if (busy.value) return;
  busy.value = it.id;
  try {
    await ed.resume(it.id, ops(it));
    saveAccepted(it.id); // (184번) 전에 만든 악보 — 1단계 판별 화면 없이 2단계로
    await router.push({ name: 'home', query: { r: it.id } });
  } finally { busy.value = null; }
}
async function confirmRemove() {
  const it = removing.value;
  removing.value = null;
  if (!it) return;
  busy.value = it.id; error.value = null; notice.value = null;
  try {
    await api.del(`/api/my-scores/${encodeURIComponent(it.id)}`);
    await ed.forget(it.id);
    items.value = items.value.filter((x) => x.id !== it.id);
    if (open.value === it.id) open.value = null;
    page.value = Math.min(page.value, pages.value);
    notice.value = `"${nm(it)}" 악보를 지웠습니다.`;
  } catch {
    error.value = '악보를 지우지 못했습니다. 잠시 뒤 다시 해 주십시오.';
  } finally { busy.value = null; }
}
</script>

<template>
  <section class="mine" aria-labelledby="mine-h" data-test="my-scores">
    <h2 id="mine-h" class="h2 center-h">내가 만든 악보</h2>
    <!-- (2026-09-30 황송해 167번) 24시간 보관 문장은 뺐다. (2026-10-01 199번) 설명 문장도 뺐다. 목록 기준은 그대로 -->
    <p v-if="notice" class="small" role="status" data-test="my-notice">{{ notice }}</p>
    <p v-if="loading" class="small" role="status">불러오는 중입니다.</p>
    <p v-else-if="error" class="field-error" role="status">{{ error }}</p>
    <p v-if="!loading && !items.length && !error" class="small" data-test="my-empty">아직 만든 악보가 없습니다.</p>
    <div v-if="items.length" class="table-scroll">
      <table class="spec plain">
        <thead><tr><th scope="col">곡</th><th scope="col">만든 시각</th><th scope="col">남은 시간</th><th scope="col">작업</th></tr></thead>
        <tbody>
          <template v-for="it in shown" :key="it.id">
            <tr data-test="my-row" :class="{ now: it.id === props.currentNo }">
              <th scope="row" class="t">{{ nm(it) }}<span v-if="it.id === props.currentNo" class="small muted"> (지금 악보)</span></th>
              <td class="c">{{ clock(it.created_at) }}</td>
              <td class="c">{{ left(it.remaining_seconds) }}</td>
              <td>
                <div class="acts">
                  <button type="button" class="btn btn-secondary btn-sm" :aria-expanded="open === it.id ? 'true' : 'false'" :aria-label="`${nm(it)} ${open === it.id ? '저장하기 닫기' : '저장하기'}`" data-test="my-download" @click="open = open === it.id ? null : it.id">
                    {{ open === it.id ? '닫기' : '저장하기' }}
                  </button>
                  <button type="button" class="btn btn-secondary btn-sm" :aria-label="`${nm(it)} 편집하기`" :aria-busy="busy === it.id ? 'true' : undefined" data-test="my-edit" @click="editIt(it)">편집하기</button>
                  <!-- (180 · 190번) 공유 악보에서 만든 요청은 서버가 목록에서 빼지만, 오면 [제거]는 두지 않는다 -->
                  <button v-if="!it.from_shared" type="button" class="btn btn-secondary btn-sm" :aria-label="`${nm(it)} 제거`" :disabled="busy === it.id" data-test="my-remove" @click="removing = it">제거</button>
                </div>
              </td>
            </tr>
            <tr v-if="open === it.id" class="card-row">
              <td colspan="4">
                <C6DownloadCard :request-no="it.id" :title="`${nm(it)} 저장하기`" :edit-ops="ops(it)" :instruments="{ mode: 'default' }" :midi-available="it.midi_available" />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <PageNav v-if="items.length > PER_PAGE" :page="page" :pages="pages" :has-next="page < pages" label="내가 만든 악보 쪽 넘기기" @go="go" />

    <LeaveConfirm
      v-if="removing" title="이 악보를 지우시겠습니까?" confirm-label="지우기"
      :lines="[`${nm(removing)}: 올린 파일, 결과 악보, 편집 기록이 바로 지워지고 되살릴 수 없습니다.`]"
      @cancel="removing = null" @confirm="confirmRemove"
    />
  </section>
</template>

<style scoped>
.mine { display: grid; gap: var(--spacing-16); }
.mine h2, .mine p { margin: 0; }
.t { overflow-wrap: anywhere; }
tr.now th, tr.now td { background: var(--color-lifted-cream); }
.card-row td { padding-top: 0; }
.btn-sm { padding: 6px 16px; min-height: 44px; }
/* (2026-09-30 황송해 191번) 1단계 표 열 머리는 가운데 */
thead th { text-align: center; }
/* (2026-10-01 황송해 200 · 201번) 작업 버튼 · 만든 시각 · 남은 시간은 가운데 */
td.c { text-align: center; }
.acts { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--spacing-8); }
</style>
