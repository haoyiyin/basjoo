/**
 * E2E test: Admin sessions takeover + widget polling for human reply.
 *
 * Tests the full chain: widget starts chat -> admin takes over ->
 * admin sends human reply -> widget polls and shows it.
 *
 * @prod
 */
import { test, expect } from '@playwright/test';
import {
  adminLogin,
  agentRoute,
  API_BASE,
  loginByApi,
  getDefaultAgent,
} from '../fixtures/e2e-context';

test.describe('Admin Sessions Takeover', () => {
  test('full takeover chain via API', async ({ request }) => {
    // 1. Login as admin using shared helper
    const token = await loginByApi(request);
    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // 2. Get default agent using shared helper
    const agent = await getDefaultAgent(request, token);

    await request.put(`${API_BASE}/api/v1/agent?agent_id=${agent.id}`, {
      headers: authHeaders,
      data: { allowed_widget_origins: [] },
    });

    // 3. Simulate a visitor chat (creates a session)
    const chatRes = await request.post(`${API_BASE}/api/v1/chat`, {
      data: { agent_id: agent.id, message: 'I need help from a human', visitor_id: 'e2e-visitor', session_id: `e2e-session-${Date.now()}` },
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
    // 1. Create a visitor session via API first using shared helpers
    const token = await loginByApi(request);
    const authHeaders = { Authorization: `Bearer ${token}` };

    // Get default agent using shared helper
    const agent = await getDefaultAgent(request, token);

    await request.put(`${API_BASE}/api/v1/agent?agent_id=${agent.id}`, {
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      data: { allowed_widget_origins: [] },
    });

    // Create a visitor chat session

    const sessionId = `e2e-ui-session-${Date.now()}`;
    const chatRes = await request.post(`${API_BASE}/api/v1/chat`, {
      headers: { 'Content-Type': 'application/json' },
      data: { agent_id: agent.id, message: 'UI test session', session_id: sessionId },
    });
    expect(chatRes.status()).toBe(200);

    // 2. Login to admin dashboard using shared helper
    await adminLogin(page);

    // 3. Navigate to agent-scoped sessions page
    await page.goto(agentRoute(agent.id, 'sessions'));
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(`/agents/${agent.id}/sessions`);

    // 4. Verify session appears in the admin list by checking via API
    const sessionsRes = await request.get(`${API_BASE}/api/v1/admin/sessions?skip=0&limit=10`, {
      headers: authHeaders,
    });
    const sessionsData = await sessionsRes.json() as { items: Array<{ session_id: string; status: string }> };
    expect(Array.isArray(sessionsData.items)).toBe(true);
    expect(sessionsData.items.length).toBeGreaterThanOrEqual(1);

    // 5. Verify sessions page renders content with bilingual assertions
    await expect(page.getByRole('heading', { name: /会话中心|Sessions Center/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(new RegExp(`会话 #${sessionId}|Session #${sessionId}`))).toBeVisible({ timeout: 10_000 });
  });
});
