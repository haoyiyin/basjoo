/**
 * E2E smoke test: current knowledge source APIs and file management UI.
 *
 * @smoke @prod
 */
import { test, expect } from "@playwright/test";
import {
	agentRoute,
	API_BASE,
	resolveAgentContext,
	loginByApi,
	getDefaultAgent,
	adminLogin,
	ensureBoundKb,
} from "../fixtures/e2e-context";

test.describe("Knowledge Source Flow", () => {
	test("API shape: files:list and sources:summary", async ({ request }) => {
		// 1. Login via API to get token
		const token = await loginByApi(request);

		// 2. Get default agent
		const agent = await getDefaultAgent(request, token);

		// 3. Test files:list API shape
		const filesListRes = await request.get(
			`${API_BASE}/api/v1/files:list?agent_id=${agent.id}&skip=0&limit=10`,
			{ headers: { Authorization: `Bearer ${token}` } },
		);
		expect(filesListRes.status()).toBe(200);
		const filesList = await filesListRes.json();
		expect(filesList).toHaveProperty("files");
		expect(filesList).toHaveProperty("total");
		expect(Array.isArray(filesList.files)).toBe(true);
		expect(typeof filesList.total).toBe("number");

		// 4. Test sources:summary API shape
		const sourcesSummaryRes = await request.get(
			`${API_BASE}/api/v1/sources:summary?agent_id=${agent.id}`,
			{ headers: { Authorization: `Bearer ${token}` } },
		);
		expect(sourcesSummaryRes.status()).toBe(200);
		const sourcesSummary = await sourcesSummaryRes.json();
		// urls shape
		expect(sourcesSummary).toHaveProperty("urls");
		expect(sourcesSummary.urls).toHaveProperty("total");
		expect(sourcesSummary.urls).toHaveProperty("indexed");
		expect(sourcesSummary.urls).toHaveProperty("pending");
		expect(typeof sourcesSummary.urls.total).toBe("number");
		expect(typeof sourcesSummary.urls.indexed).toBe("number");
		expect(typeof sourcesSummary.urls.pending).toBe("number");
		// files shape
		expect(sourcesSummary).toHaveProperty("files");
		expect(sourcesSummary.files).toHaveProperty("total");
		expect(sourcesSummary.files).toHaveProperty("ready");
		expect(sourcesSummary.files).toHaveProperty("processing");
		expect(typeof sourcesSummary.files.total).toBe("number");
		expect(typeof sourcesSummary.files.ready).toBe("number");
		expect(typeof sourcesSummary.files.processing).toBe("number");
		// has_pending flag
		expect(sourcesSummary).toHaveProperty("has_pending");
		expect(typeof sourcesSummary.has_pending).toBe("boolean");
	});

	test("File management UI loads and displays key sections", async ({
		page,
		request,
	}) => {
		// 1. Resolve agent context
		const context = await resolveAgentContext(request);

		// 2. Ensure a KB is created and bound (FileUploadManagement needs content)
		await ensureBoundKb(request, context.agentId);

		// 3. Login via UI using shared helper
		await adminLogin(page);

		// 4. Navigate to agent files page
		const filesRoute = agentRoute(context.agentId, "files");
		await page.goto(filesRoute);
		await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });

		// 5. Assert URL is correct
		await expect(page).toHaveURL(
			new RegExp(`/agents/${context.agentId}/files`),
		);

		// 6. Assert page heading (File Upload / 文件上传) - use more specific locator to avoid sidebar h1
		const headingLocator = page.locator("h1").filter({
			hasText: /File Upload|文件上传/i,
		});
		await expect(headingLocator).toBeVisible({ timeout: 10_000 });

		// 7. Assert upload section heading (Upload Files / 上传文件)
		const uploadSectionHeading = page.locator("h2").filter({
			hasText: /Upload Files|上传文件/i,
		});
		await expect(uploadSectionHeading.first()).toBeVisible({ timeout: 10_000 });

		// 8. Assert file list section heading (File List / 文件列表)
		const fileListHeading = page.locator("h2").filter({
			hasText: /File List|文件列表/i,
		});
		await expect(fileListHeading.first()).toBeVisible({ timeout: 10_000 });

		// 9. Assert dropzone text (drag and drop / 拖放文件)
		const dropzoneText = page.locator("p").filter({
			hasText: /drag and drop|拖放文件/i,
		});
		await expect(dropzoneText.first()).toBeVisible({ timeout: 10_000 });

		// 10. Assert supported formats hint (PDF, TXT, etc.)
		const formatsHint = page.locator("p").filter({
			hasText: /PDF|TXT|JSON|CSV/i,
		});
		await expect(formatsHint.first()).toBeVisible({ timeout: 10_000 });
	});

	test("agent with KB bound can receive chat responses", async ({
		request,
	}) => {
		// Verify the full integration: KB setup -> chat endpoint works
		const token = await loginByApi(request);
		const agent = await getDefaultAgent(request, token);

		// 1. Ensure a KB exists and is bound to the agent
		const boundKbId = await ensureBoundKb(request, agent.id);
		expect(boundKbId).toBeTruthy();

		// 2. Verify the derived status endpoint reports the binding
		const statusRes = await request.get(
			`${API_BASE}/api/v1/agent:kb-status?agent_id=${agent.id}`,
			{ headers: { Authorization: `Bearer ${token}` } },
		);
		expect(statusRes.status()).toBe(200);
		const status = (await statusRes.json()) as {
			kb_id?: string | null;
			kb_setup_completed?: boolean;
			kb?: { id: string } | null;
		};
		expect(status.kb_id).toBe(boundKbId);
		expect(status.kb_setup_completed).toBe(true);
		expect(status.kb?.id).toBe(boundKbId);

		// 3. Chat should succeed (uses mock LLM in test mode, but verifies flow)
		const chatRes = await request.post(`${API_BASE}/api/v1/chat`, {
			headers: { Authorization: `Bearer ${token}` },
			data: {
				agent_id: agent.id,
				message: `Test query about knowledge base ${Date.now()}`,
			},
		});
		expect(chatRes.status()).toBe(200);
		const chatData = (await chatRes.json()) as {
			reply?: string;
			session_id?: string;
		};
		// API returns 'reply' field per ChatResponse schema
		expect(chatData.reply).toBeTruthy();
		expect(chatData.session_id).toBeTruthy();
	});
});
