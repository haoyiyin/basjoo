/**
 * E2E tests for URL bug fixes:
 * 1. Bug Fix: URL Status Display Mismatch - crawlPolling sync with taskStatus.is_crawling
 * 2. Bug Fix: Clear All "Method Not Allowed" - DELETE changed to POST with message/deleted_count
 *
 * @smoke
 */
import { test, expect } from "@playwright/test";
import {
	agentRoute,
	API_BASE,
	resolveAgentContext,
	loginByApi,
	adminLogin,
} from "../fixtures/e2e-context";

const TEST_URL = "https://example.com/test-page";

test.describe("URL Bug Fixes", () => {
	test("Bug 1: URL status banner clears after crawl completes", async ({
		page,
		request,
	}) => {
		// 1. Resolve agent context and login
		const context = await resolveAgentContext(request);

		// 2. Complete KB setup via API (required for URL management)
		const jinaApiKey = process.env.E2E_JINA_API_KEY || "test_jina_key_for_e2e";
		const kbSetupRes = await request.post(
			`${API_BASE}/api/v1/agent:kb-setup?agent_id=${context.agentId}`,
			{
				headers: {
					Authorization: `Bearer ${await loginByApi(request)}`,
					"Content-Type": "application/json",
				},
				data: {
					embedding_provider: "jina",
					embedding_model: "jina-embeddings-v3",
					jina_api_key: jinaApiKey,
				},
			},
		);
		expect([200, 400, 409]).toContain(kbSetupRes.status());

		// 3. Login via UI
		await adminLogin(page);

		// 4. Navigate to agent URLs page
		const urlsRoute = agentRoute(context.agentId, "urls");
		await page.goto(urlsRoute);
		await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });

		// 5. Assert URL is correct
		await expect(page).toHaveURL(new RegExp(`/agents/${context.agentId}/urls`));

		// 6. Find and fill the URL input (first input on the page)
		const urlInput = page.locator('input[type="text"]').first();
		await expect(urlInput).toBeVisible({ timeout: 10_000 });
		await urlInput.fill(TEST_URL);

		// 7. Click "Add URL" button (single page crawl)
		const addButton = page
			.getByRole("button", { name: /single page|单页抓取/i })
			.or(page.locator("button").filter({ hasText: /add|添加/i }));
		await addButton.click();

		// 8. Wait for the URL to be added (alert or URL appears in list)
		// Wait for the success alert or the URL to appear
		await page.waitForTimeout(1000);

		// 9. Check if crawling banner appears initially (it may or may not depending on speed)
		// The banner shows when crawlPolling or taskStatus?.is_crawling is true
		const crawlingBanner = page
			.locator("div")
			.filter({ hasText: /正在抓取中|Crawling in progress/i });

		// Wait for up to 30 seconds for crawling to complete
		// The banner should disappear or never appear if crawling completes quickly
		await expect(async () => {
			const isBannerVisible = await crawlingBanner
				.isVisible()
				.catch(() => false);
			// After 30 seconds, the banner should NOT be visible
			expect(isBannerVisible).toBe(false);
		}).toPass({ timeout: 35_000 });

		// 10. Verify the URL list shows the added URL
		const urlList = page.locator("div").filter({ hasText: TEST_URL });
		await expect(urlList.first()).toBeVisible({ timeout: 10_000 });
	});

	test("Bug 2: Clear All uses POST method and returns deleted_count", async ({
		page,
		request,
	}) => {
		// 1. Resolve agent context and login
		const context = await resolveAgentContext(request);

		// 2. Complete KB setup via API
		const jinaApiKey =
			process.env.E2E_JINA_API_KEY || "test_jina_api_key_for_e2e";
		const kbSetupRes = await request.post(
			`${API_BASE}/api/v1/agent:kb-setup?agent_id=${context.agentId}`,
			{
				headers: {
					Authorization: `Bearer ${await loginByApi(request)}`,
					"Content-Type": "application/json",
				},
				data: {
					embedding_provider: "jina",
					embedding_model: "jina-embeddings-v3",
					jina_api_key: jinaApiKey,
				},
			},
		);
		expect([200, 400, 409]).toContain(kbSetupRes.status());

		// 3. Add a test URL via API first to ensure we have something to clear
		const token = await loginByApi(request);
		const addUrlRes = await request.post(
			`${API_BASE}/api/v1/urls:create?agent_id=${context.agentId}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				data: { urls: [TEST_URL] },
			},
		);
		expect(addUrlRes.status()).toBe(200);

		// 4. Login via UI
		await adminLogin(page);

		// 5. Navigate to agent URLs page
		const urlsRoute = agentRoute(context.agentId, "urls");
		await page.goto(urlsRoute);
		await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });

		// 6. Verify the URL appears in the list
		await page.waitForTimeout(2000);
		const urlListItem = page.locator("div").filter({ hasText: TEST_URL });
		await expect(urlListItem.first()).toBeVisible({ timeout: 10_000 });

		// 7. Find and click "Clear All" button (text is "清空列表" in zh-CN)
		const clearAllButton = page
			.getByRole("button", { name: /清空列表|Clear List/i })
			.or(page.locator("button").filter({ hasText: /清空列表|Clear List/i }));
		await expect(clearAllButton).toBeVisible({ timeout: 10_000 });
		await clearAllButton.click();

		// 8. Wait for confirmation dialog and confirm
		const confirmButton = page
			.getByRole("button", { name: /确认|Confirm/i })
			.or(page.locator("button").filter({ hasText: /确认|Confirm/i }))
			.last();
		await expect(confirmButton).toBeVisible({ timeout: 5_000 });
		await confirmButton.click();

		// 9. Wait for success alert (alert dialog) and dismiss it
		// The alert should show "Successfully cleared X URLs" with the deleted_count
		const alertMessage = await page.waitForEvent("dialog", { timeout: 10_000 });
		expect(alertMessage.message()).toMatch(/Successfully cleared|已成功清空/);
		await alertMessage.accept();

		// 10. Verify URL list is now empty (no URLs message shown)
		// Wait for list to refresh
		await page.waitForTimeout(2000);

		// Look for empty state message (text is "暂无 URL" with space)
		const emptyState = page
			.locator("div")
			.filter({ hasText: /暂无 URL|No URLs|please add|请添加/i });
		await expect(emptyState.first()).toBeVisible({ timeout: 10_000 });

		// 11. Also test the API directly to ensure POST method works
		// Add another URL via API
		const addUrlRes2 = await request.post(
			`${API_BASE}/api/v1/urls:create?agent_id=${context.agentId}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				data: { urls: [TEST_URL] },
			},
		);
		expect(addUrlRes2.status()).toBe(200);

		// Call clear_all API directly with POST
		const clearRes = await request.post(
			`${API_BASE}/api/v1/urls:clear_all?agent_id=${context.agentId}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
				},
			},
		);
		expect(clearRes.status()).toBe(200);

		// Verify response has message and deleted_count
		const clearData = (await clearRes.json()) as {
			message: string;
			deleted_count: number;
		};
		expect(clearData.message).toBeTruthy();
		expect(typeof clearData.deleted_count).toBe("number");
		expect(clearData.deleted_count).toBeGreaterThanOrEqual(1);
	});
});
