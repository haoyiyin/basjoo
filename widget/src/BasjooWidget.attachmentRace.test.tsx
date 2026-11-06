/**
 * #71 — concurrent attachment-upload regressions.
 *
 * Two defects pinned here:
 *
 *  1. Two picks fired before the first upload settles both see
 *     `this.sessionId === null`. Each POST then arrives without a
 *     `session_id`, the upload route mints a DIFFERENT session per request,
 *     and the widget adopts whichever response lands last. The attachments
 *     from the other session are foreign to the adopted one and are dropped
 *     by the next turn's session-scoped lookup.
 *
 *  2. The client-side `ATTACHMENT_MAX_FILES` cap is evaluated against
 *     `pendingAttachments` *before* either batch pushes to it, so two
 *     concurrent batches of 3 each admit all 6 and the visitor ends up over
 *     the frozen 5-file ceiling.
 *
 * `fetch` is stubbed: the widget's half of the contract is the serialization
 * of upload batches and the single adopted session.
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
  method?: string;
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

/**
 * Stub fetch. An attachment POST with no `session_id` mints the next
 * `sess_<n>` (mirroring the server's mint-on-first-upload contract); a POST
 * that already carries one echoes it back. `uploadDelayMs` keeps the first
 * batch outstanding so a second pick can overlap it.
 */
function installFetch(options: { uploadDelayMs?: number } = {}) {
  const calls: Call[] = [];
  const { uploadDelayMs = 0 } = options;
  let uploadCounter = 0;
  let minted = 0;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let body: unknown;
    if (typeof init?.body === 'string') {
      body = JSON.parse(init.body);
    } else if (init?.body instanceof FormData) {
      body = { __formData: true, hasFile: init.body.has('file') };
    }
    calls.push({ url, body, method: init?.method });

    if (url.includes('/api/v1/config:public')) return jsonResponse(CONFIG);
    if (url.includes('/api/v1/chat/attachments')) {
      if (uploadDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, uploadDelayMs));
      }
      uploadCounter += 1;
      const parsed = new URL(url);
      const requestedSession = parsed.searchParams.get('session_id');
      const session = requestedSession ?? `sess_${++minted}`;
      return jsonResponse({
        id: `att_${uploadCounter}`,
        filename: `file-${uploadCounter}.txt`,
        mime: 'text/plain',
        kind: 'document',
        status: 'uploaded',
        session_id: session,
      });
    }
    if (url.includes('/api/v1/chat/stream')) {
      return sseResponse([
        'event: sources\ndata: {"sources": []}',
        'event: content\ndata: {"content": "Got it."}',
        'event: done\ndata: {"message_id": 5, "session_id": "sess_1", "mode": "ai"}',
      ]);
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

function fileInput(): HTMLInputElement {
  return document.querySelector('.basjoo-file-input') as HTMLInputElement;
}

function pick(files: File[]): void {
  const input = fileInput();
  Object.defineProperty(input, 'files', { value: files, writable: true, configurable: true });
  input.dispatchEvent(new Event('change'));
}

function makeFile(name: string, bytes = 10, type = 'text/plain'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function chips(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.basjoo-attachment')) as HTMLElement[];
}

function uploadCalls(calls: Call[]): Call[] {
  return calls.filter((call) => call.url.includes('/api/v1/chat/attachments'));
}

function sessionOf(call: Call): string | null {
  return new URL(call.url).searchParams.get('session_id');
}

describe('BasjooWidget concurrent attachment uploads (#71)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
    window.localStorage.clear();
    window.localStorage.setItem('basjoo_visitor_id', 'visitor_test');
  });

  afterEach(() => {
    document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
    document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());
    vi.unstubAllGlobals();
  });

  it('keeps every pre-chat attachment on the single session it adopts', async () => {
    const calls = installFetch({ uploadDelayMs: 40 });
    const widget = makeWidget('en-US');
    await widget.init();
    expect(widget.sessionId).toBeNull();

    // Two picks before either upload settles: the classic "attach a file,
    // then attach another" that fires before the first response lands.
    pick([makeFile('first.txt')]);
    pick([makeFile('second.txt')]);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const uploads = uploadCalls(calls);
    expect(uploads).toHaveLength(2);
    expect(chips()).toHaveLength(2);

    // Exactly one session may be minted, and every attachment must belong to
    // the session the widget adopted for the next turn.
    expect(widget.sessionId).toBe('sess_1');
    // The first pick legitimately arrives session-less (the route mints one);
    // the concurrent second pick must already know and reuse that session.
    expect(sessionOf(uploads[0])).toBeNull();
    expect(sessionOf(uploads[1])).toBe(widget.sessionId);
    expect(window.localStorage.getItem('basjoo_session_agent-1')).toBe('sess_1');

    widget.destroy();
  });

  it('never lets two overlapping batches push the chip count over the cap', async () => {
    const calls = installFetch({ uploadDelayMs: 40 });
    const widget = makeWidget('en-US');
    await widget.init();

    // Two batches of three. Sequentially this is 5 + one rejected; if the cap
    // is read before either batch records its files, both admit all three and
    // the visitor ends up with six.
    pick([makeFile('a.txt'), makeFile('b.txt'), makeFile('c.txt')]);
    pick([makeFile('d.txt'), makeFile('e.txt'), makeFile('f.txt')]);
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(uploadCalls(calls)).toHaveLength(5);
    expect(chips()).toHaveLength(5);
    const errors = Array.from(document.querySelectorAll('.basjoo-error')).map((el) => el.textContent);
    expect(errors).toContain('You can attach up to 5 files');

    widget.destroy();
  });
});
