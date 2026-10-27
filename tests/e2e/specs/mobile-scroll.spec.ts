/**
 * R1: at 375×667 the document is the only vertical scroller.
 *
 * The regression this pins: `<main>` + `.playground-shell` both carried
 * `overflow: auto` and a viewport-height floor, so a touch gesture landed in a
 * box that could move 1px and the page could not move at all. The contract:
 *  - no descendant of <main> is a second vertical scroll container;
 *  - scrolling to the bottom reaches `scrollHeight - innerHeight`;
 *  - on the playground settings tab the last control is inside the viewport.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'test@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpassword123';

test.describe('mobile scroll sweep (375×667)', () => {
  test('every route scrolls as one surface', async ({ page }) => {
    const loginResponse = await page.request.post('/api/admin/login', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(loginResponse.ok()).toBeTruthy();
    const session = (await loginResponse.json()) as {
      access_token: string;
      admin: unknown;
    };

    await page.addInitScript(
      ([token, admin]) => {
        localStorage.setItem('token', token);
        localStorage.setItem('admin', admin);
        localStorage.setItem('basjoo_locale', 'zh-CN');
      },
      [session.access_token, JSON.stringify(session.admin)],
    );

    const agentsResponse = await page.request.get('/api/v1/agents', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const agents = (await agentsResponse.json()) as {
      agents: Array<{ id: string }>;
    };
    const agentId = agents.agents[0]?.id;
    if (!agentId) throw new Error('E2E needs at least one agent');

    const routes = [
      '/agents',
      '/knowledge-bases',
      `/agents/${agentId}/dashboard`,
      `/agents/${agentId}/settings/agent`,
      `/agents/${agentId}/playground`,
      `/agents/${agentId}/playground?tab=settings`,
      `/agents/${agentId}/sessions`,
      '/settings/account',
    ];

    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      const metrics = await page.evaluate(() => {
        const scroller = document.scrollingElement as HTMLElement;
        const nested = Array.from(document.querySelectorAll('main *'))
          .filter((element) => {
            const style = getComputedStyle(element);
            return (
              /(auto|scroll)/.test(style.overflowY) &&
              element.scrollHeight > element.clientHeight + 1
            );
          })
          .map((element) => `${element.tagName}.${String(element.className).slice(0, 40)}`);

        window.scrollTo(0, scroller.scrollHeight);

        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            'main button, main input, main select, main textarea, main a[href], main [style*="cursor"]',
          ),
        ).filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        const last = controls[controls.length - 1]?.getBoundingClientRect();

        return {
          nested,
          max: scroller.scrollHeight - window.innerHeight,
          scrollY: window.scrollY,
          lastTop: last ? last.top : null,
          lastBottom: last ? last.bottom : null,
        };
      });

      expect(metrics.nested, `${route} has a nested vertical scroller`).toEqual([]);
      if (metrics.max > 0) {
        expect(metrics.scrollY, `${route} did not reach max scroll`).toBe(metrics.max);
      }
      if (metrics.lastTop !== null) {
        expect(metrics.lastTop).toBeGreaterThanOrEqual(0);
        expect(metrics.lastBottom).toBeLessThanOrEqual(667);
      }
    }
  });
});
