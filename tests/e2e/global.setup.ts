/**
 * Global setup for Playwright E2E tests.
 * Creates admin user, ensures default agent exists, and seeds test data.
 * Runs once before all test projects.
 */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'test@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpassword123';
const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000';

async function api(path: string, opts: RequestInit & { data?: unknown } = {}): Promise<{ status: number; json: () => unknown }> {
  const { data, ...fetchOpts } = opts;
  const body = data ? JSON.stringify(data) : undefined;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...fetchOpts.headers } as HeadersInit,
    body,
    ...fetchOpts,
  });
  return {
    status: res.status,
    json: () => res.json(),
  };
}

export default async function globalSetup(): Promise<void> {
  // 1. Register admin (400 = already exists, which is fine)
  const registerRes = await api('/api/admin/register', {
    method: 'POST',
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: 'Test Admin' },
  });
  if (![200, 201, 400].includes(registerRes.status)) {
    throw new Error(`Admin registration failed: ${registerRes.status}`);
  }

  // 2. Login
  const loginRes = await api('/api/admin/login', {
    method: 'POST',
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (loginRes.status !== 200) {
    throw new Error(`Admin login failed: ${loginRes.status}`);
  }
  const loginData = await loginRes.json() as { access_token: string };
  const token = loginData.access_token;
  const authHeaders = { Authorization: `Bearer ${token}` };

  // 3. Get agent and set Jina key
  const agentRes = await api('/api/v1/agent:default', { headers: authHeaders });
  if (agentRes.status !== 200) {
    throw new Error(`Failed to get default agent: ${agentRes.status}`);
  }
  const agent = await agentRes.json() as { id: string; jina_api_key?: string | null };

  if (!agent.jina_api_key) {
    const setKeyRes = await api(`/api/v1/agent?agent_id=${agent.id}`, {
      method: 'PUT',
      headers: { ...authHeaders } as HeadersInit,
      data: { jina_api_key: 'test_jina_key_for_e2e' },
    });
    if (![200, 201].includes(setKeyRes.status)) {
      throw new Error(`Failed to set Jina API key: ${setKeyRes.status}`);
    }
  }

  // 4. Seed a sample QA item
  const qaContent = JSON.stringify([
    {
      question: 'What is Basjoo?',
      answer: 'Basjoo is an AI-powered customer service assistant that helps businesses provide instant support to their visitors.',
    },
  ]);
  const qaRes = await api(`/api/v1/qa:batch_import?agent_id=${agent.id}`, {
    method: 'POST',
    headers: { ...authHeaders } as HeadersInit,
    data: { format: 'json', content: qaContent, overwrite: false },
  });
  if (![200, 201].includes(qaRes.status)) {
    throw new Error(`Failed to seed QA item: ${qaRes.status}`);
  }

  // 5. Add sample URL (skip if no crawl target available)
  const crawlTarget = process.env.CRAWL_TARGET_URL || '';
  if (crawlTarget) {
    const urlRes = await api(`/api/v1/urls:create?agent_id=${agent.id}`, {
      method: 'POST',
      headers: { ...authHeaders } as HeadersInit,
      data: { urls: [crawlTarget] },
    });
    if (![200, 201].includes(urlRes.status)) {
      console.warn(`Warning: Failed to seed URL (status ${urlRes.status}), continuing anyway`);
    }
  }
}
