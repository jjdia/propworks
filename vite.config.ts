import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Base must match the GitHub Pages repo path (https://jjdia.github.io/propworks/)
export default defineConfig({
  base: '/propworks/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // autoUpdate means the SW checks for a new build on every load and
      // swaps in new app-shell assets in the background, then activates on
      // next navigation. This replaces the old app's manually-bumped
      // CACHE version string (which required remembering to bump it, and
      // was a real source of stale-app bugs) with an automatic, content-hashed
      // cache that can't go stale silently.
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'PropertyWorks',
        short_name: 'PropertyWorks',
        description: 'Real estate command center — manage, buy, sell, renovate, grow.',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        display: 'standalone',
        start_url: '/propworks/',
        scope: '/propworks/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Network-first for navigations so a signed-in owner always gets
        // the latest app shell when online, with an offline cache fallback
        // so the app still opens (never blank) with no connection.
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'pw-pages', networkTimeoutSeconds: 3 },
          },
        ],
      },
    }),
  ],
})
