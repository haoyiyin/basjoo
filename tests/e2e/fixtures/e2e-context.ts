/**
 * Shared E2E agent context: constants, API helpers, admin login, and route builders.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "test@example.com";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "testpassword123";
export const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";
export const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

export interface E2EAgentContext {
	agentId: string;
	adminEmail: string;
	apiBaseUrl: string;
	baseUrl: string;
}

export function loginHeaders(): Record<string, string> {
	return {
		"X-Forwarded-For": `203.0.113.${Math.floor(Math.random() * 200) + 20}`,
	};
}

export function agentRoute(
	agentId: string,
	page:
		| "dashboard"
		| "playground"
		| "sessions"
		| "files"
		| "urls"
		| "settings/agent",
): string {
	return `/agents/${agentId}/${page}`;
}

export async function loginByApi(request: APIRequestContext): Promise<string> {
	const loginRes = await request.post(`${API_BASE}/api/admin/login`, {
		headers: loginHeaders(),
		data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
	});
	expect(
		loginRes.status(),
		`Admin login failed: ${await loginRes.text()}`,
	).toBe(200);
	const data = (await loginRes.json()) as { access_token: string };
	return data.access_token;
}

export async function getDefaultAgent(
	request: APIRequestContext,
	token: string,
): Promise<{ id: string; [key: string]: unknown }> {
	const agentRes = await request.get(`${API_BASE}/api/v1/agent:default`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(
		agentRes.status(),
		`Agent lookup failed: ${await agentRes.text()}`,
	).toBe(200);
	const agent = (await agentRes.json()) as {
		id?: string;
		[key: string]: unknown;
	};
	expect(agent.id).toBeTruthy();
	return agent as { id: string; [key: string]: unknown };
}

export async function resolveAgentContext(
	request: APIRequestContext,
): Promise<E2EAgentContext> {
	const token = await loginByApi(request);
	const agent = await getDefaultAgent(request, token);
	return {
		agentId: agent.id,
		adminEmail: ADMIN_EMAIL,
		apiBaseUrl: API_BASE,
		baseUrl: BASE_URL,
	};
}

export async function adminLogin(page: Page): Promise<void> {
	await page.route("**/api/admin/login", async (route) => {
		await route.continue({
			headers: { ...route.request().headers(), ...loginHeaders() },
		});
	});
	await page.goto("/login");
	await page.getByLabel(/email|邮箱/i).fill(ADMIN_EMAIL);
	await page.getByLabel(/password|密码/i).fill(ADMIN_PASSWORD);
	await page.getByRole("button", { name: /login|登录|submit|提交/i }).click();
	await page.waitForLoadState("networkidle");
	await expect(page).not.toHaveURL(/\/login/);
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem("token")))
		.toBeTruthy();
}
