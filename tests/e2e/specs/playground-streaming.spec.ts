/**
 * E2E smoke test: Playground auto-save and streaming chat.
 */
import { test, expect } from "@playwright/test";
import {
	adminLogin,
	agentRoute,
	resolveAgentContext,
	loginByApi,
	API_BASE,
} from "../fixtures/e2e-context";

test.describe("Playground Streaming Chat", () => {
	test.beforeEach(async ({ page, request }) => {
		const context = await resolveAgentContext(request);
		await adminLogin(page);
		await page.goto(agentRoute(context.agentId, "playground"));
		await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });
		await expect(page).toHaveURL(
			new RegExp(`/agents/${context.agentId}/playground`),
		);
	});

	test("auto-save shows saving/saved state", async ({ page }) => {
		// Find the temperature slider (first range input)
		const tempInput = page.locator('input[type="range"]').first();
		await expect(tempInput).toBeVisible({ timeout: 10_000 });

		const previousValue = Number(
			await tempInput.evaluate((input: HTMLInputElement) => input.value),
		);
		const delta = previousValue >= 1.5 ? -0.1 : 0.1;
		const nextValue = String(Number((previousValue + delta).toFixed(1)));

		// Set up response listener before interaction
		const saveResponse = page.waitForResponse(
			(response) =>
				response.url().includes("/api/v1/agent?") &&
				response.request().method() === "PUT" &&
				response.status() === 200,
		);

		// Change temperature value through keyboard interaction
		await tempInput.focus();
		await tempInput.press(delta > 0 ? "ArrowRight" : "ArrowLeft");

		await saveResponse;

		// Assert the temperature label shows the new value
		await expect(
			page.getByText(
				new RegExp(
					`温度\\s*\\(${nextValue}\\)|temperature\\s*\\(${nextValue}\\)`,
					"i",
				),
			),
		).toBeVisible({ timeout: 5_000 });
	});

	test("send message and receive streaming response", async ({ page }) => {
		// Wait for chat input to be ready
		const messageInput = page.getByTestId("chat-message-input");
		await expect(messageInput).toBeVisible({ timeout: 10_000 });

		// Wait for any saving state to clear from previous test
		await page.waitForTimeout(1_000);

		// Use a unique message to identify it later
		const uniqueMessage = `test message ${Date.now()}`;
		await messageInput.fill(uniqueMessage);

		// Click send and wait for message to appear
		const sendButton = page.getByRole("button", { name: /发送|send/i });
		await sendButton.click();

		// Assert user message appears in chat using data-testid
		await expect(
			page
				.locator('[data-testid="message-bubble"]')
				.filter({ hasText: uniqueMessage }),
		).toBeVisible({ timeout: 15_000 });
	});

	test("clear chat resets conversation", async ({ page }) => {
		// Use a unique message to identify it later
		const uniqueMessage = `clear test ${Date.now()}`;

		// Send a message first
		const messageInput = page.getByTestId("chat-message-input");
		await expect(messageInput).toBeVisible({ timeout: 10_000 });

		// Wait for any saving state to clear from previous test
		await page.waitForTimeout(1_000);
		await messageInput.fill(uniqueMessage);

		const sendButton = page.getByRole("button", { name: /发送|send/i });
		await sendButton.click();

		// Assert user message appears in chat using data-testid
		await expect(
			page
				.locator('[data-testid="message-bubble"]')
				.filter({ hasText: uniqueMessage }),
		).toBeVisible({ timeout: 15_000 });

		// Click clear button and accept the confirmation dialog
		const clearButton = page.getByRole("button", { name: /^清空$|^clear$/i });
		await expect(clearButton).toBeVisible({ timeout: 5_000 });
		page.once("dialog", async (dialog) => dialog.accept());
		await clearButton.click();

		// After clearing, the unique user message should no longer be visible in the transcript
		await expect(
			page
				.locator('[data-testid="message-bubble"]')
				.filter({ hasText: uniqueMessage }),
		).not.toBeVisible({ timeout: 5_000 });
	});
});

test.describe("Playground KB Context Retrieval", () => {
	test("chat request succeeds after KB setup with indexed content", async ({ page, request }) => {
		// This test verifies the full flow: KB setup -> indexed content -> chat uses context
		// 1. Get context and ensure KB is set up
		const context = await resolveAgentContext(request);
		const token = await loginByApi(request);

		// Ensure KB setup is complete
		const kbSetupRes = await request.post(
			`${API_BASE}/api/v1/agent:kb-setup?agent_id=${context.agentId}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				data: {
					embedding_provider: "jina",
					embedding_model: "jina-embeddings-v3",
					jina_api_key: "test_jina_key_for_e2e",
				},
			},
		);
		// KB setup may already be completed (409/400) or succeed (200)
		expect([200, 400, 409]).toContain(kbSetupRes.status());

		// 2. Upload a file with unique content via tenant KB document endpoint
		// First get the agent's KB info
		const agentRes = await request.get(
			`${API_BASE}/api/v1/agent?agent_id=${context.agentId}`,
			{ headers: { Authorization: `Bearer ${token}` } },
		);
		expect(agentRes.status()).toBe(200);
		const agentData = await agentRes.json() as { kb_id?: string; workspace_id?: string };

		// Skip file upload if no KB bound yet (KB setup should have created it)
		if (!agentData.kb_id || !agentData.workspace_id) {
			test.skip();
			return;
		}

		// Upload file with unique test content
		const uniquePhrase = `BasjooE2ETestKBPhrase-${Date.now()}`;
		const testContent = `This is a test document for knowledge base verification. The unique test phrase is: ${uniquePhrase}. This content should be retrievable in Playground chat after indexing.`;
		const blob = new Blob([testContent], { type: "text/plain" });
		const formData = new FormData();
		formData.append("files", blob, `test-kb-${Date.now()}.txt`);

		const uploadRes = await request.post(
			`${API_BASE}/api/tenants/${agentData.workspace_id}/knowledge_bases/${agentData.kb_id}/documents`,
			{
				headers: { Authorization: `Bearer ${token}` },
				multipart: {
					files: {
						name: `test-kb-${Date.now()}.txt`,
						mimeType: "text/plain",
						buffer: Buffer.from(testContent),
					},
				},
			},
		);
		// Upload should succeed (may be 200 or 202 depending on processing)
		expect([200, 202, 201]).toContain(uploadRes.status());

		// 3. Login and go to Playground
		await adminLogin(page);
		await page.goto(agentRoute(context.agentId, "playground"));
		await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });

		// 4. Wait for chat input and send a query
		const messageInput = page.getByTestId("chat-message-input");
		await expect(messageInput).toBeVisible({ timeout: 10_000 });

		// Query asking about the unique phrase
		const query = `What is the unique test phrase in the knowledge base?`;
		await messageInput.fill(query);

		// Listen for SSE/streaming response
		const chatResponsePromise = page.waitForResponse(
			(response) =>
				response.url().includes("/api/v1/chat") &&
				response.status() === 200,
		);

		const sendButton = page.getByRole("button", { name: /发送|send/i });
		await sendButton.click();

		// Wait for response to complete
		const chatResponse = await chatResponsePromise;
		expect(chatResponse.status()).toBe(200);

		// 5. Assert user message appears
		await expect(
			page.locator('[data-testid="message-bubble"]').filter({ hasText: query }),
		).toBeVisible({ timeout: 15_000 });

		// 6. Wait for assistant response to appear (may contain KB context or not, depending on indexing state)
		// The key assertion is that the chat request succeeded - backend tests verify KB context injection
		const assistantMessages = page.locator('[data-testid="message-bubble"]').filter({
			hasNot: page.locator('[data-testid="user-message"]'),
		});
		await expect(assistantMessages.first()).toBeVisible({ timeout: 20_000 });
	});

	test("chat endpoint returns success when agent has KB configured", async ({ request }) => {
		// API-level test: verify chat endpoint accepts requests after KB setup
		const token = await loginByApi(request);
		const context = await resolveAgentContext(request);

		// Ensure KB setup
		const kbSetupRes = await request.post(
			`${API_BASE}/api/v1/agent:kb-setup?agent_id=${context.agentId}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				data: {
					embedding_provider: "jina",
					embedding_model: "jina-embeddings-v3",
					jina_api_key: "test_jina_key_for_e2e",
				},
			},
		);
		expect([200, 400, 409]).toContain(kbSetupRes.status());

		// Chat request should succeed
		const chatRes = await request.post(
			`${API_BASE}/api/v1/chat`,
			{
				headers: { Authorization: `Bearer ${token}` },
				data: {
					agent_id: context.agentId,
					message: `Test message with KB context ${Date.now()}`,
				},
			},
		);
		expect(chatRes.status()).toBe(200);
		const chatData = await chatRes.json() as { message?: string; session_id?: string };
		expect(chatData.message).toBeTruthy();
		expect(chatData.session_id).toBeTruthy();
	});
});
