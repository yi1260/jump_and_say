import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/cdn-proxy': {
            target: env.VITE_R2_BASE_URL || 'https://cdn.maskmysheet.com/raz_aa',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/cdn-proxy/, ''),
          },
        },
      },
      plugins: [
        react(), 
        basicSsl(),
        VitePWA({
          registerType: 'autoUpdate',
          devOptions: {
            enabled: true
          },
          workbox: {
            globPatterns: ['**/*.{js,css,html,ico,png,svg,mp3,ogg,ttf}'],
            globIgnores: [
              '**/node_modules/**/*',
              'sw.js',
              'workbox-*.js',
              '**/asserts/kenney/Sprites/**/*',
              '**/asserts/kenney/Vector/backup/**/*'
            ],
            runtimeCaching: [
              {
                urlPattern: /^https:\/\/cdn\.maskmysheet\.com\/raz_aa\/.*/i,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'raz-aa-cdn-cache',
                  expiration: {
                    maxEntries: 1000,
                    maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
                  },
                  cacheableResponse: {
                    statuses: [0, 200]
                  }
                }
              }
            ]
          }
        })
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
        '@': path.resolve(__dirname, '.'),
        '/asserts': path.resolve(__dirname, './public/asserts'),
        '/kenney': path.resolve(__dirname, './public/asserts/kenney'),
      }
      }
    };
});
