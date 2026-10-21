import { createApp } from 'vue';
import App from './App.vue';
import TeacherPanel from './TeacherPanel.vue';
import './theme.css';
import './style.css';
import './interface.css';
import './teacher-panel.css';
import './landing.css';
const teacherRoute = window.location.pathname === '/nauczyciel' || window.location.pathname.startsWith('/nauczyciel/');
if (teacherRoute) {
  document.querySelector('link[rel="manifest"]').href = '/teacher.webmanifest';
  document.title = 'Szkolny Alert • Panel nauczyciela';
}
createApp(teacherRoute ? TeacherPanel : App).mount('#app');
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const register = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (document.readyState === 'complete') register(); else window.addEventListener('load', register, { once: true });
}
