/**
 * E2E test: API keys validation in playground.
 */
import { test, expect } from "@playwright/test";
import {
	adminLogin,
	agentRoute,
	resolveAgentContext,
} from "../fixtures/e2e-context";

test.describe("Playground API Keys Validation", () => {
	test.beforeEach(async ({ page, request }) => {
		const context = await resolveAgentContext(request);
		await adminLogin(page);
		await page.goto(agentRoute(context.agentId, "playground"));
		await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });
		await expect(page).toHaveURL(
			new RegExp(`/agents/${context.agentId}/playground`),
		);
		await expect(page.getByText(context.agentId)).toBeVisible({ timeout: 45_000 });
	});

	test("send message after settings save completes", async ({ page }) => {
		test.setTimeout(60_000);
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
			{ timeout: 45_000 },
		);

		// Change temperature value through keyboard interaction to trigger auto-save
		await tempInput.focus();
		await tempInput.press(delta > 0 ? "ArrowRight" : "ArrowLeft");

		// Wait for save to complete
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

		// Now we can safely interact with the chat
		const messageInput = page.getByRole("textbox", {
			name: /输入您的问题|your question/i,
		});
		await expect(messageInput).toBeVisible({ timeout: 10_000 });

		// Use a unique message to identify it later
		const uniqueMessage = `api key test message ${Date.now()}`;
		await messageInput.fill(uniqueMessage);

		// Wait for save state to clear before attempting to send
		// The send button is disabled while isSettingsSaving is true OR input is empty
		await page.waitForFunction(
			() => {
				const sendBtn = document.querySelector(
					'button[aria-label="发送"], button[aria-label="Send"]',
				);
				return sendBtn && !(sendBtn as HTMLButtonElement).disabled;
			},
			{ timeout: 10_000 },
		);

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
});
