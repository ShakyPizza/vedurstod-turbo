import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'web'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/stodvar': 'http://localhost:8080',
    },
  },
});
