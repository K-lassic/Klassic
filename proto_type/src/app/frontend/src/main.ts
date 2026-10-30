// 일반 사용자 화면 진입점 (index.html) — 관리자 화면은 admin.html 로 따로 빌드된다(research R13)
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import './styles/tokens.css';
import './styles/styleguide.css';
import './app.css';
import App from './App.vue';
import { router } from './router';

createApp(App).use(createPinia()).use(router).mount('#app');
