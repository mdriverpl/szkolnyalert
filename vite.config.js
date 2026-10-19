import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';
export default defineConfig({
  plugins: [vue(), {
    name: 'school-pwa-worker', apply: 'build',
    generateBundle(options, bundle) {
      const assets = ['/index.html', '/icon-180.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest', '/teacher.webmanifest', ...Object.keys(bundle).filter(file => /\.(js|css)$/.test(file)).map(file => '/' + file)];
      const source = readFileSync(new URL('./src/service-worker.js', import.meta.url), 'utf8').replace('__BUILD_ID__', Date.now().toString(36)).replace('__PRECACHE__', JSON.stringify(assets));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    }
  }],
  server: {
    proxy: {
      // Preserve the browser host so the API can verify same-origin writes.
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false }
    }
  }
});
