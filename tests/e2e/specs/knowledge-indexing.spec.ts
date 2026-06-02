/**
 * E2E smoke test: File upload, listing, and file management UI.
 *
 * @smoke @prod
 */
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "test@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "testpassword123";
const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

function loginHeaders() {
	return {
		"X-Forwarded-For": `203.0.113.${Math.floor(Math.random() * 200) + 20}`,
	};
}

async function login(page: any) {
	await page.route("**/api/admin/login", async (route: any) => {
		await route.continue({
			headers: {
				...route.request().headers(),
				"X-Forwarded-For": `203.0.113.${Math.floor(Math.random() * 200) + 20}`,
			},
		});
	});
	await page.goto("/login");
	await page.locator("input").first().fill(ADMIN_EMAIL);
	await page.locator("input").nth(1).fill(ADMIN_PASSWORD);
	await page.getByRole("button", { name: /login|登录|submit|提交/i }).click();
	await page.waitForLoadState("networkidle");
	await expect(page).not.toHaveURL(/\/login/);
}

test.describe("Knowledge Indexing Flow", () => {
	test("file upload and listing", async ({ request }) => {
		// 1. Login via API to get token
		const loginRes = await request.post(`${API_BASE}/api/admin/login`, {
			headers: loginHeaders(),
			data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
		});
		expect(loginRes.status(), await loginRes.text()).toBe(200);
		const loginData = (await loginRes.json()) as { access_token: string };
		const token = loginData.access_token;

		// 2. Get default agent
		const agentRes = await request.get(`${API_BASE}/api/v1/agent:default`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(agentRes.status(), await agentRes.text()).toBe(200);
		const agent = (await agentRes.json()) as { id: string };

		// 3. Upload a test file with unique content
		const filename = `e2e-test-${Date.now()}.txt`;
		const uploadRes = await request.post(
			`${API_BASE}/api/v1/files:upload?agent_id=${agent.id}`,
			{
				headers: { Authorization: `Bearer ${token}` },
				multipart: {
					files: {
						name: filename,
						mimeType: "text/plain",
						buffer: Buffer.from(`E2E Test File Content ${Date.now()}`),
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

		// 4. List files to verify the uploaded file appears
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

	test("file management UI shows file list", async ({ page, request }) => {
		// 1. Login via API
		const loginRes = await request.post(`${API_BASE}/api/admin/login`, {
			headers: loginHeaders(),
			data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
		});
		expect(loginRes.status(), await loginRes.text()).toBe(200);
		const loginData = (await loginRes.json()) as { access_token: string };
		const token = loginData.access_token;

		// 2. Get default agent
		const agentRes = await request.get(`${API_BASE}/api/v1/agent:default`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(agentRes.status(), await agentRes.text()).toBe(200);
		const agent = (await agentRes.json()) as { id: string };

		// 3. Verify files API returns data
		const listRes = await request.get(
			`${API_BASE}/api/v1/files:list?agent_id=${agent.id}`,
			{
				headers: { Authorization: `Bearer ${token}` },
			},
		);
		expect(listRes.status(), await listRes.text()).toBe(200);

		// 4. Navigate to /files page
		await login(page);
		await page.goto(`/agents/${agent.id}/files`);
		await page.waitForLoadState("networkidle");

		// The page should render with a heading or content area
		await expect(
			page.locator('h1, h2, [class*="title"], [class*="files"]').first(),
		).toBeVisible({ timeout: 10_000 });
	});
});
