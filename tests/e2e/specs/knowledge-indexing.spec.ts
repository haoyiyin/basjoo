/**
 * E2E smoke test: current knowledge source APIs and file management UI.
 *
 * @smoke @prod
 */
import { test, expect } from '@playwright/test';
import { agentRoute, API_BASE, resolveAgentContext, loginByApi, getDefaultAgent, loginHeaders, ADMIN_EMAIL, ADMIN_PASSWORD } from '../fixtures/e2e-context';

test.describe('Knowledge Source Flow', () => {
  test('API shape: files:list and sources:summary', async ({ request }) => {
    // 1. Login via API to get token
    const token = await loginByApi(request);

    // 2. Get default agent
    const agent = await getDefaultAgent(request, token);

    // 3. Test files:list API shape
    const filesListRes = await request.get(
      `${API_BASE}/api/v1/files:list?agent_id=${agent.id}&skip=0&limit=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(filesListRes.status()).toBe(200);
    const filesList = await filesListRes.json();
    expect(filesList).toHaveProperty('files');
    expect(filesList).toHaveProperty('total');
    expect(Array.isArray(filesList.files)).toBe(true);
    expect(typeof filesList.total).toBe('number');

    // 4. Test sources:summary API shape
    const sourcesSummaryRes = await request.get(
      `${API_BASE}/api/v1/sources:summary?agent_id=${agent.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(sourcesSummaryRes.status()).toBe(200);
    const sourcesSummary = await sourcesSummaryRes.json();
    // urls shape
    expect(sourcesSummary).toHaveProperty('urls');
    expect(sourcesSummary.urls).toHaveProperty('total');
    expect(sourcesSummary.urls).toHaveProperty('indexed');
    expect(sourcesSummary.urls).toHaveProperty('pending');
    expect(typeof sourcesSummary.urls.total).toBe('number');
    expect(typeof sourcesSummary.urls.indexed).toBe('number');
    expect(typeof sourcesSummary.urls.pending).toBe('number');
    // files shape
    expect(sourcesSummary).toHaveProperty('files');
    expect(sourcesSummary.files).toHaveProperty('total');
    expect(sourcesSummary.files).toHaveProperty('ready');
    expect(sourcesSummary.files).toHaveProperty('processing');
    expect(typeof sourcesSummary.files.total).toBe('number');
    expect(typeof sourcesSummary.files.ready).toBe('number');
    expect(typeof sourcesSummary.files.processing).toBe('number');
    // has_pending flag
    expect(sourcesSummary).toHaveProperty('has_pending');
    expect(typeof sourcesSummary.has_pending).toBe('boolean');
  });

  test('File management UI loads and displays key sections', async ({ page, request }) => {
    // 1. Resolve agent context
    const context = await resolveAgentContext(request);

    // 2. Complete KB setup via API (required for FileUploadManagement to show content)
    const kbSetupRes = await request.post(
      `${API_BASE}/api/v1/agent:kb-setup?agent_id=${context.agentId}`,
      {
        headers: { Authorization: `Bearer ${await loginByApi(request)}`, 'Content-Type': 'application/json' },
        data: {
          embedding_provider: 'jina',
          embedding_model: 'jina-embeddings-v3',
          jina_api_key: 'test_jina_key_for_e2e',
        },
      }
    );
    // KB setup may already be completed (409/400) or succeed (200)
    expect([200, 400, 409]).toContain(kbSetupRes.status());

    // 4. Login via UI (using locator approach compatible with current Login.tsx structure)
    await page.route('**/api/admin/login', async (route) => {
      await route.continue({ headers: { ...route.request().headers(), ...loginHeaders() } });
    });
    await page.goto('/login');
    // Login.tsx has styled labels not associated with inputs via id/for, so use locator approach
    await page.locator('input').first().fill(ADMIN_EMAIL);
    await page.locator('input').nth(1).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /login|登录|submit|提交/i }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/login/);

    // 5. Navigate to agent files page
    const filesRoute = agentRoute(context.agentId, 'files');
    await page.goto(filesRoute);
    await page.waitForLoadState('networkidle');

    // 6. Assert URL is correct
    await expect(page).toHaveURL(new RegExp(`/agents/${context.agentId}/files`));

    // 7. Assert page heading (File Upload / 文件上传) - use more specific locator to avoid sidebar h1
    const headingLocator = page.locator('h1').filter({
      hasText: /File Upload|文件上传/i
    });
    await expect(headingLocator).toBeVisible({ timeout: 10_000 });

    // 8. Assert upload section heading (Upload Files / 上传文件)
    const uploadSectionHeading = page.locator('h2').filter({
      hasText: /Upload Files|上传文件/i
    });
    await expect(uploadSectionHeading.first()).toBeVisible({ timeout: 10_000 });

    // 9. Assert file list section heading (File List / 文件列表)
    const fileListHeading = page.locator('h2').filter({
      hasText: /File List|文件列表/i
    });
    await expect(fileListHeading.first()).toBeVisible({ timeout: 10_000 });

    // 10. Assert dropzone text (drag and drop / 拖放文件)
    const dropzoneText = page.locator('p').filter({
      hasText: /drag and drop|拖放文件/i
    });
    await expect(dropzoneText.first()).toBeVisible({ timeout: 10_000 });

    // 11. Assert supported formats hint (PDF, TXT, etc.)
    const formatsHint = page.locator('p').filter({
      hasText: /PDF|TXT|JSON|CSV/i
    });
    await expect(formatsHint.first()).toBeVisible({ timeout: 10_000 });
  });
});