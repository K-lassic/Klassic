// 일반 사용자 화면 진입점 (index.html) — 관리자 화면은 admin.html 로 따로 빌드된다(v0.1.1 research R13)
// 스타일(tokens · styleguide)은 공통 컴포넌트 이슈(#38)에서 옮긴다
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';

createApp(App).use(createPinia()).use(router).mount('#app');
