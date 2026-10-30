/**
 * #46 — signed visitor identity in the widget.
 *
 * The host application holds the secret and computes `hmac_sha256(secret,
 * email)` on its own server. It then calls `window.Basjoo.identify({ email,
 * hash })`. These tests drive the real `init()` against jsdom and assert what
 * crosses the wire: the `visitor_id` the widget sends is `email:hash`, the
 * second "device" resumes the thread the server reports for that identity, and
 * a rejected identity produces a readable sentence instead of a bare 403.
 *
 * The backend half lives in backend/tests/test_visitor_identity.py.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import './BasjooWidget';

interface WidgetLike {
  init(): Promise<void>;
  destroy(): void;
  sessionId: string | null;
}

type WidgetConstructor = new (config: {
  agentId: string;
  apiBase?: string;
  language?: string;
}) => WidgetLike;

interface BasjooHandle {
  identify(identity: { email?: string; hash?: string } | null): void;
  init(config: { agentId: string; apiBase?: string; language?: string }): WidgetLike;
}

const EMAIL = 'ada@example.com';
const HASH = 'a'.repeat(64);
const SIGNED = `${EMAIL}:${HASH}`;

const CONFIG = {
  widget_title: 'Support',
  widget_color: '#F9CA02',
  welcome_message: 'Hi',
  online: true,
  identity_required: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function sseResponse(events: string[]): Response {
  const body = events.map((event) => `${event}\n\n`).join('');
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    body: stream,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

interface Call {
  url: string;
  body?: unknown;
}

/**
 * Stub fetch for the identity flow.
 *
 * `currentSession` is what `/chat/session:current` answers — the server's view
 * of "which thread belongs to this identity", which is precisely the thing a
 * second device cannot know on its own.
 */
function installFetch(options: {
  config?: Record<string, unknown>;
  currentSession?: string | null;
  chatStatus?: number;
  chatBody?: unknown;
  streamEvents?: string[];
} = {}) {
  const calls: Call[] = [];
  const {
    config = CONFIG,
    currentSession = null,
    chatStatus = 200,
    chatBody = {},
    streamEvents,
  } = options;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });

    if (url.includes('/api/v1/config:public')) {
      return jsonResponse(config);
    }
    if (url.includes('/api/v1/chat/session:current')) {
      return jsonResponse({ session_id: currentSession, status: null, mode: null });
    }
    if (url.includes('/api/v1/chat/stream')) {
      if (streamEvents) {
        return sseResponse(streamEvents);
      }
      return jsonResponse(chatBody, chatStatus);
    }
    if (url.includes('/api/v1/chat/messages')) {
      return jsonResponse([
        { id: 1, role: 'user', content: 'my order number is 4471', sources: [] },
        { id: 2, role: 'assistant', content: 'Thanks, I have noted it.', sources: [] },
      ]);
    }
    if (url.includes('/api/v1/chat/escalate')) {
      return jsonResponse({ success: true, session_id: 'sess_1', status: 'active', mode: 'human' });
    }
    return jsonResponse({}, 404);
  });

  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function basjoo(): BasjooHandle {
  return (window as unknown as { Basjoo: BasjooHandle }).Basjoo;
}

function makeWidget(language = 'en-US'): WidgetLike {
  const BasjooWidget = (window as unknown as { BasjooWidget: WidgetConstructor }).BasjooWidget;
  return new BasjooWidget({ agentId: 'agent-1', apiBase: 'http://localhost:8000', language });
}

async function sendOne(text = 'where is my order?') {
  const input = document.querySelector('.basjoo-input') as HTMLInputElement;
  input.value = text;
  (document.querySelector('.basjoo-send') as HTMLButtonElement).click();
  await new Promise((resolve) => setTimeout(resolve, 60));
}

describe('BasjooWidget signed identity (#46)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
    window.localStorage.clear();
  });

  afterEach(() => {
    document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
    document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());
    vi.unstubAllGlobals();
  });

  it('sends `email:hash` as visitor_id once the host page identifies the visitor', async () => {
    const calls = installFetch({
      streamEvents: ['event: done\ndata: {"message_id": 1, "session_id": "sess_new"}'],
    });

    const widget = makeWidget();
    await widget.init();

    basjoo().identify({ email: EMAIL, hash: HASH });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await sendOne();

    const streamCall = calls.find((call) => call.url.includes('/api/v1/chat/stream'));
    expect(streamCall).toBeTruthy();
    // The signed identity *is* the visitor id — no join table, no accounts.
    expect((streamCall?.body as { visitor_id?: string }).visitor_id).toBe(SIGNED);

    // And it survives a reload under the same storage key the widget always used.
    expect(window.localStorage.getItem('basjoo_visitor_id')).toBe(SIGNED);

    widget.destroy();
  });

  it('normalises the email the same way the server does', async () => {
    const calls = installFetch({
      streamEvents: ['event: done\ndata: {"message_id": 1, "session_id": "sess_new"}'],
    });

    const widget = makeWidget();
    await widget.init();

    basjoo().identify({ email: '  Ada@Example.COM ', hash: HASH.toUpperCase() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await sendOne();

    const streamCall = calls.find((call) => call.url.includes('/api/v1/chat/stream'));
    expect((streamCall?.body as { visitor_id?: string }).visitor_id).toBe(SIGNED);

    widget.destroy();
  });

  it('resumes the server-reported session on a second device', async () => {
    // Nothing in localStorage: this is a fresh browser for a known person.
    const calls = installFetch({ currentSession: 'sess_returning' });

    const widget = makeWidget();
    await widget.init();

    expect(widget.sessionId).toBeNull();

    basjoo().identify({ email: EMAIL, hash: HASH });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The widget asked the server which session belongs to this identity…
    const resumeCall = calls.find((call) => call.url.includes('/chat/session:current'));
    expect(resumeCall).toBeTruthy();
    expect(resumeCall?.url).toContain(`visitor_id=${encodeURIComponent(SIGNED)}`);

    // …adopted it, cached it, and painted the transcript from device 1.
    expect(widget.sessionId).toBe('sess_returning');
    expect(window.localStorage.getItem('basjoo_session_agent-1')).toBe('sess_returning');
    const messages = document.querySelector('.basjoo-messages')?.textContent || '';
    expect(messages).toContain('my order number is 4471');

    widget.destroy();
  });

  it('resumes on load when a signed identity was persisted by an earlier visit', async () => {
    window.localStorage.setItem('basjoo_visitor_id', SIGNED);
    const calls = installFetch({ currentSession: 'sess_returning' });

    const widget = makeWidget();
    await widget.init();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls.some((call) => call.url.includes('/chat/session:current'))).toBe(true);
    expect(widget.sessionId).toBe('sess_returning');

    widget.destroy();
  });

  it('renders a readable sentence, not a bare 403, when the identity is rejected', async () => {
    installFetch({
      streamEvents: [
        'event: error\ndata: {"error": "Your identity could not be verified. Refresh the page or sign in again.", "code": "identity_mismatch"}',
      ],
    });

    const widget = makeWidget('en-US');
    await widget.init();
    basjoo().identify({ email: EMAIL, hash: HASH });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await sendOne();

    const error = document.querySelector('.basjoo-error') as HTMLElement;
    expect(error).toBeTruthy();
    expect(error.textContent).toBe(
      'We could not verify your identity. Please refresh the page and sign in again.',
    );
    // The raw machine code is not what a visitor reads.
    expect(error.textContent).not.toContain('identity_mismatch');
    expect(error.textContent).not.toContain('403');

    widget.destroy();
  });

  it('explains the same rejection in Chinese', async () => {
    installFetch({
      streamEvents: [
        'event: error\ndata: {"error": "nope", "code": "identity_mismatch"}',
      ],
    });

    const widget = makeWidget('zh-CN');
    await widget.init();
    basjoo().identify({ email: EMAIL, hash: HASH });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await sendOne();

    const error = document.querySelector('.basjoo-error') as HTMLElement;
    expect(error.textContent).toBe('无法验证您的身份，请刷新页面并重新登录。');

    widget.destroy();
  });

  it('explains a rejected identity on the handoff route too, not the generic failure', async () => {
    // `/chat/escalate` is not the SSE surface: the code arrives as a JSON
    // `detail`, so without mapping it the visitor would read "Could not reach a
    // human agent" for what is really "sign in again".
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/v1/config:public')) {
          return jsonResponse(CONFIG);
        }
        if (url.includes('/api/v1/chat/escalate')) {
          return jsonResponse({ detail: 'identity_mismatch' }, 403);
        }
        if (url.includes('/api/v1/chat/messages')) {
          return jsonResponse([]);
        }
        return jsonResponse({}, 404);
      }),
    );

    const widget = makeWidget('en-US');
    await widget.init();

    basjoo().identify({ email: EMAIL, hash: HASH });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // `identify()` drops any cached session (a different person may be using
    // this browser), so the handoff target is seeded afterwards, like a visitor
    // who has already sent a message with this identity.
    widget.sessionId = 'sess_1';

    (document.querySelector('.basjoo-human') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const error = document.querySelector('.basjoo-error') as HTMLElement;
    expect(error).toBeTruthy();
    expect(error.textContent).toBe(
      'We could not verify your identity. Please refresh the page and sign in again.',
    );
    expect(error.textContent).not.toContain('human agent');

    widget.destroy();
  });

  it('asks the visitor to sign in instead of sending when the agent signs visitors', async () => {
    const calls = installFetch({});
    const widget = makeWidget('en-US');
    await widget.init();

    // No identify() call: the agent requires a signature, so the composer is
    // closed with a sentence rather than a 403 after the visitor typed.
    const away = document.querySelector('.basjoo-away') as HTMLElement;
    expect(away).toBeTruthy();
    expect(away.textContent).toBe('Please sign in on this page to start chatting.');
    expect((document.querySelector('.basjoo-input-area') as HTMLElement).hidden).toBe(true);

    // identify() opens it again, with no reload.
    basjoo().identify({ email: EMAIL, hash: HASH });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector('.basjoo-away')).toBeNull();
    expect((document.querySelector('.basjoo-input-area') as HTMLElement).hidden).toBe(false);
    expect(calls.some((call) => call.url.includes('/chat/stream'))).toBe(false);

    widget.destroy();
  });

  it('leaves an unsigned agent exactly as it was', async () => {
    const calls = installFetch({ config: { ...CONFIG, identity_required: false } });

    const widget = makeWidget('en-US');
    await widget.init();

    // No identity needed: the composer is open and no resume lookup happens.
    expect(document.querySelector('.basjoo-away')).toBeNull();
    expect((document.querySelector('.basjoo-input-area') as HTMLElement).hidden).toBe(false);
    expect(calls.some((call) => call.url.includes('/chat/session:current'))).toBe(false);

    await sendOne();

    const streamCall = calls.find((call) => call.url.includes('/api/v1/chat/stream'));
    expect((streamCall?.body as { visitor_id?: string }).visitor_id).toMatch(/^visitor_/);

    widget.destroy();
  });

  it('accepts an identity before the widget mounts', async () => {
    const calls = installFetch({
      streamEvents: ['event: done\ndata: {"message_id": 1, "session_id": "sess_new"}'],
    });

    // The host page identifies on load; the server-rendered loader mounts later.
    basjoo().identify({ email: EMAIL, hash: HASH });

    const widget = makeWidget('en-US');
    await widget.init();
    await sendOne();

    const streamCall = calls.find((call) => call.url.includes('/api/v1/chat/stream'));
    expect((streamCall?.body as { visitor_id?: string }).visitor_id).toBe(SIGNED);

    widget.destroy();
  });

  it('ignores an incomplete identity instead of sending a value the server will reject', async () => {
    const calls = installFetch({
      streamEvents: ['event: done\ndata: {"message_id": 1, "session_id": "sess_new"}'],
    });

    const widget = makeWidget('en-US');
    await widget.init();

    basjoo().identify({ email: EMAIL });
    basjoo().identify({ hash: HASH });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await sendOne();

    const streamCall = calls.find((call) => call.url.includes('/api/v1/chat/stream'));
    expect((streamCall?.body as { visitor_id?: string }).visitor_id).toMatch(/^visitor_/);

    widget.destroy();
  });

  it('drops the cached session when the identity changes, and again on logout', async () => {
    const calls = installFetch({ currentSession: 'sess_returning' });

    const widget = makeWidget('en-US');
    await widget.init();
    window.localStorage.setItem('basjoo_session_agent-1', 'sess_previous');
    widget.sessionId = 'sess_previous';

    basjoo().identify({ email: EMAIL, hash: HASH });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(widget.sessionId).toBe('sess_returning');

    // A different person logs in on the same browser: the old thread must not
    // leak and the visitor id must change with them.
    basjoo().identify({ email: 'grace@example.com', hash: 'b'.repeat(64) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const lastResume = calls.filter((call) => call.url.includes('/chat/session:current')).pop();
    expect(lastResume?.url).toContain(encodeURIComponent(`grace@example.com:${'b'.repeat(64)}`));

    // Logout forgets the identity entirely.
    basjoo().identify(null);
    const anonymous = window.localStorage.getItem('basjoo_visitor_id') || '';
    expect(anonymous).toMatch(/^visitor_/);

    widget.destroy();
  });
});
