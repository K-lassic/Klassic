<script setup lang="ts">
// S6 운영 측정과 설정 (SD_02 §10 · T103). 탭: 지표 · 요청 기록 · 평가셋 · 설정 · 모델 · 변경 이력. 탭 메뉴는 C7 머리띠에 있다.
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import ServerStatusLine from '../components/ServerStatusLine.vue';
import MetricsTab from './s6/MetricsTab.vue';
import JobsTab from './s6/JobsTab.vue';
import EvaluationTab from './s6/EvaluationTab.vue';
import SettingsTab from './s6/SettingsTab.vue';
import ModelsTab from './s6/ModelsTab.vue';
import AuditTab from './s6/AuditTab.vue';
import { S6_TABS, type S6TabId } from '../router';

const route = useRoute();
const tab = computed(() => (route.params.tab as S6TabId) ?? 'metrics');
const label = computed(() => S6_TABS.find((t) => t.id === tab.value)?.label ?? '');
const views = { metrics: MetricsTab, jobs: JobsTab, evaluation: EvaluationTab, settings: SettingsTab, models: ModelsTab, audit: AuditTab } as const;
</script>

<template>
  <main id="admin-main" class="admin-main">
    <header>
      <span class="eyebrow">운영 측정과 설정</span>
      <h1 class="h2">{{ label }}</h1>
    </header>
    <ServerStatusLine />
    <component :is="views[tab]" :key="tab" />
  </main>
</template>
