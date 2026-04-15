/**
 * E2E test: Widget cross-origin embed and allowed/blocked origin behavior.
 *
 * Tests widget loading from a third-party host page with the SDK script.
 *
 * @widget
 */
import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'test@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpassword123';
const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000';

async function getAdminToken(request: any): Promise<string> {
  const loginRes = await request.post(`${API_BASE}/api/admin/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const data = await loginRes.json();
  return data.access_token;
}

test.describe('Widget Cross-Origin', () => {
  test('widget loads and chats from allowed host', async ({ page, request }) => {
    test.skip(!process.env.HOST_ALLOWED_URL, 'HOST_ALLOWED_URL not set');

    // Ensure allowed_widget_origins is set
    const token = await getAdminToken(request);
    const agentRes = await request.get(`${API_BASE}/api/v1/agent:default`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const agent = await agentRes.json();

    // Set the allowed host as widget origin
    const allowedHost = process.env.HOST_ALLOWED_URL!.replace(/\/$/, '');
    await request.put(`${API_BASE}/api/v1/agent?agent_id=${agent.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { allowed_widget_origins: [allowedHost] },
    });

    // Navigate to allowed host page
    await page.goto(process.env.HOST_ALLOWED_URL!);

    // Wait for widget button to appear
    await expect(page.locator('#basjoo-toggle-button')).toBeVisible({ timeout: 10_000 });

    // Open chat
    await page.click('#basjoo-toggle-button');
    await expect(page.locator('#basjoo-chat-window')).toBeVisible({ timeout: 5_000 });

    // Welcome message should be visible
    await expect(page.locator('#basjoo-messages-container')).toBeVisible({ timeout: 5_000 });
  });

  test('widget is blocked on disallowed host', async ({ page, request }) => {
    test.skip(!process.env.HOST_BLOCKED_URL, 'HOST_BLOCKED_URL not set');

    // Set allowed_widget_origins to NOT include the blocked host
    const token = await getAdminToken(request);
    const agentRes = await request.get(`${API_BASE}/api/v1/agent:default`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const agent = await agentRes.json();

    // Set origin to something different from the blocked host
    await request.put(`${API_BASE}/api/v1/agent?agent_id=${agent.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { allowed_widget_origins: ['https://only-allowed.example.com'] },
    });

    // Attach console listener before navigation to catch all errors
    const consoleMessages: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleMessages.push(msg.text());
      }
    });

    // Navigate to blocked host page
    await page.goto(process.env.HOST_BLOCKED_URL!);

    // Wait a moment for the widget SDK to initialize
    await page.waitForTimeout(3_000);

    // The widget button may or may not render when blocked.
    // But if it does, trying to send should fail.
    // And regardless, we should see ORIGIN_NOT_ALLOWED in console.
    const toggleButton = page.locator('#basjoo-toggle-button');
    const buttonVisible = await toggleButton.isVisible({ timeout: 5_000 }).catch(() => false);

    if (buttonVisible) {
      await toggleButton.click();
      const input = page.locator('#basjoo-message-input');
      const inputVisible = await input.isVisible({ timeout: 5_000 }).catch(() => false);
      if (inputVisible) {
        await input.fill('test message');
        await page.click('#basjoo-send-button');
        await page.waitForTimeout(5_000);
      }
    }

    // Regardless of UI path, blocked origin should produce console error
    const hasOriginError = consoleMessages.some(
      (msg) => msg.includes('ORIGIN_NOT_ALLOWED') || msg.includes('origin not allowed'),
    );
    expect(hasOriginError).toBe(true);
  });
});
