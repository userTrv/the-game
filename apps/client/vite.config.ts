import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [preact()],
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0') },
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': 'http://localhost:3000', '/admin/api': 'http://localhost:3000' },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: { pixi: ['pixi.js'] } } },
  },
});
