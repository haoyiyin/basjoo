/**
 * #60 — the widget says "answered from a saved FAQ" ONLY when a curated pair
 * actually answered.
 *
 * The `done` event carries `mode: 'scripted'` for two very different outcomes:
 *   - a keyword hit    → `matched_by: 'keyword'`, the pair's own answer;
 *   - a miss           → `matched_by: null`, the operator's `restricted_reply`.
 * Both are scripted (no model was called), but only the first is an answer from
 * the FAQ. Labelling the apology as "answered from a saved FAQ" would tell the
 * visitor something untrue, so `matched_by` is the discriminator.
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
  const BasjooWidget = (window as unknown as { BasjooWidget: WidgetConstructor })
    .BasjooWidget;
  return new BasjooWidget({
    agentId: 'agent-1',
    apiBase: 'http://localhost:8000',
    language,
  });
}

async function sendOne(widget: WidgetLike) {
  const input = document.querySelector('.basjoo-input') as HTMLInputElement;
  input.value = 'what is the refund window?';
  const sendBtn = document.querySelector('.basjoo-send') as HTMLButtonElement;
  sendBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('BasjooWidget scripted FAQ notice (#60)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
    window.localStorage.clear();
  });

  afterEach(() => {
    document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
    document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());
    vi.unstubAllGlobals();
  });

  it('shows the notice when a keyword pair answered', async () => {
    installFetch({
      message_id: 1,
      session_id: 'sess_1',
      mode: 'scripted',
      matched_by: 'keyword',
    });

    const widget = makeWidget('en-US');
    await widget.init();
    await sendOne(widget);

    const notice = document.querySelector('.basjoo-scripted') as HTMLElement;
    expect(notice).toBeTruthy();
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toContain('saved FAQ');
    expect(document.querySelector('.basjoo-messages')?.textContent).toContain(
      'Here is your answer.',
    );

    widget.destroy();
  });

  it('shows the Chinese copy in zh-CN', async () => {
    installFetch({
      message_id: 2,
      session_id: 'sess_2',
      mode: 'scripted',
      matched_by: 'keyword',
    });

    const widget = makeWidget('zh-CN');
    await widget.init();
    await sendOne(widget);

    const notice = document.querySelector('.basjoo-scripted') as HTMLElement;
    expect(notice).toBeTruthy();
    expect(notice.textContent).toContain('常见问题');

    widget.destroy();
  });

  it('shows NO notice on a scripted miss (the restricted reply is not a FAQ answer)', async () => {
    installFetch({
      message_id: 3,
      session_id: 'sess_3',
      mode: 'scripted',
      matched_by: null,
    });

    const widget = makeWidget('en-US');
    await widget.init();
    await sendOne(widget);

    expect(document.querySelector('.basjoo-scripted')).toBeNull();
    // The apology itself still reached the visitor.
    expect(document.querySelector('.basjoo-messages')?.textContent).toContain(
      'Here is your answer.',
    );

    widget.destroy();
  });

  it('shows no FAQ notice on a normal model answer', async () => {
    installFetch({ message_id: 4, session_id: 'sess_4', mode: 'ai' });

    const widget = makeWidget('en-US');
    await widget.init();
    await sendOne(widget);

    expect(document.querySelector('.basjoo-scripted')).toBeNull();

    widget.destroy();
  });
});
