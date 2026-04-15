/**
 * E2E test: Admin sessions takeover + widget polling for human reply.
 *
 * Tests the full chain: widget starts chat -> admin takes over ->
 * admin sends human reply -> widget polls and shows it.
 *
 * @prod
 */
import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'test@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpassword123';
const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000';

test.describe('Admin Sessions Takeover', () => {
  test('full takeover chain via API', async ({ page, request }) => {
    // 1. Login as admin
    const loginRes = await request.post(`${API_BASE}/api/admin/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const loginData = await loginRes.json();
    const token = loginData.access_token;
    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // 2. Get default agent
    const agentRes = await request.get(`${API_BASE}/api/v1/agent:default`, { headers: authHeaders });
    const agent = await agentRes.json();

    // 3. Simulate a visitor chat (creates a session)
    const chatRes = await request.post(`${API_BASE}/api/v1/chat`, {
      data: { agent_id: agent.id, message: 'I need help from a human', visitor_id: 'e2e-visitor' },
    });
    const chatData = await chatRes.json();
    const sessionId = chatData.session_id;
    expect(sessionId).toBeTruthy();

    // 4. Admin views sessions list
    const sessionsRes = await request.get(`${API_BASE}/api/v1/admin/sessions?skip=0&limit=10`, {
      headers: authHeaders,
    });
    const sessionsData = await sessionsRes.json();
    expect(sessionsData.items).toBeTruthy();
    expect(sessionsData.items.length).toBeGreaterThanOrEqual(1);

    // Find the session we just created
    const session = sessionsData.items.find((s: any) => s.session_id === sessionId);
    expect(session).toBeTruthy();

    // 5. Admin takes over the session
    const takeoverRes = await request.post(
      `${API_BASE}/api/v1/admin/sessions/${session.id}/takeover`,
      { headers: authHeaders },
    );
    expect([200, 201]).toContain(takeoverRes.status());

    // 6. Admin sends human reply
    const sendRes = await request.post(`${API_BASE}/api/v1/admin/sessions/send`, {
      headers: authHeaders,
      data: {
        session_id: session.id,
        content: 'Hello, I am a human agent. How can I help you?',
      },
    });
    expect([200, 201]).toContain(sendRes.status());

    // 7. Visitor (public client) polls for assistant messages
    const messagesRes = await request.get(
      `${API_BASE}/api/v1/chat/messages?session_id=${sessionId}&role=assistant`,
    );
    const messages = await messagesRes.json();
    expect(Array.isArray(messages)).toBe(true);

    // Should contain the human reply
    const hasHumanReply = messages.some((m: any) =>
      m.content?.includes('human agent'),
    );
    expect(hasHumanReply).toBe(true);
  });

  test('sessions page shows visitor sessions after login', async ({ page, request }) => {
    // 1. Create a visitor session via API first
    const loginRes = await request.post(`${API_BASE}/api/admin/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const token = (await loginRes.json() as { access_token: string }).access_token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    // Get default agent
    const agentRes = await request.get(`${API_BASE}/api/v1/agent:default`, {
      headers: authHeaders,
    });
    const agent = await agentRes.json() as { id: string };

    // Create a visitor chat session
    const chatRes = await request.post(`${API_BASE}/api/v1/chat`, {
      headers: { 'Content-Type': 'application/json' },
      data: { agent_id: agent.id, message: 'UI test session' },
    });
    expect(chatRes.status()).toBe(200);

    // 2. Login to admin dashboard
    await page.goto('/login');
    await page.getByLabel(/email|邮箱/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password|密码/i).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /login|登录|submit|提交/i }).click();
    await page.waitForURL(/\/(dashboard|sessions)/, { timeout: 10_000 });

    // 3. Navigate to sessions page
    await page.goto('/sessions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2_000);

    // 4. Verify session appears in the admin list by checking via API
    const sessionsRes = await request.get(`${API_BASE}/api/v1/admin/sessions?skip=0&limit=10`, {
      headers: authHeaders,
    });
    const sessionsData = await sessionsRes.json() as { items: Array<{ session_id: string; status: string }> };
    expect(Array.isArray(sessionsData.items)).toBe(true);
    expect(sessionsData.items.length).toBeGreaterThanOrEqual(1);

    // 5. Verify sessions page renders content (check for table or list structure)
    await expect(page.locator('table, [class*="session"], [class*="list"]').first()).toBeVisible({ timeout: 10_000 });
  });
});
