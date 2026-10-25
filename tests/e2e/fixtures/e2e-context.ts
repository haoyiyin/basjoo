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
 * Ensure the agent has an active KB bound, creating one via the KB API when needed.
 *
 * KB lifecycle is decoupled from the agent: (`POST /api/v1/knowledge-bases` then
 * `PUT /api/v1/agents/{id}/knowledge-base`). Embedding credentials live on the KB,
 * so there is no longer a per-agent `kb-setup` bootstrap.
 *
 * Returns the bound KB id.
 */
export async function ensureBoundKb(
  request: APIRequestContext,
  agentId: string,
): Promise<string> {
  const token = await loginByApi(request);
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const agentRes = await request.get(`${API_BASE}/api/v1/agent?agent_id=${agentId}`, { headers });
  expect(agentRes.status(), await agentRes.text()).toBe(200);
  const agent = (await agentRes.json()) as { kb_id?: string | null };
  if (agent.kb_id) {
    return agent.kb_id;
  }

  const apiKey =
    process.env.E2E_EMBEDDING_API_KEY ||
    process.env.E2E_JINA_API_KEY ||
    'test_jina_key_for_e2e';

  const createRes = await request.post(`${API_BASE}/api/v1/knowledge-bases`, {
    headers,
    data: {
      name: `E2E KB ${agentId.slice(0, 8)} ${Date.now()}`,
      embedding_provider: 'jina',
      embedding_model: 'jina-embeddings-v3',
      embedding_base_url: 'https://api.jina.ai/v1',
      embedding_api_key: apiKey,
      embedding_batch_size: 4,
      chunk_size: 512,
      chunk_overlap: 64,
    },
  });
  expect(
    [200, 201, 400].includes(createRes.status()),
    await createRes.text(),
  ).toBe(true);

  // An unreachable provider leaves creation refused; existing KBs are still usable.
  if (![200, 201].includes(createRes.status())) {
    const listRes = await request.get(`${API_BASE}/api/v1/knowledge-bases`, { headers });
    expect(listRes.status(), await listRes.text()).toBe(200);
    const listed = (await listRes.json()) as { knowledge_bases?: Array<{ id: string }> };
    const fallback = listed.knowledge_bases?.[0]?.id;
    expect(fallback, 'No KB available to bind for E2E').toBeTruthy();
    const bindRes = await request.put(
      `${API_BASE}/api/v1/agents/${agentId}/knowledge-base`,
      { headers, data: { kb_id: fallback } },
    );
    expect(bindRes.status(), await bindRes.text()).toBe(200);
    return fallback as string;
  }

  const created = (await createRes.json()) as { id: string };
  const bindRes = await request.put(
    `${API_BASE}/api/v1/agents/${agentId}/knowledge-base`,
    { headers, data: { kb_id: created.id } },
  );
  expect(bindRes.status(), await bindRes.text()).toBe(200);
  return created.id;
}

/**
 * Reset the agent's bound KB through the KB-level endpoint.
 */
export async function resetBoundKb(
  request: APIRequestContext,
  agentId: string,
): Promise<void> {
  const token = await loginByApi(request);
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const agentRes = await request.get(`${API_BASE}/api/v1/agent?agent_id=${agentId}`, { headers });
  expect(agentRes.status(), await agentRes.text()).toBe(200);
  const kbId = ((await agentRes.json()) as { kb_id?: string | null }).kb_id;
  if (!kbId) return;

  const apiKey =
    process.env.E2E_EMBEDDING_API_KEY ||
    process.env.E2E_JINA_API_KEY ||
    'test_jina_key_for_e2e';
  const resetRes = await request.post(
    `${API_BASE}/api/v1/knowledge-bases/${kbId}/reset`,
    {
      headers,
      data: {
        embedding_provider: 'jina',
        embedding_model: 'jina-embeddings-v3',
        embedding_base_url: 'https://api.jina.ai/v1',
        embedding_api_key: apiKey,
      },
    },
  );
  expect([200, 400, 409]).toContain(resetRes.status());
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
