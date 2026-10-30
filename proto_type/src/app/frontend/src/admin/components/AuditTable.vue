<script setup lang="ts">
// 변경 이력 (FR-052 · v_change_history_all): 운영자 · 시각 · 대상 · 항목 · 전 값 · 바뀐 값
import { AUDIT_FIELD_LABEL, AUDIT_TARGET_LABEL, dateTime } from '../lib/format';
import type { AuditRow } from '../types';

defineProps<{ rows: AuditRow[]; caption: string }>();
function operator(r: AuditRow) {
  return r.operator_masked ?? (r.operator_id === null || r.operator_id === undefined ? '시스템' : `운영자 #${r.operator_id}`);
}
</script>

<template>
  <div class="table-scroll">
    <table class="spec">
      <caption class="sr-only">{{ caption }}</caption>
      <thead>
        <tr><th scope="col">시각</th><th scope="col">운영자</th><th scope="col">대상</th><th scope="col">항목</th><th scope="col">바뀌기 전</th><th scope="col">바뀐 값</th></tr>
      </thead>
      <tbody>
        <tr v-if="!rows.length"><td colspan="6" class="muted">아직 변경 기록이 없습니다.</td></tr>
        <tr v-for="(r, i) in rows" :key="i">
          <td class="nowrap">{{ dateTime(r.changed_at) }}</td>
          <td>{{ operator(r) }}</td>
          <td>{{ AUDIT_TARGET_LABEL[r.target_type] ?? r.target_type }}<span v-if="r.target_ref" class="muted"> · {{ r.target_ref }}</span></td>
          <th scope="row">{{ AUDIT_FIELD_LABEL[r.field_name] ?? r.field_name }}</th>
          <td class="desc">{{ r.before_value ?? '—' }}</td>
          <td>{{ r.after_value ?? '—' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
