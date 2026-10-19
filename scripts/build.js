// The backend's local NODE_ENV=development must not disable the production PWA.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
await build();
