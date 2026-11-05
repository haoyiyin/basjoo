/**
 * #70 — thumbs up / thumbs down on an assistant turn.
 *
 * The widget is a plain class that builds DOM imperatively, so these tests drive
 * the real `init()` against jsdom and assert on the rendered DOM plus the
 * requests the widget makes. `fetch` is stubbed because the assertions are about
 * the widget's contract with `POST /chat/feedback` (stored on the visitor turn's
 * `rating` column, see backend/tests/test_feedback.py), not about the backend.
 *
 * Contract pinned here:
 *   - a vote, then the SAME thumb again, then the OTHER thumb → 1, 0, -1;
 *   - a `human` turn renders no control (a vote on an operator's reply would be
 *     meaningless to the analytics rollup and the server rejects it with 409);
 *   - a `scripted` turn renders no control either (no model answered);
 *   - a reload paints the vote persisted on the visitor's turn.
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
  return {
    ok: true,
    status: 200,
    body: stream,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

function installFetch(options: {
  done?: Record<string, unknown>;
  history?: Array<Record<string, unknown>>;
} = {}) {
  const calls: Call[] = [];
  const {
    done = { message_id: 42, session_id: 'sess_1', mode: 'ai' },
    history = [],
  } = options;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });

    if (url.includes('/api/v1/config:public')) return jsonResponse(CONFIG);
    if (url.includes('/api/v1/chat/feedback')) return jsonResponse({ rating: 1, cleared: false });
    if (url.includes('/api/v1/chat/stream')) {
      return sseResponse([
        'event: sources\ndata: {"sources": []}',
        'event: content\ndata: {"content": "Here is your answer."}',
        `event: done\ndata: ${JSON.stringify(done)}`,
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

async function sendOne(text = 'what is the refund window?'): Promise<void> {
  const input = document.querySelector('.basjoo-input') as HTMLInputElement;
  input.value = text;
  (document.querySelector('.basjoo-send') as HTMLButtonElement).click();
  await new Promise((resolve) => setTimeout(resolve, 60));
}

function thumbs(): { row: HTMLElement | null; up: HTMLButtonElement | null; down: HTMLButtonElement | null } {
  const row = document.querySelector('.basjoo-feedback') as HTMLElement | null;
  return {
    row,
    up: document.querySelector('.basjoo-thumb-up') as HTMLButtonElement | null,
    down: document.querySelector('.basjoo-thumb-down') as HTMLButtonElement | null,
  };
}

function voteCalls(calls: Call[]): Call[] {
  return calls.filter((call) => call.url.includes('/api/v1/chat/feedback'));
}

describe('BasjooWidget thumbs feedback (#70)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
    window.localStorage.clear();
  });

  afterEach(() => {
    document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
    document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());
    vi.unstubAllGlobals();
  });

  it('renders a thumbs pair on an AI answer and posts 1, then 0 (clear), then -1 (flip)', async () => {
    const calls = installFetch();
    const widget = makeWidget('en-US');
    await widget.init();
    await sendOne();

    const { row, up, down } = thumbs();
    expect(row, 'an AI answer must offer a vote').not.toBeNull();
    expect(up).not.toBeNull();
    expect(down).not.toBeNull();
    expect(row?.getAttribute('data-message-id')).toBe('42');
    // The labels are ours, and they are localized.
    expect(up?.getAttribute('aria-label')).toBe('Helpful');
    expect(down?.getAttribute('aria-label')).toBe('Not helpful');
    // Nothing is voted yet.
    expect(up?.getAttribute('aria-pressed')).toBe('false');
    expect(down?.getAttribute('aria-pressed')).toBe('false');

    // Click 👍 → value 1.
    up?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    let votes = voteCalls(calls);
    expect(votes).toHaveLength(1);
    const first = new URL(votes[0].url);
    expect(first.pathname).toBe('/api/v1/chat/feedback');
    expect(first.searchParams.get('session_id')).toBe('sess_1');
    expect(first.searchParams.get('message_id')).toBe('42');
    expect(first.searchParams.get('visitor_id')).toMatch(/^visitor_/);
    expect(votes[0].body).toEqual({ value: 1 });
    expect(up?.getAttribute('aria-pressed')).toBe('true');
    expect(row?.getAttribute('data-rating')).toBe('1');

    // Click 👍 again (the ACTIVE vote) → 0, the vote is cleared.
    up?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    votes = voteCalls(calls);
    expect(votes).toHaveLength(2);
    expect(votes[1].body).toEqual({ value: 0 });
    expect(up?.getAttribute('aria-pressed')).toBe('false');
    expect(down?.getAttribute('aria-pressed')).toBe('false');
    expect(row?.getAttribute('data-rating')).toBe('0');

    // Click 👎 (the other thumb) → -1, a flip rather than a clear.
    down?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    votes = voteCalls(calls);
    expect(votes).toHaveLength(3);
    expect(votes[2].body).toEqual({ value: -1 });
    expect(down?.getAttribute('aria-pressed')).toBe('true');
    expect(up?.getAttribute('aria-pressed')).toBe('false');

    widget.destroy();
  });

  it('renders NO control on a human (operator) turn', async () => {
    const calls = installFetch({
      done: { message_id: 7, session_id: 'sess_1', mode: 'human', taken_over: false },
    });
    const widget = makeWidget('en-US');
    await widget.init();
    await sendOne();

    // The answer did render…
    expect(document.querySelector('.basjoo-messages')?.textContent).toContain('Here is your answer.');
    // …but a vote on an operator's reply is not offered.
    expect(document.querySelector('.basjoo-feedback')).toBeNull();
    expect(document.querySelector('.basjoo-thumb-up')).toBeNull();
    expect(document.querySelector('.basjoo-thumb-down')).toBeNull();
    expect(voteCalls(calls)).toHaveLength(0);

    widget.destroy();
  });

  it('renders NO control on a scripted (curated FAQ) turn', async () => {
    installFetch({
      done: { message_id: 8, session_id: 'sess_1', mode: 'scripted', matched_by: 'keyword' },
    });
    const widget = makeWidget('en-US');
    await widget.init();
    await sendOne();

    expect(document.querySelector('.basjoo-scripted')).toBeTruthy();
    expect(document.querySelector('.basjoo-feedback')).toBeNull();

    widget.destroy();
  });

  it('paints the vote persisted on the visitor turn after a reload', async () => {
    // The server stores the thumbs on the *user* row (`rating`), so the answer
    // below it inherits the vote for display.
    installFetch({
      history: [
        { id: 1, role: 'user', content: 'Where is my order?', sources: [], rating: -1, sender_type: null },
        { id: 2, role: 'assistant', content: 'It shipped yesterday.', sources: [], rating: 0, sender_type: 'agent' },
      ],
    });

    window.localStorage.setItem('basjoo_session_agent-1', 'sess_1');
    const widget = makeWidget('en-US');
    await widget.init();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const { up, down, row } = thumbs();
    expect(row).not.toBeNull();
    expect(row?.getAttribute('data-rating')).toBe('-1');
    expect(down?.getAttribute('aria-pressed')).toBe('true');
    expect(up?.getAttribute('aria-pressed')).toBe('false');

    widget.destroy();
  });

  it('renders NO control on a reloaded human reply', async () => {
    installFetch({
      history: [
        { id: 1, role: 'user', content: 'Hello?', sources: [], rating: 0, sender_type: null },
        { id: 2, role: 'assistant', content: 'Hi, this is Sam.', sources: [], rating: 0, sender_type: 'human' },
      ],
    });

    window.localStorage.setItem('basjoo_session_agent-1', 'sess_1');
    const widget = makeWidget('en-US');
    await widget.init();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(document.querySelector('.basjoo-feedback')).toBeNull();

    widget.destroy();
  });

  it('uses the Chinese copy in zh-CN', async () => {
    installFetch();
    const widget = makeWidget('zh-CN');
    await widget.init();
    await sendOne();

    const { up, down } = thumbs();
    expect(up?.getAttribute('aria-label')).toBe('有帮助');
    expect(down?.getAttribute('aria-label')).toBe('没有帮助');

    widget.destroy();
  });
});
