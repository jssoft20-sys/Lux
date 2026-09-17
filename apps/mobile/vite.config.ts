import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'banks/*.png'],
      manifest: {
        name: 'Somex — P2P USDT',
        short_name: 'Somex',
        description: 'Люди. Деньги. Возможности. P2P USDT для Кыргызстана.',
        theme_color: '#0B100E',
        background_color: '#0B100E',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'ru',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: { navigateFallbackDenylist: [/^\/api\//], globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@somex/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_URL || 'http://localhost:4000', changeOrigin: true }, '/socket.io': { target: process.env.VITE_WS_URL || 'http://localhost:4000', ws: true } },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
});
