/**
 * Basjoo AI Chat Widget
 * 可嵌入的智能聊天组件
 *
 * Colours, radii, spacing, shadows and type come from `./theme`, which is the
 * widget's mirror of `frontend-nextjs/src/index.css` (the console's single
 * source of truth). `theme.test.ts` fails if the mirror drifts.
 *
 * Never add a colour / radius / shadow / font literal to this file: paint with
 * `theme.*` (or the operator's `widget_color`), so the widget cannot look like
 * a different product from the console. See issue #48.
 */

import { DEFAULT_ACCENT, resolveTheme } from './theme';

interface WidgetConfig {
  agentId: string;
  apiBase?: string;
  themeColor?: string;
  logoUrl?: string;
  title?: string;
  welcomeMessage?: string;
  language?: 'auto' | string;
  position?: 'left' | 'right';
  theme?: 'light' | 'dark' | 'auto';
}

interface PublicWidgetConfig {
  widget_title?: string | null;
  welcome_message?: string | null;
  widget_color?: string | null;
  default_agent_id?: string | null;
  /** #43: computed server-side from business_hours on every request. */
  online?: boolean | null;
  business_hours?: BusinessHoursConfig | null;
  away_message?: string | null;
  /** #46: this agent accepts only signed identities (HMAC over the email). */
  identity_required?: boolean | null;
}

/**
 * #46: the signed identity the host page computes server-side.
 *
 * `hash` is `hmac_sha256(identity_secret, email)` in hex. The secret never
 * reaches the browser: the host application derives the value after login and
 * hands this object to `window.Basjoo.identify()`. The widget only ever stores
 * the resulting `email:hash` string, which is what `visitor_id` becomes.
 */
interface VisitorIdentity {
  email?: string;
  hash?: string;
}

/** Contract C6 shape: day 0 = Monday, minutes from local midnight. */
interface BusinessHoursConfig {
  timezone?: string;
  schedule?: Array<{ day: number; start: number; end: number }>;
}

/** #40: a starter shown above the composer; `path` scopes it to one page. */
interface WidgetStarter {
  label?: string;
  action?: 'message' | 'link';
  /** The sent text when `action` is `message`, the URL when it is `link`. */
  value?: string;
  url?: string;
  /** Optional regex; the starter renders only where `location.pathname` matches. */
  path?: string;
}

/** #40: one card on the entry screen. Absent cards = today's welcome message. */
interface WidgetCard {
  logo?: string;
  heading?: string;
  text?: string;
  chat?: boolean | string;
  kb_search?: boolean | string;
  form?: boolean | string;
}

/**
 * #40: the literal the server bakes into `embed.js`.
 *
 * Every field is a constant for that host — the widget never re-derives an
 * origin or an API base from `window.location` when this object is present,
 * which is what makes the loader identical for every visitor.
 */
interface EmbedConfig {
  agent_id?: string;
  api_base?: string;
  allowed_domains?: string[];
  excluded_paths?: string[];
  display_mode?: 'bubble' | 'inline' | 'iframe';
  starters?: WidgetStarter[];
  cards?: WidgetCard[];
  traffic_percentage?: number;
  inline_container?: string | null;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  timestamp: Date;
}

interface Source {
  type: 'url' | 'qa';
  title?: string;
  url?: string;
  snippet?: string;
  question?: string;
  id?: string;
}

interface StreamDoneMeta {
  message_id?: number | null;
  session_id?: string;
  taken_over?: boolean;
  /** #43: who answers next. `taken_over` implies `human`. */
  mode?: 'ai' | 'human';
  no_answer_reason?: string | null;
  /** #44: true when the fallback model answered (primary allowance spent). */
  degraded?: boolean;
  /** #44: the model that actually produced the answer. */
  model?: string | null;
}

interface StreamErrorPayload {
  error?: string;
  code?: string;
}

interface StreamEventPayload {
  sources?: Source[];
  content?: string;
  elapsed?: number;
}

interface ChatHistoryMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: Source[];
}

function formatAssistantMessage(content: string, sources: Source[] = []): { content: string; references: Array<{ title: string; url: string }> } {
  if (!content) {
    return { content, references: [] };
  }

  const references: Array<{ title: string; url: string }> = [];
  const seenUrls = new Set<string>();
  const sourceByUrl = new Map<string, Source & { type: 'url'; url: string }>();

  for (const source of sources) {
    if (source.type !== 'url' || typeof source.url !== 'string' || !/^https?:\/\//.test(source.url) || sourceByUrl.has(source.url)) {
      continue;
    }
    sourceByUrl.set(source.url, source as Source & { type: 'url'; url: string });
  }

  const addReference = (url: string) => {
    if (seenUrls.has(url)) {
      return;
    }
    seenUrls.add(url);
    const source = sourceByUrl.get(url);
    references.push({
      title: source?.title?.trim() || url,
      url,
    });
  };

  const formattedContent = content.replace(
    /\[([^\]]+)\]\((#source-(\d+)|https?:\/\/[^\s)]+)\)/g,
    (_match, label: string, target: string, sourceIndexText?: string) => {
      if (sourceIndexText) {
        const sourceIndex = Number(sourceIndexText) - 1;
        const source = sources[sourceIndex];
        if (source && source.type === 'url' && source.url && /^https?:\/\//.test(source.url)) {
          addReference(source.url);
        }
        return label;
      }

      if (sourceByUrl.has(target)) {
        addReference(target);
        return label;
      }

      return _match;
    },
  );

  return {
    content: formattedContent,
    references,
  };
}

const AUTO_INIT_SCRIPT_PARAM_MAP = {
  agentId: ['agentId', 'agent_id'],
  apiBase: ['apiBase', 'api_base'],
  themeColor: ['themeColor', 'theme_color'],
  welcomeMessage: ['welcomeMessage', 'welcome_message'],
  language: ['language', 'locale'],
  position: ['position'],
  theme: ['theme'],
} as const

function buildDefaultLogoUrl(apiBase: string): string {
  if (!apiBase) {
    return '/basjoo-logo.png'
  }

  try {
    return new URL('/basjoo-logo.png', `${apiBase}/`).toString()
  } catch {
    return '/basjoo-logo.png'
  }
}

// --- #40: install surface ----------------------------------------------------

/** The default inline/iframe mount point when the operator set no selector. */
const DEFAULT_INLINE_CONTAINER = '#basjoo-chat'
/** A returning phone visitor must not be hit by a full-screen takeover. */
const FINE_POINTER_QUERY = '(pointer: fine)'
const OPEN_STATE_KEY_PREFIX = 'basjoo_open_'
const ROLLOUT_KEY_PREFIX = 'basjoo_rollout_'

/**
 * The literal the server baked into `embed.js`.
 *
 * It is read once at module load so every widget on the page agrees, and it is
 * the ONLY thing that can override `apiBase` — the widget never re-derives the
 * origin from `window.location` when a server config is present.
 */
function readEmbedConfig(): EmbedConfig | null {
  const raw = (window as Window & typeof globalThis & { __BASJOO_CONFIG__?: EmbedConfig }).__BASJOO_CONFIG__
  if (!raw || typeof raw !== 'object') {
    return null
  }
  return raw
}

/**
 * #46: does this visitor id look like a signed `email:hash` identity?
 *
 * Matches the server's shape check (`services/visitor_identity.py`): one `:`
 * separator and a 64-character hex digest. It is only used to decide whether a
 * *persisted* value should be treated as signed after a reload — the signature
 * itself is verified server-side and never here.
 */
function looksSigned(visitorId: string | null | undefined): boolean {
  if (typeof visitorId !== 'string') {
    return false
  }
  const separator = visitorId.lastIndexOf(':')
  if (separator <= 0) {
    return false
  }
  const digest = visitorId.slice(separator + 1)
  return digest.length === 64 && /^[0-9a-f]{64}$/.test(digest)
}

/**
 * #40: is the current page on the operator's excluded list?
 *
 * A pattern that does not compile is ignored with a warning — a bad regex must
 * never break the host page, which is the whole reason this runs before any DOM
 * is created.
 */
function isPathExcluded(pathname: string, patterns: readonly string[] | undefined): boolean {
  if (!Array.isArray(patterns)) {
    return false
  }

  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || !pattern) {
      continue
    }
    try {
      if (new RegExp(pattern).test(pathname)) {
        return true
      }
    } catch {
      console.warn(`[Basjoo Widget] Ignoring an invalid excluded_paths pattern: ${pattern}`)
    }
  }

  return false
}

/** #40: does this starter render on the current page? An unparsable `path` is ignored. */
function isStarterVisible(starter: WidgetStarter, pathname: string): boolean {
  const scope = typeof starter.path === 'string' ? starter.path.trim() : ''
  if (!scope) {
    return true
  }

  try {
    return new RegExp(scope).test(pathname)
  } catch {
    console.warn(`[Basjoo Widget] Ignoring an invalid starter path pattern: ${scope}`)
    return true
  }
}

/** The current page origin, normalised to `scheme://host` (no path, no trailing slash). */
function currentOrigin(): string {
  try {
    return window.location.origin
  } catch {
    return ''
  }
}

/**
 * #40: the sticky rollout decision.
 *
 * Decided ONCE per visitor and kept, so a visitor inside the percentage does
 * not flicker in and out between page loads. Written only when the decision is
 * made; a storage failure falls back to the fresh draw rather than blocking.
 */
function rolloutDecision(agentId: string, percentage: number, storage: StorageAdapter): boolean {
  if (percentage >= 100) {
    return true
  }
  if (percentage <= 0) {
    return false
  }

  const key = `${ROLLOUT_KEY_PREFIX}${agentId}`
  const stored = storage.getItem(key)
  if (stored === 'in') {
    return true
  }
  if (stored === 'out') {
    return false
  }

  const included = Math.random() * 100 < percentage
  storage.setItem(key, included ? 'in' : 'out')
  return included
}

/** A safe URL for `href`/`src`; `javascript:` and friends are rejected outright. */
function safeExternalUrl(value: string | undefined): string {
  if (typeof value !== 'string' || !value.trim()) {
    return ''
  }
  const trimmed = value.trim()
  try {
    const url = new URL(trimmed, window.location.href)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return ''
    }
    return url.toString()
  } catch {
    return ''
  }
}

// Storage adapter that safely wraps localStorage with try/catch and memory fallback
class StorageAdapter {
  private memoryStore = new Map<string, string>();
  private storageAvailable: boolean | null = null;

  private isAvailable(): boolean {
    if (this.storageAvailable !== null) {
      return this.storageAvailable;
    }
    try {
      const testKey = '__storage_test__';
      window.localStorage.setItem(testKey, 'test');
      window.localStorage.removeItem(testKey);
      this.storageAvailable = true;
      return true;
    } catch {
      this.storageAvailable = false;
      return false;
    }
  }

  getItem(key: string): string | null {
    if (this.isAvailable()) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        // Fall through to memory store
      }
    }
    return this.memoryStore.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.isAvailable()) {
      try {
        window.localStorage.setItem(key, value);
        return;
      } catch {
        // Fall through to memory store
      }
    }
    this.memoryStore.set(key, value);
  }

  removeItem(key: string): void {
    if (this.isAvailable()) {
      try {
        window.localStorage.removeItem(key);
        return;
      } catch {
        // Fall through to memory store
      }
    }
    this.memoryStore.delete(key);
  }
}

class BasjooWidget {
  private config: Required<WidgetConfig>;
  private readonly hasTitleOverride: boolean;
  private readonly hasWelcomeMessageOverride: boolean;
  private container: HTMLElement | null = null;
  private button: HTMLElement | null = null;
  private unreadBadge: HTMLSpanElement | null = null;
  private chatWindow: HTMLElement | null = null;
  private messages: ChatMessage[] = [];
  private sessionId: string | null = null;
  private isOpen = false;
  private readonly STORAGE_KEY: string;
  private readonly VISITOR_STORAGE_KEY = 'basjoo_visitor_id';
  private visitorId: string;
  // #46: `true` once the host page has handed us a signed identity. The widget
  // then sends `email:hash` as `visitor_id` and asks the server to resume the
  // thread behind that person instead of the one in this browser's storage.
  private identitySigned = false;
  // #46: the agent refuses unsigned identities. Shown as a readable line in the
  // composer area rather than a bare 403 in the network tab.
  private identityRequired = false;
  private storage: StorageAdapter;
  private effectiveTheme: 'light' | 'dark' = 'light';
  private originalTitle: string = '';
  private titleBlinkInterval: number | null = null;
  private hasUnread = false;
  private pollIntervalId: number | null = null;
  private lastMessageId: number = 0;
  private isSending = false;
  private streamAbortController: AbortController | null = null;
  private streamingMessage: HTMLDivElement | null = null;
  private streamingMessageContent: HTMLDivElement | null = null;
  private thinkingIndicator: HTMLDivElement | null = null;
  private thinkingIndicatorText: HTMLSpanElement | null = null;
  private thinkingElapsed = 0;
  private thinkingTimerId: number | null = null;
  private currentStreamContent = '';
  private currentStreamSources: Source[] = [];
  // #43 handoff: the session's answer mode, the operator's away copy and the
  // business-hours flag from `config:public`.
  private sessionMode: 'ai' | 'human' = 'ai';
  private isOnline = true;
  private awayMessage = '';
  private humanNoticeBar: HTMLElement | null = null;
  private headerHumanButton: HTMLButtonElement | null = null;
  private onlineCheckIntervalId: number | null = null;
  // Track imperative event listeners for cleanup
  private _buttonClickListener: (() => void) | null = null;
  private _closeBtnClickListener: (() => void) | null = null;
  private _sendBtnClickListener: (() => void) | null = null;
  private _inputKeypressListener: ((e: KeyboardEvent) => void) | null = null;
  private _humanBtnClickListener: (() => void) | null = null;
  private _continueAiClickListener: (() => void) | null = null;
  // #40 install surface: the server-baked literal, the resolved display mode
  // and the container that inline/iframe modes mount into.
  private embed: EmbedConfig | null;
  private displayMode: 'bubble' | 'inline' | 'iframe' = 'bubble';
  private mountTarget: HTMLElement | null = null;
  private iframeElement: HTMLIFrameElement | null = null;
  private cardsRendered = false;
  private openStateStorageKey: string;
  private _cardActionListeners: Array<() => void> = [];
  private _starterClickListeners: Array<() => void> = [];
  // #40: host-page context pushed through `window.Basjoo.setContext`.
  private static pageContext: { before: string; after: string } = { before: '', after: '' }
  // #46: instances alive on the page, so `window.Basjoo.identify()` reaches a
  // widget the host page did not construct itself, and a pending identity
  // survives the gap between the host calling `identify()` and the loader
  // mounting (the server-rendered embed starts the widget on DOMContentLoaded).
  private static instances: BasjooWidget[] = []
  private static pendingIdentity: VisitorIdentity | null | undefined = undefined

  constructor(config: WidgetConfig) {
    // The server-rendered loader is authoritative: when it is present, its
    // `api_base` is the API base and its `agent_id` fills an omitted one. Nothing
    // here is ever derived from `window.location`, so the same bytes work on
    // every page of the host.
    this.embed = readEmbedConfig();
    const embedAgentId = this.embed?.agent_id
    const embedApiBase = this.embed?.api_base

    const apiBase = this.detectApiBase(config.apiBase || embedApiBase);
    const agentId = config.agentId || embedAgentId || '';
    this.hasTitleOverride = typeof config.title === 'string' && config.title.trim().length > 0;
    this.hasWelcomeMessageOverride = typeof config.welcomeMessage === 'string' && config.welcomeMessage.trim().length > 0;

    this.config = {
      agentId,
      apiBase,
      themeColor: config.themeColor || '',
      logoUrl: config.logoUrl || buildDefaultLogoUrl(apiBase),
      title: config.title || 'AI助手',
      welcomeMessage: config.welcomeMessage || '你好！有什么可以帮助您的吗？',
      language: config.language || 'auto',
      position: config.position || 'right',
      theme: config.theme || 'auto',
    };

    this.STORAGE_KEY = `basjoo_session_${this.config.agentId}`;
    this.openStateStorageKey = `${OPEN_STATE_KEY_PREFIX}${this.config.agentId}`;
    this.storage = new StorageAdapter();
    this.sessionId = this.storage.getItem(this.STORAGE_KEY);
    this.visitorId = this.storage.getItem(this.VISITOR_STORAGE_KEY) || this.generateVisitorId();
    // #46: a persisted `email:hash` from an earlier page load is still a signed
    // identity — the visitor never becomes anonymous merely by reloading.
    this.identitySigned = looksSigned(this.visitorId);
    BasjooWidget.instances.push(this);
    if (BasjooWidget.pendingIdentity !== undefined) {
      // Consumed once: the host identified the visitor before the loader
      // mounted, so this first widget adopts it and no later one repeats it.
      const pending = BasjooWidget.pendingIdentity
      BasjooWidget.pendingIdentity = undefined
      this.identify(pending)
    }

    const mode = this.embed?.display_mode
    this.displayMode = mode === 'inline' || mode === 'iframe' ? mode : 'bubble';

    this.effectiveTheme = this.getEffectiveTheme();
  }

  /**
   * #40: the host page pushes context into two prompt slots. The values are
   * strings and are sent verbatim; the server wraps them in a labelled block
   * and states that they are page context, not instructions.
   */
  static setContext(context: { before?: string; after?: string } | null): void {
    const next = context && typeof context === 'object' ? context : {}
    BasjooWidget.pageContext = {
      before: typeof next.before === 'string' ? next.before : '',
      after: typeof next.after === 'string' ? next.after : '',
    }
  }

  /**
   * #46: push an identity into every live widget, remembering it for any widget
   * that mounts later. Public so `window.Basjoo.identify` can reach it without
   * exporting the private instance list.
   */
  static applyIdentity(identity: VisitorIdentity | null | undefined): void {
    // A widget whose container the host page has removed is no longer a live
    // surface: pushing an identity into a detached tree would do nothing and,
    // worse, would stop the value being remembered for the widget that mounts
    // next. So prune those first.
    BasjooWidget.instances = BasjooWidget.instances.filter(
      (widget) => widget.container?.isConnected ?? false,
    )
    // Only a call with no live widget needs remembering — a mounted widget
    // receives the identity directly, so a stale value can never be replayed
    // into a later widget on the same page.
    if (BasjooWidget.instances.length === 0) {
      BasjooWidget.pendingIdentity = identity ?? null
    }
    for (const widget of BasjooWidget.instances.slice()) {
      widget.identify(identity ?? null)
    }
  }

  /**
   * #46: adopt the signed identity the host page computed server-side.
   *
   * The host application knows the visitor's email after login and holds the
   * agent's `identity_secret`; it sends both through here as
   * `{ email, hash }` where `hash = hmac_sha256(secret, email)` in hex. The
   * widget stores the resulting `email:hash` as its visitor id, which is what
   * makes "the same email on a second device" the same visitor.
   *
   * Deliberately defensive: a missing field or a value that is not a string is
   * ignored with a warning rather than sent to the server, because a malformed
   * identity would only earn a 403. Calling it with `null` forgets the identity
   * (a logout) and goes back to the anonymous visitor.
   */
  identify(identity: VisitorIdentity | null | undefined): void {
    if (identity === null || identity === undefined) {
      this.identitySigned = false;
      const anonymous = this.generateVisitorId();
      this.visitorId = anonymous;
      this.clearSessionForIdentityChange();
      this.applyBusinessHoursState();
      this.renderModeNotice();
      return;
    }

    const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';
    const hash = typeof identity.hash === 'string' ? identity.hash.trim().toLowerCase() : '';
    if (!email || !hash) {
      console.warn('[Basjoo Widget] identify() needs both `email` and `hash`; ignoring.', identity);
      return;
    }

    const signed = `${email}:${hash}`;
    if (signed === this.visitorId) {
      return;
    }

    this.visitorId = signed;
    this.identitySigned = true;
    // Persisted so a reload keeps the same visitor until the host page calls
    // `identify()` again with the (possibly different) signed-in user.
    this.storage.setItem(this.VISITOR_STORAGE_KEY, signed);
    // A different person may be using this browser now, so the previous
    // visitor's cached session id must never be reused.
    this.clearSessionForIdentityChange();

    // A composer that was closed for want of an identity can open now.
    this.applyBusinessHoursState();
    this.renderModeNotice();

    if (this.chatWindow) {
      void this.resumeIdentitySession();
    }
  }

  /** Drop the cached session when the identity changes under the widget. */
  private clearSessionForIdentityChange(): void {
    this.sessionId = null;
    this.lastMessageId = 0;
    this.storage.removeItem(this.STORAGE_KEY);
    this.stopPolling();
  }

  /**
   * #46: ask the server which session belongs to this identity.
   *
   * This is the half of "same email, second device" that the browser cannot do
   * on its own: `localStorage` is per device, so a returning visitor has no
   * session id. The server answers one, scoped to the agent and the identity.
   */
  private async resumeIdentitySession(): Promise<boolean> {
    if (!this.identitySigned || !this.visitorId) {
      return false;
    }

    try {
      const url = new URL(`${this.config.apiBase}/api/v1/chat/session:current`);
      url.searchParams.set('agent_id', this.config.agentId);
      url.searchParams.set('visitor_id', this.visitorId);
      const response = await fetch(url.toString());
      if (!response.ok) {
        return false;
      }

      const payload = (await response.json()) as { session_id?: string | null };
      if (!payload.session_id) {
        return false;
      }

      this.sessionId = payload.session_id;
      this.storage.setItem(this.STORAGE_KEY, payload.session_id);
      await this.loadHistory();
      return true;
    } catch (error) {
      console.warn('[Basjoo Widget] Could not resume the signed-in visitor history.', error);
      return false;
    }
  }

  private generateVisitorId(): string {
    const visitorId = `visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
    this.storage.setItem(this.VISITOR_STORAGE_KEY, visitorId);
    return visitorId;
  }

  private detectApiBase(configuredApiBase?: string): string {
    if (configuredApiBase) {
      try {
        const url = new URL(configuredApiBase, window.location.href)
        if ((url.protocol === 'http:' || url.protocol === 'https:') && url.port === '3000') {
          const directBase = `${url.protocol}//${url.hostname}:8000`
          console.info('[Basjoo Widget] Rewriting configured dev apiBase to direct backend:', directBase)
          return directBase
        }
        return url.toString().replace(/\/$/, '')
      } catch {
        return configuredApiBase;
      }
    }

    const currentScript = document.currentScript;
    if (currentScript instanceof HTMLScriptElement && currentScript.src) {
      try {
        const scriptUrl = new URL(currentScript.src, window.location.href);
        console.info('[Basjoo Widget] Detected API base from current script:', scriptUrl.origin);
        return scriptUrl.origin;
      } catch {
        // Ignore and continue fallback detection.
      }
    }

    const scripts = document.querySelectorAll('script[src]');
    for (const script of scripts) {
      const src = script.getAttribute('src') || '';
      if (!src.includes('sdk.js') && !src.includes('basjoo')) {
        continue;
      }

      try {
        const scriptUrl = new URL(src, window.location.href);
        console.info('[Basjoo Widget] Detected API base from script src:', scriptUrl.origin);
        return scriptUrl.origin;
      } catch {
        // Ignore invalid script URLs and continue scanning.
      }
    }

    const port = window.location.port;
    if (port === '3000' || port === '5173') {
      const devBase = `${window.location.protocol}//${window.location.hostname}:8000`;
      console.info('[Basjoo Widget] Development mode detected, using:', devBase);
      return devBase;
    }

    if (window.location.protocol === 'file:') {
      console.error('[Basjoo Widget] Cannot determine API base from a local file. Please set apiBase explicitly.');
      return '';
    }

    console.warn('[Basjoo Widget] Falling back to window.location.origin. Set apiBase explicitly if the API is hosted elsewhere.');
    return window.location.origin;
  }

  private getEffectiveTheme(): 'light' | 'dark' {
    if (this.config.theme === 'light' || this.config.theme === 'dark') {
      return this.config.theme;
    }
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }

  private async loadPublicConfig() {
    if (!this.config.apiBase) {
      console.warn('[Basjoo Widget] Skipping public config fetch because apiBase could not be determined.');
      return;
    }

    try {
      const publicConfigUrl = new URL(`${this.config.apiBase}/api/v1/config:public`)
      if (this.config.agentId) {
        publicConfigUrl.searchParams.set('agent_id', this.config.agentId)
      }
      const response = await fetch(publicConfigUrl.toString())
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json() as PublicWidgetConfig
      if (!this.config.agentId && data.default_agent_id) {
        this.config.agentId = data.default_agent_id
      }
      // Fallback is the console accent, from the one place it is defined
      // (spec contract C1) — never a second hand-picked brand colour.
      this.config.themeColor = this.config.themeColor || data.widget_color || DEFAULT_ACCENT
      if (!this.hasTitleOverride) {
        this.config.title = data.widget_title || 'AI助手'
      }
      if (!this.hasWelcomeMessageOverride) {
        this.config.welcomeMessage = data.welcome_message || '你好！有什么可以帮助您的吗？'
      }
      // #43: the server decides `online` on every request; a config with no
      // business hours answers `true`, which is today's behaviour.
      this.isOnline = data.online !== false
      this.awayMessage = (data.away_message || '').trim()
      // #46: an agent that signs visitors only accepts `email:hash`. Remember
      // it so the composer can say why nothing is sent until the host page
      // identifies the visitor, instead of discovering it as a 403.
      this.identityRequired = data.identity_required === true
      this.effectiveTheme = this.getEffectiveTheme()
    } catch (error) {
      console.warn('[Basjoo Widget] Failed to load public config, using defaults.', error)
      if (error instanceof TypeError) {
        console.warn('[Basjoo Widget] Public config request may be blocked by CORS, network issues, or an incorrect apiBase:', this.config.apiBase)
      }
    }
  }

  /**
   * #40: the operator's domain allowlist, as one readable sentence.
   *
   * A disallowed page used to fail only as a bare 403 in the network tab. The
   * widget now says which origin was rejected and what was allowed, so the
   * operator debugging their install does not have to guess.
   */
  private isOriginAllowed(): boolean {
    const allowed = (this.embed?.allowed_domains || []).filter(
      (origin): origin is string => typeof origin === 'string' && origin.length > 0,
    )
    if (allowed.length === 0) {
      return true
    }

    const origin = currentOrigin()
    if (allowed.includes(origin)) {
      return true
    }

    console.error(
      `Basjoo: origin ${origin || '(unknown)'} is not allowed for this agent (allowed: ${allowed.join(', ')})`,
    )
    return false
  }

  /** #40: `true` when the visitor's device has a precise (mouse/trackpad) pointer. */
  private hasFinePointer(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return window.matchMedia(FINE_POINTER_QUERY).matches
  }

  /**
   * #40: the reopen asymmetry.
   *
   * A returning visitor's open state is restored ONLY on a fine pointer: a
   * full-screen takeover greeting a phone visitor is hostile, so a touch device
   * always starts closed.
   */
  private restoreOpenState(): void {
    if (!this.hasFinePointer()) {
      return
    }
    if (this.storage.getItem(this.openStateStorageKey) === 'open') {
      this.open(true)
    }
  }

  /**
   * 初始化Widget
   */
  async init() {
    if (!document.body) {
      console.warn('[Basjoo Widget] document.body is not available yet. Call init() after DOMContentLoaded or place the embed code near the end of <body>.')
      return
    }

    if (document.getElementById('basjoo-widget-container')) {
      console.warn('[Basjoo Widget] Initialization skipped because #basjoo-widget-container already exists. Avoid loading or initializing the widget twice on the same page.')
      return
    }

    // #40: the install gates run BEFORE anything is created — no DOM, no
    // request, no floating button. An excluded path or a visitor outside the
    // rollout percentage must be invisible, not merely closed.
    if (isPathExcluded(window.location.pathname, this.embed?.excluded_paths)) {
      return
    }
    if (!this.isOriginAllowed()) {
      return
    }

    const percentage = this.embed?.traffic_percentage
    if (typeof percentage === 'number' && !rolloutDecision(this.config.agentId, percentage, this.storage)) {
      return
    }

    await this.loadPublicConfig()

    // 保存原始标题用于闪烁
    this.originalTitle = document.title;

    this.createStyles();

    // #40: `iframe` mode is a bare frame — no bubble and no chat DOM of its own.
    if (this.displayMode === 'iframe') {
      this.mountIframe()
      return
    }

    // #40: `inline` mounts into the operator's container and creates NO floating
    // button; `bubble` (the default) keeps today's behaviour.
    if (this.displayMode === 'inline') {
      if (!this.mountInline()) {
        return
      }
    } else {
      this.createContainer()
      this.createButton()
    }

    this.createChatWindow()

    if (this.displayMode === 'inline') {
      // Inline has no launcher of its own, so it starts open and never blinks.
      this.open(true)
    } else {
      // 显示打招呼气泡
      this.showGreetingBubble()

      // 页面加载时立即启动标题闪烁提醒，吸引用户打开聊天窗口
      this.startTitleBlink()
    }

    // #43: `online` is computed server-side per request. The widget only reads
    // `config:public` once, so a page left open across the closing time would
    // otherwise keep an open composer forever. Re-reading the flag every minute
    // is the cheaper correct design: the backend needs no scheduler job and no
    // cache to keep in sync (see the report).
    this.startOnlineWatcher();

    if (this.sessionId) {
      void this.loadHistory();
      return;
    }

    // #46: a signed visitor with no cached session is on a second device (or
    // after a cleared storage). Ask the server which thread belongs to this
    // identity before painting a greeting, so the transcript is not appended
    // underneath a welcome message the visitor has already read before.
    if (this.identitySigned && (await this.resumeIdentitySession())) {
      this.restoreOpenState();
      return;
    }

    // #40: the card entry screen replaces the plain welcome message when the
    // operator configured cards; an absent list is today's behaviour.
    if (!this.renderCards() && this.config.welcomeMessage) {
      this.addMessage({
        role: 'assistant',
        content: this.config.welcomeMessage,
        timestamp: new Date(),
      });
    }

    this.renderStarters()
    this.restoreOpenState()
  }

  /**
   * #40: mount the chat window inside the operator's container.
   *
   * Returns false when the selector matches nothing — there is nowhere to put
   * the widget, so nothing at all is created (and no stray bubble appears).
   */
  private mountInline(): boolean {
    const selector = this.embed?.inline_container || DEFAULT_INLINE_CONTAINER
    const target = this.resolveMountTarget(selector)
    if (!target) {
      console.warn(
        `[Basjoo Widget] Inline mode found no container matching "${selector}". Add an element with that selector, or change the install setting.`,
      )
      return false
    }

    this.mountTarget = target
    const host = document.createElement('div')
    host.className = 'basjoo-inline-host'
    target.appendChild(host)
    this.container = host
    return true
  }

  /** #40: `iframe` mode — a bare frame pointing at the widget demo surface. */
  private mountIframe(): void {
    const selector = this.embed?.inline_container || DEFAULT_INLINE_CONTAINER
    const target = this.resolveMountTarget(selector)
    if (!target) {
      console.warn(
        `[Basjoo Widget] iframe mode found no container matching "${selector}". Add an element with that selector, or change the install setting.`,
      )
      return
    }

    this.mountTarget = target
    const host = document.createElement('div')
    host.className = 'basjoo-inline-host'

    const frame = document.createElement('iframe')
    frame.className = 'basjoo-inline-frame'
    frame.title = this.config.title
    const src = new URL('/widget-demo', `${this.config.apiBase}/`)
    src.searchParams.set('agent_id', this.config.agentId)
    frame.src = src.toString()

    host.appendChild(frame)
    target.appendChild(host)
    this.container = host
    this.iframeElement = frame
  }

  /** A CSS selector that does not compile is reported, not thrown. */
  private resolveMountTarget(selector: string): HTMLElement | null {
    try {
      return document.querySelector<HTMLElement>(selector)
    } catch {
      console.warn(`[Basjoo Widget] Ignoring an invalid container selector: ${selector}`)
      return null
    }
  }

  /**
   * #40: the card-based entry screen.
   *
   * Returns true when cards were rendered so the caller falls back to the
   * welcome message with one branch. Rendered at most once per widget.
   */
  private renderCards(): boolean {
    const cards = (this.embed?.cards || []).filter(
      (card): card is WidgetCard => Boolean(card) && typeof card === 'object',
    )
    if (cards.length === 0 || this.cardsRendered) {
      return false
    }

    const messagesContainer = this.chatWindow?.querySelector('.basjoo-messages') as HTMLElement | null
    if (!messagesContainer) {
      return false
    }

    this.cardsRendered = true
    const list = document.createElement('div')
    list.className = 'basjoo-cards'

    for (const card of cards) {
      const item = document.createElement('div')
      item.className = 'basjoo-card'

      const logo = safeExternalUrl(card.logo)
      if (logo) {
        const logoImage = document.createElement('img')
        logoImage.className = 'basjoo-card-logo'
        logoImage.src = logo
        logoImage.alt = ''
        item.appendChild(logoImage)
      }

      const heading = typeof card.heading === 'string' ? card.heading.trim() : ''
      if (heading) {
        const headingNode = document.createElement('div')
        headingNode.className = 'basjoo-card-heading'
        headingNode.textContent = heading
        item.appendChild(headingNode)
      }

      const text = typeof card.text === 'string' ? card.text.trim() : ''
      if (text) {
        const textNode = document.createElement('div')
        textNode.className = 'basjoo-card-text'
        textNode.textContent = text
        item.appendChild(textNode)
      }

      // `chat`, `kb_search` and `form` all reduce to "seed the composer with
      // this text" — the operator writes the opener, the bot answers it.
      const seed = card.chat ?? card.kb_search ?? card.form
      const seedText = typeof seed === 'string' ? seed.trim() : ''
      if (seedText) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'basjoo-card-action'
        button.textContent = heading || seedText
        const listener = () => {
          void this.sendMessage(seedText)
        }
        this._cardActionListeners.push(listener)
        button.addEventListener('click', listener)
        item.appendChild(button)
      }

      list.appendChild(item)
    }

    messagesContainer.appendChild(list)
    messagesContainer.scrollTop = messagesContainer.scrollHeight
    return true
  }

  /** #40: starters above the composer, filtered by the current path. */
  private renderStarters(): void {
    const starters = (this.embed?.starters || []).filter(
      (starter) => Boolean(starter) && typeof starter.label === 'string' && starter.label.trim().length > 0,
    )
    if (starters.length === 0) {
      return
    }

    const visible = starters.filter((starter) => isStarterVisible(starter, window.location.pathname))
    if (visible.length === 0) {
      return
    }

    const inputArea = this.chatWindow?.querySelector('.basjoo-input-area') as HTMLElement | null
    if (!inputArea) {
      return
    }

    const row = document.createElement('div')
    row.className = 'basjoo-starters'

    for (const starter of visible) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'basjoo-starter'
      button.textContent = starter.label || ''

      let listener: () => void
      if (starter.action === 'link') {
        const href = safeExternalUrl(starter.url ?? starter.value)
        listener = href
          ? () => {
              window.open(href, '_blank', 'noopener')
            }
          : () => {
              console.warn(`[Basjoo Widget] Starter "${starter.label}" has no usable link target.`)
            }
      } else {
        const text = (starter.value ?? starter.label ?? '').trim()
        listener = () => {
          void this.sendMessage(text)
        }
      }

      this._starterClickListeners.push(listener)
      button.addEventListener('click', listener)
      row.appendChild(button)
    }

    inputArea.parentNode?.insertBefore(row, inputArea)
  }

  /**
   * 显示打招呼气泡
   */
  private showGreetingBubble() {
    if (!this.button) return;

    const bubble = document.createElement('div');
    bubble.className = 'basjoo-greeting-bubble';
    bubble.textContent = this.getText('greetingBubble');

    // 定位到按钮左上方
    const position = this.config.position;
    bubble.style.position = 'fixed';
    bubble.style.bottom = '100px';
    bubble.style[position] = '24px';
    bubble.style.zIndex = '9999';

    document.body.appendChild(bubble);

    // 5秒后自动消失
    setTimeout(() => {
      bubble.remove();
    }, 5000);
  }

  private async loadHistory() {
    if (!this.sessionId) return;

    try {
      const response = await fetch(
        `${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&visitor_id=${encodeURIComponent(this.visitorId)}`
      );
      if (!response.ok) {
        // #46: a stale or missing identity is not an expired session — clearing
        // the id would silently discard the thread instead of telling the
        // visitor to sign in again, and the next send would 403 anyway.
        if (await this.reportIdentityRejection(response)) {
          return;
        }
        throw new Error('Failed to load history');
      }

      const messages = await response.json() as ChatHistoryMessage[];
      if (messages && messages.length > 0) {
        for (const message of messages) {
          this.addMessage({
            role: message.role === 'user' ? 'user' : 'assistant',
            content: message.content,
            sources: message.sources,
            timestamp: new Date(),
          });
          if (message.id > this.lastMessageId) {
            this.lastMessageId = message.id;
          }
        }
        this.startPolling();
        return;
      }
    } catch {
      // Fall through to reset invalid or expired sessions.
    }

    this.sessionId = null;
    this.storage.removeItem(this.STORAGE_KEY);
    if (this.config.welcomeMessage) {
      this.addMessage({
        role: 'assistant',
        content: this.config.welcomeMessage,
        timestamp: new Date(),
      });
    }
  }

  /**
   * 开始标题闪烁提醒
   */
  private startTitleBlink() {
    if (this.titleBlinkInterval) return;

    this.hasUnread = true;
    this.updateUnreadBadge();
    let showOriginal = true;

    this.titleBlinkInterval = window.setInterval(() => {
      document.title = showOriginal ? this.originalTitle : '❗ ' + this.getText('newMessage');
      showOriginal = !showOriginal;
    }, 1000);
  }

  /**
   * 停止标题闪烁
   */
  private stopTitleBlink() {
    if (this.titleBlinkInterval) {
      clearInterval(this.titleBlinkInterval);
      this.titleBlinkInterval = null;
    }
    document.title = this.originalTitle;
    this.hasUnread = false;
    this.updateUnreadBadge();
  }

  /**
   * 创建样式
   */
  private createStyles() {
    const style = document.createElement('style');
    style.id = 'basjoo-widget-styles';
    const theme = resolveTheme(this.effectiveTheme === 'dark');

    style.textContent = `
      #basjoo-widget-container, #basjoo-widget-container * {
        box-sizing: border-box;
        font-family: ${theme.fontText};
      }

      #basjoo-widget-button {
        position: fixed;
        bottom: ${theme.space6};
        ${this.config.position === 'left' ? 'left' : 'right'}: ${theme.space6};
        width: 60px;
        height: 60px;
        border-radius: ${theme.radiusFull};
        background-color: ${this.config.themeColor};
        cursor: pointer;
        box-shadow: ${theme.shadow2};
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s, box-shadow 0.2s;
        z-index: 9999;
      }

      #basjoo-widget-button:hover {
        transform: scale(1.05);
        box-shadow: ${theme.shadow3};
      }

      #basjoo-widget-button svg {
        width: 30px;
        height: 30px;
        fill: ${theme.accentContrast};
      }

      .basjoo-unread-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        border-radius: ${theme.radiusMd};
        background: ${theme.error};
        color: ${theme.textInverse};
        font-size: 11px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid ${theme.surface};
      }

      .basjoo-greeting-bubble {
        background: ${theme.surfaceRaised};
        color: ${theme.textPrimary};
        padding: 10px 14px;
        border-radius: ${theme.radiusMd};
        box-shadow: ${theme.shadow2};
        font-family: ${theme.fontDisplay};
        font-size: 13px;
        line-height: ${theme.leadingSnug};
        animation: basjoo-bubble-fadein 0.3s ease-out;
        max-width: 200px;
      }

      .basjoo-greeting-bubble::after {
        content: '';
        position: absolute;
        bottom: -6px;
        ${this.config.position === 'left' ? 'left' : 'right'}: 30px;
        width: 12px;
        height: 12px;
        background: ${theme.surfaceRaised};
        transform: rotate(45deg);
        border-bottom: 1px solid ${theme.border};
        border-right: 1px solid ${theme.border};
      }

      @keyframes basjoo-bubble-fadein {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      #basjoo-chat-window {
        position: fixed;
        bottom: 96px;
        ${this.config.position === 'left' ? 'left' : 'right'}: ${theme.space6};
        width: 380px;
        height: 600px;
        max-height: calc(100vh - 120px);
        background: ${theme.surface};
        border-radius: ${theme.radiusLg};
        box-shadow: ${theme.shadow3};
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transform: scale(0);
        transform-origin: ${this.config.position === 'left' ? 'bottom left' : 'bottom right'};
        transition: transform 0.3s ease;
        z-index: 9998;
      }

      #basjoo-chat-window.open {
        transform: scale(1);
      }

      #basjoo-chat-window.closing {
        transform: scale(0);
      }

      .basjoo-header {
        background: linear-gradient(135deg, ${this.config.themeColor} 0%, ${this.adjustColor(this.config.themeColor, -20)} 100%);
        color: ${theme.accentContrast};
        padding: ${theme.space5} ${theme.space6};
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
      }

      /* Scoped to the container on purpose: the blanket
         #basjoo-widget-container * rule above is (1,0,0) and would otherwise
         out-rank a bare .basjoo-header-title (0,1,0), silently dropping the
         display face. The child rule repeats only the type, because the star
         in the blanket selector otherwise wins inside the title's own span. */
      #basjoo-widget-container .basjoo-header-title {
        display: flex;
        align-items: center;
        gap: ${theme.space3};
        font-family: ${theme.fontDisplay};
        font-size: 18px;
        font-weight: 600;
      }

      #basjoo-widget-container .basjoo-header-title span {
        font-family: ${theme.fontDisplay};
        font-size: 18px;
        font-weight: 600;
      }

      .basjoo-header-logo {
        width: 32px;
        height: 32px;
        object-fit: contain;
        border-radius: ${theme.radiusSm};
        background: ${this.hexToRgba(theme.accentContrast, 0.18)};
        padding: ${theme.space1};
        flex-shrink: 0;
      }

      .basjoo-close {
        width: 32px;
        height: 32px;
        border: none;
        background: ${this.hexToRgba(theme.accentContrast, 0.15)};
        border-radius: ${theme.radiusSm};
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
        color: ${theme.accentContrast};
      }

      .basjoo-close:hover {
        background: ${this.hexToRgba(theme.accentContrast, 0.28)};
      }

      .basjoo-header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      /* #43: "Talk to a human" — a labelled affordance, not icon-only. */
      .basjoo-human {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 32px;
        padding: 0 12px;
        border: 1px solid rgba(255,255,255,0.35);
        background: rgba(255,255,255,0.15);
        border-radius: 16px;
        cursor: pointer;
        color: white;
        font-size: 13px;
        font-weight: 500;
        transition: background 0.2s;
      }

      .basjoo-human:hover {
        background: rgba(255,255,255,0.28);
      }

      .basjoo-human[hidden] {
        display: none;
      }

      .basjoo-human svg {
        flex-shrink: 0;
      }

      /* #43: the human-mode notice bar sits above the transcript. */
      .basjoo-notice {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        padding: 10px 16px;
        background: ${theme.surfaceSunken};
        border-bottom: 1px solid ${theme.border};
        color: ${theme.textPrimary};
        font-size: 13px;
        line-height: 1.4;
        flex-shrink: 0;
      }

      .basjoo-notice[hidden] {
        display: none;
      }

      .basjoo-notice-text {
        flex: 1;
        min-width: 0;
      }

      .basjoo-continue-ai {
        min-height: 32px;
        padding: 0 14px;
        border: 1px solid ${this.config.themeColor};
        background: transparent;
        color: ${this.adjustColor(this.config.themeColor, -30)};
        border-radius: 16px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
      }

      .basjoo-continue-ai:hover {
        background: ${this.hexToRgba(this.config.themeColor, 0.12)};
      }

      /* #44: the degraded notice — one small line, muted, no fill. */
      .basjoo-degraded {
        margin: -8px 0 0 0;
        padding: 0 4px;
        color: ${theme.textMuted};
        font-size: 12px;
        line-height: 1.5;
      }

      /* #40: inline / iframe installs mount inside the host's own container,
         so the chat window is a static block there, never a floating panel. */
      .basjoo-inline-host {
        display: block;
        width: 100%;
      }

      .basjoo-inline-host #basjoo-chat-window {
        position: static;
        width: 100%;
        height: 520px;
        max-height: none;
        transform: none;
        transform-origin: center;
      }

      .basjoo-inline-host #basjoo-chat-window.closing {
        transform: none;
      }

      .basjoo-inline-frame {
        display: block;
        width: 100%;
        height: 520px;
        border: 0;
        border-radius: 20px;
      }

      /* #40: the card entry screen. */
      .basjoo-cards {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 4px 0;
      }

      .basjoo-card {
        padding: 12px 14px;
        border: 1px solid ${theme.border};
        border-radius: 12px;
        background: ${theme.surfaceSunken};
      }

      .basjoo-card-logo {
        width: 28px;
        height: 28px;
        margin-bottom: 8px;
        border-radius: 6px;
        object-fit: contain;
      }

      .basjoo-card-heading {
        color: ${theme.textPrimary};
        font-size: 14px;
        font-weight: 600;
        line-height: 1.4;
      }

      .basjoo-card-text {
        margin-top: 4px;
        color: ${theme.textMuted};
        font-size: 13px;
        line-height: 1.5;
      }

      .basjoo-card-action {
        margin-top: 8px;
        padding: 6px 12px;
        border: 1px solid ${theme.border};
        border-radius: 999px;
        background: transparent;
        color: ${theme.textPrimary};
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }

      .basjoo-card-action:hover {
        background: ${this.hexToRgba(this.config.themeColor, 0.12)};
      }

      /* #40: starters sit between the transcript and the composer. */
      .basjoo-starters {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 8px 16px;
        border-top: 1px solid ${theme.border};
        flex-shrink: 0;
      }

      .basjoo-starter {
        padding: 6px 12px;
        border: 1px solid ${theme.border};
        border-radius: 999px;
        background: ${theme.surfaceRaised};
        color: ${theme.textPrimary};
        font-size: 13px;
        cursor: pointer;
      }

      .basjoo-starter:hover {
        border-color: ${this.config.themeColor};
      }

      /* #43: outside business hours the composer is replaced by this. */
      .basjoo-away {
        padding: 16px 20px 24px 20px;
        border-top: 1px solid ${theme.border};
        background: ${theme.surfaceRaised};
        color: ${theme.textMuted};
        font-size: 13px;
        line-height: 1.5;
        flex-shrink: 0;
      }

      .basjoo-input-area[hidden] {
        display: none;
      }

      .basjoo-messages {
        flex: 1;
        overflow-y: auto;
        padding: ${theme.space5};
        display: flex;
        flex-direction: column;
        gap: ${theme.space4};
        background: ${theme.surfaceSunken};
      }

      #basjoo-widget-container .basjoo-message {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        max-width: 85%;
        min-width: 0;
        width: fit-content;
        animation: basjoo-message-fadein 0.3s ease-out;
      }

      #basjoo-widget-container .basjoo-message-user {
        align-self: flex-end;
        align-items: flex-end;
      }

      #basjoo-widget-container .basjoo-message-assistant {
        align-self: flex-start;
        align-items: flex-start;
      }

      #basjoo-widget-container .basjoo-message-content {
        display: block;
        align-self: flex-start;
        width: fit-content;
        max-width: 100%;
        min-width: 0;
        padding: ${theme.space3} ${theme.space4};
        border-radius: ${theme.radiusLg};
        font-size: 14px;
        line-height: ${theme.leadingNormal};
        white-space: pre-wrap;
        word-break: break-word;
        overflow-wrap: anywhere;
      }

      #basjoo-widget-container .basjoo-message-user .basjoo-message-content {
        align-self: flex-end;
      }

      #basjoo-widget-container .basjoo-message-content > * {
        display: block;
        max-width: 100%;
      }

      #basjoo-widget-container .basjoo-message-content p,
      #basjoo-widget-container .basjoo-message-content ul,
      #basjoo-widget-container .basjoo-message-content ol,
      #basjoo-widget-container .basjoo-message-content pre,
      #basjoo-widget-container .basjoo-message-content blockquote {
        margin: 0 0 10px;
      }

      #basjoo-widget-container .basjoo-message-content p:last-child,
      #basjoo-widget-container .basjoo-message-content ul:last-child,
      #basjoo-widget-container .basjoo-message-content ol:last-child,
      #basjoo-widget-container .basjoo-message-content pre:last-child,
      #basjoo-widget-container .basjoo-message-content blockquote:last-child {
        margin-bottom: 0;
      }

      #basjoo-widget-container .basjoo-message-content ul,
      #basjoo-widget-container .basjoo-message-content ol {
        padding-left: 18px;
      }

      #basjoo-widget-container .basjoo-message-content code {
        font-family: SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace;
        font-size: 12px;
        background: ${theme.surfaceSunken};
        padding: 1px ${theme.space1};
        border-radius: ${theme.radiusSm};
      }

      #basjoo-widget-container .basjoo-message-content pre {
        background: ${theme.surfaceSunken};
        color: ${theme.textPrimary};
        padding: 10px ${theme.space3};
        border-radius: ${theme.radiusMd};
        overflow-x: auto;
      }

      #basjoo-widget-container .basjoo-message-content pre code {
        background: transparent;
        padding: 0;
        color: inherit;
      }

      #basjoo-widget-container .basjoo-message-content a {
        color: ${this.adjustColor(this.config.themeColor, -10)};
        text-decoration: underline;
      }

      #basjoo-widget-container .basjoo-message-content blockquote {
        padding-left: ${theme.space3};
        border-left: 3px solid ${theme.border};
        color: ${theme.textMuted};
      }

      #basjoo-widget-container .basjoo-message-user .basjoo-message-content {
        background: ${this.config.themeColor};
        color: ${theme.accentContrast};
        border-bottom-right-radius: ${theme.radiusSm};
      }

      #basjoo-widget-container .basjoo-message-user .basjoo-message-content a {
        color: ${theme.accentContrast};
      }

      #basjoo-widget-container .basjoo-message-user .basjoo-message-content code {
        background: ${this.hexToRgba(theme.accentContrast, 0.2)};
        color: ${theme.accentContrast};
      }

      #basjoo-widget-container .basjoo-message-assistant .basjoo-message-content {
        background: ${theme.surfaceRaised};
        color: ${theme.textPrimary};
        border-bottom-left-radius: ${theme.radiusSm};
      }

      #basjoo-widget-container .basjoo-message-error .basjoo-message-content {
        background: ${theme.errorBg};
        color: ${theme.error};
        border: 1px solid ${theme.error};
      }

      .basjoo-stream-cursor {
        display: inline-block;
        width: 0.5rem;
        height: 1em;
        margin-left: 0.12rem;
        vertical-align: text-bottom;
        background: ${this.config.themeColor};
        animation: basjoo-cursor-blink 1s steps(1) infinite;
      }

      @keyframes basjoo-cursor-blink {
        0%, 50% { opacity: 1; }
        50.01%, 100% { opacity: 0; }
      }

      .basjoo-loading {
        display: flex;
        gap: ${theme.space1};
        padding: ${theme.space3} ${theme.space4} !important;
        align-self: flex-start;
        margin-top: ${theme.space1} !important;
      }

      .basjoo-loading-dot {
        width: 8px;
        height: 8px;
        border-radius: ${theme.radiusFull};
        background: ${theme.textMuted};
        animation: basjoo-bounce 1.4s infinite ease-in-out both;
      }

      .basjoo-loading-dot:nth-child(1) { animation-delay: -0.32s; }
      .basjoo-loading-dot:nth-child(2) { animation-delay: -0.16s; }

      @keyframes basjoo-bounce {
        0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
        40% { transform: scale(1); opacity: 1; }
      }

      .basjoo-input-area {
        padding: ${theme.space4} ${theme.space5} ${theme.space6} ${theme.space5} !important;
        border-top: 1px solid ${theme.border};
        display: flex;
        gap: ${theme.space3};
        background: ${theme.surface};
        flex-shrink: 0;
      }

      .basjoo-input {
        flex: 1;
        height: 48px;
        padding: 0 ${theme.space5} !important;
        border: 1px solid ${theme.border};
        border-radius: ${theme.radiusLg};
        font-size: 14px;
        outline: none;
        transition: all 0.2s;
        background: ${theme.surfaceRaised};
        color: ${theme.textPrimary};
        margin-bottom: ${theme.space2} !important;
        margin-left: ${theme.space1} !important;
      }

      .basjoo-input::placeholder {
        color: ${theme.textMuted};
      }

      .basjoo-input:focus {
        border-color: ${this.config.themeColor};
        box-shadow: 0 0 0 3px ${this.hexToRgba(this.config.themeColor, 0.1)};
      }

      .basjoo-send {
        width: 48px;
        height: 48px;
        border: none;
        border-radius: ${theme.radiusFull};
        background: ${this.config.themeColor};
        color: ${theme.accentContrast};
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        flex-shrink: 0;
      }

      .basjoo-send:hover:not(:disabled) {
        transform: scale(1.05);
        box-shadow: 0 4px 12px ${this.hexToRgba(this.config.themeColor, 0.3)};
      }

      .basjoo-send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .basjoo-send svg {
        width: 20px;
        height: 20px;
        stroke: currentColor;
      }

      .basjoo-error {
        padding: ${theme.space3} ${theme.space4};
        background: ${theme.errorBg};
        color: ${theme.error};
        font-size: 13px;
        text-align: center;
        border-top: 1px solid ${theme.error};
      }

      #basjoo-widget-container .basjoo-message-time {
        font-size: 11px;
        color: ${theme.textMuted};
        margin-top: ${theme.space1};
        padding: 0 ${theme.space1};
      }

      #basjoo-widget-container .basjoo-message-user .basjoo-message-time {
        text-align: right;
      }

      .basjoo-thinking {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: ${theme.textMuted};
        font-size: 12px;
        margin-top: ${theme.space2};
      }

      .basjoo-thinking-spinner {
        width: 12px;
        height: 12px;
        border: 2px solid ${this.hexToRgba(this.config.themeColor, 0.2)};
        border-top-color: ${this.config.themeColor};
        border-radius: ${theme.radiusFull};
        animation: basjoo-spin 0.8s linear infinite;
      }

      @keyframes basjoo-spin {
        to { transform: rotate(360deg); }
      }

      @keyframes basjoo-message-fadein {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @media (max-width: 480px) {
        #basjoo-chat-window {
          width: calc(100vw - 32px);
          height: calc(100vh - 120px);
          max-height: 640px;
          bottom: 88px;
          left: ${theme.space4} !important;
          right: ${theme.space4} !important;
        }

        #basjoo-widget-button {
          bottom: ${theme.space4};
          ${this.config.position === 'left' ? 'left' : 'right'}: ${theme.space4};
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Parse the colour shapes an operator can actually supply into 0-255
   * channels: three- and six-digit hex, and an hsl triple with percent
   * saturation and lightness (the console tokens are hsl strings, so the
   * helpers must accept them). Returns null for anything else so the callers
   * can fall back instead of emitting an invalid declaration.
   */
  private parseColor(value: string): { r: number; g: number; b: number } | null {
    const raw = (value || '').trim();

    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
    if (hex) {
      const digits = hex[1];
      const bytes = digits.length === 3
        ? digits.split('').map((digit) => parseInt(digit + digit, 16))
        : [0, 2, 4].map((index) => parseInt(digits.slice(index, index + 2), 16));
      return { r: bytes[0], g: bytes[1], b: bytes[2] };
    }

    const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(raw);
    if (hsl) {
      const hue = ((Number.parseFloat(hsl[1]) % 360) + 360) % 360;
      const saturation = Number.parseFloat(hsl[2]) / 100;
      const lightness = Number.parseFloat(hsl[3]) / 100;
      const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
      const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
      const offset = lightness - chroma / 2;
      let rgb: [number, number, number];
      if (hue < 60) rgb = [chroma, second, 0];
      else if (hue < 120) rgb = [second, chroma, 0];
      else if (hue < 180) rgb = [0, chroma, second];
      else if (hue < 240) rgb = [0, second, chroma];
      else if (hue < 300) rgb = [second, 0, chroma];
      else rgb = [chroma, 0, second];
      return {
        r: Math.round((rgb[0] + offset) * 255),
        g: Math.round((rgb[1] + offset) * 255),
        b: Math.round((rgb[2] + offset) * 255),
      };
    }

    return null;
  }

  /** Lighten (positive) or darken (negative) every channel by `amount`. */
  private adjustColor(color: string, amount: number): string {
    const parsed = this.parseColor(color);
    if (!parsed) {
      return color;
    }

    const clamp = (channel: number) => Math.max(0, Math.min(255, channel + amount));
    const r = clamp(parsed.r);
    const g = clamp(parsed.g);
    const b = clamp(parsed.b);

    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  private hexToRgba(color: string, alpha: number): string {
    const parsed = this.parseColor(color) ?? this.parseColor(DEFAULT_ACCENT);
    const { r, g, b } = parsed ?? { r: 0, g: 0, b: 0 };
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private updateUnreadBadge() {
    if (!this.button) {
      return;
    }

    if (this.hasUnread) {
      if (!this.unreadBadge) {
        const badge = document.createElement('span');
        badge.className = 'basjoo-unread-badge';
        badge.textContent = '1';
        this.button.appendChild(badge);
        this.unreadBadge = badge;
      }
      return;
    }

    this.unreadBadge?.remove();
    this.unreadBadge = null;
  }

  /**
   * 创建容器
   */
  private createContainer() {
    this.container = document.createElement('div');
    this.container.id = 'basjoo-widget-container';
    document.body.appendChild(this.container);
  }

  /**
   * 创建浮动按钮
   */
  private createButton() {
    this.button = document.createElement('div');
    this.button.id = 'basjoo-widget-button';
    this.button.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
    `;
    this._buttonClickListener = () => this.toggle();
    this.button.addEventListener('click', this._buttonClickListener);
    this.container!.appendChild(this.button);
    this.updateUnreadBadge();
  }

  /**
   * 创建聊天窗口
   */
  private createChatWindow() {
    this.chatWindow = document.createElement('div');
    this.chatWindow.id = 'basjoo-chat-window';

    const safeLogoUrl = this.config.logoUrl ? this.sanitizeUrlAttribute(this.config.logoUrl) : '';
    const safeTitle = this.escapeHtml(this.config.title);
    const safePlaceholder = this.escapeHtml(this.getText('inputPlaceholder'));
    const safeHumanLabel = this.escapeHtml(this.getText('talkToHuman'));

    this.chatWindow.innerHTML = `
      <div class="basjoo-header">
        <div class="basjoo-header-title">
          ${safeLogoUrl ? `<img src="${safeLogoUrl}" class="basjoo-header-logo" alt="">` : ''}
          <span>${safeTitle}</span>
        </div>
        <div class="basjoo-header-actions">
          <button class="basjoo-human" type="button" aria-label="${safeHumanLabel}" title="${safeHumanLabel}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="8.5" cy="7" r="4"></circle>
              <polyline points="17 11 19 13 23 9"></polyline>
            </svg>
            <span class="basjoo-human-label">${safeHumanLabel}</span>
          </button>
          <button class="basjoo-close" type="button" aria-label="${this.escapeHtml(this.getText('closeWindow'))}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
      <div class="basjoo-notice" hidden></div>
      <div class="basjoo-messages"></div>
      <div class="basjoo-input-area">
        <input type="text" class="basjoo-input" placeholder="${safePlaceholder}" maxlength="2000">
        <button class="basjoo-send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    `;

    const closeBtn = this.chatWindow.querySelector('.basjoo-close') as HTMLElement;
    this._closeBtnClickListener = () => this.close();
    closeBtn.addEventListener('click', this._closeBtnClickListener);

    const input = this.chatWindow.querySelector('.basjoo-input') as HTMLInputElement;
    const sendBtn = this.chatWindow.querySelector('.basjoo-send') as HTMLButtonElement;

    this._sendBtnClickListener = () => {
      if (this.isSending) {
        return;
      }
      const message = input.value.trim();
      if (message) {
        if (message.length > 2000) {
          this.showError(this.getText('messageTooLong'));
          return;
        }
        this.sendMessage(message);
        input.value = '';
      }
    };

    sendBtn.addEventListener('click', this._sendBtnClickListener);
    this._inputKeypressListener = (e: KeyboardEvent) => {
      if (e.key === 'Enter') this._sendBtnClickListener?.();
    };
    input.addEventListener('keypress', this._inputKeypressListener);

    // #43: "Talk to a human" lives in the header. It is hidden outside business
    // hours (no one is there to answer) and while the session is already in
    // human mode.
    this.headerHumanButton = this.chatWindow.querySelector(
      '.basjoo-human'
    ) as HTMLButtonElement | null;
    this._humanBtnClickListener = () => {
      void this.requestHumanHandoff();
    };
    this.headerHumanButton?.addEventListener('click', this._humanBtnClickListener);

    this.container!.appendChild(this.chatWindow);

    this.applyBusinessHoursState();
    this.renderModeNotice();
  }

  /**
   * #43: re-read `online` every minute so a widget left open across the closing
   * time flips within one minute instead of staying open until reload.
   *
   * Only the online/away fields are touched — the title, colour and welcome
   * message the visitor already saw are never rewritten by a poll.
   */
  private startOnlineWatcher() {
    if (this.onlineCheckIntervalId) return;

    this.onlineCheckIntervalId = window.setInterval(() => {
      void this.refreshOnlineState();
    }, 60_000);
  }

  private stopOnlineWatcher() {
    if (this.onlineCheckIntervalId) {
      window.clearInterval(this.onlineCheckIntervalId);
      this.onlineCheckIntervalId = null;
    }
  }

  private async refreshOnlineState() {
    if (!this.config.apiBase) return;

    try {
      const url = new URL(`${this.config.apiBase}/api/v1/config:public`);
      if (this.config.agentId) {
        url.searchParams.set('agent_id', this.config.agentId);
      }
      const response = await fetch(url.toString());
      if (!response.ok) return;

      const data = (await response.json()) as PublicWidgetConfig;
      const nextOnline = data.online !== false;
      const nextAway = (data.away_message || '').trim();
      if (nextOnline === this.isOnline && nextAway === this.awayMessage) {
        return;
      }

      this.isOnline = nextOnline;
      this.awayMessage = nextAway;
      this.applyBusinessHoursState();
    } catch (error) {
      // A transient failure must not close the composer the visitor is using.
      console.warn('[Basjoo Widget] Could not refresh the business-hours state.', error);
    }
  }

  /**
   * #43: outside business hours the composer is replaced by the away message
   * (falling back to a sensible default) and the human affordance is hidden.
   *
   * #46: the same placeholder carries the "sign in first" line for an agent
   * that signs visitors, because the two reasons for a closed composer are
   * mutually exclusive and look identical to the visitor. Without it a host
   * page that never calls `Basjoo.identify()` would send a message, earn a 403
   * and only then learn why — the sentence reads much better *before* the send.
   */
  private applyBusinessHoursState() {
    if (!this.chatWindow) return;

    const inputArea = this.chatWindow.querySelector('.basjoo-input-area') as HTMLElement | null;
    const away = this.chatWindow.querySelector('.basjoo-away') as HTMLElement | null;

    const signedIdentityMissing = this.identityRequired && !this.identitySigned;
    const blockedMessage = !this.isOnline
      ? this.awayMessage || this.getText('awayDefault')
      : signedIdentityMissing
        ? this.getText('identityRequired')
        : null;

    if (blockedMessage === null) {
      if (inputArea) inputArea.hidden = false;
      away?.remove();
    } else {
      if (inputArea) inputArea.hidden = true;
      if (!away) {
        const awayEl = document.createElement('div');
        awayEl.className = 'basjoo-away';
        awayEl.setAttribute('role', 'status');
        awayEl.textContent = blockedMessage;
        this.chatWindow.appendChild(awayEl);
      } else {
        away.textContent = blockedMessage;
      }
    }

    if (this.headerHumanButton) {
      this.headerHumanButton.hidden =
        !this.isOnline || this.sessionMode === 'human' || signedIdentityMissing;
    }
  }

  /**
   * #43: the notice bar shown while a human is expected to answer, with the
   * "Continue with AI" action that puts the session back into `ai` mode.
   */
  private renderModeNotice() {
    if (!this.chatWindow) return;

    const bar = this.chatWindow.querySelector('.basjoo-notice') as HTMLElement | null;
    if (!bar) return;

    if (this.sessionMode !== 'human') {
      bar.hidden = true;
      bar.textContent = '';
      this.humanNoticeBar = null;
      this._continueAiClickListener = null;
      if (this.headerHumanButton) {
        // #46: an unsigned visitor on a signing agent has no affordance either.
        this.headerHumanButton.hidden =
          !this.isOnline || (this.identityRequired && !this.identitySigned);
      }
      return;
    }

    if (this.headerHumanButton) {
      this.headerHumanButton.hidden = true;
    }

    if (this.humanNoticeBar === bar) {
      return;
    }

    bar.textContent = '';
    bar.hidden = false;

    const label = document.createElement('span');
    label.className = 'basjoo-notice-text';
    label.textContent = this.getText('takenOverNotice');

    const continueButton = document.createElement('button');
    continueButton.type = 'button';
    continueButton.className = 'basjoo-continue-ai';
    continueButton.textContent = this.getText('continueWithAi');
    this._continueAiClickListener = () => {
      void this.releaseToAi();
    };
    continueButton.addEventListener('click', this._continueAiClickListener);

    bar.appendChild(label);
    bar.appendChild(continueButton);
    this.humanNoticeBar = bar;
  }

  private setSessionMode(mode: 'ai' | 'human') {
    this.sessionMode = mode;
    this.applyBusinessHoursState();
    this.renderModeNotice();
  }
  /**
   * #43: ask for a human. Sets `mode="human"` server-side; `status` is
   * untouched, so the operator can still release the visitor back to the bot.
   */
  private async requestHumanHandoff() {
    if (!this.sessionId) {
      this.showError(this.getText('humanNeedsSession'));
      return;
    }

    try {
      const response = await fetch(`${this.config.apiBase}/api/v1/chat/escalate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: this.config.agentId,
          session_id: this.sessionId,
          visitor_id: this.visitorId,
          reason: this.getText('talkToHuman'),
        }),
      });

      if (!response.ok) {
        if (await this.reportIdentityRejection(response)) {
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      this.setSessionMode('human');
      this.addMessage({
        role: 'assistant',
        content: this.getText('takenOverNotice'),
        timestamp: new Date(),
      });
      this.startPolling();
    } catch (error) {
      console.error('[Basjoo Widget] Failed to request a human handoff:', error);
      this.showError(this.getText('humanFailed'));
    }
  }

  /**
   * #46: turn a rejected identity into a sentence in the chat window.
   *
   * `/chat/escalate`, `/chat/release` and `/chat/messages` answer a forged or
   * missing identity with 403 `identity_mismatch`. Those routes are not the SSE
   * surface, so the code arrives in a JSON `detail`; without this the visitor
   * would get the route's generic fallback line ("Could not reach a human
   * agent") for what is really "sign in again".
   *
   * Returns `true` when the response was an identity rejection and has been
   * reported, so the caller can stop and not also show its own message.
   */
  private async reportIdentityRejection(response: Response): Promise<boolean> {
    if (response.status !== 403) {
      return false;
    }

    try {
      const payload = (await response.json()) as {
        detail?: string;
        code?: string;
      };
      if (payload?.detail !== 'identity_mismatch' && payload?.code !== 'identity_mismatch') {
        return false;
      }
    } catch {
      return false;
    }

    this.showError(this.getText('identityMismatch'));
    return true;
  }

  /**
   * #43: "Continue with AI". The admin release route needs an operator token,
   * so the widget calls the ownership-checked public counterpart.
   */
  private async releaseToAi() {
    if (!this.sessionId) return;

    try {
      const response = await fetch(`${this.config.apiBase}/api/v1/chat/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: this.config.agentId,
          session_id: this.sessionId,
          visitor_id: this.visitorId,
        }),
      });

      if (!response.ok) {
        if (await this.reportIdentityRejection(response)) {
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      this.setSessionMode('ai');
    } catch (error) {
      console.error('[Basjoo Widget] Failed to release the session to AI:', error);
      this.showError(this.getText('humanFailed'));
    }
  }

  /**
   * 切换聊天窗口
   */
  private toggle() {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.open();
  }

  /**
   * `restore` skips the focus side effect: restoring a remembered state must not
   * steal focus from whatever the visitor was doing on the host page.
   */
  private open(restore = false) {
    this.isOpen = true;
    this.chatWindow?.classList.remove('closing');
    this.chatWindow?.classList.add('open');
    this.persistOpenState();
    this.stopTitleBlink();
    this.updateUnreadBadge();
    const input = this.chatWindow?.querySelector('.basjoo-input') as HTMLInputElement | null;
    setTimeout(() => {
      // #43: outside business hours the composer is hidden, so there is nothing
      // to focus (focusing a hidden input throws in some browsers).
      if (input && !input.closest('.basjoo-input-area[hidden]') && !restore) {
        input.focus();
      }
    }, 300);
  }

  private close() {
    this.isOpen = false;
    this.chatWindow?.classList.remove('open');
    this.chatWindow?.classList.add('closing');
    this.persistOpenState();
  }

  /**
   * #40: the reopen asymmetry — the open state is only *written* on a fine
   * pointer, so a phone visitor never comes back to a full-screen takeover.
   */
  private persistOpenState(): void {
    if (!this.hasFinePointer()) {
      return
    }
    this.storage.setItem(this.openStateStorageKey, this.isOpen ? 'open' : 'closed')
  }

  private getRequestLocale(): string {
    if (this.config.language && this.config.language !== 'auto') {
      return this.config.language
    }

    return navigator.language || 'en-US'
  }

  /**
   * Get localized text based on language setting
   */
  private getText(key: 'sendFailed' | 'networkError' | 'quotaExceeded' | 'takenOverNotice' | 'inputPlaceholder' | 'messageTooLong' | 'greetingBubble' | 'newMessage' | 'thinking' | 'references' | 'talkToHuman' | 'continueWithAi' | 'awayDefault' | 'closeWindow' | 'humanNeedsSession' | 'humanFailed' | 'degradedNotice' | 'identityMismatch' | 'identityRequired'): string {
    const texts: Record<string, Record<string, string>> = {
      sendFailed: { 'en-US': 'Send failed, please try again later', 'zh-CN': '发送失败，请稍后重试' },
      networkError: { 'en-US': 'Network connection failed, please check your connection', 'zh-CN': '网络连接失败，请检查网络' },
      quotaExceeded: { 'en-US': 'Daily message limit reached', 'zh-CN': '今日消息已达上限' },
      takenOverNotice: { 'en-US': 'Your conversation has been transferred to a human agent. Please wait for their reply.', 'zh-CN': '已转接人工客服，请等待回复。' },
      inputPlaceholder: { 'en-US': 'Type your question...', 'zh-CN': '输入您的问题...' },
      messageTooLong: { 'en-US': 'Message too long (max 2000 characters)', 'zh-CN': '消息过长（最多2000字符）' },
      greetingBubble: { 'en-US': 'Hi! How can I help you?', 'zh-CN': '你好！有什么可以帮您？' },
      newMessage: { 'en-US': 'New message', 'zh-CN': '新消息' },
      thinking: { 'en-US': 'Thinking...', 'zh-CN': '思考中...' },
      references: { 'en-US': 'References', 'zh-CN': '参考来源' },
      talkToHuman: { 'en-US': 'Talk to a human', 'zh-CN': '转人工' },
      continueWithAi: { 'en-US': 'Continue with AI', 'zh-CN': '继续由 AI 回答' },
      awayDefault: { 'en-US': 'We are away right now. Leave a message and we will get back to you.', 'zh-CN': '当前非服务时间，请留言，我们会尽快回复。' },
      closeWindow: { 'en-US': 'Close', 'zh-CN': '关闭' },
      humanNeedsSession: { 'en-US': 'Send a message first, then you can ask for a human.', 'zh-CN': '请先发送一条消息，然后再转人工。' },
      humanFailed: { 'en-US': 'Could not reach a human agent. Please try again.', 'zh-CN': '转人工失败，请稍后重试。' },
      degradedNotice: { 'en-US': 'Quota reached — answering with the fallback model', 'zh-CN': '额度用尽，已使用备用模型' },
      identityMismatch: { 'en-US': 'We could not verify your identity. Please refresh the page and sign in again.', 'zh-CN': '无法验证您的身份，请刷新页面并重新登录。' },
      identityRequired: { 'en-US': 'Please sign in on this page to start chatting.', 'zh-CN': '请先在本页面登录，然后再开始对话。' },
    };

    const locale = this.getRequestLocale().toLowerCase()
    return locale.startsWith('zh')
      ? texts[key]['zh-CN'] || texts[key]['en-US'] || key
      : texts[key]['en-US'] || texts[key]['zh-CN'] || key
  }

  /**
   * 将纯文本安全转义为HTML
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Sanitise a URL to be safe for use in an HTML attribute (e.g. src/href).
   * Only allows http/https URLs and strips anything else.
   */
  private sanitizeUrlAttribute(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return this.escapeHtml(url);
      }
    } catch { /* invalid URL */ }
    return '';
  }

  /**
   * 安全渲染基础 Markdown
   */
  private renderMarkdown(markdown: string): string {
    if (!markdown) {
      return '';
    }

    const blocks = markdown
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);

    const renderInline = (text: string): string => {
      let html = this.escapeHtml(text);
      html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
      html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
      html = html.replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');
      html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => {
        const safeLabel = label;
        const safeUrl = this.sanitizeUrlAttribute(url);
        if (!safeUrl) {
          return safeLabel;
        }
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
      });
      return html;
    };

    const renderedBlocks = blocks.map((block) => {
      if (/^```/.test(block) && /```$/.test(block)) {
        const code = block.replace(/^```\w*\n?/, '').replace(/```$/, '');
        return `<pre><code>${this.escapeHtml(code)}</code></pre>`;
      }

      if (/^(?:[-*]\s.+\n?)+$/.test(block)) {
        const items = block
          .split('\n')
          .map((line) => line.replace(/^[-*]\s+/, '').trim())
          .filter(Boolean)
          .map((line) => `<li>${renderInline(line)}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }

      if (/^(?:\d+\.\s.+\n?)+$/.test(block)) {
        const items = block
          .split('\n')
          .map((line) => line.replace(/^\d+\.\s+/, '').trim())
          .filter(Boolean)
          .map((line) => `<li>${renderInline(line)}</li>`)
          .join('');
        return `<ol>${items}</ol>`;
      }

      if (/^>\s?/.test(block)) {
        const quote = block
          .split('\n')
          .map((line) => line.replace(/^>\s?/, ''))
          .join('<br>');
        return `<blockquote>${renderInline(quote)}</blockquote>`;
      }

      if (/^#{1,6}\s/.test(block)) {
        const headingText = block.replace(/^#{1,6}\s+/, '');
        return `<p><strong>${renderInline(headingText)}</strong></p>`;
      }

      return `<p>${renderInline(block).replace(/\n/g, '<br>')}</p>`;
    });

    return renderedBlocks.join('');
  }

  private updateMessageContent(element: HTMLElement, content: string, includeCursor = false): void {
    element.innerHTML = this.renderMarkdown(content) + (includeCursor ? '<span class="basjoo-stream-cursor"></span>' : '');
  }

  private createMessageElement(message: ChatMessage): HTMLDivElement {
    const messageDiv = document.createElement('div');
    messageDiv.className = `basjoo-message basjoo-message-${message.role}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'basjoo-message-content';

    if (message.role === 'assistant') {
      const formattedMessage = formatAssistantMessage(message.content, message.sources);
      const referenceMarkdown = formattedMessage.references.length > 0
        ? `\n\n**${this.getText('references')}**\n${formattedMessage.references.map((reference) => `- [${reference.title}](${reference.url})`).join('\n')}`
        : '';
      this.updateMessageContent(contentDiv, formattedMessage.content + referenceMarkdown);
    } else {
      this.updateMessageContent(contentDiv, message.content);
    }

    messageDiv.appendChild(contentDiv);

    const timeDiv = document.createElement('div');
    timeDiv.className = 'basjoo-message-time';
    timeDiv.textContent = message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    messageDiv.appendChild(timeDiv);

    return messageDiv;
  }

  private formatThinkingText(): string {
    return `${this.getText('thinking')} ${this.thinkingElapsed}s`;
  }

  private showThinkingIndicator(elapsed = 0): void {
    this.hideLoading();
    if (!this.currentStreamContent.trim()) {
      this.streamingMessage?.remove();
      this.streamingMessage = null;
      this.streamingMessageContent = null;
    }
    this.thinkingElapsed = elapsed;
    const messagesContainer = this.chatWindow?.querySelector('.basjoo-messages') as HTMLElement | null;
    if (!messagesContainer) {
      return;
    }

    if (!this.thinkingIndicator) {
      const indicator = document.createElement('div');
      indicator.className = 'basjoo-thinking';
      indicator.innerHTML = `
        <span class="basjoo-thinking-spinner"></span>
        <span>${this.getText('thinking')}</span>
      `;
      messagesContainer.appendChild(indicator);
      this.thinkingIndicator = indicator;
      this.thinkingIndicatorText = indicator.querySelector('span:last-child') as HTMLSpanElement | null;
    }

    if (this.thinkingIndicatorText) {
      this.thinkingIndicatorText.textContent = this.formatThinkingText();
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    if (this.thinkingTimerId === null) {
      this.thinkingTimerId = window.setInterval(() => {
        this.thinkingElapsed += 1;
        if (this.thinkingIndicatorText) {
          this.thinkingIndicatorText.textContent = this.formatThinkingText();
        }
      }, 1000);
    }
  }

  private hideThinkingIndicator(): void {
    if (this.thinkingTimerId !== null) {
      window.clearInterval(this.thinkingTimerId);
      this.thinkingTimerId = null;
    }
    this.thinkingIndicator?.remove();
    this.thinkingIndicator = null;
    this.thinkingIndicatorText = null;
    this.thinkingElapsed = 0;
  }

  private removeStreamingMessage(): void {
    this.streamingMessage?.remove();
    this.streamingMessage = null;
    this.streamingMessageContent = null;
    this.currentStreamContent = '';
    this.currentStreamSources = [];
  }

  private createStreamingMessage(includeCursor = false): HTMLDivElement {
    const messagesContainer = this.chatWindow?.querySelector('.basjoo-messages') as HTMLElement | null;
    const messageDiv = document.createElement('div');
    messageDiv.className = 'basjoo-message basjoo-message-assistant';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'basjoo-message-content';
    this.updateMessageContent(contentDiv, this.currentStreamContent, includeCursor);
    messageDiv.appendChild(contentDiv);

    if (!messagesContainer) {
      this.streamingMessage = messageDiv;
      this.streamingMessageContent = contentDiv;
      this.currentStreamContent = '';
      return messageDiv;
    }

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    this.streamingMessage = messageDiv;
    this.streamingMessageContent = contentDiv;
    this.currentStreamContent = '';
    return messageDiv;
  }

  private appendToStreamingMessage(chunk: string): void {
    if (!this.streamingMessage || !this.streamingMessageContent) {
      this.hideThinkingIndicator();
      this.createStreamingMessage();
    }

    this.currentStreamContent += chunk;
    if (this.streamingMessageContent) {
      this.updateMessageContent(this.streamingMessageContent, this.currentStreamContent, true);
    }

    const messagesContainer = this.chatWindow?.querySelector('.basjoo-messages') as HTMLElement | null;
    if (!messagesContainer) {
      return;
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  private finalizeStreamingMessage(sources: Source[] = []): void {
    if (!this.streamingMessage || !this.streamingMessageContent) {
      return;
    }

    if (!this.currentStreamContent.trim()) {
      this.removeStreamingMessage();
      return;
    }

    const cursor = this.streamingMessage.querySelector('.basjoo-stream-cursor');
    cursor?.remove();
    this.currentStreamSources = sources;
    const formattedMessage = formatAssistantMessage(this.currentStreamContent, sources);
    const referenceMarkdown = formattedMessage.references.length > 0
      ? `\n\n**${this.getText('references')}**\n${formattedMessage.references.map((reference) => `- [${reference.title}](${reference.url})`).join('\n')}`
      : '';
    const finalContent = formattedMessage.content + referenceMarkdown;
    this.updateMessageContent(this.streamingMessageContent, finalContent);

    this.messages.push({
      role: 'assistant',
      content: finalContent,
      sources,
      timestamp: new Date(),
    });

    const messagesContainer = this.chatWindow?.querySelector('.basjoo-messages') as HTMLElement;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    this.streamingMessage = null;
    this.streamingMessageContent = null;
    this.currentStreamContent = '';
    this.currentStreamSources = [];
  }

  /**
   * 添加消息到界面
   */
  private addMessage(message: ChatMessage) {
    this.messages.push(message);
    const messagesContainer = this.chatWindow?.querySelector('.basjoo-messages') as HTMLElement | null;

    if (!message.content) {
      console.error('Message content is null or undefined:', message);
      return;
    }

    if (!messagesContainer) {
      return;
    }

    const messageDiv = this.createMessageElement(message);
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    if (message.role === 'assistant' && !this.isOpen) {
      this.hasUnread = true;
      this.updateUnreadBadge();
    }
  }

  /**
   * 显示加载动画
   */
  private showLoading() {
    const messagesContainer = this.chatWindow?.querySelector('.basjoo-messages') as HTMLElement | null;
    if (!messagesContainer) {
      return;
    }

    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'basjoo-loading';
    loadingDiv.id = 'basjoo-loading';
    loadingDiv.innerHTML = `
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
    `;
    messagesContainer.appendChild(loadingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  /**
   * 移除加载动画
   */
  private hideLoading() {
    const loading = this.chatWindow?.querySelector('#basjoo-loading');
    loading?.remove();
  }

  /**
   * 显示错误
   */
  private showError(message: string) {
    const messagesContainer = this.chatWindow?.querySelector('.basjoo-messages') as HTMLElement | null;
    if (!messagesContainer) {
      return;
    }

    const errorDiv = document.createElement('div');
    errorDiv.className = 'basjoo-error';
    errorDiv.textContent = message;
    messagesContainer.appendChild(errorDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    setTimeout(() => errorDiv.remove(), 5000);
  }

  /**
   * #44: one line under an answer that came from the fallback model. The SSE
   * `done` event carries the flag; the model name is appended when the backend
   * sent one. Purely informational — it is not a message and is not persisted.
   */
  private showDegradedNotice(model?: string | null) {
    const messagesContainer = this.chatWindow?.querySelector('.basjoo-messages') as HTMLElement | null;
    if (!messagesContainer) {
      return;
    }

    const notice = document.createElement('div');
    notice.className = 'basjoo-degraded';
    notice.setAttribute('role', 'status');
    notice.textContent = model
      ? `${this.getText('degradedNotice')} · ${model}`
      : this.getText('degradedNotice');
    messagesContainer.appendChild(notice);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  /**
   * 开始轮询新消息（人工接管后管理员发送的消息）
   */
  private startPolling() {
    if (this.pollIntervalId) return;
    this.pollIntervalId = window.setInterval(() => this.pollMessages(), 3000);
  }

  /**
   * 停止轮询
   */
  private stopPolling() {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  /**
   * 轮询拉取新消息
   */
  private async pollMessages() {
    if (!this.sessionId) return;

    try {
      const response = await fetch(
        `${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&visitor_id=${encodeURIComponent(this.visitorId)}&after_id=${this.lastMessageId}&role=assistant`
      );
      if (!response.ok) return;

      const messages = await response.json() as ChatHistoryMessage[];
      for (const msg of messages) {
        if (msg.content) {
          this.addMessage({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content,
            sources: msg.sources,
            timestamp: new Date(),
          });
          if (!this.isOpen) {
            this.startTitleBlink();
          }
        }
        if (msg.id > this.lastMessageId) {
          this.lastMessageId = msg.id;
        }
      }
    } catch {
      // 轮询失败静默忽略
    }
  }

  /**
   * Unified cleanup after any stream termination path.
   * Hides transient UI states and removes incomplete streaming content.
   */
  private cleanupAfterStreamError() {
    this.hideLoading();
    this.hideThinkingIndicator();
    this.removeStreamingMessage();
  }

  private async consumeStream(response: Response): Promise<void> {
    if (!response.body) {
      throw new Error('Streaming response body is unavailable');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let streamCompleted = false;

    const processEvent = (rawEvent: string) => {
      if (!rawEvent.trim()) {
        return;
      }

      let eventName = 'message';
      const dataLines: string[] = [];

      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      if (!dataLines.length) {
        return;
      }

      const payload = JSON.parse(dataLines.join('\n')) as StreamEventPayload | StreamDoneMeta | StreamErrorPayload;

      switch (eventName) {
        case 'sources':
          this.currentStreamSources = Array.isArray((payload as StreamEventPayload).sources)
            ? (payload as StreamEventPayload).sources!
            : [];
          break;
        case 'thinking':
          this.showThinkingIndicator(typeof (payload as StreamEventPayload).elapsed === 'number'
            ? (payload as StreamEventPayload).elapsed!
            : 0);
          break;
        case 'thinking_done':
          this.hideThinkingIndicator();
          break;
        case 'content': {
          const contentChunk = (payload as StreamEventPayload).content || '';
          this.appendToStreamingMessage(contentChunk);
          break;
        }
        case 'done': {
          const donePayload = payload as StreamDoneMeta;
          if (donePayload.session_id) {
            this.sessionId = donePayload.session_id;
            this.storage.setItem(this.STORAGE_KEY, donePayload.session_id);
            this.startPolling();
          }
          if (typeof donePayload.message_id === 'number' && donePayload.message_id > this.lastMessageId) {
            this.lastMessageId = donePayload.message_id;
          }
          if (donePayload.taken_over) {
            this.removeStreamingMessage();
            this.setSessionMode('human');
            this.addMessage({
              role: 'assistant',
              content: this.getText('takenOverNotice'),
              timestamp: new Date(),
            });
          } else {
            if (donePayload.mode === 'human') {
              this.setSessionMode('human');
            }
            this.finalizeStreamingMessage(this.currentStreamSources);
            /* #44: the `done` event carries the flag; one small notice line so
             * the visitor knows the answer came from the fallback model. */
            if (donePayload.degraded) {
              this.showDegradedNotice(donePayload.model);
            }
            if (!this.isOpen) {
              this.startTitleBlink();
            }
          }
          streamCompleted = true;
          break;
        }
        case 'error': {
          const streamErrorPayload = payload as StreamErrorPayload;
          const streamError = new Error(streamErrorPayload.error || 'Stream failed');
          if (streamErrorPayload.code) {
            streamError.name = streamErrorPayload.code;
          }
          throw streamError;
        }
        default:
          break;
      }
    };

    const findEventDelimiter = (): { index: number; length: number } | null => {
      const crlfIndex = buffer.indexOf('\r\n\r\n');
      const lfIndex = buffer.indexOf('\n\n');

      if (crlfIndex === -1 && lfIndex === -1) {
        return null;
      }
      if (crlfIndex === -1) {
        return { index: lfIndex, length: 2 };
      }
      if (lfIndex === -1) {
        return { index: crlfIndex, length: 4 };
      }
      return crlfIndex < lfIndex
        ? { index: crlfIndex, length: 4 }
        : { index: lfIndex, length: 2 };
    };

    const streamReadTimeout = 90_000;

    while (!streamCompleted) {
      // Check if the stream was aborted externally (e.g. new message, widget destroy).
      if (this.streamAbortController?.signal.aborted) {
        reader.cancel();
        return;
      }

      let timeoutId: number | null = null;
      try {
        const { done, value } = await Promise.race([
          reader.read(),
          new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
            timeoutId = window.setTimeout(() => reject(new Error('Stream read timeout')), streamReadTimeout);
          }),
        ]);
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

        let delimiter = findEventDelimiter();
        while (delimiter) {
          const rawEvent = buffer.slice(0, delimiter.index);
          buffer = buffer.slice(delimiter.index + delimiter.length);
          processEvent(rawEvent.replace(/\r\n/g, '\n'));
          if (streamCompleted) {
            break;
          }
          delimiter = findEventDelimiter();
        }

        if (done) {
          break;
        }
      } finally {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
      }
    }

    if (!streamCompleted) {
      if (buffer.trim()) {
        processEvent(buffer);
      }
      if (!streamCompleted) {
        throw new Error('Stream ended unexpectedly');
      }
    }
  }

  /**
   * Abort the active stream and release the reader lock.
   */
  private abortStream() {
    this.streamAbortController?.abort();
    this.streamAbortController = null;
  }

  /**
   * 发送消息
   */
  private async sendMessageWithRetry(message: string): Promise<void> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= 1; attempt++) {
      // Abort any prior stream before starting a new attempt.
      this.abortStream();
      this.streamAbortController = new AbortController();

      try {
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        const response = await fetch(`${this.config.apiBase}/api/v1/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
          },
          signal: this.streamAbortController.signal,
          body: JSON.stringify({
            agent_id: this.config.agentId,
            message,
            locale: this.getRequestLocale(),
            session_id: this.sessionId || undefined,
            visitor_id: this.visitorId,
            timezone: userTimezone,
            // #40: the two page-context slots. Sent verbatim; the server wraps
            // them in a labelled block and states they are not instructions.
            context_before: BasjooWidget.pageContext.before || undefined,
            context_after: BasjooWidget.pageContext.after || undefined,
          }),
        });

        if (!response.ok) {
          let detail = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const errorPayload = await response.json();
            detail = errorPayload.message || errorPayload.detail || detail;
          } catch {
            // ignore non-JSON error bodies
          }
          throw new Error(detail);
        }

        this.hideLoading();
        await this.consumeStream(response);
        return;
      } catch (error: any) {
        lastError = error;
        const errorText = String(error?.message || '');
        const hasPartialContent = this.currentStreamContent.trim().length > 0;
        const isRetryable = !hasPartialContent && (
          error instanceof TypeError
          || errorText.includes('fetch')
          || errorText.includes('Failed to fetch')
          || errorText.includes('Stream ended unexpectedly')
        );

        if (!isRetryable || attempt >= 1) {
          this.cleanupAfterStreamError();
          throw error;
        }

        this.cleanupAfterStreamError();
        console.warn(`[Basjoo Widget] Stream attempt ${attempt + 1} failed, retrying...`);
        await new Promise(resolve => window.setTimeout(resolve, 1000));
        this.showLoading();
      }
    }

    throw lastError;
  }

  private async sendMessage(message: string) {
    if (this.isSending) {
      return;
    }

    this.isSending = true;

    this.addMessage({
      role: 'user',
      content: message,
      timestamp: new Date(),
    });

    this.hideLoading();
    this.hideThinkingIndicator();
    this.removeStreamingMessage();
    this.createStreamingMessage(true);

    try {
      await this.sendMessageWithRetry(message);
    } catch (error: any) {
      console.error('[Basjoo Widget] Error sending message:', error);

      let errorMessage = this.getText('sendFailed');
      let consoleHint = '';
      const errorText = String(error?.message || '');

      if (error instanceof TypeError || errorText.includes('fetch')) {
        errorMessage = this.getText('networkError');
        consoleHint = `Request may be blocked by CORS, network connectivity, or an incorrect apiBase. Current apiBase: ${this.config.apiBase || '(not set)'}`;
      } else if (errorText.includes('429') || errorText.toLowerCase().includes('quota')) {
        errorMessage = this.getText('quotaExceeded');
      } else if (error?.name === 'ORIGIN_NOT_ALLOWED' || errorText.toLowerCase().includes('widget origin not allowed')) {
        errorMessage = this.getText('sendFailed');
        consoleHint = 'Widget request was blocked because the current page origin is not on the allowed domain list.';
      } else if (error?.name === 'identity_mismatch' || errorText.includes('identity_mismatch')) {
        /* #46: the agent signs visitors and this one's hash did not verify —
         * usually a stale hash in the host page, or `identify()` never called.
         * A readable sentence, not a bare 403. */
        errorMessage = this.getText('identityMismatch');
        consoleHint = 'Signed visitor identity rejected: recompute hmac_sha256(identity_secret, email) for the signed-in visitor and pass it to Basjoo.identify({ email, hash }).';
      } else if (errorText.includes('401')) {
        consoleHint = 'Authentication failed. Please check the agent configuration and public API access.';
      }

      if (!this.config.apiBase) {
        consoleHint = 'apiBase could not be determined. When embedding the widget from a local file, set apiBase explicitly or load the SDK from the target server.';
      }

      if (consoleHint) {
        console.error('[Basjoo Widget]', consoleHint);
      }

      this.showError(errorMessage);
    } finally {
      this.isSending = false;
    }
  }

  /**
   * 销毁Widget
   */
  destroy() {
    BasjooWidget.instances = BasjooWidget.instances.filter((instance) => instance !== this);
    // 停止轮询和标题闪烁
    this.stopPolling();
    this.stopTitleBlink();
    this.stopOnlineWatcher();
    this.hideThinkingIndicator();
    this.removeStreamingMessage();

    // Abort any active stream request.
    this.abortStream();

    // Remove tracked event listeners.
    if (this.button && this._buttonClickListener) {
      this.button.removeEventListener('click', this._buttonClickListener);
    }
    const closeBtn = this.chatWindow?.querySelector('.basjoo-close') as HTMLElement | null;
    if (closeBtn && this._closeBtnClickListener) {
      closeBtn.removeEventListener('click', this._closeBtnClickListener);
    }
    const sendBtn = this.chatWindow?.querySelector('.basjoo-send') as HTMLButtonElement | null;
    if (sendBtn && this._sendBtnClickListener) {
      sendBtn.removeEventListener('click', this._sendBtnClickListener);
    }
    const input = this.chatWindow?.querySelector('.basjoo-input') as HTMLInputElement | null;
    if (input && this._inputKeypressListener) {
      input.removeEventListener('keypress', this._inputKeypressListener);
    }

    // #43 handoff affordances.
    if (this.headerHumanButton && this._humanBtnClickListener) {
      this.headerHumanButton.removeEventListener('click', this._humanBtnClickListener);
    }
    const continueButton = this.humanNoticeBar?.querySelector(
      '.basjoo-continue-ai'
    ) as HTMLButtonElement | null;
    if (continueButton && this._continueAiClickListener) {
      continueButton.removeEventListener('click', this._continueAiClickListener);
    }
    this.humanNoticeBar = null;
    this.headerHumanButton = null;

    // #40: the card and starter rows are destroyed with the container, but their
    // closures outlive a re-render, so drop every reference explicitly.
    this._cardActionListeners = [];
    this._starterClickListeners = [];
    this.iframeElement = null;
    this.mountTarget = null;

    this.container?.remove();
    const styles = document.getElementById('basjoo-widget-styles');
    styles?.remove();
  }
}

// 导出到全局（不使用 export default，避免 ES Module 格式）
(window as any).BasjooWidget = BasjooWidget;

/**
 * #40: `window.Basjoo` is the host page's handle — `setContext` pushes page
 * context, `init` mounts a widget by hand. Exposed as a plain object because
 * the IIFE bundle has no module exports.
 *
 * #46 adds `identify`: the host page computes `hmac_sha256(secret, email)` on
 * its own server and hands `{ email, hash }` across. The secret never reaches
 * the browser, and the widget never computes the digest.
 */
(window as any).Basjoo = {
  Widget: BasjooWidget,
  setContext: (context: { before?: string; after?: string } | null) => BasjooWidget.setContext(context),
  identify: (identity: VisitorIdentity | null | undefined) => {
    // Remember it for a widget that has not mounted yet, then fan out to every
    // live instance (a page may hold more than one widget).
    BasjooWidget.applyIdentity(identity)
  },
  init: (config: WidgetConfig) => {
    const widget = new BasjooWidget(config)
    void widget.init()
    return widget
  },
};

function getSearchParamValue(searchParams: URLSearchParams, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = searchParams.get(key)
    if (value && value.trim()) {
      return value.trim()
    }
  }
  return null
}

function findAutoInitScript(): HTMLScriptElement | null {
  if (document.currentScript instanceof HTMLScriptElement) {
    return document.currentScript
  }

  const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[]
  for (let index = scripts.length - 1; index >= 0; index -= 1) {
    const script = scripts[index]
    const src = script.getAttribute('src') || ''
    if (!src.includes('sdk.js')) {
      continue
    }
    try {
      const url = new URL(src, window.location.href)
      if (getSearchParamValue(url.searchParams, AUTO_INIT_SCRIPT_PARAM_MAP.agentId)) {
        return script
      }
    } catch {
      continue
    }
  }

  return null
}

function getAutoInitConfig(script: HTMLScriptElement): WidgetConfig | null {
  const src = script.getAttribute('src') || script.src
  if (!src) {
    return null
  }

  let url: URL
  try {
    url = new URL(src, window.location.href)
  } catch {
    return null
  }

  const agentId = getSearchParamValue(url.searchParams, AUTO_INIT_SCRIPT_PARAM_MAP.agentId)
  if (!agentId) {
    return null
  }

  const config: WidgetConfig = { agentId }

  const apiBase = getSearchParamValue(url.searchParams, AUTO_INIT_SCRIPT_PARAM_MAP.apiBase)
  if (apiBase) {
    config.apiBase = apiBase
  }

  const themeColor = getSearchParamValue(url.searchParams, AUTO_INIT_SCRIPT_PARAM_MAP.themeColor)
  if (themeColor) {
    config.themeColor = themeColor
  }

  const welcomeMessage = getSearchParamValue(url.searchParams, AUTO_INIT_SCRIPT_PARAM_MAP.welcomeMessage)
  if (welcomeMessage) {
    config.welcomeMessage = welcomeMessage
  }

  const language = getSearchParamValue(url.searchParams, AUTO_INIT_SCRIPT_PARAM_MAP.language)
  if (language) {
    config.language = language
  }

  const position = getSearchParamValue(url.searchParams, AUTO_INIT_SCRIPT_PARAM_MAP.position)
  if (position === 'left' || position === 'right') {
    config.position = position
  }

  const theme = getSearchParamValue(url.searchParams, AUTO_INIT_SCRIPT_PARAM_MAP.theme)
  if (theme === 'light' || theme === 'dark' || theme === 'auto') {
    config.theme = theme
  }

  return config
}

(function bootstrapBasjooWidget() {
  const globalWindow = window as Window & typeof globalThis & {
    __basjooWidgetAutoInitScheduled?: boolean
  }

  // #40: the server-rendered loader carries no `?agent_id=`, so it needs no
  // script scan — the baked literal is the config and the widget starts itself.
  const embedConfig = readEmbedConfig()
  if (embedConfig && typeof embedConfig.agent_id === 'string' && embedConfig.agent_id) {
    if (globalWindow.__basjooWidgetAutoInitScheduled) {
      return
    }
    globalWindow.__basjooWidgetAutoInitScheduled = true

    const startFromEmbed = () => {
      void new BasjooWidget({ agentId: embedConfig.agent_id! }).init()
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startFromEmbed, { once: true })
      return
    }
    startFromEmbed()
    return
  }

  const script = findAutoInitScript()
  if (!script) {
    return
  }

  const config = getAutoInitConfig(script)
  if (!config) {
    return
  }

  if (globalWindow.__basjooWidgetAutoInitScheduled) {
    return
  }
  globalWindow.__basjooWidgetAutoInitScheduled = true

  const start = () => {
    void new BasjooWidget(config).init()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
    return
  }

  start()
})()
