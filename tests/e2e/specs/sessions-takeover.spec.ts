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
  sseDoneEvent,
} from '../fixtures/e2e-context';

test.describe('Admin Sessions Takeover', () => {
  test('full takeover chain via API', async ({ request }) => {
    test.setTimeout(120_000);
    // 1. Login as admin using shared helper
    const token = await loginByApi(request);
    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // 2. Get default agent using shared helper
    const agent = await getDefaultAgent(request, token);

    await request.put(`${API_BASE}/api/v1/agent?agent_id=${agent.id}`, {
      headers: authHeaders,
      data: { allowed_widget_origins: [] },
    });

    // 3. Simulate a visitor chat (creates a session). The stream endpoint is the
    //    only one that survives a slow first token; a client cannot predict the
    //    server-minted session id, so read it from the SSE `done` event.
    const chatRes = await request.post(`${API_BASE}/api/v1/chat/stream`, {
      headers: authHeaders,
      data: {
        agent_id: agent.id,
        message: 'I need help from a human',
        visitor_id: 'e2e-visitor',
        preview: true,
      },
    });
    expect(chatRes.status()).toBe(200);
    const sseBody = await chatRes.text();
    expect(sseBody).not.toContain('event: error');
    const done = sseDoneEvent(sseBody);
    expect(done, sseBody.slice(-400)).toBeTruthy();
    const sessionId = done!.session_id as string;
    expect(sessionId).toBeTruthy();

    // 4. Admin views sessions list. The endpoint sorts oldest first, so use a
    // wider limit to find this freshly-created session in reused E2E databases.
    const sessionsRes = await request.get(
      `${API_BASE}/api/v1/admin/sessions?skip=0&limit=100&agent_id=${agent.id}`,
      { headers: authHeaders },
    );
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
    const takeover = (await takeoverRes.json()) as {
      success?: boolean;
      session?: { status?: string; mode?: string };
    };
    expect(takeover.success).toBe(true);
    expect(takeover.session?.status).toBe('taken_over');
    expect(takeover.session?.mode).toBe('human');

    // 6. Admin sends human reply
    const sendRes = await request.post(`${API_BASE}/api/v1/admin/sessions/send`, {
      headers: authHeaders,
      data: {
        session_id: session.id,
        content: 'Hello, I am a human agent. How can I help you?',
      },
    });
    expect([200, 201]).toContain(sendRes.status());

    // 7. Visitor (public client) polls for assistant messages. The endpoint
    //    requires the session's own visitor id, exactly like the widget does.
    const messagesRes = await request.get(
      `${API_BASE}/api/v1/chat/messages?session_id=${sessionId}&visitor_id=e2e-visitor&role=assistant`,
    );
    const messages = await messagesRes.json();
    expect(Array.isArray(messages)).toBe(true);

    // Should contain the human reply, authored by the operator (not the AI).
    const hasHumanReply = messages.some((m: any) =>
      m.content?.includes('human agent') && m.sender_type === 'human',
    );
    expect(hasHumanReply).toBe(true);
  });

  test('sessions page shows visitor sessions after login', async ({ page, request }) => {
    // A live provider's first token can take ~60 s; the stream endpoint keeps the
    // socket alive, the blocking one trips the 30 s per-test timeout.
    test.setTimeout(120_000);
    // 1. Create a visitor session via API first using shared helpers
    const token = await loginByApi(request);
    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Get default agent using shared helper
    const agent = await getDefaultAgent(request, token);

    await request.put(`${API_BASE}/api/v1/agent?agent_id=${agent.id}`, {
      headers: authHeaders,
      data: { allowed_widget_origins: [] },
    });

    // Create a visitor chat session through the stream endpoint and take the
    // server-minted id from the SSE `done` event; the client cannot predict it.
    const chatRes = await request.post(`${API_BASE}/api/v1/chat/stream`, {
      headers: authHeaders,
      data: {
        agent_id: agent.id,
        message: 'UI test session',
        visitor_id: 'e2e-ui-visitor',
        preview: true,
      },
    });
    expect(chatRes.status()).toBe(200);
    const sseBody = await chatRes.text();
    expect(sseBody).not.toContain('event: error');
    const done = sseDoneEvent(sseBody);
    expect(done, sseBody.slice(-400)).toBeTruthy();
    const sessionId = done!.session_id as string;
    expect(sessionId).toBeTruthy();

    // 2. Login to admin dashboard using shared helper
    await adminLogin(page);

    // 3. Navigate to agent-scoped sessions page
    await page.goto(agentRoute(agent.id, 'sessions'));
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(`/agents/${agent.id}/sessions`);

    // 4. Verify session appears in the admin list by checking via API
    const sessionsRes = await request.get(
      `${API_BASE}/api/v1/admin/sessions?skip=0&limit=100&agent_id=${agent.id}`,
      { headers: authHeaders },
    );
    const sessionsData = await sessionsRes.json() as { items: Array<{ session_id: string; status: string }> };
    expect(Array.isArray(sessionsData.items)).toBe(true);
    expect(sessionsData.items.length).toBeGreaterThanOrEqual(1);
    expect(sessionsData.items.some((s) => s.session_id === sessionId)).toBe(true);

    // 5. Verify sessions page renders content with bilingual assertions
    await expect(page.getByRole('heading', { name: /会话中心|Sessions Center/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(new RegExp(`会话 #${sessionId}|Session #${sessionId}`))).toBeVisible({ timeout: 10_000 });
  });
});
