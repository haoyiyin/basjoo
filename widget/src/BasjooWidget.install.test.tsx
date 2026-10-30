/**
 * #40 — the install surface in the widget.
 *
 * The widget is a plain class that builds DOM imperatively, so these tests drive
 * the real `init()` against a jsdom document and assert on the rendered DOM, on
 * `console` output and on the storage keys. `fetch` is stubbed: the assertions
 * are about the widget's contract with the server-baked `__BASJOO_CONFIG__`,
 * not about the backend (covered in backend/tests/test_embed_loader.py).
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

type EmbedConfig = {
  agent_id?: string;
  api_base?: string;
  allowed_domains?: string[];
  excluded_paths?: string[];
  display_mode?: 'bubble' | 'inline' | 'iframe';
  inline_container?: string | null;
  starters?: Array<Record<string, unknown>>;
  cards?: Array<Record<string, unknown>>;
  traffic_percentage?: number;
};

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

/** Route every fetch the widget makes to a deterministic response. */
function installFetch(calls: Array<{ url: string; body?: unknown }> = []) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });

    if (url.includes('/api/v1/config:public')) return jsonResponse(CONFIG);
    if (url.includes('/api/v1/chat/messages')) return jsonResponse([]);
    return jsonResponse({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function setEmbedConfig(config: EmbedConfig | null): void {
  (window as unknown as { __BASJOO_CONFIG__?: EmbedConfig | null }).__BASJOO_CONFIG__ = config;
}

function makeWidget(overrides: { agentId?: string; apiBase?: string } = {}): WidgetLike {
  const BasjooWidget = (window as unknown as { BasjooWidget: WidgetConstructor }).BasjooWidget;
  return new BasjooWidget({
    agentId: overrides.agentId ?? 'agent-1',
    ...(overrides.apiBase ? { apiBase: overrides.apiBase } : {}),
    language: 'en-US',
  });
}

/** jsdom is served from `/`; an excluded-path test needs the real page path. */
function withPathname(pathname: string): () => void {
  const original = window.location.pathname
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname },
    writable: true,
    configurable: true,
  })
  return () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: original },
      writable: true,
      configurable: true,
    })
  }
}

/** `matchMedia('(pointer: fine)')` decides the reopen asymmetry. */
function setFinePointer(fine: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('pointer: fine') ? fine : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

const realMatchMedia = window.matchMedia;

function resetDom(): void {
  document.documentElement.innerHTML = '<html><head></head><body></body></html>';
  window.localStorage.clear();
}

function teardownDom(): void {
  document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
  document.querySelectorAll('.basjoo-inline-host').forEach((el) => el.remove());
  document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());
}

describe('BasjooWidget install surface (#40)', () => {
  beforeEach(() => {
    resetDom();
    setEmbedConfig(null);
    installFetch();
  });

  afterEach(() => {
    teardownDom();
    setEmbedConfig(null);
    vi.unstubAllGlobals();
    window.matchMedia = realMatchMedia;
    vi.restoreAllMocks();
  });

  it('renders nothing at all on an excluded path', async () => {
    const restore = withPathname('/admin')
    try {
      setEmbedConfig({
        agent_id: 'agent-1',
        api_base: 'https://api.example.com',
        excluded_paths: ['^/admin', '^/checkout$'],
      });

      const widget = makeWidget();
      await widget.init();

      // No bubble, no window, no styles — the script loaded and did nothing.
      expect(document.getElementById('basjoo-widget-container')).toBeNull();
      expect(document.getElementById('basjoo-widget-button')).toBeNull();
      expect(document.getElementById('basjoo-chat-window')).toBeNull();
      expect(document.getElementById('basjoo-widget-styles')).toBeNull();
      // And no request either: nothing was created and nothing was fetched.
      expect(document.body.innerHTML.trim()).toBe('');

      widget.destroy();
    } finally {
      restore()
    }
  });

  it('mounts on a path that is not excluded', async () => {
    const restore = withPathname('/pricing')
    try {
      setEmbedConfig({
        agent_id: 'agent-1',
        api_base: 'https://api.example.com',
        excluded_paths: ['^/admin', '^/checkout$'],
      });

      const widget = makeWidget();
      await widget.init();

      expect(document.getElementById('basjoo-widget-container')).toBeTruthy();
      widget.destroy();
    } finally {
      restore()
    }
  });

  it('tolerates an invalid excluded-path regex without throwing', async () => {
    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });

    setEmbedConfig({
      agent_id: 'agent-1',
      api_base: 'https://api.example.com',
      // One broken pattern, one valid one that does not match '/'.
      excluded_paths: ['([', '^/admin'],
    });

    const widget = makeWidget();
    await expect(widget.init()).resolves.toBeUndefined();

    // The bad pattern is named in a warning, not swallowed silently…
    expect(warnings.some((line) => line.includes('invalid excluded_paths'))).toBe(true);
    expect(warnings.some((line) => line.includes('(['))).toBe(true);
    // …and the widget still mounted.
    expect(document.getElementById('basjoo-widget-container')).toBeTruthy();

    widget.destroy();
    warnSpy.mockRestore();
  });

  it('mounts inline into the container and creates no floating button', async () => {
    document.body.innerHTML = '<div id="help-panel"></div>';

    setEmbedConfig({
      agent_id: 'agent-1',
      api_base: 'https://api.example.com',
      display_mode: 'inline',
      inline_container: '#help-panel',
    });

    const widget = makeWidget();
    await widget.init();

    // No bubble, no launcher.
    expect(document.getElementById('basjoo-widget-button')).toBeNull();

    const host = document.querySelector('#help-panel .basjoo-inline-host');
    expect(host).toBeTruthy();
    const chatWindow = document.getElementById('basjoo-chat-window');
    expect(chatWindow).toBeTruthy();
    // The window lives inside the operator's container and starts open (there
    // is no button to open it with).
    expect(chatWindow?.closest('#help-panel')).toBeTruthy();
    expect(chatWindow?.classList.contains('open')).toBe(true);

    widget.destroy();
  });

  it('mounts a bare iframe in iframe mode', async () => {
    document.body.innerHTML = '<div id="basjoo-chat"></div>';

    setEmbedConfig({
      agent_id: 'agent-1',
      api_base: 'https://api.example.com',
      display_mode: 'iframe',
    });

    const widget = makeWidget();
    await widget.init();

    expect(document.getElementById('basjoo-widget-button')).toBeNull();
    expect(document.getElementById('basjoo-chat-window')).toBeNull();

    const frame = document.querySelector('#basjoo-chat iframe') as HTMLIFrameElement | null;
    expect(frame).toBeTruthy();
    expect(frame?.src).toBe('https://api.example.com/widget-demo?agent_id=agent-1');

    widget.destroy();
  });

  it('keeps the bubble default when no config is baked in', async () => {
    const calls = installFetch();
    const widget = makeWidget({ apiBase: 'http://localhost:8000' });
    await widget.init();

    expect(document.getElementById('basjoo-widget-button')).toBeTruthy();
    expect(document.getElementById('basjoo-chat-window')).toBeTruthy();
    // Today's welcome message still renders when there are no cards.
    expect(document.querySelector('.basjoo-messages')?.textContent).toContain('Hi there');
    expect(calls.some((call) => call.url.includes('/api/v1/config:public'))).toBe(true);

    widget.destroy();
  });

  it('names the current origin and the allowed list when the origin is rejected', async () => {
    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });

    setEmbedConfig({
      agent_id: 'agent-1',
      api_base: 'https://api.example.com',
      allowed_domains: ['https://a.com', 'https://b.com'],
    });

    const widget = makeWidget();
    await widget.init();

    const message = errors.find((line) => line.includes('is not allowed')) || '';
    expect(message).toContain(window.location.origin);
    expect(message).toContain('https://a.com');
    expect(message).toContain('https://b.com');
    // The exact sentence the issue asks for, not a bare 403.
    expect(message).toContain(
      `Basjoo: origin ${window.location.origin} is not allowed for this agent (allowed: https://a.com, https://b.com)`,
    );

    // And it renders nothing, rather than mounting a widget that cannot talk.
    expect(document.getElementById('basjoo-widget-container')).toBeNull();

    widget.destroy();
    errorSpy.mockRestore();
  });

  it('mounts normally when the current origin is allowed', async () => {
    const origin = window.location.origin;
    setEmbedConfig({
      agent_id: 'agent-1',
      api_base: 'https://api.example.com',
      allowed_domains: [origin, 'https://b.com'],
    });

    const widget = makeWidget();
    await widget.init();

    expect(document.getElementById('basjoo-widget-container')).toBeTruthy();
    widget.destroy();
  });

  it('scopes a starter to its path', async () => {
    const calls = installFetch();
    setEmbedConfig({
      agent_id: 'agent-1',
      api_base: 'https://api.example.com',
      starters: [
        { label: 'See pricing', action: 'message', value: 'What does it cost?', path: '^/pricing$' },
        { label: 'Anywhere', action: 'message', value: 'Hello' },
      ],
    });

    const widget = makeWidget();
    await widget.init();

    const labels = Array.from(document.querySelectorAll('.basjoo-starter')).map(
      (node) => node.textContent,
    );
    // On `/` the /pricing starter is absent; the unscoped one still shows.
    expect(labels).toEqual(['Anywhere']);
    expect(labels).not.toContain('See pricing');

    // Clicking a message starter sends its text.
    (document.querySelector('.basjoo-starter') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const streamCall = calls.find((call) => call.url.includes('/api/v1/chat/stream'));
    expect(streamCall?.body).toMatchObject({ message: 'Hello' });

    widget.destroy();
  });

  it('renders the path-scoped starter on the page it belongs to', async () => {
    const originalPathname = window.location.pathname;
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/pricing' },
      writable: true,
      configurable: true,
    });

    try {
      installFetch();
      setEmbedConfig({
        agent_id: 'agent-1',
        api_base: 'https://api.example.com',
        starters: [
          { label: 'See pricing', action: 'message', value: 'What does it cost?', path: '^/pricing$' },
        ],
      });

      const widget = makeWidget();
      await widget.init();

      const labels = Array.from(document.querySelectorAll('.basjoo-starter')).map(
        (node) => node.textContent,
      );
      expect(labels).toEqual(['See pricing']);
      widget.destroy();
    } finally {
      Object.defineProperty(window, 'location', {
        value: { ...window.location, pathname: originalPathname },
        writable: true,
        configurable: true,
      });
    }
  });

  it('tolerates an invalid starter path regex by showing the starter', async () => {
    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });

    setEmbedConfig({
      agent_id: 'agent-1',
      api_base: 'https://api.example.com',
      // A broken scope is operator data too: it must not throw and must not
      // silently hide the starter the operator asked for.
      starters: [{ label: 'Anywhere', action: 'message', value: 'Hi', path: '([' }],
    });

    const widget = makeWidget();
    await expect(widget.init()).resolves.toBeUndefined();

    expect(warnings.some((line) => line.includes('invalid starter path'))).toBe(true);
    expect(
      Array.from(document.querySelectorAll('.basjoo-starter')).map((n) => n.textContent),
    ).toEqual(['Anywhere']);

    widget.destroy();
    warnSpy.mockRestore();
  });

  it('renders the card entry screen instead of the welcome message', async () => {
    setEmbedConfig({
      agent_id: 'agent-1',
      api_base: 'https://api.example.com',
      cards: [
        { heading: 'Shipping', text: 'Where is my order?', chat: 'Where is my order?' },
        { heading: 'Returns', text: 'How do I return?' },
      ],
    });

    const widget = makeWidget();
    await widget.init();

    const cards = document.querySelectorAll('.basjoo-card');
    expect(cards).toHaveLength(2);
    expect(document.querySelector('.basjoo-card-heading')?.textContent).toBe('Shipping');
    expect(document.querySelector('.basjoo-card-text')?.textContent).toBe('Where is my order?');
    // Cards replace the welcome message — no regression, no duplication.
    expect(document.querySelector('.basjoo-messages')?.textContent).not.toContain('Hi there');

    widget.destroy();
  });

  it('keeps the welcome message when no cards are configured', async () => {
    setEmbedConfig({ agent_id: 'agent-1', api_base: 'https://api.example.com' });

    const widget = makeWidget();
    await widget.init();

    expect(document.querySelectorAll('.basjoo-card')).toHaveLength(0);
    expect(document.querySelector('.basjoo-messages')?.textContent).toContain('Hi there');

    widget.destroy();
  });

  it('opens a link starter in a new tab', async () => {
    const openSpy = vi.fn();
    vi.stubGlobal('open', openSpy);
    const calls = installFetch();

    setEmbedConfig({
      agent_id: 'agent-1',
      api_base: 'https://api.example.com',
      starters: [{ label: 'Docs', action: 'link', url: 'https://shop.example.com/docs' }],
    });

    const widget = makeWidget();
    await widget.init();

    (document.querySelector('.basjoo-starter') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openSpy).toHaveBeenCalledWith(
      'https://shop.example.com/docs',
      '_blank',
      'noopener',
    );
    // A link starter must not send a message.
    expect(calls.some((call) => call.url.includes('/api/v1/chat/stream'))).toBe(false);

    widget.destroy();
  });

  it('decides the rollout once per visitor and keeps it (sticky)', async () => {
    // A seeded 0.9 puts this visitor above a 50% rollout: Math.random()*100 < 50
    // is false, so they are OUT — and that decision must stick.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9);

    setEmbedConfig({
      agent_id: 'agent-1',
      api_base: 'https://api.example.com',
      traffic_percentage: 50,
    });

    const first = makeWidget();
    await first.init();
    expect(document.getElementById('basjoo-widget-container')).toBeNull();
    expect(window.localStorage.getItem('basjoo_rollout_agent-1')).toBe('out');
    first.destroy();
    teardownDom();

    // Second page load, same visitor: the sticky value is reused, so the draw
    // is not repeated (and a high draw cannot flip them in).
    randomSpy.mockClear();
    randomSpy.mockReturnValue(0.1);
    const second = makeWidget();
    await second.init();
    expect(randomSpy).not.toHaveBeenCalled();
    expect(document.getElementById('basjoo-widget-container')).toBeNull();
    expect(window.localStorage.getItem('basjoo_rollout_agent-1')).toBe('out');
    second.destroy();

    randomSpy.mockRestore();
  });

  it('never mounts at 0% and always mounts at 100%', async () => {
    setEmbedConfig({
      agent_id: 'agent-1',
      api_base: 'https://api.example.com',
      traffic_percentage: 0,
    });
    const off = makeWidget();
    await off.init();
    expect(document.getElementById('basjoo-widget-container')).toBeNull();
    // 0 and 100 are absolute: no coin is flipped, so nothing is stored.
    expect(window.localStorage.getItem('basjoo_rollout_agent-1')).toBeNull();
    off.destroy();
    teardownDom();

    setEmbedConfig({
      agent_id: 'agent-1',
      api_base: 'https://api.example.com',
      traffic_percentage: 100,
    });
    const on = makeWidget();
    await on.init();
    expect(document.getElementById('basjoo-widget-container')).toBeTruthy();
    expect(window.localStorage.getItem('basjoo_rollout_agent-1')).toBeNull();
    on.destroy();
  });

  it('restores the open state on a fine pointer only', async () => {
    setEmbedConfig({ agent_id: 'agent-1', api_base: 'https://api.example.com' });
    installFetch();

    // Desktop: the remembered open state comes back.
    setFinePointer(true);
    window.localStorage.setItem('basjoo_open_agent-1', 'open');
    const desktop = makeWidget();
    await desktop.init();
    expect(document.getElementById('basjoo-chat-window')?.classList.contains('open')).toBe(true);
    desktop.destroy();
    teardownDom();

    // Phone: a full-screen takeover on return is hostile, so it stays closed.
    setFinePointer(false);
    window.localStorage.setItem('basjoo_open_agent-1', 'open');
    const phone = makeWidget();
    await phone.init();
    expect(document.getElementById('basjoo-chat-window')?.classList.contains('open')).toBe(false);
    phone.destroy();
  });

  it('does not write the open state on a coarse pointer', async () => {
    setEmbedConfig({ agent_id: 'agent-1', api_base: 'https://api.example.com' });
    installFetch();
    setFinePointer(false);

    const widget = makeWidget();
    await widget.init();
    // Mobile never persists, so a later desktop visit is not surprised either.
    expect(window.localStorage.getItem('basjoo_open_agent-1')).toBeNull();
    widget.destroy();
  });

  it('sends the two page-context slots with the message', async () => {
    const calls = installFetch();
    setEmbedConfig({ agent_id: 'agent-1', api_base: 'https://api.example.com' });

    const Basjoo = (window as unknown as {
      Basjoo: { setContext: (c: { before?: string; after?: string }) => void };
    }).Basjoo;
    Basjoo.setContext({ before: 'Plan: Pro', after: 'Cart: 2 items' });

    const widget = makeWidget();
    await widget.init();

    const input = document.querySelector('.basjoo-input') as HTMLInputElement;
    input.value = 'Can I upgrade?';
    (document.querySelector('.basjoo-send') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const streamCall = calls.find((call) => call.url.includes('/api/v1/chat/stream'));
    expect(streamCall?.body).toMatchObject({
      context_before: 'Plan: Pro',
      context_after: 'Cart: 2 items',
    });

    widget.destroy();
    Basjoo.setContext({});
  });

  it('omits the context fields when the page pushed nothing', async () => {
    const calls = installFetch();
    setEmbedConfig({ agent_id: 'agent-1', api_base: 'https://api.example.com' });

    const widget = makeWidget();
    await widget.init();

    const input = document.querySelector('.basjoo-input') as HTMLInputElement;
    input.value = 'Hi';
    (document.querySelector('.basjoo-send') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const streamCall = calls.find((call) => call.url.includes('/api/v1/chat/stream'));
    const body = streamCall?.body as Record<string, unknown>;
    expect('context_before' in body).toBe(false);
    expect('context_after' in body).toBe(false);

    widget.destroy();
  });

  it('takes the agent id and api base from the baked config', async () => {
    const calls = installFetch();
    // No agentId and no apiBase passed by hand: the loader supplies both, and
    // neither may come from window.location.
    setEmbedConfig({ agent_id: 'agt_baked', api_base: 'https://api.example.com' });

    const BasjooWidget = (window as unknown as {
      BasjooWidget: new (config: { agentId?: string; apiBase?: string }) => WidgetLike;
    }).BasjooWidget;
    const widget = new BasjooWidget({});
    await widget.init();

    expect(document.getElementById('basjoo-widget-container')).toBeTruthy();
    const configCall = calls.find((call) => call.url.includes('/api/v1/config:public'));
    expect(configCall?.url).toContain('agent_id=agt_baked');
    expect(configCall?.url).toContain('https://api.example.com');
    expect(configCall?.url).not.toContain('localhost');

    widget.destroy();
  });
});
