import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies the admin API and health endpoint to the Core service so
// the UI can use relative URLs (VITE_API_BASE left empty).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)), 'CORE_URL');
  const coreUrl = process.env.CORE_URL ?? env.CORE_URL ?? 'http://localhost:3000';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/admin': { target: coreUrl, changeOrigin: true },
        '/health': { target: coreUrl, changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router'],
            antd: ['antd', '@ant-design/icons'],
            refine: ['@refinedev/core', '@refinedev/antd', '@refinedev/react-router'],
            i18n: ['i18next', 'react-i18next'],
          },
        },
      },
    },
  };
});
