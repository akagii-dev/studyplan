import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  base: mode === 'lan' ? '/studyplan-lan/' : mode === 'demo' ? '/studyplan/' : '/',
  publicDir: mode === 'lan' ? false : 'public',
  build: mode === 'lan' ? { outDir: 'dist-lan', sourcemap: false } : undefined,
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
