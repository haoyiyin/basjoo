/**
 * Shared admin authentication fixture for Playwright E2E tests.
 * Re-exports from e2e-context for backwards compatibility.
 */
import type { Page } from '@playwright/test';

// Re-export from shared context for backwards compatibility
export {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API_BASE,
  BASE_URL,
  type E2EAgentContext,
  loginHeaders,
  agentRoute,
  loginByApi,
  getDefaultAgent,
  resolveAgentContext,
} from './e2e-context';

import { adminLogin as sharedAdminLogin } from './e2e-context';

/**
 * Login to the admin dashboard and return the page object.
 * Delegates to shared context helper with proper headers.
 */
export async function adminLogin(page: Page): Promise<void> {
  await sharedAdminLogin(page);
}

/**
 * Navigate to a dashboard page with admin auth.
 */
export async function goToPage(page: Page, path: string): Promise<void> {
  // Ensure logged in first
  const token = await page.evaluate(() => localStorage.getItem('token'));
  if (!token) {
    await adminLogin(page);
  }
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}
