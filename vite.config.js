import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true, port: 3002 },
  build: { outDir: 'dist', target: 'es2020' }
});
