import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

// Serve /landid as landid.html in dev and preview, like server/index.js does.
function cleanPageUrls(): Plugin {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    if (req.url && /^\/landid\/?(\?|#|$)/.test(req.url)) req.url = req.url.replace(/^\/landid\/?/, '/landid.html');
    next();
  };
  return {
    name: 'clean-page-urls',
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, 'web'),
  plugins: [cleanPageUrls()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'web/index.html'),
        landid: resolve(__dirname, 'web/landid.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/stodvar': 'http://localhost:8080',
    },
  },
});
