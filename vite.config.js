import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        home: resolve(projectRoot, 'index.html'),
        apiDocs: resolve(projectRoot, 'api-docs/index.html'),
        comfyUI: resolve(projectRoot, 'comfyui/index.html'),
      },
    },
  },
  server: {
    proxy: {
      // Keep the trailing slash so the /api-docs multi-page route is never proxied.
      '/api/': {
        target: process.env.SUB2API_URL || 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
});
