/**
 * E2E smoke test: Playground auto-save and streaming chat.
 */
import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'test@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpassword123';

async function login(page: any) {
  await page.goto('/login');
  await page.getByLabel(/email|邮箱/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password|密码/i).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /login|登录|submit|提交/i }).click();
  await page.waitForURL(/\/(dashboard|playground)/, { timeout: 10_000 });
}

test.describe('Playground Streaming Chat', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/playground');
    await page.waitForLoadState('networkidle');
  });

  test('auto-save shows saving/saved state', async ({ page }) => {
    // Find the system prompt or temperature field and modify it
    const tempInput = page.locator('input[type="number"]').first();
    await expect(tempInput).toBeVisible({ timeout: 10_000 });

    // Change temperature value
    await tempInput.click();
    await tempInput.fill('0.7');

    // Should show saving state briefly, then saved state
    // The AI Settings form auto-saves on change
    await expect(page.getByText(/已保存|saved/i)).toBeVisible({ timeout: 5_000 });
  });

  test('send message and receive streaming response', async ({ page }) => {
    // Wait for chat input to be ready (uses placeholder text)
    const messageInput = page.getByPlaceholder(/输入|input|message|发消息/i);
    await expect(messageInput).toBeVisible({ timeout: 10_000 });

    // Type a test message
    await messageInput.fill('你好');

    // Click send
    const sendButton = page.getByRole('button', { name: /发送|send/i });
    await sendButton.click();

    // Wait for assistant response (streaming content)
    await expect(page.locator('[class*="message"]').first()).toBeVisible({ timeout: 30_000 });
  });

  test('clear chat resets conversation', async ({ page }) => {
    // Send a message first
    const messageInput = page.getByPlaceholder(/输入|input|message|发消息/i);
    await expect(messageInput).toBeVisible({ timeout: 10_000 });
    await messageInput.fill('test message');

    const sendButton = page.locator('button').filter({ hasText: /发送|send/i });
    await sendButton.click();

    // Wait for response to appear
    await expect(page.locator('[class*="message"]').first()).toBeVisible({ timeout: 30_000 });

    // Click clear button
    const clearButton = page.locator('button').filter({ hasText: /清空|clear/i });
    await expect(clearButton).toBeVisible({ timeout: 5_000 });
    await clearButton.click();

    // After clearing, the user message should no longer be visible
    await expect(page.getByText('test message')).not.toBeVisible({ timeout: 5_000 });
  });
});
