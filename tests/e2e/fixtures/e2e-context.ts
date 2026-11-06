/**
 * Shared E2E context helper providing single source of truth for:
 * - Credentials (ADMIN_EMAIL, ADMIN_PASSWORD)
 * - API/Base URLs
 * - Agent context resolution
 * - Admin login (API and UI)
 * - Agent-scoped route construction
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Detection for the one embedding-provider failure that is a *precondition*
 * miss — no reachable service — rather than a product regression.
 *
 * The KB-create probe raises `400` with the bounded provider message
 * (`backend/api/v1/kb_endpoints.py::_probe_provider`), so an unreachable
 * service surfaces as an httpx transport error string. Only such a message is
 * treated as "provider unreachable"; auth, validation, 5xx, dimension and
 * no-vectors errors must fail the calling test.
 */
const CONNECTIVITY_PATTERNS: RegExp[] = [
	/connection attempts failed/i,
	/connection refused/i,
	/connect error/i,
	/cannot connect to host/i,
	/name or service not known/i,
	/nodename nor servname/i,
	/temporary failure in name resolution/i,
	/connection reset/i,
	/connect timeout/i,
	/unreachable/i,
];

function isEmbeddingProviderConnectivityFailure(status: number, body: string): boolean {
	if (status !== 400) return false;
	let detail = body;
	try {
		const parsed = JSON.parse(body) as { detail?: unknown };
		if (typeof parsed.detail === 'string') detail = parsed.detail;
	} catch {
		// non-JSON body: match the raw text
	}
	return CONNECTIVITY_PATTERNS.some((re) => re.test(detail));
}

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
 * Login via API and return the access token plus the admin object the SPA
 * stores verbatim under localStorage('admin').
 */
export async function loginByApiWithAdmin(
  request: APIRequestContext,
): Promise<{ token: string; admin: unknown }> {
  const loginRes = await request.post(`${API_BASE}/api/admin/login`, {
    headers: loginHeaders(),
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.status(), await loginRes.text()).toBe(200);
  const data = (await loginRes.json()) as { access_token?: string; admin?: unknown };
  expect(data.access_token).toBeTruthy();
  expect(data.admin).toBeTruthy();
  return { token: data.access_token as string, admin: data.admin };
}

/**
 * Login via API and return the access token.
 */
export async function loginByApi(request: APIRequestContext): Promise<string> {
  return (await loginByApiWithAdmin(request)).token;
}

/**
 * Parse the SSE `done` event payload out of a fully-buffered stream body.
 * Returns null when the stream never emitted a `done` event (e.g. it errored).
 */
export function sseDoneEvent(sseBody: string): Record<string, unknown> | null {
  const block = sseBody
    .split(/\r?\n\r?\n/)
    .find((candidate) => /(^|\n)event:\s*done\b/.test(candidate));
  if (!block) return null;
  const dataLine = block.split(/\r?\n/).find((line) => line.startsWith('data:'));
  if (!dataLine) return null;
  return JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
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
 * The `local` embedding provider is the compose-network TEI service. The
 * backend resolves `local-embed` from inside `basjoo-network`; the host does
 * not. `E2E_LOCAL_EMBEDDING_BASE_URL` overrides the base URL only when the QA
 * stack exposes TEI somewhere else.
 */
const LOCAL_EMBEDDING_BASE_URL =
	process.env.E2E_LOCAL_EMBEDDING_BASE_URL || 'http://local-embed:80/v1';
const LOCAL_EMBEDDING_MODEL =
	process.env.E2E_LOCAL_EMBEDDING_MODEL ||
	'ibm-granite/granite-embedding-97m-multilingual-r2';

/** A `local`-provider KB needs no API key (the endpoint only enforces one for
 * jina / siliconflow / custom). */
function localEmbeddingKbPayload(name: string) {
	return {
		name,
		embedding_provider: 'local',
		embedding_model: LOCAL_EMBEDDING_MODEL,
		embedding_base_url: LOCAL_EMBEDDING_BASE_URL,
		embedding_api_key: '',
		embedding_batch_size: 4,
		chunk_size: 512,
		chunk_overlap: 64,
	};
}

/**
 * Ensure the agent has an active KB bound, creating one via the KB API when needed.
 *
 * KB lifecycle is decoupled from the agent: (`POST /api/v1/knowledge-bases` then
 * `PUT /api/v1/agents/{id}/knowledge-base`). The KB is created with the `local`
 * embedding provider, which probes one real embedding call before the row is
 * written. When that probe fails with a transport/connectivity error (the QA
 * stack ran without the compose `local-embed`/TEI container), no KB can exist —
 * the dependent test is skipped explicitly instead of falling back to a
 * fabricated KB or a fake key, and never treated as a product failure. Any other
 * failure (auth, validation, 5xx, dimension) fails the test.
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

	const createRes = await request.post(`${API_BASE}/api/v1/knowledge-bases`, {
		headers,
		data: localEmbeddingKbPayload(`E2E KB ${agentId.slice(0, 8)} ${Date.now()}`),
	});

	if (![200, 201].includes(createRes.status())) {
		const body = await createRes.text();
		// Skip ONLY the measured "no reachable local embedding service" signal:
		// a 400 whose bounded provider message is a transport/connectivity error.
		// Auth, validation, 5xx and dimension failures are product regressions and
		// must fail the test, not be masked as "provider unavailable".
		if (isEmbeddingProviderConnectivityFailure(createRes.status(), body)) {
			test.skip(
				true,
				`SKIP (precondition): local embedding provider unreachable ` +
					`(provider=local base=${LOCAL_EMBEDDING_BASE_URL}). ` +
					`POST /knowledge-bases -> ${createRes.status()}: ${body.slice(0, 300)}. ` +
					`Start the compose 'local-embed' (TEI) service, or set ` +
					`E2E_LOCAL_EMBEDDING_BASE_URL, then rerun.`,
			);
		}
		expect(
			[200, 201],
			`ensureBoundKb: KB creation failed (not a provider-connectivity ` +
				`precondition) with status ${createRes.status()}: ${body.slice(0, 300)}`,
		).toContain(createRes.status());
	}

	const created = (await createRes.json()) as { id: string };
	const bindRes = await request.put(
		`${API_BASE}/api/v1/agents/${agentId}/knowledge-base`,
		{ headers, data: { kb_id: created.id } },
	);
	expect(bindRes.status(), await bindRes.text()).toBe(200);

	// The agent-scoped `files:*` aliases answer 409 until the binding is visible
	// ("files endpoint is locked"). Wait for the read alias to resolve the KB so
	// the next upload cannot race a stale binding.
	await expect
		.poll(
			async () => {
				const listRes = await request.get(
					`${API_BASE}/api/v1/files:list?agent_id=${agentId}`,
					{ headers },
				);
				return listRes.status();
			},
			{ timeout: 10_000, intervals: [250, 500, 1_000] },
		)
		.toBe(200);

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

  // Same `local` provider as `ensureBoundKb`: no fabricated key, no hosted URL.
  const resetRes = await request.post(
    `${API_BASE}/api/v1/knowledge-bases/${kbId}/reset`,
    {
      headers,
      data: {
        embedding_provider: 'local',
        embedding_model: LOCAL_EMBEDDING_MODEL,
        embedding_base_url: LOCAL_EMBEDDING_BASE_URL,
        embedding_api_key: '',
      },
    },
  );
  expect([200, 400, 409, 423]).toContain(resetRes.status());
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
