import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for Basjoo.
 *
 * Two primary project modes:
 * - 'smoke': Fast functional E2E against dev environment (localhost:3000)
 * - 'prod-like': Production-approximate E2E via nginx (localhost:80/443)
 *
 * Environment variables:
 * - BASE_URL: Admin dashboard URL (default: http://localhost:3000)
 * - API_BASE_URL: Backend API URL (default: http://localhost:8000)
 * - ADMIN_EMAIL: Test admin email (default: test@example.com)
 * - ADMIN_PASSWORD: Test admin password (default: testpassword123)
 */

const isCI = !!process.env.CI;
const isProdLike = process.env.E2E_ENV === 'prod';

const baseURL = process.env.BASE_URL || (isProdLike ? 'http://localhost' : 'http://localhost:3000');
const apiBaseUrl = process.env.API_BASE_URL || (isProdLike ? 'http://localhost' : 'http://localhost:8000');

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  ignoreSnapshots: false,
  reporter: [['html', { outputFolder: '../playwright-report' }], ['list']],
  // Avoid picking up non-playwright test files (e.g. frontend vitest tests)
  testIgnore: ['**/frontend-nextjs/**', '**/widget/**', '**/backend/**'],
  use: {
    baseURL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Global setup runs once before all tests: seeds admin + QA data
  globalSetup: './global.setup.ts',
  projects: [
    // Smoke E2E against dev environment - runs core admin/chat specs only
    {
      name: 'smoke',
      testMatch: ['admin-auth.spec.ts', 'playground-streaming.spec.ts', 'knowledge-indexing.spec.ts', 'sessions-takeover.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.BASE_URL || 'http://localhost:3000',
        viewport: { width: 1280, height: 720 },
      },
    },
    // Widget cross-origin E2E (requires host pages and external config)
    {
      name: 'widget-cross-origin',
      testMatch: ['widget-cross-origin.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.HOST_BASE_URL || 'http://localhost',
        viewport: { width: 1280, height: 720 },
      },
    },
    // Production-approximate E2E via nginx (runs all specs via nginx)
    {
      name: 'prod-like',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.BASE_URL || 'http://localhost',
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: isProdLike ? undefined : [
    {
      command: 'docker compose --profile dev up -d',
      url: 'http://localhost:3000',
      timeout: 120_000,
      reuseExistingServer: true,
    },
  ],
});
