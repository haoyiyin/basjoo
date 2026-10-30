/**
 * #62 — the widget has NO degraded / fallback-model notice any more.
 *
 * This file used to pin the #44 behaviour: the SSE `done` event carried
 * `degraded: true` (plus the fallback model's name) and the widget rendered a
 * "Quota reached — answering with the fallback model" line under the answer.
 * The daily quota and the #44 fallback model were both deleted, so the reverse
 * is now the contract:
 *
 *   - a `done` payload that still carries `degraded` / `model` is ignored;
 *   - no notice element of any kind is rendered over a normal model answer;
 *   - the retired copy never reaches the visitor, in either locale.
 *
 * The #60 scripted notice (`BasjooWidget.scripted.test.tsx`) is a different
 * feature and stays exactly as it was.
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

/** Every class the widget ever used for an informational answer notice. */
const NOTICE_SELECTORS = ['.basjoo-degraded', '.basjoo-scripted'];

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A canned SSE body: sources → content → done (carrying the retired flags). */
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

function expectNoNotice(): void {
  for (const selector of NOTICE_SELECTORS) {
    expect(document.querySelector(selector)).toBeNull();
  }
}

describe('BasjooWidget has no degraded notice (#62 removed #44)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
    window.localStorage.clear();
  });

  afterEach(() => {
    document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
    document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());
    vi.unstubAllGlobals();
  });

  it('ignores a done payload that still carries degraded + model', async () => {
    installFetch({
      message_id: 1,
      session_id: 'sess_1',
      degraded: true,
      model: 'cheap-fallback-model',
    });

    const widget = makeWidget('en-US');
    await widget.init();
    await sendOne(widget);

    expectNoNotice();
    // The answer itself is still rendered — the flag is simply dead.
    const transcript = document.querySelector('.basjoo-messages')?.textContent || '';
    expect(transcript).toContain('Here is your answer.');
    expect(transcript).not.toContain('Quota reached');
    expect(transcript).not.toContain('fallback model');
    // The retired model name is not echoed anywhere either.
    expect(transcript).not.toContain('cheap-fallback-model');

    widget.destroy();
  });

  it('renders no notice for the retired Chinese copy in zh-CN', async () => {
    installFetch({ message_id: 2, session_id: 'sess_2', degraded: true, model: null });

    const widget = makeWidget('zh-CN');
    await widget.init();
    await sendOne(widget);

    expectNoNotice();
    const transcript = document.querySelector('.basjoo-messages')?.textContent || '';
    expect(transcript).toContain('Here is your answer.');
    expect(transcript).not.toContain('额度用尽');
    expect(transcript).not.toContain('备用模型');

    widget.destroy();
  });

  it('renders no notice on a normal answer that carries no flags', async () => {
    installFetch({ message_id: 3, session_id: 'sess_3' });

    const widget = makeWidget('en-US');
    await widget.init();
    await sendOne(widget);

    expectNoNotice();
    expect(document.querySelector('.basjoo-messages')?.textContent).toContain(
      'Here is your answer.',
    );

    widget.destroy();
  });

  it('never ships the retired degraded styles or copy', async () => {
    installFetch({ message_id: 4, session_id: 'sess_4' });

    const widget = makeWidget('en-US');
    await widget.init();
    await sendOne(widget);

    const styles = document.querySelector('#basjoo-widget-styles')?.textContent || '';
    expect(styles).not.toBe('');
    expect(styles).not.toContain('.basjoo-degraded');
    // The #60 notice is a separate feature and keeps its own (renamed) style.
    expect(styles).toContain('.basjoo-scripted');

    widget.destroy();
  });
});
