/**
 * #73 — the prechat form and the operator's AI disclosure.
 *
 * Two independent pieces of the same issue:
 *
 *   - `prechat_mode` (off | optional | required) decides whether the widget
 *     asks for a name and an e-mail before the first turn. `required` hides the
 *     composer until the form is submitted; `optional` also offers a skip.
 *   - `ai_disclosure` is the operator's own line about talking to an AI, shown
 *     in the one notice bar before any send. Absent → nothing rendered.
 *
 * The privacy half of the issue is a UI property too: the form's values are
 * overlay state, so they are sent as `prechat` on the FIRST turn and must never
 * become transcript rows — including after `loadHistory()` restores a thread.
 * The backend half (the values never reach the model) is
 * backend/tests/test_prechat_isolation.py.
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
  prechatMode?: string;
  aiDisclosure?: string | null;
  history?: Array<Record<string, unknown>>;
} = {}) {
  const calls: Call[] = [];
  const { prechatMode = 'off', aiDisclosure = null, history = [] } = options;

  const config = {
    widget_title: 'Support',
    widget_color: '#F9CA02',
    welcome_message: 'Hi',
    online: true,
    prechat_mode: prechatMode,
    ai_disclosure: aiDisclosure,
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });

    if (url.includes('/api/v1/config:public')) return jsonResponse(config);
    if (url.includes('/api/v1/chat/stream')) {
      return sseResponse([
        'event: sources\ndata: {"sources": []}',
        'event: content\ndata: {"content": "Thanks!"}',
        'event: done\ndata: {"message_id": 9, "session_id": "sess_1", "mode": "ai"}',
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

function prechatForm(): HTMLFormElement | null {
  return document.querySelector('.basjoo-prechat') as HTMLFormElement | null;
}

function inputArea(): HTMLElement {
  return document.querySelector('.basjoo-input-area') as HTMLElement;
}

async function fillAndSubmit(name: string, email: string): Promise<void> {
  const form = prechatForm()!;
  (form.querySelector('.basjoo-prechat-name-input') as HTMLInputElement).value = name;
  (form.querySelector('.basjoo-prechat-email-input') as HTMLInputElement).value = email;
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function sendOne(text = 'hello'): Promise<void> {
  const input = document.querySelector('.basjoo-input') as HTMLInputElement;
  input.value = text;
  (document.querySelector('.basjoo-send') as HTMLButtonElement).click();
  await new Promise((resolve) => setTimeout(resolve, 60));
}

describe('BasjooWidget prechat form (#73)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
    window.localStorage.clear();
  });

  afterEach(() => {
    document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
    document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());
    vi.unstubAllGlobals();
  });

  it('required: hides the composer until the form is submitted', async () => {
    const calls = installFetch({ prechatMode: 'required' });
    const widget = makeWidget('en-US');
    await widget.init();

    const form = prechatForm();
    expect(form, 'a required policy must render the form').not.toBeNull();
    expect(form?.hidden).toBe(false);
    // No skip affordance in required mode.
    expect((form?.querySelector('.basjoo-prechat-skip') as HTMLElement).hidden).toBe(true);
    // The composer is locked.
    expect(inputArea().hidden).toBe(true);

    // Pressing send before submitting does nothing at all.
    await sendOne('sneaky');
    expect(calls.find((call) => call.url.includes('/api/v1/chat/stream'))).toBeFalsy();

    await fillAndSubmit('Ada Lovelace', 'ada@example.com');

    // Submitting unlocks the composer and hides the form.
    expect(inputArea().hidden).toBe(false);
    expect(prechatForm()?.hidden).toBe(true);

    // The FIRST turn carries the captured identity…
    await sendOne('What is the refund window?');
    const streamCalls = calls.filter((call) => call.url.includes('/api/v1/chat/stream'));
    expect(streamCalls).toHaveLength(1);
    expect((streamCalls[0].body as { prechat?: unknown }).prechat).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });

    // …and only the first: the values must not ride every later turn.
    await sendOne('And the pro plan?');
    const after = calls.filter((call) => call.url.includes('/api/v1/chat/stream'));
    expect(after).toHaveLength(2);
    expect('prechat' in (after[1].body as Record<string, unknown>)).toBe(false);

    widget.destroy();
  });

  it('required: refuses to submit without a name and without a valid e-mail', async () => {
    installFetch({ prechatMode: 'required' });
    const widget = makeWidget('en-US');
    await widget.init();

    const form = prechatForm()!;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('.basjoo-prechat-error')?.textContent).toBe(
      'Please enter your name.',
    );
    expect(inputArea().hidden).toBe(true);

    (form.querySelector('.basjoo-prechat-name-input') as HTMLInputElement).value = 'Ada';
    (form.querySelector('.basjoo-prechat-email-input') as HTMLInputElement).value = 'not-an-email';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('.basjoo-prechat-error')?.textContent).toBe(
      'Please enter a valid e-mail address.',
    );
    expect(inputArea().hidden).toBe(true);

    widget.destroy();
  });

  it('off: renders no form at all', async () => {
    installFetch({ prechatMode: 'off' });
    const widget = makeWidget('en-US');
    await widget.init();

    expect(prechatForm()?.hidden).toBe(true);
    expect(inputArea().hidden).toBe(false);

    widget.destroy();
  });

  it('optional: offers a skip, and skipping never re-opens the form', async () => {
    installFetch({ prechatMode: 'optional' });
    const widget = makeWidget('en-US');
    await widget.init();

    const form = prechatForm();
    expect(form?.hidden).toBe(false);
    // In optional mode the composer stays usable, unlike `required`.
    expect(inputArea().hidden).toBe(false);

    const skip = form!.querySelector('.basjoo-prechat-skip') as HTMLButtonElement;
    expect(skip.hidden).toBe(false);
    skip.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(prechatForm()?.hidden).toBe(true);
    expect(inputArea().hidden).toBe(false);

    // Sending a turn must not bring the skipped form back.
    await sendOne('hello');
    expect(prechatForm()?.hidden).toBe(true);

    widget.destroy();
  });

  it('optional: submitting still attaches the values to the first turn', async () => {
    const calls = installFetch({ prechatMode: 'optional' });
    const widget = makeWidget('en-US');
    await widget.init();

    await fillAndSubmit('Grace Hopper', 'grace@example.com');
    expect(prechatForm()?.hidden).toBe(true);

    await sendOne('hi');
    const streamCall = calls.find((call) => call.url.includes('/api/v1/chat/stream'));
    expect((streamCall?.body as { prechat?: unknown }).prechat).toEqual({
      name: 'Grace Hopper',
      email: 'grace@example.com',
    });

    widget.destroy();
  });

  it('never turns the form values into transcript rows, even after loadHistory', async () => {
    // A thread exists, so the form must not be shown at all on this visit…
    installFetch({
      prechatMode: 'required',
      history: [
        { id: 1, role: 'user', content: 'Where is my order?', sources: [], rating: 0, sender_type: null },
        { id: 2, role: 'assistant', content: 'It shipped yesterday.', sources: [], rating: 0, sender_type: 'agent' },
      ],
    });

    window.localStorage.setItem('basjoo_session_agent-1', 'sess_1');
    const widget = makeWidget('en-US');
    await widget.init();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // …and the restored transcript holds only the two real messages.
    expect(prechatForm()?.hidden).toBe(true);
    expect(inputArea().hidden).toBe(false);
    const transcript = document.querySelector('.basjoo-messages')?.textContent || '';
    expect(transcript).toContain('Where is my order?');
    expect(transcript).toContain('It shipped yesterday.');
    // The overlay the operator typed earlier in this file never appears.
    expect(transcript).not.toContain('Ada Lovelace');
    expect(transcript).not.toContain('ada@example.com');

    // The rendered rows are exactly the two history messages — no phantom
    // name/e-mail bubbles were injected by the form.
    expect(document.querySelectorAll('.basjoo-message')).toHaveLength(2);

    widget.destroy();
  });

  it('localizes the form copy in zh-CN', async () => {
    installFetch({ prechatMode: 'required' });
    const widget = makeWidget('zh-CN');
    await widget.init();

    const form = prechatForm()!;
    expect(form.querySelector('.basjoo-prechat-title')?.textContent).toBe('开始之前');
    expect(form.querySelector('.basjoo-prechat-submit')?.textContent).toBe('开始对话');
    const labels = Array.from(form.querySelectorAll('.basjoo-prechat-label')).map((el) => el.textContent);
    expect(labels).toEqual(['姓名', '邮箱']);

    widget.destroy();
  });
});

describe('BasjooWidget AI disclosure (#73)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
    window.localStorage.clear();
  });

  afterEach(() => {
    document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
    document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());
    vi.unstubAllGlobals();
  });

  it('renders the operator copy in the notice bar before any send', async () => {
    installFetch({ aiDisclosure: 'You are chatting with an AI assistant.' });
    const widget = makeWidget('en-US');
    await widget.init();

    const bar = document.querySelector('.basjoo-notice') as HTMLElement;
    expect(bar.hidden).toBe(false);
    const disclosure = bar.querySelector('[data-testid="basjoo-ai-disclosure"]') as HTMLElement;
    expect(disclosure).toBeTruthy();
    expect(disclosure.textContent).toBe('You are chatting with an AI assistant.');

    // It is still there after a turn — it is a standing policy line.
    await sendOne('hi');
    expect(
      document.querySelector('[data-testid="basjoo-ai-disclosure"]')?.textContent,
    ).toBe('You are chatting with an AI assistant.');

    widget.destroy();
  });

  it('renders nothing when the agent has no disclosure', async () => {
    installFetch({ aiDisclosure: null });
    const widget = makeWidget('en-US');
    await widget.init();

    const bar = document.querySelector('.basjoo-notice') as HTMLElement;
    expect(bar.hidden).toBe(true);
    expect(document.querySelector('[data-testid="basjoo-ai-disclosure"]')).toBeNull();

    widget.destroy();
  });

  it('renders nothing for an empty disclosure string', async () => {
    installFetch({ aiDisclosure: '   ' });
    const widget = makeWidget('en-US');
    await widget.init();

    expect((document.querySelector('.basjoo-notice') as HTMLElement).hidden).toBe(true);
    expect(document.querySelector('[data-testid="basjoo-ai-disclosure"]')).toBeNull();

    widget.destroy();
  });

  it('renders the disclosure verbatim, not translated', async () => {
    installFetch({ aiDisclosure: '您正在与 AI 助手对话。' });
    const widget = makeWidget('en-US');
    await widget.init();

    expect(document.querySelector('[data-testid="basjoo-ai-disclosure"]')?.textContent).toBe(
      '您正在与 AI 助手对话。',
    );

    widget.destroy();
  });
});
