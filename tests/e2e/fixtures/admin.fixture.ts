/**
 * Shared admin authentication fixture for Playwright E2E tests.
 */
import { Page, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'test@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpassword123';

/**
 * Login to the admin dashboard and return the page object.
 */
export async function adminLogin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email|邮箱/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password|密码/i).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /login|登录|submit|提交/i }).click();
  // Wait for redirect after successful login
  await page.waitForURL(/\/(dashboard|playground)/, { timeout: 10_000 });
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
