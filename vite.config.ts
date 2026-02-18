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
      build: {
        chunkSizeWarningLimit: 2000,
        rollupOptions: {
          output: {
            manualChunks: {
              'phaser': ['phaser'],
              'react-vendor': ['react', 'react-dom', 'framer-motion'],
            }
          }
        }
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
            cleanupOutdatedCaches: true,
            globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,json,wasm,data,tflite,woff,woff2,ttf}'],
            maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10MB
            globIgnores: [
              '**/node_modules/**/*',
              'sw.js',
              'workbox-*.js',
              '**/assets/kenney/**/*',
              '**/assets/Fredoka/**/*',
              '**/mediapipe/pose/**/*',
              '**/themes.backup*/**/*',
              '**/assets/kenney/Sprites/**/*',
              '**/assets/kenney/Vector/backup/**/*'
            ],
            ignoreURLParametersMatching: [/^utm_/, /^fbclid$/],
            skipWaiting: true,
            clientsClaim: true,
            runtimeCaching: [
              {
                urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/themes/'),
                handler: 'CacheFirst',
                options: {
                  cacheName: 'local-themes-cache',
                  expiration: {
                    maxEntries: 50,
                    maxAgeSeconds: 60 * 60 * 24 * 7
                  },
                  cacheableResponse: {
                    statuses: [0, 200]
                  }
                }
              },
              {
                urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/assets/'),
                handler: 'CacheFirst',
                options: {
                  cacheName: 'local-assets-cache',
                  expiration: {
                    maxEntries: 500,
                    maxAgeSeconds: 60 * 60 * 24 * 365
                  },
                  cacheableResponse: {
                    statuses: [0, 200]
                  }
                }
              },
              // 1. MediaPipe CDN Caching (CDN First, Long-term Cache)
              // Matches jsdelivr, unpkg, and your own CDN for mediapipe files
              {
                urlPattern: /^https:\/\/(cdn\.jsdelivr\.net|fastly\.jsdelivr\.net|unpkg\.com|cdn\.maskmysheet\.com)\/.*mediapipe.*\.(?:js|wasm|data|tflite)$/i,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'mediapipe-cdn-cache-v2',
                  expiration: {
                    maxEntries: 20,
                    maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
                  },
                  cacheableResponse: {
                    statuses: [0, 200]
                  }
                }
              },
              // 2. Theme Images (RAZ) - Updated rule for uppercase path structure
              {
                urlPattern: /^https:\/\/cdn\.maskmysheet\.com\/RAZ\/.*/i,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'raz-cdn-cache-v4',
                  expiration: {
                    maxEntries: 1000,
                    maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
                  },
                  cacheableResponse: {
                    statuses: [200]
                  }
                }
              },
              // 3. General Game Assets (assets/ and jump-and-say-themes-pic/) - R2 CDN
              // Matches https://cdn.maskmysheet.com/assets/... or .../jump-and-say-themes-pic/...
              {
                urlPattern: /^https:\/\/cdn\.maskmysheet\.com\/(assets|jump-and-say-themes-pic)\/.*/i,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'game-assets-cdn-cache-v3',
                  expiration: {
                    maxEntries: 500,
                    maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
                  },
                  cacheableResponse: {
                    statuses: [200]
                  }
                }
              },
              // 4. Google Fonts (Cache First)
              {
                urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'google-fonts-cache',
                  expiration: {
                    maxEntries: 10,
                    maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
                  },
                  cacheableResponse: {
                    statuses: [0, 200]
                  }
                }
              },
              // 5. Google Fonts Webfiles (Stale While Revalidate)
              {
                urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'gstatic-fonts-cache',
                  expiration: {
                    maxEntries: 10,
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
        '/assets': path.resolve(__dirname, './public/assets'),
        '/kenney': path.resolve(__dirname, './public/assets/kenney'),
      }
      }
    };
});
