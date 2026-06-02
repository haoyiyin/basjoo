/**
 * E2E smoke test: Playground auto-save and streaming chat.
 */
import { test, expect } from '@playwright/test';
import { adminLogin, agentRoute, resolveAgentContext } from '../fixtures/e2e-context';

test.describe('Playground Streaming Chat', () => {
  test.beforeEach(async ({ page, request }) => {
    const context = await resolveAgentContext(request);
    await adminLogin(page);
    await page.goto(agentRoute(context.agentId, 'playground'));
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(new RegExp(`/agents/${context.agentId}/playground`));
  });

  test('auto-save shows saving/saved state', async ({ page }) => {
    // Find the temperature slider (first range input)
    const tempInput = page.locator('input[type="range"]').first();
    await expect(tempInput).toBeVisible({ timeout: 10_000 });

    const previousValue = Number(await tempInput.evaluate((input: HTMLInputElement) => input.value));
    const delta = previousValue >= 1.5 ? -0.1 : 0.1;
    const nextValue = String(Number((previousValue + delta).toFixed(1)));
    
    // Set up response listener before interaction
    const saveResponse = page.waitForResponse((response) =>
      response.url().includes('/api/v1/agent?') &&
      response.request().method() === 'PUT' &&
      response.status() === 200,
    );

    // Change temperature value through keyboard interaction
    await tempInput.focus();
    await tempInput.press(delta > 0 ? 'ArrowRight' : 'ArrowLeft');

    await saveResponse;
    
    // Assert the temperature label shows the new value
    await expect(page.getByText(new RegExp(`温度\\s*\\(${nextValue}\\)|temperature\\s*\\(${nextValue}\\)`, 'i'))).toBeVisible({ timeout: 5_000 });
  });

  test('send message and receive streaming response', async ({ page }) => {
    // Wait for chat input to be ready (uses placeholder text)
    const messageInput = page.getByRole('textbox', { name: /输入您的问题|your question/i });
    await expect(messageInput).toBeVisible({ timeout: 10_000 });

    // Use a unique message to identify it later
    const uniqueMessage = `test message ${Date.now()}`;
    await messageInput.fill(uniqueMessage);

    // Click send
    const sendButton = page.getByRole('button', { name: /发送|send/i });
    await sendButton.click();

    // Assert user message appears in chat
    await expect(page.getByText(uniqueMessage)).toBeVisible({ timeout: 10_000 });

    // Wait for assistant response or error (provider might not be configured)
    // Look for assistant/error content that is NOT the user's unique message
    // Assistant responses typically appear in a separate container with different styling
    await expect(
      page.locator('main').locator('div').filter({ hasNot: page.getByText(uniqueMessage) }).getByText(/hello|你好|help|帮助|i can|我可以|error|错误|failed|失败|quota|配置|api|provider/i).first()
    ).toBeVisible({ timeout: 30_000 });
  });

  test('clear chat resets conversation', async ({ page }) => {
    // Use a unique message to identify it later
    const uniqueMessage = `clear test ${Date.now()}`;
    
    // Send a message first
    const messageInput = page.getByRole('textbox', { name: /输入您的问题|your question/i });
    await expect(messageInput).toBeVisible({ timeout: 10_000 });
    await messageInput.fill(uniqueMessage);

    const sendButton = page.getByRole('button', { name: /发送|send/i });
    await sendButton.click();

    // Assert user message appears in chat
    await expect(page.getByText(uniqueMessage)).toBeVisible({ timeout: 10_000 });

    // Wait for response or error to appear before clearing
    // Look for content that is NOT the user's unique message
    await expect(
      page.locator('main').locator('div').filter({ hasNot: page.getByText(uniqueMessage) }).getByText(/hello|你好|help|帮助|i can|我可以|error|错误|failed|失败|quota|配置|api|provider/i).first()
    ).toBeVisible({ timeout: 30_000 });

    // Click clear button and accept the confirmation dialog
    const clearButton = page.getByRole('button', { name: /^清空$|^clear$/i });
    await expect(clearButton).toBeVisible({ timeout: 5_000 });
    page.once('dialog', async (dialog) => dialog.accept());
    await clearButton.click();

    // After clearing, the unique user message should no longer be visible in the transcript
    await expect(page.locator('main').getByText(uniqueMessage, { exact: false })).not.toBeVisible({ timeout: 5_000 });
  });
});
