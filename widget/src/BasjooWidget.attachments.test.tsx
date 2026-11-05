/**
 * #71 — visitor attachments in the widget.
 *
 * The upload route is shipped by a different lane (wave-2 lane A), so `fetch` is
 * stubbed here: what this file pins is the *widget's* half of the contract —
 * the paperclip, the chip row, the remove button, the client-side caps that
 * mirror the frozen schema (5 files / 5 MB each), the disabled send while an
 * upload is in flight, and the `attachment_ids` the chat body carries.
 *
 * The backend half lives in backend/tests/test_chat_attachments.py.
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
 * Stub fetch. `uploadDelayMs` lets a test observe the in-flight state (the send
 * button must be disabled while the POST is outstanding).
 */
function installFetch(options: { uploadDelayMs?: number; uploadStatus?: number } = {}) {
  const calls: Call[] = [];
  const { uploadDelayMs = 0, uploadStatus = 200 } = options;
  let uploadCounter = 0;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let body: unknown;
    if (typeof init?.body === 'string') {
      body = JSON.parse(init.body);
    } else if (init?.body instanceof FormData) {
      // The multipart body is opaque here; record that a file rode along.
      body = { __formData: true, hasFile: init.body.has('file') };
    }
    calls.push({ url, body, method: init?.method });

    if (url.includes('/api/v1/config:public')) return jsonResponse(CONFIG);
    if (url.includes('/api/v1/chat/attachments')) {
      if (uploadDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, uploadDelayMs));
      }
      if (uploadStatus !== 200) {
        return jsonResponse({ detail: 'rejected' }, uploadStatus);
      }
      uploadCounter += 1;
      return jsonResponse({
        id: `att_${uploadCounter}`,
        filename: `file-${uploadCounter}.txt`,
        mime: 'text/plain',
        kind: 'document',
        status: 'uploaded',
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

function attachBtn(): HTMLButtonElement {
  return document.querySelector('.basjoo-attach') as HTMLButtonElement;
}

function sendBtn(): HTMLButtonElement {
  return document.querySelector('.basjoo-send') as HTMLButtonElement;
}

/** Build a `File` and hand it to the hidden input, then fire `change`. */
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

describe('BasjooWidget attachments (#71)', () => {
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

  it('renders a paperclip inside the input area in both locales', async () => {
    installFetch();

    const zh = makeWidget('zh-CN');
    await zh.init();
    expect(document.querySelector('.basjoo-input-area .basjoo-attach')).toBeTruthy();
    expect(attachBtn().getAttribute('aria-label')).toBe('添加附件');
    zh.destroy();

    document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
    document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());

    const en = makeWidget('en-US');
    await en.init();
    expect(attachBtn().getAttribute('aria-label')).toBe('Attach a file');
    en.destroy();
  });

  it('uploads on select, shows a chip, and removes it again', async () => {
    const calls = installFetch();
    const widget = makeWidget('en-US');
    await widget.init();
    window.localStorage.setItem('basjoo_session_agent-1', 'sess_1');
    (widget as unknown as { sessionId: string | null }).sessionId = 'sess_1';

    pick([makeFile('notes.txt')]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const upload = calls.find((call) => call.url.includes('/api/v1/chat/attachments'));
    expect(upload, 'the pick must be uploaded at once').toBeTruthy();
    expect(upload?.method).toBe('POST');
    expect((upload?.body as { hasFile?: boolean }).hasFile).toBe(true);

    // A chip with the filename and a labelled remove button.
    const row = chips();
    expect(row).toHaveLength(1);
    expect(document.querySelector('.basjoo-attachments')?.hasAttribute('hidden')).toBe(false);
    expect(row[0].textContent).toContain('file-1.txt');
    const remove = row[0].querySelector('.basjoo-attachment-remove') as HTMLButtonElement;
    expect(remove.getAttribute('aria-label')).toBe('Remove attachment');

    remove.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chips()).toHaveLength(0);
    expect(document.querySelector('.basjoo-attachments')?.hasAttribute('hidden')).toBe(true);

    widget.destroy();
  });

  it('disables send while an upload is in flight, and re-enables it after', async () => {
    installFetch({ uploadDelayMs: 40 });
    const widget = makeWidget('en-US');
    await widget.init();
    (widget as unknown as { sessionId: string | null }).sessionId = 'sess_1';

    expect(sendBtn().disabled).toBe(false);

    pick([makeFile('slow.txt')]);
    // The upload is outstanding: the composer must not be able to send a turn
    // that references ids the server has not handed out yet.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(sendBtn().disabled, 'send must be disabled mid-upload').toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(sendBtn().disabled, 'send must be usable again once the upload lands').toBe(false);
    expect(chips()).toHaveLength(1);

    widget.destroy();
  });

  it('rejects a file over 5 MB with a readable sentence', async () => {
    installFetch();
    const widget = makeWidget('en-US');
    await widget.init();

    const tooBig = makeFile('huge.txt', 5 * 1024 * 1024 + 1);
    pick([tooBig]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(chips()).toHaveLength(0);
    const error = document.querySelector('.basjoo-error') as HTMLElement | null;
    expect(error).toBeTruthy();
    expect(error?.textContent).toBe('Each file must be 5 MB or smaller');

    widget.destroy();
  });

  it('rejects a sixth file with a readable sentence', async () => {
    installFetch();
    const widget = makeWidget('en-US');
    await widget.init();
    (widget as unknown as { sessionId: string | null }).sessionId = 'sess_1';

    pick([
      makeFile('a.txt'),
      makeFile('b.txt'),
      makeFile('c.txt'),
      makeFile('d.txt'),
      makeFile('e.txt'),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(chips()).toHaveLength(5);

    pick([makeFile('f.txt')]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(chips()).toHaveLength(5);
    const errors = Array.from(document.querySelectorAll('.basjoo-error')).map((el) => el.textContent);
    expect(errors).toContain('You can attach up to 5 files');

    widget.destroy();
  });

  it('sends attachment_ids with the next chat turn (at most 5)', async () => {
    const calls = installFetch();
    const widget = makeWidget('en-US');
    await widget.init();
    (widget as unknown as { sessionId: string | null }).sessionId = 'sess_1';

    pick([makeFile('a.txt'), makeFile('b.txt')]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(chips()).toHaveLength(2);

    const input = document.querySelector('.basjoo-input') as HTMLInputElement;
    input.value = 'please read these';
    sendBtn().click();
    await new Promise((resolve) => setTimeout(resolve, 60));

    const streamCall = calls.find((call) => call.url.includes('/api/v1/chat/stream'));
    expect(streamCall).toBeTruthy();
    expect((streamCall?.body as { attachment_ids?: string[] }).attachment_ids).toEqual([
      'att_1',
      'att_2',
    ]);

    // The chips are consumed by the turn they belonged to.
    expect(chips()).toHaveLength(0);

    widget.destroy();
  });

  it('shows a readable rejection when the upload route refuses the file', async () => {
    installFetch({ uploadStatus: 413 });
    const widget = makeWidget('en-US');
    await widget.init();
    (widget as unknown as { sessionId: string | null }).sessionId = 'sess_1';

    pick([makeFile('nope.txt')]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(chips()).toHaveLength(0);
    const error = document.querySelector('.basjoo-error') as HTMLElement | null;
    expect(error?.textContent).toBe('That file could not be uploaded. Please try again.');

    widget.destroy();
  });

  it('localizes the caps copy in zh-CN', async () => {
    installFetch();
    const widget = makeWidget('zh-CN');
    await widget.init();

    pick([makeFile('huge.txt', 5 * 1024 * 1024 + 1)]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const error = document.querySelector('.basjoo-error') as HTMLElement | null;
    expect(error?.textContent).toBe('单个文件不能超过 5 MB');

    widget.destroy();
  });
});
