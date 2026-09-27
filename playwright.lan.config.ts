import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/lan', testMatch: '**/*.spec.ts',
  outputDir: 'test-results/lan', workers: 1, timeout: 60000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4182/studyplan-lan/', channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', trace: 'retain-on-failure' },
  projects: [
    { name: 'wide', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'narrow', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: 'node tests/lan/server.mjs', url: 'http://127.0.0.1:4182/studyplan-lan/', reuseExistingServer: false, timeout: 30000 },
});
