/**
 * Shared admin authentication fixture for Playwright E2E tests.
 * Delegates to e2e-context for shared helpers.
 */
import { type Page, expect } from "@playwright/test";
import { adminLogin as sharedAdminLogin, agentRoute } from "./e2e-context";

export { adminLogin as sharedAdminLogin, agentRoute };

/**
 * Login to the admin dashboard via the /login page.
 */
export async function adminLogin(page: Page): Promise<void> {
	await sharedAdminLogin(page);
}

/**
 * Navigate to a dashboard page with admin auth.
 */
export async function goToPage(page: Page, path: string): Promise<void> {
	// Ensure logged in first
	const token = await page.evaluate(() => localStorage.getItem("token"));
	if (!token) {
		await adminLogin(page);
	}
	await page.goto(path);
	await page.waitForLoadState("networkidle");
}
