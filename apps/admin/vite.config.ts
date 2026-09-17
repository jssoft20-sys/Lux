import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@somex/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    proxy: { '/api': { target: process.env.VITE_API_URL || 'http://localhost:4000', changeOrigin: true }, '/socket.io': { target: process.env.VITE_WS_URL || 'http://localhost:4000', ws: true } },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 1200 },
});
