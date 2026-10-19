import { existsSync } from 'node:fs';
import { createStore } from './store.js';
import { createApp } from './app.js';
if (existsSync('.env')) process.loadEnvFile('.env');
const store = await createStore({ connectionString: process.env.DATABASE_URL });
const app = createApp(store);
const server = app.listen(Number(process.env.PORT || 3001), '127.0.0.1', () => console.log(`Szkolny Alert API: http://127.0.0.1:${process.env.PORT || 3001} • ${store.demo ? 'DEMO — dane przykładowe' : 'PostgreSQL'}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await store.close(); process.exit(); }));
