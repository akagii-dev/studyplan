import { defineConfig } from '@playwright/test';

// Runs against a temporary localhost server and a fresh browser profile per test.
export default defineConfig({
  testDir: 'tests/pwa',
  testMatch: '*.spec.ts',
  outputDir: 'test-results/pwa',
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  reporter: 'list',
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    timezoneId: 'Asia/Tokyo',
    serviceWorkers: 'allow',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'narrow', use: { viewport: { width: 390, height: 844 } } },
    { name: 'wide', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
