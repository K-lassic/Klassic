// 관리자 화면 진입점 (admin.html). 사용자 화면(index.html)과 번들을 나눈다(research R13).
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '@/styles/tokens.css';
import '@/styles/styleguide.css';
import './admin.css';
import AdminApp from './AdminApp.vue';
import { createAdminRouter } from './router';

const app = createApp(AdminApp);
app.use(createPinia());
app.use(createAdminRouter());
app.mount('#app');
