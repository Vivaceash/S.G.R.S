import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: process.env.SGRS_PROXY_TARGET || 'http://127.0.0.1:3000', changeOrigin: false } },
  },
  preview: { host: '127.0.0.1', port: 4173 },
});
