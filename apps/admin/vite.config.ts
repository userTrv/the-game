import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

// Served by the game server under /admin/ (ADMIN_DIST). In dev: http://localhost:5174/admin/
export default defineConfig({
  base: '/admin/',
  plugins: [preact()],
  server: { port: 5174, proxy: { '/admin/api': 'http://localhost:3000' } },
  build: { target: 'es2022' },
});
