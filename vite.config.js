import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
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
      ],

      manifest: {
        name: 'Protocol',
        short_name: 'Protocol',
        description: 'Protocol',

        theme_color: '#050405',
        background_color: '#050405',

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
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },

      injectManifest: {
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg}',
        ],
      },
    }),
  ],
})