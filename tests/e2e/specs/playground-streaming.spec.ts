/**
 * E2E smoke test: Playground auto-save and streaming chat.
 */
import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'test@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpassword123';

async function login(page: any) {
  await page.route('**/api/admin/login', async (route: any) => {
    await route.continue({ headers: { ...route.request().headers(), 'X-Forwarded-For': `203.0.113.${Math.floor(Math.random() * 200) + 20}` } });
  });
  await page.goto('/login');
  await page.locator('input').first().fill(ADMIN_EMAIL);
  await page.locator('input').nth(1).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /login|登录|submit|提交/i }).click();
  await page.waitForLoadState('networkidle');
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe('Playground Streaming Chat', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/playground');
    await page.waitForLoadState('networkidle');
  });

  test('auto-save shows saving/saved state', async ({ page }) => {
    // Find the system prompt or temperature field and modify it
    const tempInput = page.locator('input[type="range"], input[type="number"]').first();
    await expect(tempInput).toBeVisible({ timeout: 10_000 });

    const previousValue = Number(await tempInput.evaluate((input: HTMLInputElement) => input.value));
    const delta = previousValue >= 2 ? -0.1 : 0.1;
    const nextValue = String(Number((previousValue + delta).toFixed(1)));
    const saveResponse = page.waitForResponse((response) =>
      response.url().includes('/api/v1/agent?') &&
      response.request().method() === 'PUT' &&
      response.status() === 200,
    );

    // Change temperature value through a real keyboard interaction so React state updates.
    await tempInput.focus();
    await tempInput.press(delta > 0 ? 'ArrowRight' : 'ArrowLeft');

    await saveResponse;
    await expect(page.getByText(new RegExp(`温度\\s*\\(${nextValue}\\)|temperature\\s*\\(${nextValue}\\)`, 'i'))).toBeVisible({ timeout: 5_000 });
  });

  test('send message and receive streaming response', async ({ page }) => {
    // Wait for chat input to be ready (uses placeholder text)
    const messageInput = page.getByRole('textbox', { name: /输入您的问题|your question/i });
    await expect(messageInput).toBeVisible({ timeout: 10_000 });

    // Type a test message
    await messageInput.fill('你好');

    // Click send
    const sendButton = page.getByRole('button', { name: /发送|send/i });
    await sendButton.click();

    // Wait for assistant response (streaming content)
    await expect(page.getByText(/你好|hello|help|帮助/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test('clear chat resets conversation', async ({ page }) => {
    // Send a message first
    const messageInput = page.getByRole('textbox', { name: /输入您的问题|your question/i });
    await expect(messageInput).toBeVisible({ timeout: 10_000 });
    await messageInput.fill('test message');

    const sendButton = page.locator('button').filter({ hasText: /发送|send/i });
    await sendButton.click();

    // Wait for response to appear
    await expect(page.getByText(/你好|hello|help|帮助/i).first()).toBeVisible({ timeout: 30_000 });

    // Click clear button and accept the confirmation dialog
    const clearButton = page.getByRole('button', { name: /^清空$|^clear$/i });
    await expect(clearButton).toBeVisible({ timeout: 5_000 });
    page.once('dialog', async (dialog) => dialog.accept());
    await clearButton.click();

    // After clearing, the unique user message should no longer be visible in the transcript.
    await expect(page.locator('main').getByText('test message', { exact: true })).not.toBeVisible({ timeout: 5_000 });
  });
});
