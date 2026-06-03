/**
 * Global setup for Playwright E2E tests.
 * Creates admin user, ensures default agent exists, and configures test environment.
 * Runs once before all test projects.
 */

import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API_BASE,
  loginHeaders,
} from './fixtures/e2e-context';

const E2E_JINA_API_KEY = process.env.E2E_JINA_API_KEY || 'test_jina_key_for_e2e';
const E2E_API_KEY = process.env.E2E_API_KEY || ''; // LLM API key (e.g., DeepSeek)

export default async function globalSetup(): Promise<void> {
  // Use consistent IP for the setup run (required for rate limiting)
  const setupHeaders = loginHeaders();

  // Helper for API requests
  async function apiFetch(
    path: string,
    opts: { method?: string; data?: unknown; headers?: Record<string, string> } = {}
  ): Promise<{ status: number; json: () => Promise<unknown> }> {
    const { method = 'GET', data, headers = {} } = opts;
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...setupHeaders,
        ...headers,
      } as HeadersInit,
      body: data ? JSON.stringify(data) : undefined,
    });
    return {
      status: res.status,
      json: () => res.json(),
    };
  }

  // 1. Attempt admin registration
  // 200/201 = created, 400 = already exists by email, 403 = admin already configured
  const registerRes = await apiFetch('/api/admin/register', {
    method: 'POST',
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: 'Test Admin' },
  });

  if (![200, 201, 400, 403].includes(registerRes.status)) {
    throw new Error(`Admin registration failed with unexpected status: ${registerRes.status}`);
  }

  // 2. Login to get auth token
  const loginRes = await apiFetch('/api/admin/login', {
    method: 'POST',
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });

  if (loginRes.status !== 200) {
    throw new Error(
      `Admin login failed with E2E credentials after registration status ${registerRes.status}. ` +
      `Reset the test database or set ADMIN_EMAIL/ADMIN_PASSWORD for the existing admin.`
    );
  }

  const loginData = (await loginRes.json()) as { access_token: string };
  const token = loginData.access_token;
  const authHeaders = { Authorization: `Bearer ${token}` };

  // 3. Get default agent and validate
  const agentRes = await apiFetch('/api/v1/agent:default', { headers: authHeaders });
  if (agentRes.status !== 200) {
    throw new Error(`Failed to get default agent: ${agentRes.status}`);
  }
  const agent = (await agentRes.json()) as { id: string; jina_api_key_set?: boolean | null };
  if (!agent.id) {
    throw new Error('Default agent has no id');
  }

  // 4. Set API keys if not already set
  // Use type assertion to check for api_key_set property
  const agentWithKeyStatus = agent as { id: string; jina_api_key_set?: boolean | null; api_key_set?: boolean | null };

  // Set main LLM API key if provided via environment and not already set
  if (E2E_API_KEY && !agentWithKeyStatus.api_key_set) {
    const setKeyRes = await apiFetch(`/api/v1/agent?agent_id=${agent.id}`, {
      method: 'PUT',
      headers: authHeaders,
      data: { api_key: E2E_API_KEY },
    });
    if (![200, 201].includes(setKeyRes.status)) {
      throw new Error(`Failed to set API key: ${setKeyRes.status}`);
    }
  }

  // Set Jina API key if not already set (for embedding tests)
  if (!agent.jina_api_key_set) {
    const setJinaRes = await apiFetch(`/api/v1/agent?agent_id=${agent.id}`, {
      method: 'PUT',
      headers: authHeaders,
      data: { jina_api_key: E2E_JINA_API_KEY },
    });
    if (![200, 201].includes(setJinaRes.status)) {
      throw new Error(`Failed to set Jina API key: ${setJinaRes.status}`);
    }
  }

  // 5. Add sample URL (skip if no crawl target available)
  const crawlTarget = process.env.CRAWL_TARGET_URL || '';
  if (crawlTarget) {
    const urlRes = await apiFetch(`/api/v1/urls:create?agent_id=${agent.id}`, {
      method: 'POST',
      headers: authHeaders,
      data: { urls: [crawlTarget] },
    });
    if (![200, 201].includes(urlRes.status)) {
      console.warn(`Warning: Failed to seed URL (status ${urlRes.status}), continuing anyway`);
    }
  }

  console.log(`E2E global setup complete: agentId=${agent.id}, adminEmail=${ADMIN_EMAIL}`);
}
