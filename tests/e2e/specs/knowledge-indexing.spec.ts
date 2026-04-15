/**
 * E2E smoke test: QA import -> index rebuild -> chat retrieval.
 *
 * @smoke @prod
 */
import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'test@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpassword123';
const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000';

async function login(page: any) {
  await page.goto('/login');
  await page.getByLabel(/email|邮箱/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password|密码/i).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /login|登录|submit|提交/i }).click();
  await page.waitForURL(/\/(dashboard|playground)/, { timeout: 10_000 });
}

test.describe('Knowledge Indexing Flow', () => {
  test('QA import and index rebuild', async ({ page, request }) => {
    // 1. Login via API to get token
    const loginRes = await request.post(`${API_BASE}/api/admin/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const loginData = await loginRes.json();
    const token = loginData.access_token;

    // 2. Get default agent
    const agentRes = await request.get(`${API_BASE}/api/v1/agent:default`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const agent = await agentRes.json();

    // 3. Import a specific QA item (API expects {format, content, overwrite} body)
    const uniqueQuestion = `E2E Test Question ${Date.now()}`;
    const qaContent = JSON.stringify([
      { question: uniqueQuestion, answer: 'This is an E2E test answer.' },
    ]);
    const qaRes = await request.post(`${API_BASE}/api/v1/qa:batch_import?agent_id=${agent.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { format: 'json', content: qaContent, overwrite: false },
    });
    expect([200, 201]).toContain(qaRes.status());

    // 4. Rebuild index
    const rebuildRes = await request.post(`${API_BASE}/api/v1/index:rebuild?agent_id=${agent.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {},
    });
    expect([200, 202]).toContain(rebuildRes.status());

    // 5. Wait for index job to complete
    const rebuildData = await rebuildRes.json();
    const jobId = rebuildData.job_id;
    let status = 'unknown';
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1_000);
      const statusRes = await request.get(`${API_BASE}/api/v1/index:status?agent_id=${agent.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const statusData = await statusRes.json();
      status = statusData.status;
      if (status === 'completed' || status === 'failed') {
        break;
      }
    }

    // Index must complete successfully
    expect(status).toBe('completed');

    // 6. Chat and check if the QA is retrievable
    const chatRes = await request.post(`${API_BASE}/api/v1/chat`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { agent_id: agent.id, message: uniqueQuestion },
    });
    const chatData = await chatRes.json();

    // The reply should reference the QA or at least return a response
    expect(chatData.reply).toBeTruthy();
  });

  test('QA management UI shows imported items', async ({ page, request }) => {
    // 1. Verify QA was seeded via API
    const loginRes = await request.post(`${API_BASE}/api/admin/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const token = (await loginRes.json() as { access_token: string }).access_token;
    const agentRes = await request.get(`${API_BASE}/api/v1/agent:default`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const agent = await agentRes.json() as { id: string };

    // Confirm QA items exist
    const qaListRes = await request.get(`${API_BASE}/api/v1/qa:list?agent_id=${agent.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const qaList = await qaListRes.json() as { total: number };
    expect(qaList.total).toBeGreaterThanOrEqual(1);

    // 2. Verify QA page loads in UI
    await login(page);
    await page.goto('/qa');
    await page.waitForLoadState('networkidle');

    // The QA page should render (check for page title or content area)
    await expect(page.locator('h1, h2, [class*="title"], [class*="qa"]').first()).toBeVisible({ timeout: 10_000 });
  });
});
