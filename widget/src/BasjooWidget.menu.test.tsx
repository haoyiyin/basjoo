/**
 * #75 — the visitor menu in the widget header: "New chat" and "End chat".
 *
 * Both are session-scoped actions, so both are disabled until the session has at
 * least one real turn (the rendered welcome greeting is not a turn and must not
 * unlock them). "New chat" clears ONLY `basjoo_session_<agentId>` — the visitor
 * id survives, because the visitor is the same person. "End chat" closes the
 * session server-side (`POST /chat/session:end`) and only then clears the stored
 * id, so a failed request leaves the visitor on their existing thread.
 *
 * The backend half lives in backend/tests/test_session_end.py.
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

interface Call {
  url: string;
  body?: unknown;
}

const CONFIG = {
  widget_title: 'Support',
  widget_color: '#F9CA02',
  welcome_message: 'Hi there',
  online: true,
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

function installFetch(options: { endStatus?: number; history?: Array<Record<string, unknown>> } = {}) {
  const calls: Call[] = [];
  const { endStatus = 200, history = [] } = options;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });

    if (url.includes('/api/v1/config:public')) return jsonResponse(CONFIG);
    if (url.includes('/api/v1/chat/session:end')) {
      if (endStatus !== 200) return jsonResponse({ detail: 'nope' }, endStatus);
      return jsonResponse({ success: true, session_id: 'sess_1', status: 'closed', closed_by: 'visitor' });
    }
    if (url.includes('/api/v1/chat/stream')) {
      return sseResponse([
        'event: sources\ndata: {"sources": []}',
        'event: content\ndata: {"content": "Sure thing."}',
        'event: done\ndata: {"message_id": 3, "session_id": "sess_1", "mode": "ai"}',
      ]);
    }
    if (url.includes('/api/v1/chat/messages')) return jsonResponse(history);
    return jsonResponse({}, 404);
  });

  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function makeWidget(language = 'en-US'): WidgetLike {
  const BasjooWidget = (window as unknown as { BasjooWidget: WidgetConstructor }).BasjooWidget;
  return new BasjooWidget({ agentId: 'agent-1', apiBase: 'http://localhost:8000', language });
}

function menuToggle(): HTMLButtonElement {
  return document.querySelector('.basjoo-menu-toggle') as HTMLButtonElement;
}

function menu(): HTMLElement {
  return document.querySelector('.basjoo-menu') as HTMLElement;
}

function newChatBtn(): HTMLButtonElement {
  return document.querySelector('.basjoo-new-chat') as HTMLButtonElement;
}

function endChatBtn(): HTMLButtonElement {
  return document.querySelector('.basjoo-end-chat') as HTMLButtonElement;
}

async function sendOne(text = 'hello'): Promise<void> {
  const input = document.querySelector('.basjoo-input') as HTMLInputElement;
  input.value = text;
  (document.querySelector('.basjoo-send') as HTMLButtonElement).click();
  await new Promise((resolve) => setTimeout(resolve, 60));
}

describe('BasjooWidget visitor menu (#75)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
    window.localStorage.clear();
  });

  afterEach(() => {
    document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
    document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());
    vi.unstubAllGlobals();
  });

  it('renders a three-dots control beside the handoff button, labelled in both locales', async () => {
    installFetch();

    const zh = makeWidget('zh-CN');
    await zh.init();
    expect(menuToggle()).toBeTruthy();
    expect(menuToggle().getAttribute('aria-label')).toBe('对话选项');
    expect(newChatBtn().textContent).toBe('新对话');
    expect(endChatBtn().textContent).toBe('结束对话');
    // It sits in the header, next to the human-handoff button.
    expect(document.querySelector('.basjoo-header .basjoo-human')).toBeTruthy();
    expect(document.querySelector('.basjoo-header .basjoo-menu-toggle')).toBeTruthy();
    zh.destroy();

    document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
    document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());

    const en = makeWidget('en-US');
    await en.init();
    expect(menuToggle().getAttribute('aria-label')).toBe('Chat options');
    expect(newChatBtn().textContent).toBe('New chat');
    expect(endChatBtn().textContent).toBe('End chat');
    en.destroy();
  });

  it('disables both actions until the session has a message', async () => {
    installFetch();
    const widget = makeWidget('en-US');
    await widget.init();

    // The welcome greeting is rendered but is not a turn.
    expect(document.querySelector('.basjoo-messages')?.textContent).toContain('Hi there');
    expect(newChatBtn().disabled).toBe(true);
    expect(endChatBtn().disabled).toBe(true);

    await sendOne('now I have said something');

    expect(newChatBtn().disabled).toBe(false);
    expect(endChatBtn().disabled).toBe(false);

    widget.destroy();
  });

  it('toggles the panel open and closed', async () => {
    installFetch();
    const widget = makeWidget('en-US');
    await widget.init();

    expect(menu().hidden).toBe(true);
    expect(menuToggle().getAttribute('aria-expanded')).toBe('false');

    menuToggle().click();
    expect(menu().hidden).toBe(false);
    expect(menuToggle().getAttribute('aria-expanded')).toBe('true');

    menuToggle().click();
    expect(menu().hidden).toBe(true);
    expect(menuToggle().getAttribute('aria-expanded')).toBe('false');

    widget.destroy();
  });

  it('End chat posts session:end with the agent id, session id and visitor id, then clears the stored session', async () => {
    const calls = installFetch();
    window.localStorage.setItem('basjoo_visitor_id', 'visitor_keep');
    const widget = makeWidget('en-US');
    await widget.init();
    await sendOne('hello');

    // The stream's session id landed in storage.
    expect(window.localStorage.getItem('basjoo_session_agent-1')).toBe('sess_1');
    expect(window.localStorage.getItem('basjoo_visitor_id')).toBe('visitor_keep');

    menuToggle().click();
    endChatBtn().click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const endCall = calls.find((call) => call.url.includes('/api/v1/chat/session:end'));
    expect(endCall, 'End chat must call the route').toBeTruthy();
    // The backend requires all three: a body without `agent_id` answers
  // 400 `Missing agent_id, session_id or visitor_id`, so this assertion is the
  // regression guard for that exact defect.
  expect(endCall?.body).toEqual({
    agent_id: 'agent-1',
    session_id: 'sess_1',
    visitor_id: 'visitor_keep',
  });

    // The stored session is gone; the visitor identity survives.
    expect(window.localStorage.getItem('basjoo_session_agent-1')).toBeNull();
    expect(window.localStorage.getItem('basjoo_visitor_id')).toBe('visitor_keep');
    // The transcript is reset to the greeting, and the menu locks again.
    expect(document.querySelectorAll('.basjoo-message')).toHaveLength(1);
    expect(newChatBtn().disabled).toBe(true);
    expect(endChatBtn().disabled).toBe(true);

    widget.destroy();
  });

  it('End chat keeps the session when the route refuses', async () => {
    installFetch({ endStatus: 500 });
    window.localStorage.setItem('basjoo_visitor_id', 'visitor_keep');
    const widget = makeWidget('en-US');
    await widget.init();
    await sendOne('hello');

    menuToggle().click();
    endChatBtn().click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    // The local id is cleared only after the server accepts.
    expect(window.localStorage.getItem('basjoo_session_agent-1')).toBe('sess_1');
    const error = document.querySelector('.basjoo-error') as HTMLElement | null;
    expect(error?.textContent).toBe('Could not end the chat. Please try again.');

    widget.destroy();
  });

  it('New chat clears only the session key and keeps the visitor id', async () => {
    installFetch();
    window.localStorage.setItem('basjoo_visitor_id', 'visitor_keep');
    const widget = makeWidget('en-US');
    await widget.init();
    await sendOne('hello');

    expect(window.localStorage.getItem('basjoo_session_agent-1')).toBe('sess_1');

    menuToggle().click();
    newChatBtn().click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(window.localStorage.getItem('basjoo_session_agent-1')).toBeNull();
    // The SAME visitor: clearing this would make them a brand-new arrival.
    expect(window.localStorage.getItem('basjoo_visitor_id')).toBe('visitor_keep');
    // Back to a single greeting row.
    expect(document.querySelectorAll('.basjoo-message')).toHaveLength(1);
    expect(document.querySelector('.basjoo-messages')?.textContent).toContain('Hi there');

    widget.destroy();
  });

  it('unlocks both actions on a reloaded thread with history', async () => {
    installFetch({
      history: [
        { id: 1, role: 'user', content: 'Where is my order?', sources: [], rating: 0, sender_type: null },
        { id: 2, role: 'assistant', content: 'It shipped yesterday.', sources: [], rating: 0, sender_type: 'agent' },
      ],
    });

    window.localStorage.setItem('basjoo_session_agent-1', 'sess_1');
    const widget = makeWidget('en-US');
    await widget.init();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(newChatBtn().disabled).toBe(false);
    expect(endChatBtn().disabled).toBe(false);

    widget.destroy();
  });
});
