/**
 * E2E smoke test: Admin login, token persistence, and token expiration.
 *
 * @smoke
 */
import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'test@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpassword123';

test.describe('Admin Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to start fresh
    await page.context().clearCookies();
    await page.context().clearPermissions();
  });

  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await page.goto('/login');

    // Login form inputs have no name attribute; use label text to find them
    await page.getByLabel(/email|邮箱/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password|密码/i).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /login|登录|submit|提交/i }).click();

    // Should redirect after successful login
    await page.waitForURL(/\/(dashboard|playground)/, { timeout: 10_000 });

    // Token should be stored in localStorage
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeTruthy();

    // Admin info should be stored
    const admin = await page.evaluate(() => localStorage.getItem('admin'));
    expect(admin).toBeTruthy();
  });

  test('refresh page preserves login state', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.getByLabel(/email|邮箱/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password|密码/i).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /login|登录|submit|提交/i }).click();
    await page.waitForURL(/\/(dashboard|playground)/, { timeout: 10_000 });

    // Refresh the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should still be logged in (not redirected to /login)
    await expect(page).not.toHaveURL(/\/login$/);
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeTruthy();
  });

  test('invalid credentials show error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email|邮箱/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password|密码/i).fill('wrongpassword');
    await page.getByRole('button', { name: /login|登录|submit|提交/i }).click();

    // Should show error message
    await expect(page.getByText(/登录失败|invalid|incorrect|failed/i)).toBeVisible({ timeout: 5_000 });
  });

  test('expired token triggers auto-logout', async ({ page }) => {
    // Create an expired JWT token (exp in the past)
    const expiredPayload = { sub: '1', exp: Math.floor(Date.now() / 1000) - 100 };
    const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
    const payload = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
    const expiredToken = `${header}.${payload}.fakesignature`;

    // Set expired token in localStorage
    await page.goto('/');
    await page.evaluate(({ token, admin }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('admin', JSON.stringify(admin));
    }, { token: expiredToken, admin: { id: 1, email: ADMIN_EMAIL, name: 'Test' } });

    // Reload page - AuthContext should detect expired token and logout
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should be redirected to login
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });

    // localStorage should be cleared
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeFalsy();
  });
});
