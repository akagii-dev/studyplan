import { defineConfig } from '@playwright/test';

// Portable contract tests. Native SQLite/E2E stays in playwright.config.ts.
export default defineConfig({
  testDir: 'tests/web',
  outputDir: 'test-results/contracts',
  fullyParallel: true,
  timeout: 90000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4177/studyplan/',
    timezoneId: 'Asia/Tokyo',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'wide', use: { viewport: { width: 1280, height: 950 } } },
    { name: 'narrow', use: { viewport: { width: 320, height: 844 } } },
  ],
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js preview --mode demo --host 127.0.0.1 --port 4177 --strictPort',
    url: 'http://127.0.0.1:4177/studyplan/',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
