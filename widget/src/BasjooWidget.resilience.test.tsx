/**
 * Malformed-event and transient-failure resilience for the widget.
 *
 * Two contracts pinned here:
 *
 *   - a single malformed SSE frame must not tear down the stream. The visitor
 *     keeps the content already received and a later `done` still finalizes it;
 *     the old code let `JSON.parse` throw out of `consumeStream`, discarding a
 *     partial answer and showing the generic "Send failed" line.
 *   - a history load that fails transiently (network, 5xx) must NOT discard the
 *     stored session. Only an explicit 404 — the session is unknown or foreign —
 *     resets it; otherwise a flaky network silently drops the visitor's thread
 *     and the next turn opens a new one.
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
  welcome_message: 'Hi',
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
  return { ok: true, status: 200, body: stream, json: async () => ({}), text: async () => body } as unknown as Response;
}

function installFetch(options: { streamEvents?: string[] } = {}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (url.includes('/api/v1/config:public')) return jsonResponse(CONFIG);
    if (url.includes('/api/v1/chat/stream')) {
      return sseResponse(
        options.streamEvents ?? [
          'event: sources\ndata: {"sources": []}',
          'event: content\ndata: {"content": "Got it."}',
          'event: done\ndata: {"message_id": 5, "session_id": "sess_1", "mode": "ai"}',
        ],
      );
    }
    if (url.includes('/api/v1/chat/messages')) return jsonResponse([]);
    return jsonResponse({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function makeWidget(language = 'en-US'): WidgetLike {
  const BasjooWidget = (window as unknown as { BasjooWidget: WidgetConstructor }).BasjooWidget;
  return new BasjooWidget({ agentId: 'agent-1', apiBase: 'http://localhost:8000', language });
}

async function sendOne(text = 'hello'): Promise<void> {
  const input = document.querySelector('.basjoo-input') as HTMLInputElement;
  input.value = text;
  (document.querySelector('.basjoo-send') as HTMLButtonElement).click();
  await new Promise((resolve) => setTimeout(resolve, 70));
}

describe('BasjooWidget malformed stream events', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
    window.localStorage.clear();
  });

  afterEach(() => {
    document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
    document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());
    vi.unstubAllGlobals();
  });

  it('ignores one malformed data frame and still finalizes the answer', async () => {
    installFetch({
      streamEvents: [
        'event: content\ndata: {"content": "Hi"}',
        'event: content\ndata: {this is not json',
        'event: done\ndata: {"message_id": 1, "session_id": "s1", "mode": "ai"}',
      ],
    });
    const widget = makeWidget();
    await widget.init();
    await sendOne();

    expect(document.querySelector('.basjoo-error')).toBeNull();
    expect(document.querySelector('.basjoo-messages')?.textContent).toContain('Hi');

    widget.destroy();
  });

  it('ignores an unknown event name and keeps reading', async () => {
    installFetch({
      streamEvents: [
        'event: content\ndata: {"content": "Hi"}',
        'event: telemetry\ndata: {"whatever": 1}',
        'event: done\ndata: {"message_id": 1, "session_id": "s1", "mode": "ai"}',
      ],
    });
    const widget = makeWidget();
    await widget.init();
    await sendOne();

    expect(document.querySelector('.basjoo-error')).toBeNull();
    expect(document.querySelector('.basjoo-messages')?.textContent).toContain('Hi');

    widget.destroy();
  });
});

describe('BasjooWidget history-load resilience', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
    window.localStorage.clear();
    window.localStorage.setItem('basjoo_visitor_id', 'visitor_test');
    window.localStorage.setItem('basjoo_session_agent-1', 'sess_keep');
  });

  afterEach(() => {
    document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
    document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());
    vi.unstubAllGlobals();
  });

  function installHistoryFetch(mode: 'network' | number) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/v1/config:public')) return jsonResponse(CONFIG);
        if (url.includes('/api/v1/chat/messages')) {
          if (mode === 'network') throw new TypeError('Failed to fetch');
          return jsonResponse({ detail: 'boom' }, mode);
        }
        return jsonResponse({}, 404);
      }),
    );
  }

  it('keeps the session when the history request fails at the network level', async () => {
    installHistoryFetch('network');
    const widget = makeWidget();
    await widget.init();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect((widget as unknown as { sessionId: string | null }).sessionId).toBe('sess_keep');
    expect(window.localStorage.getItem('basjoo_session_agent-1')).toBe('sess_keep');

    widget.destroy();
  });

  it('keeps the session when history answers 500', async () => {
    installHistoryFetch(500);
    const widget = makeWidget();
    await widget.init();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect((widget as unknown as { sessionId: string | null }).sessionId).toBe('sess_keep');
    expect(window.localStorage.getItem('basjoo_session_agent-1')).toBe('sess_keep');

    widget.destroy();
  });

  it('still drops the session when history answers 404', async () => {
    installHistoryFetch(404);
    const widget = makeWidget();
    await widget.init();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect((widget as unknown as { sessionId: string | null }).sessionId).toBeNull();
    expect(window.localStorage.getItem('basjoo_session_agent-1')).toBeNull();

    widget.destroy();
  });
});
