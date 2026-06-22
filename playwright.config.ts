import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.e2e.ts', '**/*.spec.ts'],
  timeout: 30_000,
  use: {
    trace: 'on-first-retry'
  }
});
