import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendProxyTarget = process.env.BACKEND_PROXY_TARGET || 'http://localhost:8000';

const proxy = {
  target: backendProxyTarget,
  changeOrigin: true,
};

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Vite 8 runs on rolldown, where `manualChunks` only accepts a function
        // (the object-map form was removed). This is the equivalent split:
        // react/react-dom land in their own `react` chunk, everything else in app code.
        manualChunks(id: string) {
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      // NOTE: no `compress`/buffering options here — SSE responses from the
      // backend must stream through untouched.
      '/api': proxy,
      '/sdk.js': proxy,
      '/widget-demo': proxy,
      '/basjoo-logo.png': proxy,
      '/health': proxy,
    },
  },
});
