import { copyFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Where the app is served from. GitHub Pages serves a project at /<repository>/, and the deploy
// workflow passes that in; everywhere else the app sits at the root.
const base = process.env.BASE_PATH ? `/${process.env.BASE_PATH.replace(/^\/|\/$/g, '')}/` : '/';

/**
 * Static hosts have no idea that /collection or /builds/abc are pages of this app. GitHub Pages
 * serves 404.html for any path it does not have, so a copy of the app's entry page there makes
 * every address open the app.
 */
const spaFallback = (): Plugin => ({
  name: 'spa-fallback',
  apply: 'build',
  closeBundle() {
    copyFileSync('dist/index.html', 'dist/404.html');
  },
});

// `npm run dev:phone` serves over HTTPS on the local network: phone browsers only allow camera
// access on secure origins, and the certificate is self-signed, so expect a one-time warning.
export default defineConfig(({ mode }) => ({
  base,
  plugins: [
    react(),
    tailwindcss(),
    ...(mode === 'phone' ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Brickloom',
        short_name: 'Brickloom',
        description: 'Scan and sort your bricks, then design new builds from what you own.',
        theme_color: '#FFD23F',
        background_color: '#F4F1EA',
        display: 'standalone',
        orientation: 'any',
        // PNGs are what phone launchers use (see scripts/make-icons.mjs); the SVG covers everything else.
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // The data files are large (thousands of part shapes) and mostly never needed by any one
        // person: cache each on first use instead of downloading them all when the app installs.
        globIgnores: ['catalog/**', 'ldraw/**', 'sets/**', '404.html'],
        runtimeCaching: [
          {
            urlPattern: /\/(catalog|sets)\/.*\.json$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'catalog' },
          },
          {
            urlPattern: /\/ldraw\/.*\.json$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'ldraw', expiration: { maxEntries: 4000 } },
          },
        ],
      },
    }),
    spaFallback(),
  ],
  // three.js accounts for most of the bundle and is needed on every screen, so one chunk is fine.
  build: { chunkSizeWarningLimit: 1500 },
  server: { port: 5173, host: mode === 'phone' },
  preview: { port: 4173 },
}));
