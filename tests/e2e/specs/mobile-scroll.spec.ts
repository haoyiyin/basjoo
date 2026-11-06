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
import {
  loginByApiWithAdmin,
  getDefaultAgent,
} from '../fixtures/e2e-context';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

test.describe('mobile scroll sweep (375×667)', () => {
  test('every route scrolls as one surface', async ({ page, request }) => {
    // Authenticate through the shared API helper (absolute API_BASE) instead of a
    // dashboard-relative path, then seed localStorage exactly the way
    // AuthContext.persistSession() writes it: token plus JSON-stringified admin.
    const { token, admin } = await loginByApiWithAdmin(request);

    await page.addInitScript(
      ([storedToken, storedAdmin]) => {
        localStorage.setItem('token', storedToken);
        localStorage.setItem('admin', storedAdmin);
        localStorage.setItem('basjoo_locale', 'zh-CN');
      },
      [token, JSON.stringify(admin)],
    );

    const agent = await getDefaultAgent(request, token);
    const agentId = agent.id;

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
      // The documented contract only pins the last control to the viewport on the
      // playground settings tab. Other routes (e.g. /settings/account, whose
      // trailing content is an action-less empty state) have no control at the
      // page bottom, so the "last control" heuristic does not apply there.
      if (route.includes('tab=settings') && metrics.lastTop !== null) {
        expect(metrics.lastTop, `${route} last control above viewport`).toBeGreaterThanOrEqual(0);
        expect(metrics.lastBottom, `${route} last control below viewport`).toBeLessThanOrEqual(667);
      }
    }
  });
});
