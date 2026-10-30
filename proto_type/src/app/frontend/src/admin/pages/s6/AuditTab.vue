<script setup lang="ts">
// 변경 이력 탭 (FR-052 · BR-OPS-08): 누가 · 언제 · 무엇을 바꿨는지 숨기지 않는다.
import { computed, onMounted, ref } from 'vue';
import { adminApi } from '../../api';
import AuditTable from '../../components/AuditTable.vue';
import { AUDIT_TARGET_LABEL } from '../../lib/format';
import type { AuditRow } from '../../types';

const rows = ref<AuditRow[]>([]);
const target = ref('');
const error = ref('');
const loading = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try { rows.value = await adminApi.audit({ limit: 200 }); } catch (e) { error.value = (e as Error).message || '변경 이력을 불러오지 못했습니다.'; } finally { loading.value = false; }
}
onMounted(load);
const shown = computed(() => {
  const list = target.value ? rows.value.filter((r) => r.target_type === target.value) : rows.value;
  return [...list].sort((a, b) => (a.changed_at < b.changed_at ? 1 : -1));
});
</script>

<template>
  <section class="stack" aria-labelledby="audit-h">
    <h2 id="audit-h" class="sr-only">변경 이력</h2>
    <div class="panel-head">
      <div class="field">
        <label for="audit-target">대상</label>
        <select id="audit-target" v-model="target" class="input compact">
          <option value="">전체</option>
          <option v-for="(label, key) in AUDIT_TARGET_LABEL" :key="key" :value="key">{{ label }}</option>
        </select>
      </div>
      <button type="button" class="btn btn-secondary" :disabled="loading" @click="load">{{ loading ? '불러오는 중…' : '새로 고침' }}</button>
    </div>
    <div v-if="error" class="notice n-rejected" role="alert"><span class="title">변경 이력을 불러오지 못했습니다</span><p>{{ error }}</p></div>
    <AuditTable :rows="shown" caption="변경 이력(최근 변경이 위)" />
  </section>
</template>
