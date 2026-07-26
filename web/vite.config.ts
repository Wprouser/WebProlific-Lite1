/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'WebProlific-Lite',
        short_name: 'WebProlific',
        description: 'AI Inventory Management System for hotels and restaurants',
        // Matches --primary in tokens.css — kept in sync manually since the
        // manifest can't read a CSS custom property at build time.
        theme_color: '#5b3df0',
        background_color: '#0b0b10',
        display: 'standalone',
        // Placeholder — swap for real raster icons (192/512 PNG, maskable
        // variant) once the product has actual brand artwork.
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Dev-only: lets the frontend call same-origin `/api/v1/...` and
    // `/uploads/...` paths without the backend needing CORS configured —
    // that's a separate, more consequential decision (real origin
    // whitelisting) for whenever this ships behind a real domain.
    proxy: {
      '/api': 'http://localhost:3000',
      // ItemImage.url values are stored as backend-relative paths (see
      // LocalDiskStorageRepository) and rendered directly as <img src>, so
      // without this the browser resolves them against the Vite dev
      // server's own origin, which has no route for them — Vite's SPA
      // fallback then serves index.html instead of the image (200, but
      // text/html), and the <img> silently renders blank.
      '/uploads': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
