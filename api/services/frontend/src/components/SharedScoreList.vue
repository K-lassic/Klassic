<script setup lang="ts">
// 공유 악보 목록 (2026-09-30 황송해, UC18 기본흐름 2~4 · SD_02 §4-6) — S1 올리기 아래
// 다른 사람이 공유한 결과 악보를 올리기 전에 골라 듣는다(같은 곡을 다시 변환하지 않게). 올린 사람 정보는 없다(BR-SHR-03).
// [▶ 듣기]는 기본 국악기 구성으로 연주하고 다시 누르면 멈춘다. [♥]는 로그인한 계정마다 한 번(다시 누르면 취소).
// (2026-09-30 황송해 179번) 한 쪽에 4개 · 쪽 넘기기(전 [더 보기] 20개씩). 서버 API 는 그대로 — limit=4 · offset=(쪽-1)×4 로 한 쪽씩 부른다.
// 전체 개수를 모르므로 쪽 번호는 지금까지 알게 된 쪽까지, 다음 쪽이 있으면(has_more) [다음]이 켜진다.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '@/api/client';
import PageNav from '@/components/PageNav.vue';
import { player } from '@/player/player';
import { parseMusicXml } from '@/lib/scoreCore';
import { applyDefaultEnsemble } from '@/lib/ensemble';
import { useInstrumentStore } from '@/stores/instruments';
import { useRequestStore } from '@/stores/request';
import type { SharedScoreBody, SharedScoreItem, SharedScoreList } from '@/types/api';

const PAGE = 4;
const TYPE_NAME = { staff: '오선보', jeongganbo: '정간보' } as const;
const inst = useInstrumentStore();
const req = useRequestStore();
const working = ref<string | null>(null);
const sort = ref<'likes' | 'recent'>('likes');
const items = ref<SharedScoreItem[]>([]);
const hasMore = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const playing = ref<string | null>(null);
const busyLike = ref<string | null>(null);

/** 보관 남은 날(공유한 때부터 3일, 2026-09-30 BR-SHR-02) — 작게 "N일 남음". 예시 공유 악보는 "예시"(2026-09-30 조성기, BR-SHR-08) */
function daysLeft(it: SharedScoreItem): string | null {
  if (it.example) return '예시';
  if (!it.expires_at) return null;
  const ms = new Date(it.expires_at).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return null;
  return `${Math.max(1, Math.ceil(ms / 86_400_000))}일 남음`;
}

/** 지금 쪽(1부터) · 지금까지 알게 된 가장 뒤 쪽 */
const page = ref(1);
const known = ref(1);
const pages = computed(() => Math.max(known.value, page.value + (hasMore.value ? 1 : 0)));
async function load(reset = true, to = 1) {
  if (reset) { to = 1; known.value = 1; }
  loading.value = true; error.value = null;
  try {
    const r = await api.get<SharedScoreList>(`/api/shared-scores?sort=${sort.value}&limit=${PAGE}&offset=${(to - 1) * PAGE}`);
    const got = Array.isArray(r?.items) ? r.items : [];
    if (!got.length && to > 1) { await load(false, to - 1); return; } // 그사이 줄었으면 앞 쪽으로
    if (playing.value) { player.stop(); playing.value = null; }
    items.value = got;
    page.value = to;
    hasMore.value = !!r?.has_more;
    known.value = Math.max(known.value, to + (hasMore.value ? 1 : 0));
  } catch {
    error.value = '공유 악보 목록을 불러오지 못했습니다.';
  } finally { loading.value = false; }
}
function setSort(s: 'likes' | 'recent') { if (sort.value !== s) { sort.value = s; void load(true); } }
function goPage(n: number) { void load(false, n); }

// (2026-09-30 76번) 음원을 처음 불러올 때 player 가 'ready' 를 먼저 알려 [멈추기]가 [듣기]로 되돌아가던 문제 — 듣기를 시작하는 동안의 알림은 무시한다
let starting = false;
const off = player.on((s) => { if (!starting && s !== 'playing' && s !== 'loading') playing.value = null; });
onMounted(() => { void inst.load(); void load(true); });
onBeforeUnmount(() => { off(); if (playing.value) player.stop(); });

async function listen(it: SharedScoreItem) {
  if (playing.value === it.share_no) { player.stop(); playing.value = null; return; }
  error.value = null;
  try {
    const body = await api.get<SharedScoreBody>(`/api/shared-scores/${encodeURIComponent(it.share_no)}/score`);
    const doc = applyDefaultEnsemble(parseMusicXml(body.musicxml), inst.catalog);
    playing.value = it.share_no;
    starting = true;
    const ok = await player.play(doc, () => { if (playing.value === it.share_no) playing.value = null; });
    starting = false;
    if (!ok) { playing.value = null; error.value = '재생할 수 없습니다.'; }
  } catch {
    starting = false;
    playing.value = null; error.value = '이 악보를 불러오지 못했습니다.';
  }
}
/** [이 악보로 작업하기](2026-09-30 109번) — 공유 복사본으로 내 새 요청을 만들고 2단계로(인식 없음). S1 화면이 요청 번호를 주소에 적어 결과로 바뀐다 */
async function work(it: SharedScoreItem) {
  if (working.value) return;
  if (playing.value) { player.stop(); playing.value = null; }
  working.value = it.share_no; error.value = null;
  const g = await req.workOnShared(it.share_no);
  working.value = null;
  if (!g) return;
  if (g.code === 'REQUEST_NOT_FOUND') {
    await load(true); // 거둠 · 내림 · 3일 지나 정리된 악보는 목록에서 빠진다
    error.value = '이 공유 악보는 더 이상 쓸 수 없습니다. 목록을 새로 불러왔습니다.';
  } else error.value = `이 악보로 작업하지 못했습니다. ${g.reason}`;
}
async function like(it: SharedScoreItem) {
  if (busyLike.value) return;
  busyLike.value = it.share_no;
  try {
    const r = await api.post<{ liked: boolean; likes: number }>(`/api/shared-scores/${encodeURIComponent(it.share_no)}/like`);
    it.liked_by_me = r.liked; it.likes = r.likes;
  } catch { error.value = '좋아요를 반영하지 못했습니다.'; }
  finally { busyLike.value = null; }
}
</script>

<template>
  <section class="shared" aria-labelledby="shared-h" data-test="shared-list">
    <div class="head">
      <!-- (2026-09-30 108번) "공유 악보" → "악보 공유하기" -->
      <h2 id="shared-h" class="h2 center-h">악보 공유하기</h2>
      <p class="small muted center-h">다른 사람이 만든 악보를 먼저 들어 보십시오. 같은 곡이 있으면 다시 올리지 않아도 됩니다.</p>
      <div class="segmented" role="radiogroup" aria-label="정렬">
        <label><input type="radio" name="shared-sort" value="likes" :checked="sort === 'likes'" data-test="sort-likes" @change="setSort('likes')" /><span>좋아요 많은 순</span></label>
        <label><input type="radio" name="shared-sort" value="recent" :checked="sort === 'recent'" data-test="sort-recent" @change="setSort('recent')" /><span>최신 순</span></label>
      </div>
    </div>
    <p v-if="error" class="field-error" role="status">{{ error }}</p>
    <p v-if="!loading && !items.length && !error" class="small" data-test="shared-empty">아직 공유된 악보가 없습니다.</p>
    <div v-if="items.length" class="table-scroll">
      <table class="spec plain">
        <thead><tr><th scope="col">제목</th><th scope="col">악보 종류</th><th scope="col">좋아요</th><th scope="col">듣기</th><th scope="col">작업</th></tr></thead>
        <tbody>
          <tr v-for="it in items" :key="it.share_no" data-test="shared-row">
            <th scope="row" class="t">{{ it.title }}<span v-if="daysLeft(it)" class="left small muted" data-test="days-left">{{ daysLeft(it) }}</span></th>
            <td>{{ TYPE_NAME[it.score_type] }}</td>
            <td>
              <button
                type="button" class="btn btn-secondary btn-sm like" :class="{ on: it.liked_by_me }" :aria-pressed="it.liked_by_me"
                :aria-label="`${it.title} 좋아요 ${it.likes}개${it.liked_by_me ? ' (누름)' : ''}`" data-test="like" @click="like(it)"
              >
                {{ it.liked_by_me ? '♥' : '♡' }} {{ it.likes }}
              </button>
            </td>
            <td>
              <button type="button" class="btn btn-secondary btn-sm" :aria-label="`${it.title} ${playing === it.share_no ? '멈추기' : '듣기'}`" data-test="listen" @click="listen(it)">
                {{ playing === it.share_no ? '■ 멈추기' : '▶ 듣기' }}
              </button>
            </td>
            <td>
              <button
                type="button" class="btn btn-primary btn-sm" :aria-label="`${it.title} 이 악보로 작업하기`"
                :aria-busy="working === it.share_no ? 'true' : undefined" data-test="work" @click="work(it)"
              >
                {{ working === it.share_no ? '준비하는 중…' : '이 악보로 작업하기' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- (179번) [더 보기] 대신 쪽 넘기기 -->
    <PageNav v-if="pages > 1" :page="page" :pages="pages" :has-next="hasMore" label="악보 공유하기 쪽 넘기기" @go="goPage" />
  </section>
</template>

<style scoped>
.shared { display: grid; gap: var(--spacing-16); }
.head { display: grid; gap: var(--spacing-8); justify-items: start; }
.head p, .head h2 { margin: 0; }
.t { overflow-wrap: anywhere; }
/* (2026-09-30 황송해 191번) 1단계 표 열 머리는 가운데 */
thead th { text-align: center; }
.left { display: block; font-weight: 400; font-size: var(--text-micro); margin-top: 2px; }
.btn-sm { padding: 6px 16px; min-height: 40px; }
.like.on { color: var(--color-primary-strong); border-color: var(--color-primary-strong); font-weight: 700; }
.row { justify-content: center; }
</style>
