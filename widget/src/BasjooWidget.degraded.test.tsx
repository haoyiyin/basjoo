/**
 * #44 — the widget shows a notice when the fallback model answered.
 *
 * The SSE `done` event carries `degraded` (and the model name); the widget
 * renders one small informational line under the answer. It is not a message
 * and is never persisted — the visitor just learns why the answer may be
 * weaker than usual.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import './BasjooWidget';

interface WidgetLike {
  init(): Promise<void>;
  destroy(): void;
  sessionId: string | null;
}

type WidgetConstructor = new (config: { agentId: string; apiBase?: string; language?: string }) => WidgetLike;

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

/** A canned SSE body: sources → content → done (with the #44 flags). */
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

function installFetch(donePayload: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/v1/config:public')) {
      return jsonResponse(CONFIG);
    }
    if (url.includes('/api/v1/chat/stream')) {
      return sseResponse([
        'event: sources\ndata: {"sources": []}',
        'event: content\ndata: {"content": "Here is your answer."}',
        `event: done\ndata: ${JSON.stringify(donePayload)}`,
      ]);
    }
    if (url.includes('/api/v1/chat/messages')) {
      return jsonResponse([]);
    }
    return jsonResponse({}, 404);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function makeWidget(language: string): WidgetLike {
  const BasjooWidget = (window as unknown as { BasjooWidget: WidgetConstructor }).BasjooWidget;
  return new BasjooWidget({ agentId: 'agent-1', apiBase: 'http://localhost:8000', language });
}

async function sendOne(widget: WidgetLike) {
  const input = document.querySelector('.basjoo-input') as HTMLInputElement;
  input.value = 'what is the refund window?';
  const sendBtn = document.querySelector('.basjoo-send') as HTMLButtonElement;
  sendBtn.click();
  // Let the streamed turn settle.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('BasjooWidget degraded fallback notice (#44)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
    window.localStorage.clear();
  });

  afterEach(() => {
    document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
    document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());
    vi.unstubAllGlobals();
  });

  it('shows the notice with the model name when the done event is degraded', async () => {
    installFetch({
      message_id: 1,
      session_id: 'sess_1',
      degraded: true,
      model: 'cheap-fallback-model',
    });

    const widget = makeWidget('en-US');
    await widget.init();
    await sendOne(widget);

    const notice = document.querySelector('.basjoo-degraded') as HTMLElement;
    expect(notice).toBeTruthy();
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toContain('Quota reached');
    expect(notice.textContent).toContain('cheap-fallback-model');
    // The answer itself is still rendered — degrading is not failing.
    expect(document.querySelector('.basjoo-messages')?.textContent).toContain(
      'Here is your answer.',
    );

    widget.destroy();
  });

  it('shows the Chinese copy in zh-CN', async () => {
    installFetch({ message_id: 2, session_id: 'sess_2', degraded: true, model: null });

    const widget = makeWidget('zh-CN');
    await widget.init();
    await sendOne(widget);

    const notice = document.querySelector('.basjoo-degraded') as HTMLElement;
    expect(notice).toBeTruthy();
    expect(notice.textContent).toContain('额度用尽');
    // No model name was sent, so none is appended.
    expect(notice.textContent).not.toContain('·');

    widget.destroy();
  });

  it('renders no notice at all on a normal answer', async () => {
    installFetch({ message_id: 3, session_id: 'sess_3', degraded: false, model: 'primary' });

    const widget = makeWidget('en-US');
    await widget.init();
    await sendOne(widget);

    expect(document.querySelector('.basjoo-degraded')).toBeNull();

    widget.destroy();
  });
});
