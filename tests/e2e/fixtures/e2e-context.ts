/**
 * Shared E2E context helper providing single source of truth for:
 * - Credentials (ADMIN_EMAIL, ADMIN_PASSWORD)
 * - API/Base URLs
 * - Agent context resolution
 * - Admin login (API and UI)
 * - Agent-scoped route construction
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'test@example.com';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpassword123';
export const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000';
export const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export type E2EAgentContext = {
  agentId: string;
  adminEmail: string;
  apiBaseUrl: string;
  baseUrl: string;
};

/**
 * Generate headers with random IP for rate limit bypass.
 */
export function loginHeaders(): Record<string, string> {
  return { 'X-Forwarded-For': `203.0.113.${Math.floor(Math.random() * 200) + 20}` };
}

/**
 * Construct an agent-scoped route path.
 */
export function agentRoute(
  agentId: string,
  page: 'dashboard' | 'playground' | 'sessions' | 'files' | 'urls' | 'settings/agent'
): string {
  return `/agents/${agentId}/${page}`;
}

/**
 * Login via API and return the access token.
 */
export async function loginByApi(request: APIRequestContext): Promise<string> {
  const loginRes = await request.post(`${API_BASE}/api/admin/login`, {
    headers: loginHeaders(),
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.status(), await loginRes.text()).toBe(200);
  const data = (await loginRes.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Get the default agent for the authenticated user.
 */
export async function getDefaultAgent(
  request: APIRequestContext,
  token: string
): Promise<{ id: string; [key: string]: unknown }> {
  const agentRes = await request.get(`${API_BASE}/api/v1/agent:default`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(agentRes.status(), await agentRes.text()).toBe(200);
  const agent = (await agentRes.json()) as { id?: string; [key: string]: unknown };
  expect(agent.id).toBeTruthy();
  return agent as { id: string; [key: string]: unknown };
}

/**
 * Resolve full E2E agent context (login + get default agent).
 */
export async function resolveAgentContext(request: APIRequestContext): Promise<E2EAgentContext> {
  const token = await loginByApi(request);
  const agent = await getDefaultAgent(request, token);
  return { agentId: agent.id, adminEmail: ADMIN_EMAIL, apiBaseUrl: API_BASE, baseUrl: BASE_URL };
}

/**
 * Login via UI (admin dashboard) with proper headers.
 * Hardened to eliminate race conditions by awaiting response and token persistence.
 */
export async function adminLogin(
  page: Page,
  options?: { timeout?: number },
): Promise<void> {
  const timeout = options?.timeout ?? 15_000;

  // Intercept login API calls to add required headers
  await page.route('**/api/admin/login', async (route) => {
    await route.continue({ headers: { ...route.request().headers(), ...loginHeaders() } });
  });

  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');

  // Wait for form to be ready
  const emailInput = page.getByLabel(/email|邮箱/i).or(page.locator('input[type="email"]')).first();
  const passwordInput = page.getByLabel(/password|密码/i).or(page.locator('input[type="password"]')).first();
  const submitButton = page.getByRole('button', { name: /login|登录|submit|提交/i });

  await expect(emailInput).toBeVisible({ timeout });
  await expect(passwordInput).toBeVisible({ timeout });
  await expect(submitButton).toBeVisible({ timeout });

  // Fill the form - this will trigger React state updates
  // Note: The button may be disabled initially due to hydration state (disabled={loading || !hydrated})
  // Playwright's click() will auto-wait for the button to be actionable
  await emailInput.fill(ADMIN_EMAIL);
  await passwordInput.fill(ADMIN_PASSWORD);

  // STEP 1: Wait for login API response
  const loginResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/admin/login') && response.request().method() === 'POST',
    { timeout }
  );

  await submitButton.click();

  const loginResponse = await loginResponsePromise;
  const responseStatus = loginResponse.status();
  const responseText = await loginResponse.text();

  // Assert response is 200 before proceeding
  if (responseStatus !== 200) {
    // Collect visible error text for diagnostics
    const errorText = await page.locator('text=/登录失败|invalid|incorrect|failed|error/i').first().textContent().catch(() => 'No visible error');
    throw new Error(
      `Admin login API failed with status ${responseStatus}. ` +
      `Response: ${responseText.substring(0, 500)}. ` +
      `Visible error: ${errorText}`
    );
  }

  // STEP 2: Wait for localStorage token to be set (proves auth state is durable)
  await page.waitForFunction(
    () => {
      const token = localStorage.getItem('token');
      const admin = localStorage.getItem('admin');
      return Boolean(token && admin);
    },
    { timeout }
  );

  // Verify token and admin are truthy
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const admin = await page.evaluate(() => localStorage.getItem('admin'));

  if (!token || !admin) {
    throw new Error(
      `Auth state incomplete after login. token: ${token ? 'present' : 'missing'}, ` +
      `admin: ${admin ? 'present' : 'missing'}`
    );
  }

  // STEP 3: Wait for navigation away from /login
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout });

  // Final assertions to confirm login success
  await expect(page).not.toHaveURL(/\/login/, { timeout });
}
