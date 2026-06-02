import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * NOTE: QA (Question-Answer) batch import feature has been removed.
 * Tests previously using qa:batch_import now use files:upload.
 * See: docs/plans/2026-06-03-fix-e2e-qa-tests-implementation-plan.md
 */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "test@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "testpassword123";
const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";
const JINA_API_KEY = process.env.E2E_JINA_API_KEY || "";
const SILICONFLOW_API_KEY = process.env.E2E_SILICONFLOW_API_KEY || "";
const DEEPSEEK_API_KEY = process.env.E2E_DEEPSEEK_API_KEY || "";

type Agent = {
	id: string;
	provider_type?: string;
	model?: string;
	api_base?: string;
	embedding_provider?: "jina" | "siliconflow";
	embedding_model?: string;
	api_key_set?: boolean;
	api_key_masked?: string | null;
	jina_api_key_set?: boolean;
	jina_api_key_masked?: string | null;
	siliconflow_api_key_set?: boolean;
	siliconflow_api_key_masked?: string | null;
	embedding_api_key_set?: boolean;
	[key: string]: unknown;
};

async function loginByApi(request: APIRequestContext): Promise<string> {
	const loginRes = await request.post(`${API_BASE}/api/admin/login`, {
		headers: {
			"X-Forwarded-For": `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
		},
		data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
	});
	expect(loginRes.status(), await loginRes.text()).toBe(200);
	const loginData = (await loginRes.json()) as { access_token: string };
	return loginData.access_token;
}

async function getDefaultAgent(
	request: APIRequestContext,
	token: string,
): Promise<Agent> {
	const agentRes = await request.get(`${API_BASE}/api/v1/agent:default`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(agentRes.status(), await agentRes.text()).toBe(200);
	return agentRes.json() as Promise<Agent>;
}

async function updateAgent(
	request: APIRequestContext,
	token: string,
	agentId: string,
	data: Record<string, unknown>,
): Promise<Agent> {
	const updateRes = await request.put(
		`${API_BASE}/api/v1/agent?agent_id=${agentId}`,
		{
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			data,
		},
	);
	expect(updateRes.status(), await updateRes.text()).toBe(200);
	return updateRes.json() as Promise<Agent>;
}

test.describe.configure({ mode: "serial" });

test.describe("Recent commit regressions", () => {
	let token: string;
	let agent: Agent;

	test.beforeAll(async ({ request }) => {
		token = await loginByApi(request);
		agent = await getDefaultAgent(request, token);
	});

	test("provider keys are saved, masked, switchable, and usable for embedding API tests", async ({
		request,
	}) => {
		test.skip(
			!JINA_API_KEY || !SILICONFLOW_API_KEY || !DEEPSEEK_API_KEY,
			"Provider test keys are required",
		);

		const deepseekAgent = await updateAgent(request, token, agent.id, {
			provider_type: "deepseek",
			api_key: DEEPSEEK_API_KEY,
			api_base: "https://api.deepseek.com",
			model: "deepseek-chat",
		});
		expect(deepseekAgent.provider_type).toBe("deepseek");
		expect(deepseekAgent.api_key_set).toBe(true);
		expect(JSON.stringify(deepseekAgent)).not.toContain(DEEPSEEK_API_KEY);

		const jinaAgent = await updateAgent(request, token, agent.id, {
			embedding_provider: "jina",
			embedding_model: "jina-embeddings-v3",
			jina_api_key: JINA_API_KEY,
		});
		expect(jinaAgent.embedding_provider).toBe("jina");
		expect(jinaAgent.jina_api_key_set).toBe(true);
		expect(jinaAgent.embedding_api_key_set).toBe(true);
		expect(JSON.stringify(jinaAgent)).not.toContain(JINA_API_KEY);

		const jinaTestRes = await request.post(
			`${API_BASE}/api/v1/agent:test-embedding-api?agent_id=${agent.id}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				data: { embedding_provider: "jina", jina_api_key: JINA_API_KEY },
			},
		);
		expect(jinaTestRes.status(), await jinaTestRes.text()).toBe(200);
		await expect(jinaTestRes.json()).resolves.toMatchObject({ success: true });

		const siliconflowAgent = await updateAgent(request, token, agent.id, {
			embedding_provider: "siliconflow",
			embedding_model: "BAAI/bge-m3",
			siliconflow_api_key: SILICONFLOW_API_KEY,
		});
		expect(siliconflowAgent.embedding_provider).toBe("siliconflow");
		expect(siliconflowAgent.siliconflow_api_key_set).toBe(true);
		expect(siliconflowAgent.embedding_api_key_set).toBe(true);
		expect(JSON.stringify(siliconflowAgent)).not.toContain(SILICONFLOW_API_KEY);

		const siliconflowTestRes = await request.post(
			`${API_BASE}/api/v1/agent:test-embedding-api?agent_id=${agent.id}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				data: {
					provider_type: "deepseek",
					embedding_provider: "siliconflow",
					embedding_model: "BAAI/bge-m3",
					siliconflow_api_key: SILICONFLOW_API_KEY,
				},
			},
		);
		expect(siliconflowTestRes.status(), await siliconflowTestRes.text()).toBe(
			200,
		);
		await expect(siliconflowTestRes.json()).resolves.toMatchObject({
			success: true,
		});
	});

	test("SiliconFlow embedding can upload files and list them", async ({
		request,
	}) => {
		test.skip(!SILICONFLOW_API_KEY, "SiliconFlow test key is required");

		await updateAgent(request, token, agent.id, {
			embedding_provider: "siliconflow",
			embedding_model: "BAAI/bge-m3",
			siliconflow_api_key: SILICONFLOW_API_KEY,
		});

		const filename = `siliconflow-e2e-${Date.now()}.txt`;
		const content = `SiliconFlow E2E test content ${Date.now()}`;

		// Upload a test file via the files endpoint (replaces removed qa:batch_import)
		const uploadRes = await request.post(
			`${API_BASE}/api/v1/files:upload?agent_id=${agent.id}`,
			{
				headers: { Authorization: `Bearer ${token}` },
				multipart: {
					files: {
						name: filename,
						mimeType: "text/plain",
						buffer: Buffer.from(content),
					},
				},
			},
		);
		expect(uploadRes.status(), await uploadRes.text()).toBe(200);
		const uploadData = (await uploadRes.json()) as {
			uploaded: number;
			files: Array<{ id: string; filename: string; status: string }>;
		};
		expect(uploadData.uploaded).toBe(1);
		expect(uploadData.files[0].filename).toBe(filename);
		expect(uploadData.files[0].status).toBe("pending");

		// List files to verify the uploaded file appears
		const listRes = await request.get(
			`${API_BASE}/api/v1/files:list?agent_id=${agent.id}`,
			{
				headers: { Authorization: `Bearer ${token}` },
			},
		);
		expect(listRes.status(), await listRes.text()).toBe(200);
		const listData = (await listRes.json()) as {
			total: number;
			files: Array<{ id: string; filename: string }>;
		};
		expect(listData.total).toBeGreaterThanOrEqual(1);
		expect(listData.files.some((f) => f.filename === filename)).toBe(true);
	});

	test("URL safety rejects SSRF-like URLs without server errors", async ({
		request,
	}) => {
		const blockedUrls = [
			"http://localhost",
			"http://127.0.0.1",
			"http://169.254.169.254/latest/meta-data/",
			"http://192.168.0.1",
			"https://user:pass@example.com",
		];

		for (const url of blockedUrls) {
			const res = await request.post(
				`${API_BASE}/api/v1/urls:create?agent_id=${agent.id}`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					data: { urls: [url] },
				},
			);
			expect(
				res.status(),
				`${url}: ${await res.text()}`,
			).toBeGreaterThanOrEqual(400);
			expect(res.status(), url).toBeLessThan(500);
		}
	});

	test("auth language switcher works before login", async ({ page }) => {
		await page.route("**/api/admin/login", async (route) => {
			await route.continue({
				headers: {
					...route.request().headers(),
					"X-Forwarded-For": `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
				},
			});
		});
		await page.goto("/login");
		await expect(
			page.getByRole("button", { name: /login|登录/i }),
		).toBeVisible();

		const htmlBefore = await page.locator("body").innerText();
		const languageControls = page
			.getByRole("button")
			.filter({ hasText: /中文|English|EN|中/i });
		const count = await languageControls.count();
		expect(count).toBeGreaterThan(0);
		const englishControl = page.getByRole("button", { name: /English|EN/i });
		if (await englishControl.count()) {
			await englishControl.first().click();
		} else {
			await languageControls.nth(Math.min(1, count - 1)).click();
		}
		await page.waitForTimeout(500);
		const htmlAfter = await page.locator("body").innerText();
		expect(htmlAfter).not.toBe(htmlBefore);

		await page.locator("input").first().fill(ADMIN_EMAIL);
		await page.locator("input").nth(1).fill(ADMIN_PASSWORD);
		await page.getByRole("button", { name: /login|登录|submit|提交/i }).click();
		await page.waitForLoadState("networkidle");
		await expect(page).not.toHaveURL(/\/login/);
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem("token")))
			.toBeTruthy();
	});

	test("widget renderer does not execute malicious markdown-like content in welcome message", async ({
		page,
		request,
	}) => {
		await updateAgent(request, token, agent.id, {
			allowed_widget_origins: ["http://localhost:3000"],
			welcome_message:
				"[<img src=x onerror=alert(1)>](javascript:alert(1)) <script>alert(2)</script>",
		});

		const dialogs: string[] = [];
		page.on("dialog", async (dialog) => {
			dialogs.push(dialog.message());
			await dialog.dismiss();
		});

		await page.goto("/");
		await page.addScriptTag({ url: `${API_BASE}/sdk.js` });
		await page.evaluate((currentAgentId) => {
			const WidgetClass = (window as any).BasjooWidget;
			const widget = new WidgetClass({
				agentId: currentAgentId,
				apiBase: "http://localhost:8000",
			});
			return widget.init();
		}, agent.id);
		await expect(page.locator("#basjoo-widget-button")).toBeVisible({
			timeout: 10_000,
		});
		await page.locator("#basjoo-widget-button").click();
		await page.waitForTimeout(1_000);
		expect(dialogs).toEqual([]);

		const dangerousNodes = await page
			.locator(
				'#basjoo-widget-container a[href^="javascript:"], #basjoo-widget-container script, #basjoo-widget-container img[onerror]',
			)
			.count();
		expect(dangerousNodes).toBe(0);
	});
});
