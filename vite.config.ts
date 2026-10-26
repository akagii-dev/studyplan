import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig(({ mode }) => ({
  base: mode === 'lan' ? '/studyplan-lan/' : mode === 'demo' ? '/studyplan/' : '/',
  publicDir: mode === 'lan' ? false : 'public',
  build: {
    ...(mode === 'lan' ? { outDir: 'dist-lan', sourcemap: false } : {}),
    // Fonts stay separate files: the desktop CSP does not allow data: fonts.
    assetsInlineLimit: (file: string) => (/\.woff2?$/.test(file) ? false : undefined),
  },
  plugins: [react(), tailwindcss()],
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
