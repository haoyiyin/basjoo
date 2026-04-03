/**
 * Basjoo AI Chat Widget
 * 可嵌入的智能聊天组件
 */

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
  turnstileSiteKey?: string;
}

interface TurnstilePublicConfig {
  turnstile_enabled?: boolean;
  turnstile_site_key?: string | null;
  widget_title?: string | null;
  widget_title_i18n?: Record<string, string> | null;
  welcome_message?: string | null;
  welcome_message_i18n?: Record<string, string> | null;
  widget_color?: string | null;
  default_agent_id?: string | null;
}

interface TurnstileApi {
  render: (container: HTMLElement | string, options: Record<string, unknown>) => string;
  execute: (widgetIdOrSelector: string) => void;
  reset: (widgetIdOrSelector: string) => void;
  remove: (widgetIdOrSelector: string) => void;
}

type WindowWithTurnstile = Window & typeof globalThis & {
  turnstile?: TurnstileApi;
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

function replaceSourcePlaceholders(content: string, sources: Source[] = []): string {
  if (!content) {
    return content;
  }

  return content.replace(/\[([^\]]+)\]\(#source-(\d+)\)/g, (_match, label: string, sourceIndexText: string) => {
    const sourceIndex = Number(sourceIndexText) - 1;
    const source = sources[sourceIndex];

    if (!source || source.type !== 'url' || !source.url || !/^https?:\/\//.test(source.url)) {
      return label;
    }

    return `[${label}](${source.url})`;
  });
}

const AUTO_INIT_SCRIPT_PARAM_MAP = {
  agentId: ['agentId', 'agent_id'],
  apiBase: ['apiBase', 'api_base'],
  themeColor: ['themeColor', 'theme_color'],
  welcomeMessage: ['welcomeMessage', 'welcome_message'],
  language: ['language', 'locale'],
  position: ['position'],
  theme: ['theme'],
  turnstileSiteKey: ['turnstileSiteKey', 'turnstile_site_key'],
} as const

const LOCALE_ALIAS_MAP: Record<string, string> = {
  en: 'en-US',
  fr: 'fr-FR',
  ja: 'ja-JP',
  de: 'de-DE',
  es: 'es-ES',
  'zh-hans': 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-sg': 'zh-CN',
  'zh-hant': 'zh-Hant',
  'zh-tw': 'zh-TW',
  'zh-hk': 'zh-HK',
  'zh-mo': 'zh-HK',
}

const WIDGET_LOCALE_DEFAULTS = ['en-US', 'zh-CN'] as const

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
  private effectiveTheme: 'light' | 'dark' = 'light';
  private originalTitle: string = '';
  private titleBlinkInterval: number | null = null;
  private hasUnread = false;
  private pollIntervalId: number | null = null;
  private lastMessageId: number = 0;
  private isSending = false;
  private streamingMessage: HTMLDivElement | null = null;
  private streamingMessageContent: HTMLDivElement | null = null;
  private thinkingIndicator: HTMLDivElement | null = null;
  private thinkingIndicatorText: HTMLSpanElement | null = null;
  private thinkingElapsed = 0;
  private thinkingTimerId: number | null = null;
  private currentStreamContent = '';
  private currentStreamSources: Source[] = [];
  private turnstileSiteKey: string | null = null;
  private turnstileWidgetId: string | null = null;
  private turnstileContainer: HTMLDivElement | null = null;
  private turnstileScriptPromise: Promise<void> | null = null;

  constructor(config: WidgetConfig) {
    const apiBase = this.detectApiBase(config.apiBase);
    this.hasTitleOverride = typeof config.title === 'string' && config.title.trim().length > 0;
    this.hasWelcomeMessageOverride = typeof config.welcomeMessage === 'string' && config.welcomeMessage.trim().length > 0;

    this.config = {
      agentId: config.agentId,
      apiBase,
      themeColor: config.themeColor || '#3B82F6',
      logoUrl: config.logoUrl || buildDefaultLogoUrl(apiBase),
      title: config.title || 'AI助手',
      welcomeMessage: config.welcomeMessage || '你好！有什么可以帮助您的吗？',
      language: config.language || 'auto',
      position: config.position || 'right',
      theme: config.theme || 'auto',
      turnstileSiteKey: config.turnstileSiteKey || '',
    };

    this.STORAGE_KEY = `basjoo_session_${this.config.agentId}`;
    this.sessionId = localStorage.getItem(this.STORAGE_KEY);
    this.visitorId = localStorage.getItem(this.VISITOR_STORAGE_KEY) || this.generateVisitorId();

    this.effectiveTheme = this.getEffectiveTheme();
  }

  private generateVisitorId(): string {
    const visitorId = `visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem(this.VISITOR_STORAGE_KEY, visitorId);
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

  private normalizeLocale(locale?: string | null): string | null {
    if (!locale) {
      return null
    }

    const cleaned = locale.trim().replace(/_/g, '-')
    if (!cleaned) {
      return null
    }

    const parts = cleaned.split('-').filter(Boolean)
    if (parts.length === 0) {
      return null
    }

    const normalizedParts = [parts[0].toLowerCase()]
    for (const part of parts.slice(1)) {
      if (/^[A-Za-z]{4}$/.test(part)) {
        normalizedParts.push(part[0].toUpperCase() + part.slice(1).toLowerCase())
      } else if (/^[A-Za-z]{2,3}$/.test(part)) {
        normalizedParts.push(part.toUpperCase())
      } else {
        normalizedParts.push(part)
      }
    }

    const normalized = normalizedParts.join('-')
    return LOCALE_ALIAS_MAP[normalized.toLowerCase()] || normalized
  }

  private getPreferredLocales(): string[] {
    const locales = new Set<string>()

    const explicitLocale = this.config.language !== 'auto'
      ? this.normalizeLocale(this.config.language)
      : null
    if (explicitLocale) {
      locales.add(explicitLocale)
    } else {
      const browserLocales = Array.isArray(navigator.languages) && navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language]
      for (const locale of browserLocales) {
        const normalized = this.normalizeLocale(locale)
        if (normalized) {
          locales.add(normalized)
        }
      }
    }

    for (const locale of WIDGET_LOCALE_DEFAULTS) {
      locales.add(locale)
    }
    return Array.from(locales)
  }

  private buildLocaleFallbacks(locale?: string | null): string[] {
    const normalized = this.normalizeLocale(locale)
    if (!normalized) {
      return [...WIDGET_LOCALE_DEFAULTS]
    }

    const fallbacks = [normalized]
    const language = normalized.split('-', 1)[0]
    const lowerNormalized = normalized.toLowerCase()

    if (language === 'zh') {
      if (normalized.includes('Hant') || ['zh-tw', 'zh-hk', 'zh-mo'].includes(lowerNormalized)) {
        fallbacks.push('zh-Hant', 'zh-TW', 'zh-HK', 'zh-CN', 'zh')
      } else {
        fallbacks.push('zh-Hans', 'zh-CN', 'zh')
      }
    } else {
      const preferredMap: Record<string, string> = {
        en: 'en-US',
        fr: 'fr-FR',
        ja: 'ja-JP',
        de: 'de-DE',
        es: 'es-ES',
      }
      if (preferredMap[language]) {
        fallbacks.push(preferredMap[language])
      }
      fallbacks.push(language)
    }

    fallbacks.push(...WIDGET_LOCALE_DEFAULTS)
    return Array.from(new Set(fallbacks.map(item => this.normalizeLocale(item)).filter((item): item is string => Boolean(item))))
  }

  private getEffectiveLocale(): string {
    return this.getPreferredLocales()[0] || 'en-US'
  }

  private resolveI18nText(
    i18nMap: Record<string, string> | null | undefined,
    fallback: string,
  ): string {
    if (!i18nMap) {
      return fallback
    }

    const normalizedEntries = new Map<string, string>()
    const orderedValues: string[] = []
    for (const [key, value] of Object.entries(i18nMap)) {
      if (typeof value !== 'string') {
        continue
      }
      const cleaned = value.trim()
      if (!cleaned) {
        continue
      }
      const normalizedKey = this.normalizeLocale(key) || key
      normalizedEntries.set(normalizedKey, cleaned)
      orderedValues.push(cleaned)
    }

    for (const locale of this.getPreferredLocales()) {
      for (const candidate of this.buildLocaleFallbacks(locale)) {
        const matched = normalizedEntries.get(candidate)
        if (matched) {
          return matched
        }
      }
    }

    if (orderedValues.length > 0) {
      return orderedValues[0]
    }

    return fallback
  }

  private async loadPublicConfig() {
    this.turnstileSiteKey = this.config.turnstileSiteKey || null;

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

      const data = await response.json() as TurnstilePublicConfig
      if (!this.config.agentId && data.default_agent_id) {
        this.config.agentId = data.default_agent_id
      }
      this.config.themeColor = this.config.themeColor || data.widget_color || '#3B82F6'
      if (!this.hasTitleOverride) {
        this.config.title = this.resolveI18nText(data.widget_title_i18n, data.widget_title || 'AI助手')
      }
      if (!this.hasWelcomeMessageOverride) {
        this.config.welcomeMessage = this.resolveI18nText(data.welcome_message_i18n, data.welcome_message || '你好！有什么可以帮助您的吗？')
      }
      const turnstileConfig = data
      this.turnstileSiteKey = turnstileConfig.turnstile_enabled ? (turnstileConfig.turnstile_site_key || null) : null
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
        `${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}`
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
    localStorage.removeItem(this.STORAGE_KEY);
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
    const isDark = this.effectiveTheme === 'dark';
    const bgColor = isDark ? '#1a1a2e' : 'white';
    const textColor = isDark ? '#e2e8f0' : '#1f2937';
    const mutedColor = isDark ? '#94a3b8' : '#6b7280';
    const borderColor = isDark ? 'rgba(148, 163, 184, 0.2)' : '#e5e7eb';
    const inputBg = isDark ? '#0f0f1a' : 'white';
    const messageBg = isDark ? '#2d2d44' : '#f3f4f6';
    const errorBg = isDark ? 'rgba(239, 68, 68, 0.2)' : '#fef2f2';

    style.textContent = `
      #basjoo-widget-container, #basjoo-widget-container * {
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }

      #basjoo-widget-button {
        position: fixed;
        bottom: 24px;
        ${this.config.position === 'left' ? 'left' : 'right'}: 24px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background-color: ${this.config.themeColor};
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s, box-shadow 0.2s;
        z-index: 9999;
      }

      #basjoo-widget-button:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
      }

      #basjoo-widget-button svg {
        width: 30px;
        height: 30px;
        fill: white;
      }

      .basjoo-unread-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        border-radius: 10px;
        background: #ef4444;
        color: white;
        font-size: 11px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid white;
      }

      .basjoo-greeting-bubble {
        background: white;
        color: ${textColor};
        padding: 10px 14px;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        font-size: 13px;
        line-height: 1.4;
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
        background: white;
        transform: rotate(45deg);
        border-bottom: 1px solid ${borderColor};
        border-right: 1px solid ${borderColor};
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
        ${this.config.position === 'left' ? 'left' : 'right'}: 24px;
        width: 380px;
        height: 600px;
        max-height: calc(100vh - 120px);
        background: ${bgColor};
        border-radius: 20px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
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
        color: white;
        padding: 20px 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
      }

      .basjoo-header-title {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 18px;
        font-weight: 600;
      }

      .basjoo-header-logo {
        width: 32px;
        height: 32px;
        object-fit: contain;
        border-radius: 8px;
        background: rgba(255,255,255,0.2);
        padding: 4px;
        flex-shrink: 0;
      }

      .basjoo-close {
        width: 32px;
        height: 32px;
        border: none;
        background: rgba(255,255,255,0.15);
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
        color: white;
      }

      .basjoo-close:hover {
        background: rgba(255,255,255,0.25);
      }

      .basjoo-messages {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        background: ${inputBg};
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
        padding: 12px 16px;
        border-radius: 16px;
        font-size: 14px;
        line-height: 1.6;
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
        background: rgba(15, 23, 42, 0.08);
        padding: 1px 4px;
        border-radius: 4px;
      }

      #basjoo-widget-container .basjoo-message-content pre {
        background: #0f172a;
        color: #e2e8f0;
        padding: 10px 12px;
        border-radius: 10px;
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
        padding-left: 12px;
        border-left: 3px solid rgba(148, 163, 184, 0.4);
        color: ${mutedColor};
      }

      #basjoo-widget-container .basjoo-message-user .basjoo-message-content {
        background: ${this.config.themeColor};
        color: white;
        border-bottom-right-radius: 4px;
      }

      #basjoo-widget-container .basjoo-message-user .basjoo-message-content a {
        color: white;
      }

      #basjoo-widget-container .basjoo-message-user .basjoo-message-content code {
        background: rgba(255, 255, 255, 0.18);
        color: white;
      }

      #basjoo-widget-container .basjoo-message-assistant .basjoo-message-content {
        background: ${messageBg};
        color: ${textColor};
        border-bottom-left-radius: 4px;
      }

      #basjoo-widget-container .basjoo-message-error .basjoo-message-content {
        background: ${errorBg};
        color: ${isDark ? '#fca5a5' : '#dc2626'};
        border: 1px solid ${isDark ? 'rgba(239,68,68,0.35)' : '#fecaca'};
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
        gap: 4px;
        padding: 12px 16px !important;
        align-self: flex-start;
        margin-top: 4px !important;
      }

      .basjoo-loading-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: ${mutedColor};
        animation: basjoo-bounce 1.4s infinite ease-in-out both;
      }

      .basjoo-loading-dot:nth-child(1) { animation-delay: -0.32s; }
      .basjoo-loading-dot:nth-child(2) { animation-delay: -0.16s; }

      @keyframes basjoo-bounce {
        0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
        40% { transform: scale(1); opacity: 1; }
      }

      .basjoo-input-area {
        padding: 16px 20px 24px 20px !important;
        border-top: 1px solid ${borderColor};
        display: flex;
        gap: 12px;
        background: ${bgColor};
        flex-shrink: 0;
      }

      .basjoo-input {
        flex: 1;
        height: 48px;
        padding: 0 20px 0 20px !important;
        border: 1px solid ${borderColor};
        border-radius: 24px;
        font-size: 14px;
        outline: none;
        transition: all 0.2s;
        background: ${inputBg};
        color: ${textColor};
        margin-bottom: 8px !important;
        margin-left: 4px !important;
      }

      .basjoo-input::placeholder {
        color: ${mutedColor};
      }

      .basjoo-input:focus {
        border-color: ${this.config.themeColor};
        box-shadow: 0 0 0 3px ${this.hexToRgba(this.config.themeColor, 0.1)};
      }

      .basjoo-send {
        width: 48px;
        height: 48px;
        border: none;
        border-radius: 50%;
        background: ${this.config.themeColor};
        color: white;
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
        padding: 12px 16px;
        background: ${errorBg};
        color: ${isDark ? '#fca5a5' : '#dc2626'};
        font-size: 13px;
        text-align: center;
        border-top: 1px solid ${isDark ? 'rgba(239,68,68,0.35)' : '#fecaca'};
      }

      #basjoo-widget-container .basjoo-message-time {
        font-size: 11px;
        color: ${mutedColor};
        margin-top: 4px;
        padding: 0 4px;
      }

      #basjoo-widget-container .basjoo-message-user .basjoo-message-time {
        text-align: right;
      }

      .basjoo-thinking {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: ${mutedColor};
        font-size: 12px;
        margin-top: 8px;
      }

      .basjoo-thinking-spinner {
        width: 12px;
        height: 12px;
        border: 2px solid ${this.hexToRgba(this.config.themeColor, 0.2)};
        border-top-color: ${this.config.themeColor};
        border-radius: 50%;
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
          left: 16px !important;
          right: 16px !important;
        }

        #basjoo-widget-button {
          bottom: 16px;
          ${this.config.position === 'left' ? 'left' : 'right'}: 16px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  private adjustColor(hex: string, amount: number): string {
    let useHash = false;
    let color = hex;
    if (color[0] === '#') {
      color = color.slice(1);
      useHash = true;
    }

    const num = parseInt(color, 16);
    let r = (num >> 16) + amount;
    let g = ((num >> 8) & 255) + amount;
    let b = (num & 255) + amount;

    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));

    return `${useHash ? '#' : ''}${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  private hexToRgba(hex: string, alpha: number): string {
    let color = hex.replace('#', '');
    if (color.length === 3) {
      const [r, g, b] = color.split('');
      color = `${r}${r}${g}${g}${b}${b}`;
    }

    const num = parseInt(color, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
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
    this.button.addEventListener('click', () => this.toggle());
    this.container!.appendChild(this.button);
    this.updateUnreadBadge();
  }

  /**
   * 创建聊天窗口
   */
  private createChatWindow() {
    this.chatWindow = document.createElement('div');
    this.chatWindow.id = 'basjoo-chat-window';
    this.chatWindow.innerHTML = `
      <div class="basjoo-header">
        <div class="basjoo-header-title">
          ${this.config.logoUrl ? `<img src="${this.config.logoUrl}" class="basjoo-header-logo" alt="">` : ''}
          <span>${this.config.title}</span>
        </div>
        <button class="basjoo-close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="basjoo-messages"></div>
      <div class="basjoo-input-area">
        <input type="text" class="basjoo-input" placeholder="${this.getText('inputPlaceholder')}" maxlength="2000">
        <button class="basjoo-send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    `;

    const closeBtn = this.chatWindow.querySelector('.basjoo-close') as HTMLElement;
    closeBtn.addEventListener('click', () => this.close());

    const input = this.chatWindow.querySelector('.basjoo-input') as HTMLInputElement;
    const sendBtn = this.chatWindow.querySelector('.basjoo-send') as HTMLButtonElement;

    const send = () => {
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

    sendBtn.addEventListener('click', send);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') send();
    });

    this.container!.appendChild(this.chatWindow);
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
      input?.focus();
    }, 300);
  }

  private close() {
    this.isOpen = false;
    this.chatWindow?.classList.remove('open');
    this.chatWindow?.classList.add('closing');
  }

  /**
   * Get localized text based on language setting
   */
  private getText(key: 'sendFailed' | 'networkError' | 'quotaExceeded' | 'takenOverNotice' | 'inputPlaceholder' | 'messageTooLong' | 'greetingBubble' | 'newMessage' | 'thinking'): string {
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
    };

    return this.resolveI18nText(texts[key], texts[key]['en-US'] || texts[key]['zh-CN'] || key)
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
        const safeUrl = this.escapeHtml(url);
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
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
    this.updateMessageContent(contentDiv, replaceSourcePlaceholders(message.content, message.sources));
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
    const finalContent = replaceSourcePlaceholders(this.currentStreamContent, sources);
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
        `${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&after_id=${this.lastMessageId}&role=assistant`
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
        case 'content':
          this.appendToStreamingMessage((payload as StreamEventPayload).content || '');
          break;
        case 'done': {
          const donePayload = payload as StreamDoneMeta;
          if (donePayload.session_id) {
            this.sessionId = donePayload.session_id;
            localStorage.setItem(this.STORAGE_KEY, donePayload.session_id);
            this.startPolling();
          }
          if (typeof donePayload.message_id === 'number' && donePayload.message_id > this.lastMessageId) {
            this.lastMessageId = donePayload.message_id;
          }
          if (donePayload.taken_over) {
            this.removeStreamingMessage();
            this.addMessage({
              role: 'assistant',
              content: this.getText('takenOverNotice'),
              timestamp: new Date(),
            });
          } else {
            this.finalizeStreamingMessage(this.currentStreamSources);
            if (!this.isOpen) {
              this.startTitleBlink();
            }
          }
          streamCompleted = true;
          break;
        }
        case 'error':
          throw new Error((payload as StreamErrorPayload).error || 'Stream failed');
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
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
          window.setTimeout(() => reject(new Error('Stream read timeout')), streamReadTimeout);
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
   * 发送消息
   */
  private async ensureTurnstileReady(): Promise<void> {
    if (!this.turnstileSiteKey) {
      return;
    }

    if ((window as WindowWithTurnstile).turnstile && this.turnstileWidgetId) {
      return;
    }

    if (!this.turnstileScriptPromise) {
      this.turnstileScriptPromise = new Promise<void>((resolve, reject) => {
        const existingScript = document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]') as HTMLScriptElement | null;
        if (existingScript) {
          if ((window as WindowWithTurnstile).turnstile) {
            resolve();
            return;
          }
          existingScript.addEventListener('load', () => resolve(), { once: true });
          existingScript.addEventListener('error', () => reject(new Error('Failed to load Turnstile')), { once: true });
          return;
        }

        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Turnstile'));
        document.head.appendChild(script);
      });
    }

    await this.turnstileScriptPromise;

    if (!(window as WindowWithTurnstile).turnstile) {
      throw new Error('Turnstile unavailable');
    }

    if (!this.turnstileContainer) {
      this.turnstileContainer = document.createElement('div');
      this.turnstileContainer.style.display = 'none';
      document.body.appendChild(this.turnstileContainer);
    }

    const turnstile = (window as WindowWithTurnstile).turnstile;
    if (!turnstile) {
      throw new Error('Turnstile unavailable');
    }

    if (!this.turnstileWidgetId) {
      this.turnstileWidgetId = turnstile.render(this.turnstileContainer, {
        sitekey: this.turnstileSiteKey,
        execution: 'execute',
        appearance: 'execute',
      });
    }
  }

  private async getTurnstileToken(): Promise<string | undefined> {
    if (!this.turnstileSiteKey) {
      return undefined;
    }

    await this.ensureTurnstileReady();

    if (!(window as WindowWithTurnstile).turnstile || !this.turnstileWidgetId) {
      throw new Error('Turnstile unavailable');
    }

    return await new Promise<string>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => reject(new Error('Turnstile timeout')), 10000);
      const widgetId = this.turnstileWidgetId as string;
      const container = this.turnstileContainer as HTMLElement;

      (window as WindowWithTurnstile).turnstile!.remove(widgetId);
      this.turnstileWidgetId = (window as WindowWithTurnstile).turnstile!.render(container, {
        sitekey: this.turnstileSiteKey,
        execution: 'execute',
        appearance: 'execute',
        callback: (token: string) => {
          window.clearTimeout(timeoutId);
          resolve(token);
        },
        'error-callback': () => {
          window.clearTimeout(timeoutId);
          reject(new Error('Turnstile failed'));
        },
        'expired-callback': () => {
          window.clearTimeout(timeoutId);
          reject(new Error('Turnstile expired'));
        },
      });

      (window as WindowWithTurnstile).turnstile!.execute(this.turnstileWidgetId);
    });
  }

  private async sendMessageWithRetry(message: string): Promise<void> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= 1; attempt++) {
      try {
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const turnstileToken = await this.getTurnstileToken();

        const response = await fetch(`${this.config.apiBase}/api/v1/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify({
            agent_id: this.config.agentId,
            message,
            locale: this.getEffectiveLocale(),
            session_id: this.sessionId || undefined,
            visitor_id: this.visitorId,
            timezone: userTimezone,
            turnstile_token: turnstileToken,
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
        const isRetryable = error instanceof TypeError
          || errorText.includes('fetch')
          || errorText.includes('Failed to fetch')
          || errorText.includes('Stream ended unexpectedly');

        if (!isRetryable || attempt >= 1) {
          throw error;
        }

        this.hideLoading();
        this.hideThinkingIndicator();
        this.removeStreamingMessage();
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
      this.hideLoading();
      this.hideThinkingIndicator();
      this.removeStreamingMessage();
      console.error('[Basjoo Widget] Error sending message:', error);

      let errorMessage = this.getText('sendFailed');
      let consoleHint = '';
      const errorText = String(error?.message || '');

      if (error instanceof TypeError || errorText.includes('fetch')) {
        errorMessage = this.getText('networkError');
        consoleHint = `Request may be blocked by CORS, network connectivity, or an incorrect apiBase. Current apiBase: ${this.config.apiBase || '(not set)'}`;
      } else if (errorText.includes('429') || errorText.toLowerCase().includes('quota')) {
        errorMessage = this.getText('quotaExceeded');
      } else if (errorText.toLowerCase().includes('turnstile') || errorText.toLowerCase().includes('bot verification') || errorText.includes('403')) {
        errorMessage = this.getText('sendFailed');
        consoleHint = 'Bot protection verification failed. Check Turnstile site key, secret key, and allowed hostnames.';
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
    this.hideThinkingIndicator();
    this.removeStreamingMessage();

    const turnstile = (window as WindowWithTurnstile).turnstile;
    if (turnstile && this.turnstileWidgetId) {
      turnstile.remove(this.turnstileWidgetId);
    }
    this.turnstileContainer?.remove();
    this.turnstileContainer = null;
    this.turnstileWidgetId = null;

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

  const turnstileSiteKey = getSearchParamValue(url.searchParams, AUTO_INIT_SCRIPT_PARAM_MAP.turnstileSiteKey)
  if (turnstileSiteKey) {
    config.turnstileSiteKey = turnstileSiteKey
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
