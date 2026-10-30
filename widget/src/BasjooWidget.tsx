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
}

/** Contract C6 shape: day 0 = Monday, minutes from local midnight. */
interface BusinessHoursConfig {
  timezone?: string;
  schedule?: Array<{ day: number; start: number; end: number }>;
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

  constructor(config: WidgetConfig) {
    const apiBase = this.detectApiBase(config.apiBase);
    this.hasTitleOverride = typeof config.title === 'string' && config.title.trim().length > 0;
    this.hasWelcomeMessageOverride = typeof config.welcomeMessage === 'string' && config.welcomeMessage.trim().length > 0;

    this.config = {
      agentId: config.agentId,
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
    this.storage = new StorageAdapter();
    this.sessionId = this.storage.getItem(this.STORAGE_KEY);
    this.visitorId = this.storage.getItem(this.VISITOR_STORAGE_KEY) || this.generateVisitorId();

    this.effectiveTheme = this.getEffectiveTheme();
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
      this.effectiveTheme = this.getEffectiveTheme()
    } catch (error) {
      console.warn('[Basjoo Widget] Failed to load public config, using defaults.', error)
      if (error instanceof TypeError) {
        console.warn('[Basjoo Widget] Public config request may be blocked by CORS, network issues, or an incorrect apiBase:', this.config.apiBase)
      }
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

    await this.loadPublicConfig()

    // 保存原始标题用于闪烁
    this.originalTitle = document.title;

    this.createStyles();
    this.createContainer();
    this.createButton();
    this.createChatWindow();

    // 显示打招呼气泡
    this.showGreetingBubble();

    // 页面加载时立即启动标题闪烁提醒，吸引用户打开聊天窗口
    this.startTitleBlink();

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

    // 欢迎消息
    if (this.config.welcomeMessage) {
      this.addMessage({
        role: 'assistant',
        content: this.config.welcomeMessage,
        timestamp: new Date(),
      });
    }
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
   */
  private applyBusinessHoursState() {
    if (!this.chatWindow) return;

    const inputArea = this.chatWindow.querySelector('.basjoo-input-area') as HTMLElement | null;
    const away = this.chatWindow.querySelector('.basjoo-away') as HTMLElement | null;

    if (this.isOnline) {
      if (inputArea) inputArea.hidden = false;
      away?.remove();
    } else {
      if (inputArea) inputArea.hidden = true;
      if (!away) {
        const awayEl = document.createElement('div');
        awayEl.className = 'basjoo-away';
        awayEl.setAttribute('role', 'status');
        awayEl.textContent = this.awayMessage || this.getText('awayDefault');
        this.chatWindow.appendChild(awayEl);
      } else {
        away.textContent = this.awayMessage || this.getText('awayDefault');
      }
    }

    if (this.headerHumanButton) {
      this.headerHumanButton.hidden = !this.isOnline || this.sessionMode === 'human';
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
        this.headerHumanButton.hidden = !this.isOnline;
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

  private open() {
    this.isOpen = true;
    this.chatWindow?.classList.remove('closing');
    this.chatWindow?.classList.add('open');
    this.stopTitleBlink();
    this.updateUnreadBadge();
    const input = this.chatWindow?.querySelector('.basjoo-input') as HTMLInputElement | null;
    setTimeout(() => {
      // #43: outside business hours the composer is hidden, so there is nothing
      // to focus (focusing a hidden input throws in some browsers).
      if (input && !input.closest('.basjoo-input-area[hidden]')) {
        input.focus();
      }
    }, 300);
  }

  private close() {
    this.isOpen = false;
    this.chatWindow?.classList.remove('open');
    this.chatWindow?.classList.add('closing');
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
  private getText(key: 'sendFailed' | 'networkError' | 'quotaExceeded' | 'takenOverNotice' | 'inputPlaceholder' | 'messageTooLong' | 'greetingBubble' | 'newMessage' | 'thinking' | 'references' | 'talkToHuman' | 'continueWithAi' | 'awayDefault' | 'closeWindow' | 'humanNeedsSession' | 'humanFailed'): string {
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

    this.container?.remove();
    const styles = document.getElementById('basjoo-widget-styles');
    styles?.remove();
  }
}

// 导出到全局（不使用 export default，避免 ES Module 格式）
(window as any).BasjooWidget = BasjooWidget;

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
