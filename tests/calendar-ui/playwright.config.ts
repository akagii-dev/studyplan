import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', outputDir: '../../test-results/calendar-ui',
  fullyParallel: true, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4179', timezoneId: 'Asia/Tokyo',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'wide', use: { viewport: { width: 1280, height: 950 } } },
    { name: 'narrow', use: { viewport: { width: 320, height: 844 } } },
  ],
  webServer: { cwd: fileURLToPath(new URL('../../', import.meta.url)), command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179/tests/calendar-ui/calendar.html', reuseExistingServer: false },
});
