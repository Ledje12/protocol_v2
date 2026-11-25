import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // version déployée (commit Vercel), notée avec chaque erreur
  define: {
    __APP_VERSION__: JSON.stringify(
      (process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7)
    ),
  },

  plugins: [
    react(),

    VitePWA({
      strategies: 'injectManifest',

      srcDir: 'src',
      filename: 'sw.js',

      registerType: 'autoUpdate',

      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'pwa-maskable-512x512.png',
      ],

      manifest: {
        name: 'Protocol',
        short_name: 'Protocol',
        description: 'Protocol',

        theme_color: '#08050a',
        background_color: '#08050a',

        display: 'standalone',
        orientation: 'portrait',

        start_url: '/',
        scope: '/',

        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            // Android découpe l'icône en cercle : le P y est plus petit
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      injectManifest: {
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,webp}',
        ],
        // écrans de lancement iOS : un seul par appareil, lu par iOS
        // à l'installation ; inutile de tous les mettre en cache
        globIgnores: ['splash/**'],
      },
    }),
  ],
})