/**
 * #43 handoff affordances in the widget.
 *
 * The widget is a plain class that builds DOM imperatively, so these tests drive
 * the real `init()` against a jsdom document and assert on the rendered DOM plus
 * the requests the widget makes. `fetch` is stubbed: the assertions are about
 * the widget's contract with `/config:public`, `/chat/escalate` and
 * `/chat/release`, not about the backend (covered in backend/tests/test_handoff.py).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import './BasjooWidget';

interface WidgetLike {
  init(): Promise<void>;
  destroy(): void;
  sessionId: string | null;
}

type WidgetConstructor = new (config: { agentId: string; apiBase?: string; language?: string }) => WidgetLike;

const ONLINE_CONFIG = {
  widget_title: 'Support',
  widget_color: '#F9CA02',
  welcome_message: 'Hi',
  online: true,
  business_hours: { timezone: 'Asia/Shanghai', schedule: [{ day: 0, start: 540, end: 1080 }] },
  away_message: 'We are closed. Leave a note.',
};

const OFFLINE_CONFIG = {
  ...ONLINE_CONFIG,
  online: false,
  away_message: 'We are closed. Leave a note.',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Route every fetch the widget makes to a deterministic response. */
function installFetch(config: Record<string, unknown>) {
  const calls: Array<{ url: string; body?: unknown }> = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });

    if (url.includes('/api/v1/config:public')) {
      return jsonResponse(config);
    }
    if (url.includes('/api/v1/chat/escalate')) {
      return jsonResponse({ success: true, session_id: 'sess_1', status: 'active', mode: 'human' });
    }
    if (url.includes('/api/v1/chat/release')) {
      return jsonResponse({ success: true, session_id: 'sess_1', status: 'active', mode: 'ai' });
    }
    if (url.includes('/api/v1/chat/messages')) {
      return jsonResponse([]);
    }
    return jsonResponse({}, 404);
  });

  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function makeWidget(language: string): WidgetLike {
  const BasjooWidget = (window as unknown as { BasjooWidget: WidgetConstructor }).BasjooWidget;
  return new BasjooWidget({ agentId: 'agent-1', apiBase: 'http://localhost:8000', language });
}

describe('BasjooWidget human handoff (#43)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
    window.localStorage.clear();
  });

  afterEach(() => {
    document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
    document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());
    vi.unstubAllGlobals();
  });

  it('renders a labelled "Talk to a human" affordance in both locales', async () => {
    installFetch(ONLINE_CONFIG);

    const zh = makeWidget('zh-CN');
    await zh.init();
    const zhButton = document.querySelector('.basjoo-human') as HTMLButtonElement;
    expect(zhButton).toBeTruthy();
    expect(zhButton.getAttribute('aria-label')).toBe('转人工');
    expect(zhButton.textContent).toContain('转人工');
    zh.destroy();

    document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
    document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());

    const en = makeWidget('en-US');
    await en.init();
    const enButton = document.querySelector('.basjoo-human') as HTMLButtonElement;
    expect(enButton).toBeTruthy();
    expect(enButton.getAttribute('aria-label')).toBe('Talk to a human');
    expect(enButton.textContent).toContain('Talk to a human');
    en.destroy();
  });

  it('escalates with visitor_id and shows the notice bar with a Continue with AI button', async () => {
    const calls = installFetch(ONLINE_CONFIG);

    const widget = makeWidget('en-US');
    await widget.init();
    // The widget only escalates an existing session, so seed one.
    widget.sessionId = 'sess_1';
    window.localStorage.setItem('basjoo_session_agent-1', 'sess_1');

    const humanButton = document.querySelector('.basjoo-human') as HTMLButtonElement;
    humanButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const escalateCall = calls.find((call) => call.url.includes('/chat/escalate'));
    expect(escalateCall).toBeTruthy();
    expect(escalateCall?.body).toMatchObject({
      agent_id: 'agent-1',
      session_id: 'sess_1',
      visitor_id: expect.stringContaining('visitor_'),
    });

    const notice = document.querySelector('.basjoo-notice') as HTMLElement;
    expect(notice).toBeTruthy();
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('Continue with AI');
    expect(notice.textContent).toContain('human agent');

    // The header affordance is hidden while a human is expected.
    expect((document.querySelector('.basjoo-human') as HTMLButtonElement).hidden).toBe(true);

    const continueButton = document.querySelector('.basjoo-continue-ai') as HTMLButtonElement;
    continueButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const releaseCall = calls.find((call) => call.url.includes('/chat/release'));
    expect(releaseCall).toBeTruthy();
    expect(releaseCall?.body).toMatchObject({ session_id: 'sess_1', agent_id: 'agent-1' });

    // Back to AI: the notice is hidden and the affordance returns.
    expect((document.querySelector('.basjoo-notice') as HTMLElement).hidden).toBe(true);
    expect((document.querySelector('.basjoo-human') as HTMLButtonElement).hidden).toBe(false);

    widget.destroy();
  });

  it('replaces the composer with the away message and hides the human affordance when offline', async () => {
    installFetch(OFFLINE_CONFIG);

    const widget = makeWidget('en-US');
    await widget.init();

    const inputArea = document.querySelector('.basjoo-input-area') as HTMLElement;
    expect(inputArea.hidden).toBe(true);

    const away = document.querySelector('.basjoo-away') as HTMLElement;
    expect(away).toBeTruthy();
    expect(away.textContent).toBe('We are closed. Leave a note.');

    expect((document.querySelector('.basjoo-human') as HTMLButtonElement).hidden).toBe(true);

    widget.destroy();
  });

  it('flips to offline within one minute when the schedule closes', async () => {
    vi.useFakeTimers();
    try {
      let online = true;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes('/api/v1/config:public')) {
            return jsonResponse({ ...ONLINE_CONFIG, online });
          }
          if (url.includes('/api/v1/chat/messages')) return jsonResponse([]);
          return jsonResponse({}, 404);
        }),
      );

      const widget = makeWidget('en-US');
      await widget.init();

      expect((document.querySelector('.basjoo-input-area') as HTMLElement).hidden).toBe(false);

      // The closing time passes server-side; the next poll must pick it up.
      online = false;
      await vi.advanceTimersByTimeAsync(60_000);

      expect((document.querySelector('.basjoo-input-area') as HTMLElement).hidden).toBe(true);
      expect(document.querySelector('.basjoo-away')).toBeTruthy();
      expect((document.querySelector('.basjoo-human') as HTMLButtonElement).hidden).toBe(true);

      widget.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to a default away message when the agent has none', async () => {
    installFetch({ ...OFFLINE_CONFIG, away_message: null });

    const widget = makeWidget('en-US');
    await widget.init();

    const away = document.querySelector('.basjoo-away') as HTMLElement;
    expect(away.textContent).toBe(
      'We are away right now. Leave a message and we will get back to you.',
    );

    widget.destroy();
  });
});
