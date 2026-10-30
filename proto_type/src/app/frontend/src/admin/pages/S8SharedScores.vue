<script setup lang="ts">
// S8 공유 악보 관리 (2026-09-30 황송해 결정 — design/UC_18 UC19 · SD_02 §10B)
// 모든 공유 악보를 상태로 거르고, 부적절한 것을 [내리기](사유 · 확인 창) · [다시 올리기]. 올린 사람 정보는 보이지 않는다(BR-SHR-03).
import { onMounted, ref, watch } from 'vue';
import { adminApi } from '../api';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { dateTime } from '../lib/format';
import type { SharedScoreAdminRow } from '../types';

const STATUS = [
  { id: 'all', label: '모두' }, { id: 'visible', label: '보임' }, { id: 'taken_down', label: '내림' }, { id: 'unshared', label: '거둠' }, { id: 'expired', label: '3일 지남' },
] as const;
const STATUS_LABEL: Record<SharedScoreAdminRow['status'], string> = { visible: '보임', taken_down: '내림', unshared: '거둠(올린 사람)', expired: '3일 지남(정리 대기)', purged: '정리됨' };
const TYPE_NAME = { staff: '오선보', jeongganbo: '정간보' } as const;

const status = ref<string>('all');
const rows = ref<SharedScoreAdminRow[]>([]);
const loading = ref(false);
const flash = ref('');
const target = ref<SharedScoreAdminRow | null>(null);
const reason = ref('');
const busy = ref(false);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  try { rows.value = (await adminApi.sharedScores(status.value)).items ?? []; }
  catch { flash.value = '공유 악보를 불러오지 못했습니다.'; }
  finally { loading.value = false; }
}
onMounted(load);
watch(status, load);

async function takeDown() {
  if (!target.value) return;
  busy.value = true; error.value = null;
  try {
    await adminApi.takeDownShared(target.value.share_no, reason.value.trim());
    flash.value = `${target.value.title} 을(를) 목록에서 내렸습니다.`;
    target.value = null; reason.value = '';
    await load();
  } catch { error.value = '내리지 못했습니다. 다시 해 주십시오.'; }
  finally { busy.value = false; }
}
async function restore(r: SharedScoreAdminRow) {
  try { await adminApi.restoreShared(r.share_no); flash.value = `${r.title} 을(를) 다시 올렸습니다.`; await load(); }
  catch { flash.value = '다시 올리지 못했습니다.'; }
}
</script>

<template>
  <main id="admin-main" class="admin-main">
    <header>
      <span class="eyebrow">공유 악보</span>
      <h1 class="h2">공유 악보 관리</h1>
      <p class="small muted" style="margin: 0">사용자가 모두에게 공유한 악보입니다(공유한 때부터 3일 보관, 지나면 저절로 정리). 부적절한 악보는 목록에서 내리고, 잘못 내렸으면 다시 올립니다. 올린 사람은 보이지 않고, 조치는 변경 이력에 남습니다.</p>
    </header>

    <div class="row" role="radiogroup" aria-label="상태로 거르기">
      <label v-for="s in STATUS" :key="s.id" class="chip" :class="{ on: status === s.id }">
        <input v-model="status" type="radio" name="shared-status" :value="s.id" class="sr-only" :data-test="`status-${s.id}`" />{{ s.label }}
      </label>
    </div>
    <p class="small" role="status" aria-live="polite" style="margin: 0; min-height: 20px">{{ flash }}</p>

    <p v-if="loading" class="body" role="status">불러오는 중입니다.</p>
    <p v-else-if="!rows.length" class="body" data-test="shared-empty">공유 악보가 없습니다.</p>
    <div v-else class="table-scroll">
      <table class="spec">
        <caption class="sr-only">공유 악보 목록</caption>
        <thead><tr><th scope="col">제목</th><th scope="col">종류</th><th scope="col">좋아요</th><th scope="col">공유 시각</th><th scope="col">보관 끝</th><th scope="col">상태</th><th scope="col">조치</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.share_no" data-test="shared-admin-row">
            <th scope="row">{{ r.title }} <span class="small muted">{{ r.share_no }}</span></th>
            <td>{{ TYPE_NAME[r.score_type] }}</td>
            <td class="num-col">{{ r.likes }}</td>
            <td>{{ dateTime(r.shared_at) }}</td>
            <td>{{ r.expires_at ? dateTime(r.expires_at) : '' }}</td>
            <td>{{ STATUS_LABEL[r.status] }}<span v-if="r.take_down_reason" class="small muted"> ({{ r.take_down_reason }})</span></td>
            <td>
              <button v-if="r.status === 'visible'" type="button" class="btn btn-secondary" data-test="take-down" @click="target = r; reason = ''">내리기</button>
              <button v-else-if="r.status === 'taken_down'" type="button" class="btn btn-secondary" data-test="restore" @click="restore(r)">다시 올리기</button>
              <span v-else class="small muted">없음</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ConfirmDialog v-if="target" :title="`${target.title} 을(를) 목록에서 내리시겠습니까?`" confirm-label="내리기" :busy="busy" :error="error" @confirm="takeDown" @cancel="target = null">
      <p class="body" style="margin: 0">내리면 사용자 목록과 듣기에서 빠집니다. 파일은 남아 다시 올릴 수 있습니다.</p>
      <label class="field">
        <span class="label">사유 (선택)</span>
        <input v-model="reason" class="input" type="text" maxlength="200" data-test="take-down-reason" />
      </label>
    </ConfirmDialog>
  </main>
</template>
