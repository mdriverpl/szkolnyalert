import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // Preserve the browser host so the API can verify same-origin writes.
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false }
    }
  }
});
