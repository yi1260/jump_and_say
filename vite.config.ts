import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

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
      plugins: [react(), basicSsl()],
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
