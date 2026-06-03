/**
 * E2E test: Widget cross-origin embed and allowed/blocked origin behavior.
 *
 * Tests widget loading from a third-party host page with the SDK script.
 *
 * @widget
 */
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "test@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "testpassword123";
const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

/**
 * Generate headers with random IP for rate limit bypass.
 */
function loginHeaders(): Record<string, string> {
	return {
		"X-Forwarded-For": `203.0.113.${Math.floor(Math.random() * 200) + 20}`,
	};
}

async function getAdminToken(request: any): Promise<string> {
	const loginRes = await request.post(`${API_BASE}/api/admin/login`, {
		headers: loginHeaders(),
		data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
	});
	const data = await loginRes.json();
	return data.access_token;
}

test.describe("Widget Cross-Origin", () => {
	test("widget loads and chats from allowed host", async ({
		page,
		request,
	}) => {
		test.skip(!process.env.HOST_ALLOWED_URL, "HOST_ALLOWED_URL not set");

		// Ensure allowed_widget_origins is set
		const token = await getAdminToken(request);
		const agentRes = await request.get(`${API_BASE}/api/v1/agent:default`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		const agent = await agentRes.json();

		// Set the allowed host as widget origin
		const allowedHost = process.env.HOST_ALLOWED_URL!.replace(/\/$/, "");
		await request.put(`${API_BASE}/api/v1/agent?agent_id=${agent.id}`, {
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			data: { allowed_widget_origins: [allowedHost] },
		});

		// Navigate to allowed host page with agent ID
		await page.goto(`${process.env.HOST_ALLOWED_URL!}?agentId=${agent.id}`);

		// Wait for widget button to appear
		await expect(page.locator("#basjoo-widget-button")).toBeVisible({
			timeout: 10_000,
		});

		// Open chat
		await page.click("#basjoo-widget-button");
		await expect(page.locator("#basjoo-chat-window")).toBeVisible({
			timeout: 5_000,
		});

		// Welcome message should be visible (check for messages container class)
		await expect(page.locator(".basjoo-messages")).toBeVisible({
			timeout: 5_000,
		});
	});

	test("widget is blocked on disallowed host", async ({ page, request }) => {
		test.skip(!process.env.HOST_BLOCKED_URL, "HOST_BLOCKED_URL not set");

		// Set allowed_widget_origins to NOT include the blocked host
		const token = await getAdminToken(request);
		const agentRes = await request.get(`${API_BASE}/api/v1/agent:default`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		const agent = await agentRes.json();

		// Set origin to something different from the blocked host
		await request.put(`${API_BASE}/api/v1/agent?agent_id=${agent.id}`, {
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			data: { allowed_widget_origins: ["https://only-allowed.example.com"] },
		});

		// Verify the update succeeded
		const verifyRes = await request.get(
			`${API_BASE}/api/v1/agent?agent_id=${agent.id}`,
			{
				headers: { Authorization: `Bearer ${token}` },
			},
		);
		const verifyAgent = await verifyRes.json();
		console.log(
			"Agent allowed_widget_origins after update:",
			verifyAgent.allowed_widget_origins,
		);
		expect(verifyAgent.allowed_widget_origins).toContain(
			"https://only-allowed.example.com",
		);

		// Attach console listener before navigation to catch all errors
		const consoleMessages: string[] = [];
		page.on("console", (msg) => {
			if (msg.type() === "error" || msg.type() === "warning") {
				consoleMessages.push(msg.text());
			}
		});

		// Navigate to blocked host page with agent ID (widget needs agentId to initialize)
		await page.goto(`${process.env.HOST_BLOCKED_URL!}?agentId=${agent.id}`);

		// Wait for widget button to be visible (more robust than arbitrary timeout)
		const widgetButton = page.locator("#basjoo-widget-button");
		await expect(widgetButton).toBeVisible({ timeout: 10_000 });

		// Click to open chat window
		await widgetButton.click();

		// Wait for chat window to be visible
		const chatWindow = page.locator("#basjoo-chat-window");
		await expect(chatWindow).toBeVisible({ timeout: 5_000 });

		// Wait for input to be visible and ready
		const input = page.locator(".basjoo-input");
		await expect(input).toBeVisible({ timeout: 5_000 });

		// Fill and send message
		await input.fill("test message from blocked host");
		const sendButton = page.locator(".basjoo-send");
		await expect(sendButton).toBeVisible({ timeout: 5_000 });
		await sendButton.click();

		// Wait for the error to be processed (widget needs time to receive SSE error and log it)
		await page.waitForTimeout(3_000);

		// Log all captured console messages for debugging
		console.log("All console messages captured:", consoleMessages);

		// Blocked origin should produce console error
		// Widget logs: '[Basjoo Widget] Widget request was blocked because the current page origin is not on the allowed domain list.'
		const hasOriginError = consoleMessages.some(
			(msg) =>
				msg.includes("ORIGIN_NOT_ALLOWED") ||
				msg.includes("origin not allowed") ||
				msg.includes("not on the allowed domain list") ||
				msg.includes("blocked because the current page origin"),
		);
		expect(hasOriginError).toBe(true);
	});
});
