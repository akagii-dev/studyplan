import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  base: mode === 'pwa' ? '/studyplan-pwa/' : mode === 'demo' ? '/studyplan/' : '/',
  publicDir: false,
  build: { outDir: mode === 'pwa' ? 'dist-pwa' : 'dist', sourcemap: false },
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        '**/src-tauri/**',
        '**/release/**',
        '**/.test-data/**',
        '**/test-results/**',
        '**/playwright-report/**',
      ],
    },
  },
  clearScreen: false,
}));
