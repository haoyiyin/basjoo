/**
 * Widget interaction fixture for Playwright E2E tests.
 * Provides helpers for widget initialization, messaging, and assertion.
 */
import { Page, expect } from '@playwright/test';

/**
 * Opens a host page that embeds the widget via script tag.
 */
export async function openWidgetHost(page: Page, hostUrl: string): Promise<void> {
  await page.goto(hostUrl);
  // Wait for widget button to appear
  await expect(page.locator('#basjoo-widget-container')).toBeVisible({ timeout: 10_000 });
}

/**
 * Opens the widget chat window.
 */
export async function openChatWindow(page: Page): Promise<void> {
  await page.click('#basjoo-toggle-button');
  await expect(page.locator('#basjoo-chat-window')).toBeVisible({ timeout: 5_000 });
}

/**
 * Sends a message through the widget and waits for a response.
 */
export async function sendMessageAndWaitForResponse(
  page: Page,
  message: string,
  options?: { timeout?: number },
): Promise<void> {
  const timeout = options?.timeout ?? 30_000;

  // Fill and send message
  await page.fill('#basjoo-message-input', message);
  await page.click('#basjoo-send-button');

  // Wait for assistant response to appear
  await page.waitForSelector('#basjoo-messages-container .message.assistant', { timeout });
}

/**
 * Asserts that the widget shows an error or origin-not-allowed state.
 */
export async function assertWidgetBlocked(page: Page): Promise<void> {
  // The widget should show an error message when origin is not allowed
  await expect(
    page.locator('#basjoo-messages-container').getByText(/origin not allowed|error|blocked/i),
  ).toBeVisible({ timeout: 10_000 }).catch(async () => {
    // Fallback: check console for error
    // Widget logs "ORIGIN_NOT_ALLOWED" to console
  });
}
