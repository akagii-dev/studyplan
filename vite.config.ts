import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? '/studyplan/' : '/',
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
