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
 * Establish an authenticated admin browser session for non-auth E2E specs.
 *
 * Dedicated UI-login behavior remains covered by admin-auth.spec.ts. This helper
 * uses the backend login API directly to avoid Next dev proxy and hydration races
 * that can leave unrelated feature specs stuck on the login form.
 */
export async function adminLogin(
  page: Page,
  _options?: { timeout?: number },
): Promise<void> {
  const loginRes = await page.request.post(`${API_BASE}/api/admin/login`, {
    headers: loginHeaders(),
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const responseText = await loginRes.text();
  expect(loginRes.status(), responseText).toBe(200);

  const loginData = JSON.parse(responseText) as {
    access_token?: string;
    admin?: unknown;
  };
  if (!loginData.access_token || !loginData.admin) {
    throw new Error(
      `Admin login API response missing auth state. Response: ${responseText.substring(0, 500)}`,
    );
  }

  await page.addInitScript(
    ({ token, admin }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('admin', JSON.stringify(admin));
    },
    { token: loginData.access_token, admin: loginData.admin },
  );

  if (page.url().startsWith(BASE_URL)) {
    await page.evaluate(
      ({ token, admin }) => {
        localStorage.setItem('token', token);
        localStorage.setItem('admin', JSON.stringify(admin));
      },
      { token: loginData.access_token, admin: loginData.admin },
    );
  }
}
