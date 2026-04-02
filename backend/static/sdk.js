/**
 * Basjoo Widget SDK v2.0 - 专业客服风格
 * 可嵌入的智能聊天组件
 */
(function() {
  'use strict';

  // SDK版本号，用于缓存控制
  var SDK_VERSION = '2.0.0';

  /**
   * BasjooWidget 构造函数
   * @param {Object} config - 配置对象
   */
  function BasjooWidget(config) {
    this.config = {
      agentId: config.agentId,
      apiBase: this.detectApiBase(config.apiBase),
      themeColor: config.themeColor || null,  // null 表示需要从后端获取
      logoUrl: config.logoUrl || '/basjoo-logo.png',
      title: config.title || null,
      welcomeMessage: config.welcomeMessage || null,
      language: config.language || 'auto',
      position: config.position || 'right',
      theme: config.theme || 'auto'
    };

    this.container = null;
    this.button = null;
    this.chatWindow = null;
    this.messages = [];
    this.sessionId = localStorage.getItem('basjoo_session_' + this.config.agentId);
    this.visitorId = localStorage.getItem('basjoo_visitor_id') || this.generateVisitorId();
    this.isOpen = false;
    this.effectiveTheme = 'light';
    this.originalTitle = '';
    this.titleBlinkInterval = null;
    this.hasUnread = false;
    this.pollIntervalId = null;
    this.lastMessageId = 0;
    this.takenOver = false;
    this.isSending = false;
    this.streamingMessage = null;
    this.streamingMessageContent = null;
    this.currentStreamContent = '';
    this.currentStreamSources = [];
    this.turnstileSiteKey = config.turnstileSiteKey || null;
    this.turnstileWidgetId = null;
    this.turnstileContainer = null;
    this.turnstileScriptPromise = null;

    this.effectiveTheme = this.getEffectiveTheme();
    this.loadConfigAndInit();  // 先加载配置，再初始化
  }

  /**
   * 生成访客ID
   */
  BasjooWidget.prototype.generateVisitorId = function() {
    var visitorId = 'visitor_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('basjoo_visitor_id', visitorId);
    return visitorId;
  };

  /**
   * 检测 API 基础地址
   */
  BasjooWidget.prototype.detectApiBase = function(configuredApiBase) {
    if (configuredApiBase) {
      try {
        var configuredUrl = new URL(configuredApiBase, window.location.href);
        if ((configuredUrl.protocol === 'http:' || configuredUrl.protocol === 'https:') && configuredUrl.port === '3000') {
          var directBase = configuredUrl.protocol + '//' + configuredUrl.hostname + ':8000';
          console.info('[Basjoo Widget] Rewriting configured dev apiBase to direct backend:', directBase);
          return directBase;
        }
        return configuredUrl.toString().replace(/\/$/, '');
      } catch (error) {
        return configuredApiBase;
      }
    }

    var currentScript = document.currentScript;
    if (currentScript && currentScript.src) {
      try {
        var currentScriptUrl = new URL(currentScript.src, window.location.href);
        console.info('[Basjoo Widget] Detected API base from current script:', currentScriptUrl.origin);
        return currentScriptUrl.origin;
      } catch (error) {
        // Ignore and continue fallback detection.
      }
    }

    var scripts = document.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute('src') || '';
      if (src.indexOf('sdk.js') === -1 && src.indexOf('basjoo') === -1) {
        continue;
      }

      try {
        var scriptUrl = new URL(src, window.location.href);
        console.info('[Basjoo Widget] Detected API base from script src:', scriptUrl.origin);
        return scriptUrl.origin;
      } catch (error) {
        // Ignore invalid script URLs and continue scanning.
      }
    }

    var port = window.location.port;
    if (port === '3000' || port === '5173') {
      var devBase = window.location.protocol + '//' + window.location.hostname + ':8000';
      console.info('[Basjoo Widget] Development mode detected, using:', devBase);
      return devBase;
    }

    if (window.location.protocol === 'file:') {
      console.error('[Basjoo Widget] Cannot determine API base from a local file. Please set apiBase explicitly.');
      return '';
    }

    console.warn('[Basjoo Widget] Falling back to window.location.origin. Set apiBase explicitly if the API is hosted elsewhere.');
    return window.location.origin;
  };

  /**
   * 从后端加载配置并初始化
   */
  BasjooWidget.prototype.loadConfigAndInit = function() {
    var self = this;

    // 默认值
    var defaults = {
      themeColor: '#0EA5E9',
      title: '在线客服',
      welcomeMessage: '您好！我是您的专属客服助手，有什么可以帮助您的吗？'
    };

    // 调用后端公开配置接口获取 Widget 配置
    if (!this.config.apiBase) {
      console.warn('[Basjoo Widget] Skipping public config fetch because apiBase could not be determined.');
      self.config.themeColor = self.config.themeColor || defaults.themeColor;
      self.config.title = self.config.title || defaults.title;
      self.config.welcomeMessage = self.config.welcomeMessage || defaults.welcomeMessage;
      self.init();
      return;
    }

    var publicConfigUrl = new URL(this.config.apiBase + '/api/v1/config:public');
    if (this.config.agentId) {
      publicConfigUrl.searchParams.set('agent_id', this.config.agentId);
    }

    fetch(publicConfigUrl.toString())
      .then(function(response) {
        if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + response.statusText);
        return response.json();
      })
      .then(function(data) {
        if (!self.config.agentId && data.default_agent_id) {
          self.config.agentId = data.default_agent_id;
        }
        // 用户参数优先，否则使用后端配置，最后使用默认值
        self.config.themeColor = self.config.themeColor || data.widget_color || defaults.themeColor;
        self.config.title = self.config.title || self.resolveI18nText(data.widget_title_i18n, data.widget_title || defaults.title);
        self.config.welcomeMessage = self.config.welcomeMessage || self.resolveI18nText(data.welcome_message_i18n, data.welcome_message || defaults.welcomeMessage);
        self.turnstileSiteKey = data.turnstile_enabled ? (data.turnstile_site_key || null) : null;

        // 重新计算主题
        self.effectiveTheme = self.getEffectiveTheme();

        // 初始化 UI
        self.init();
      })
      .catch(function(error) {
        console.warn('[Basjoo Widget] Failed to load public config, using defaults.', error);
        if (error instanceof TypeError) {
          console.warn('[Basjoo Widget] Public config request may be blocked by CORS, network issues, or an incorrect apiBase:', self.config.apiBase);
        }
        // 使用默认值
        self.config.themeColor = self.config.themeColor || defaults.themeColor;
        self.config.title = self.config.title || defaults.title;
        self.config.welcomeMessage = self.config.welcomeMessage || defaults.welcomeMessage;
        self.init();
      });
  };

  /**
   * 调整颜色亮度
   */
  BasjooWidget.prototype.adjustColor = function(color, amount) {
    var usePound = false;
    if (color[0] === '#') {
      color = color.slice(1);
      usePound = true;
    }
    var num = parseInt(color, 16);
    var r = (num >> 16) + amount;
    if (r > 255) r = 255; else if (r < 0) r = 0;
    var b = ((num >> 8) & 0x00FF) + amount;
    if (b > 255) b = 255; else if (b < 0) b = 0;
    var g = (num & 0x0000FF) + amount;
    if (g > 255) g = 255; else if (g < 0) g = 0;
    return (usePound ? '#' : '') + (g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
  };

  /**
   * 将 hex 颜色转换为 rgba
   */
  BasjooWidget.prototype.hexToRgba = function(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
  };

  /**
   * 获取有效主题
   */
  BasjooWidget.prototype.getEffectiveTheme = function() {
    if (this.config.theme === 'light' || this.config.theme === 'dark') {
      return this.config.theme;
    }
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  };

  /**
   * 获取浏览器语言
   */
  BasjooWidget.prototype.getBrowserLanguage = function() {
    var lang = navigator.language || navigator.userLanguage || 'zh-CN';
    if (lang.startsWith('zh')) return 'zh-CN';
    if (lang.startsWith('en')) return 'en-US';
    return 'zh-CN';
  };

  BasjooWidget.prototype.getEffectiveLocale = function() {
    if (this.config.language === 'zh-CN' || this.config.language === 'en-US') {
      return this.config.language;
    }
    return this.getBrowserLanguage();
  };

  BasjooWidget.prototype.resolveI18nText = function(i18nMap, fallback) {
    var locale = this.getEffectiveLocale();
    if (i18nMap && i18nMap[locale]) return i18nMap[locale];
    if (i18nMap && i18nMap['zh-CN']) return i18nMap['zh-CN'];
    if (i18nMap && i18nMap['en-US']) return i18nMap['en-US'];
    return fallback;
  };

  /**
   * 获取本地化文本
   */
  BasjooWidget.prototype.getText = function(key) {
    var texts = {
      'inputPlaceholder': { 'zh-CN': '输入消息...', 'en-US': 'Type a message...' },
      'send': { 'zh-CN': '发送', 'en-US': 'Send' },
      'messageTooLong': { 'zh-CN': '消息过长，请控制在2000字以内', 'en-US': 'Message too long, please keep it under 2000 characters' },
      'sendFailed': { 'zh-CN': '发送失败，请稍后重试', 'en-US': 'Send failed, please try again later' },
      'networkError': { 'zh-CN': '网络连接失败，请检查网络', 'en-US': 'Network connection failed, please check your connection' },
      'quotaExceeded': { 'zh-CN': '今日消息已达上限', 'en-US': 'Daily message limit reached' },
      'takenOverNotice': { 'zh-CN': '已转接人工客服，请等待回复。', 'en-US': 'Your conversation has been transferred to a human agent. Please wait for their reply.' },
      'citationSources': { 'zh-CN': '引用来源', 'en-US': 'Citation Sources' },
      'openSource': { 'zh-CN': '打开来源', 'en-US': 'Open source' },
      'document': { 'zh-CN': '文档', 'en-US': 'Document' },
      'greetingBubble': { 'zh-CN': '你好！有什么可以帮您？', 'en-US': 'Hi! How can I help you?' },
      'newMessage': { 'zh-CN': '新消息', 'en-US': 'New message' },
      'thinking': { 'zh-CN': '思考中...', 'en-US': 'Thinking...' }
    };
    var lang = this.getEffectiveLocale();
    return (texts[key] && texts[key][lang]) || (texts[key] && texts[key]['zh-CN']) || key;
  };

  /**
   * 初始化 Widget
   */
  BasjooWidget.prototype.init = function() {
    if (document.getElementById('basjoo-widget-container')) {
      console.warn('Basjoo Widget already initialized');
      return;
    }

    this.createStyles();
    this.createContainer();
    this.createButton();
    this.createChatWindow();

    // 页面加载时立即启动标题闪烁提醒，吸引用户打开聊天窗口
    this.startTitleBlink();

    if (this.sessionId) {
      // 有会话 ID，从后端加载历史消息
      this.loadHistory();
    } else if (this.config.welcomeMessage) {
      this.addMessage({
        role: 'assistant',
        content: this.config.welcomeMessage,
        timestamp: new Date()
      });
    }

    this.showUnreadBadge();
  };

  /**
   * 创建样式
   */
  BasjooWidget.prototype.createStyles = function() {
    var isDark = this.effectiveTheme === 'dark';
    var bgColor = isDark ? '#1a1a2e' : '#ffffff';
    var textColor = isDark ? '#e4e4e7' : '#18181b';
    var mutedColor = isDark ? '#a1a1aa' : '#71717a';
    var borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
    var inputBg = isDark ? '#27273a' : '#f4f4f5';
    var messageBg = isDark ? '#2d2d44' : '#f4f4f5';

    var style = document.createElement('style');
    style.id = 'basjoo-widget-styles-v3';
    style.textContent = `
      /* ===== 基础重置 ===== */
      #basjoo-widget-container {
        --bw-primary: ${this.config.themeColor};
        --bw-primary-dark: ${this.adjustColor(this.config.themeColor, -15)};
        --bw-bg: ${bgColor};
        --bw-text: ${textColor};
        --bw-muted: ${mutedColor};
        --bw-border: ${borderColor};
        --bw-input-bg: ${inputBg};
        --bw-message-bg: ${messageBg};
      }

      #basjoo-widget-container * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }

      /* ===== 浮动按钮 ===== */
      #basjoo-widget-button {
        position: fixed;
        bottom: 20px;
        ${this.config.position === 'left' ? 'left' : 'right'}: 20px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--bw-primary), var(--bw-primary-dark));
        cursor: pointer;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s;
        z-index: 9999;
      }

      #basjoo-widget-button:hover {
        transform: scale(1.08);
        box-shadow: 0 8px 30px rgba(0,0,0,0.2);
      }

      #basjoo-widget-button svg {
        width: 28px;
        height: 28px;
        fill: white;
      }

      /* 未读红点 */
      .basjoo-unread-badge {
        position: absolute;
        top: -2px;
        right: -2px;
        width: 20px;
        height: 20px;
        background: #ef4444;
        color: white;
        border-radius: 50%;
        font-size: 11px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 6px rgba(239,68,68,0.4);
        animation: basjoo-pulse 2s infinite;
      }

      @keyframes basjoo-pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
      }

      /* ===== 聊天窗口 ===== */
      #basjoo-chat-window {
        position: fixed;
        bottom: 90px;
        ${this.config.position === 'left' ? 'left' : 'right'}: 20px;
        width: 360px;
        height: 520px;
        max-width: calc(100vw - 40px);
        max-height: calc(100vh - 110px);
        background: var(--bw-bg);
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08);
        display: flex;
        flex-direction: column;
        z-index: 9998;
        opacity: 0;
        transform: translateY(16px) scale(0.96);
        pointer-events: none;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        overflow: hidden;
        border: 1px solid var(--bw-border);
      }

      #basjoo-chat-window.open {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: all;
      }

      /* ===== 头部 ===== */
      .basjoo-header {
        height: 60px;
        padding: 0 20px !important;
        background: linear-gradient(135deg, var(--bw-primary), var(--bw-primary-dark));
        color: white;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
      }

      .basjoo-header-title {
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 600;
        font-size: 15px;
      }

      .basjoo-header-logo {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: white;
        padding: 4px;
        object-fit: contain;
        margin-left: 4px;
      }

      .basjoo-close {
        width: 36px;
        height: 36px;
        background: rgba(255,255,255,0.15);
        border: none;
        color: white;
        cursor: pointer;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        margin: 0 8px !important;
        flex-shrink: 0;
      }

      .basjoo-close:hover {
        background: rgba(255,255,255,0.25);
        transform: rotate(90deg);
      }

      /* ===== 消息区域 ===== */
      .basjoo-messages {
        flex: 1;
        overflow-y: auto;
        padding: 20px !important;
        display: flex;
        flex-direction: column;
        gap: 16px;
        background: var(--bw-bg);
      }

      .basjoo-message {
        max-width: 80%;
        padding: 12px 16px !important;
        border-radius: 12px;
        font-size: 14px;
        line-height: 1.5;
        animation: basjoo-message-in 0.3s ease-out;
        margin-top: 4px !important;
        margin-bottom: 0 !important;
      }

      @keyframes basjoo-message-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .basjoo-message-user {
        align-self: flex-end;
        background: linear-gradient(135deg, var(--bw-primary), var(--bw-primary-dark));
        color: white;
        border-bottom-right-radius: 4px;
      }

      .basjoo-message-assistant {
        align-self: flex-start;
        background: var(--bw-message-bg);
        color: var(--bw-text);
        border-bottom-left-radius: 4px;
        border: 1px solid var(--bw-border);
      }

      .basjoo-message-content p,
      .basjoo-message-content ul,
      .basjoo-message-content ol,
      .basjoo-message-content pre,
      .basjoo-message-content blockquote {
        margin: 0 0 0.75em 0;
      }

      .basjoo-message-content p:last-child,
      .basjoo-message-content ul:last-child,
      .basjoo-message-content ol:last-child,
      .basjoo-message-content pre:last-child,
      .basjoo-message-content blockquote:last-child {
        margin-bottom: 0;
      }

      .basjoo-message-content ul,
      .basjoo-message-content ol {
        padding-left: 1.25rem;
      }

      .basjoo-message-content code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.92em;
        background: ${isDark ? 'rgba(15, 15, 26, 0.8)' : 'rgba(255, 255, 255, 0.75)'};
        border: 1px solid var(--bw-border);
        border-radius: 6px;
        padding: 0.1rem 0.35rem;
      }

      .basjoo-message-content pre {
        overflow-x: auto;
        padding: 0.875rem 1rem;
        background: ${isDark ? '#0f0f1a' : '#ffffff'};
        border: 1px solid var(--bw-border);
        border-radius: 10px;
      }

      .basjoo-message-content pre code {
        background: transparent;
        border: none;
        padding: 0;
      }

      .basjoo-message-content a {
        color: var(--bw-primary);
        text-decoration: underline;
      }

      .basjoo-message-content blockquote {
        padding-left: 0.875rem;
        border-left: 3px solid var(--bw-primary);
        color: var(--bw-muted);
      }

      .basjoo-stream-cursor {
        display: inline-block;
        width: 0.5rem;
        height: 1em;
        margin-left: 0.12rem;
        vertical-align: text-bottom;
        background: var(--bw-primary);
        animation: basjoo-cursor-blink 1s steps(1) infinite;
      }

      @keyframes basjoo-cursor-blink {
        0%, 50% { opacity: 1; }
        50.01%, 100% { opacity: 0; }
      }

      .basjoo-sources {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .basjoo-sources-label {
        font-size: 12px;
        color: var(--bw-muted);
      }

      .basjoo-citation-card {
        background: var(--bw-message-bg);
        border: 1px solid var(--bw-border);
        border-radius: 8px;
        overflow: hidden;
      }

      .basjoo-citation-trigger {
        width: 100%;
        border: none;
        background: transparent;
        color: inherit;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        cursor: pointer;
        text-align: left;
      }

      .basjoo-citation-number {
        width: 18px;
        height: 18px;
        border-radius: 4px;
        background: var(--bw-primary);
        color: white;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: 700;
        flex-shrink: 0;
      }

      .basjoo-citation-title {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        color: var(--bw-text);
      }

      .basjoo-citation-arrow {
        color: var(--bw-muted);
        transition: transform 0.2s ease;
        flex-shrink: 0;
      }

      .basjoo-citation-card[open] .basjoo-citation-arrow {
        transform: rotate(180deg);
      }

      .basjoo-citation-body {
        border-top: 1px solid var(--bw-border);
        padding: 8px 10px;
        font-size: 12px;
        color: var(--bw-muted);
        line-height: 1.5;
      }

      .basjoo-citation-link {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
        color: var(--bw-primary);
        text-decoration: none;
        word-break: break-all;
      }

      /* 加载动画 */
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
        background: var(--bw-muted);
        animation: basjoo-bounce 1.4s infinite ease-in-out both;
      }

      .basjoo-loading-dot:nth-child(1) { animation-delay: -0.32s; }
      .basjoo-loading-dot:nth-child(2) { animation-delay: -0.16s; }

      @keyframes basjoo-bounce {
        0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
        40% { transform: scale(1); opacity: 1; }
      }

      /* ===== 输入区域 ===== */
      .basjoo-input-area {
        padding: 16px 20px 24px 20px !important;
        border-top: 1px solid var(--bw-border);
        display: flex;
        gap: 12px;
        background: var(--bw-bg);
        flex-shrink: 0;
      }

      .basjoo-input {
        flex: 1;
        height: 48px;
        padding: 0 20px 0 20px !important;
        border: 1px solid var(--bw-border);
        border-radius: 24px;
        font-size: 14px;
        outline: none;
        transition: all 0.2s;
        background: var(--bw-input-bg);
        color: var(--bw-text);
        margin-bottom: 8px !important;
        margin-left: 4px !important;
      }

      .basjoo-input::placeholder {
        color: var(--bw-muted);
      }

      .basjoo-input:focus {
        border-color: var(--bw-primary);
        box-shadow: 0 0 0 3px ${this.hexToRgba(this.config.themeColor, 0.1)};
      }

      .basjoo-send {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: var(--bw-primary);
        border: none;
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        flex-shrink: 0;
        margin-bottom: 8px !important;
      }

      .basjoo-send:hover {
        background: var(--bw-primary-dark);
        transform: scale(1.05);
      }

      .basjoo-send:active {
        transform: scale(0.95);
      }

      .basjoo-send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* ===== 滚动条 ===== */
      .basjoo-messages::-webkit-scrollbar {
        width: 4px;
      }

      .basjoo-messages::-webkit-scrollbar-track {
        background: transparent;
      }

      .basjoo-messages::-webkit-scrollbar-thumb {
        background: var(--bw-border);
        border-radius: 2px;
      }

      .basjoo-messages::-webkit-scrollbar-thumb:hover {
        background: var(--bw-muted);
      }

      /* ===== 响应式 ===== */
      @media (max-width: 480px) {
        #basjoo-chat-window {
          width: calc(100vw - 32px);
          height: calc(100vh - 100px);
          bottom: 80px;
          ${this.config.position === 'left' ? 'left' : 'right'}: 16px;
        }

        #basjoo-widget-button {
          width: 52px;
          height: 52px;
          bottom: 16px;
          ${this.config.position === 'left' ? 'left' : 'right'}: 16px;
        }
      }
    `;
    document.head.appendChild(style);
  };

  /**
   * 创建容器
   */
  BasjooWidget.prototype.createContainer = function() {
    this.container = document.createElement('div');
    this.container.id = 'basjoo-widget-container';
    document.body.appendChild(this.container);
  };

  /**
   * 创建按钮
   */
  BasjooWidget.prototype.createButton = function() {
    var self = this;
    this.button = document.createElement('div');
    this.button.id = 'basjoo-widget-button';
    this.button.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
    `;
    this.button.addEventListener('click', function() {
      self.toggle();
    });
    this.container.appendChild(this.button);
  };

  /**
   * 创建聊天窗口
   */
  BasjooWidget.prototype.createChatWindow = function() {
    var self = this;
    this.chatWindow = document.createElement('div');
    this.chatWindow.id = 'basjoo-chat-window';

    var logoUrl = this.config.logoUrl;
    if (logoUrl && logoUrl.startsWith('/')) {
      logoUrl = this.config.apiBase + logoUrl;
    }

    this.chatWindow.innerHTML = `
      <div class="basjoo-header">
        <div class="basjoo-header-title">
          ${logoUrl ? `<img src="${logoUrl}" class="basjoo-header-logo" alt="">` : ''}
          <span>${this.config.title}</span>
        </div>
        <button class="basjoo-close" aria-label="关闭">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="basjoo-messages"></div>
      <div class="basjoo-input-area">
        <input type="text" class="basjoo-input" placeholder="${this.getText('inputPlaceholder')}" maxlength="2000">
        <button class="basjoo-send" aria-label="发送">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22,2 15,22 11,13 2,9 22,2"></polygon>
          </svg>
        </button>
      </div>
    `;

    this.chatWindow.querySelector('.basjoo-close').addEventListener('click', function() {
      self.toggle();
    });

    var input = this.chatWindow.querySelector('.basjoo-input');
    var sendBtn = this.chatWindow.querySelector('.basjoo-send');

    var sendMessage = function() {
      var text = input.value.trim();
      if (text) {
        if (text.length > 2000) {
          self.showError(self.getText('messageTooLong'));
          return;
        }
        self.sendMessage(text);
        input.value = '';
      }
    };

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') sendMessage();
    });

    this.container.appendChild(this.chatWindow);
  };

  /**
   * 显示未读消息红点
   */
  BasjooWidget.prototype.showUnreadBadge = function() {
    if (!this.button) return;
    var existingBadge = this.button.querySelector('.basjoo-unread-badge');
    if (existingBadge) existingBadge.remove();

    var badge = document.createElement('div');
    badge.className = 'basjoo-unread-badge';
    badge.textContent = '1';
    this.button.appendChild(badge);
  };

  /**
   * 隐藏未读消息红点
   */
  BasjooWidget.prototype.hideUnreadBadge = function() {
    var badge = this.button.querySelector('.basjoo-unread-badge');
    if (badge) badge.remove();
  };

  /**
   * 切换窗口显示
   */
  BasjooWidget.prototype.toggle = function() {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.chatWindow.classList.add('open');
      this.hideUnreadBadge();
      this.stopTitleBlink();
    } else {
      this.chatWindow.classList.remove('open');
    }
  };

  /**
   * 添加消息
   */
  BasjooWidget.prototype.escapeHtml = function(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  BasjooWidget.prototype.renderMarkdown = function(markdown) {
    if (!markdown) return '';

    var self = this;
    var blocks = markdown.replace(/\r\n/g, '\n').split(/\n{2,}/).map(function(block) {
      return block.trim();
    }).filter(Boolean);

    function renderInline(text) {
      var html = self.escapeHtml(text);
      html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
      html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
      html = html.replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');
      html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function(match, label, url) {
        var safeUrl = self.escapeHtml(url);
        return '<a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
      });
      return html;
    }

    return blocks.map(function(block) {
      if (/^```/.test(block) && /```$/.test(block)) {
        var code = block.replace(/^```\w*\n?/, '').replace(/```$/, '');
        return '<pre><code>' + self.escapeHtml(code) + '</code></pre>';
      }
      if (/^(?:[-*]\s.+\n?)+$/.test(block)) {
        return '<ul>' + block.split('\n').map(function(line) {
          return line.replace(/^[-*]\s+/, '').trim();
        }).filter(Boolean).map(function(line) {
          return '<li>' + renderInline(line) + '</li>';
        }).join('') + '</ul>';
      }
      if (/^(?:\d+\.\s.+\n?)+$/.test(block)) {
        return '<ol>' + block.split('\n').map(function(line) {
          return line.replace(/^\d+\.\s+/, '').trim();
        }).filter(Boolean).map(function(line) {
          return '<li>' + renderInline(line) + '</li>';
        }).join('') + '</ol>';
      }
      if (/^>\s?/.test(block)) {
        var quote = block.split('\n').map(function(line) {
          return line.replace(/^>\s?/, '');
        }).join('<br>');
        return '<blockquote>' + renderInline(quote) + '</blockquote>';
      }
      if (/^#{1,6}\s/.test(block)) {
        var headingText = block.replace(/^#{1,6}\s+/, '');
        return '<p><strong>' + renderInline(headingText) + '</strong></p>';
      }
      return '<p>' + renderInline(block).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  };

  BasjooWidget.prototype.updateMessageContent = function(element, content) {
    element.innerHTML = this.renderMarkdown(content);
  };

  BasjooWidget.prototype.createCitationCard = function(source, index) {
    var details = document.createElement('details');
    details.className = 'basjoo-citation-card';

    var summary = document.createElement('summary');
    summary.className = 'basjoo-citation-trigger';

    var number = document.createElement('span');
    number.className = 'basjoo-citation-number';
    number.textContent = String(index + 1);

    var title = document.createElement('span');
    title.className = 'basjoo-citation-title';
    title.textContent = source.type === 'url'
      ? (source.title || source.url || this.getText('document'))
      : (source.question || this.getText('citationSources'));

    var arrow = document.createElement('span');
    arrow.className = 'basjoo-citation-arrow';
    arrow.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';

    summary.appendChild(number);
    summary.appendChild(title);
    summary.appendChild(arrow);
    details.appendChild(summary);

    var body = document.createElement('div');
    body.className = 'basjoo-citation-body';

    if (source.type === 'url' && source.url) {
      var link = document.createElement('a');
      link.className = 'basjoo-citation-link';
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = this.getText('openSource');
      body.appendChild(link);

      var urlText = document.createElement('div');
      urlText.textContent = source.url;
      body.appendChild(urlText);
    }

    var snippet = document.createElement('div');
    snippet.textContent = source.snippet || source.question || source.title || source.url || this.getText('document');
    body.appendChild(snippet);
    details.appendChild(body);

    return details;
  };

  BasjooWidget.prototype.renderSources = function(container, sources) {
    if (!sources || !sources.length) return;

    var sourcesWrapper = document.createElement('div');
    sourcesWrapper.className = 'basjoo-sources';

    var label = document.createElement('div');
    label.className = 'basjoo-sources-label';
    label.textContent = this.getText('citationSources') + ' (' + sources.length + ')';
    sourcesWrapper.appendChild(label);

    for (var i = 0; i < sources.length; i++) {
      sourcesWrapper.appendChild(this.createCitationCard(sources[i], i));
    }

    container.appendChild(sourcesWrapper);
  };

  BasjooWidget.prototype.createMessageElement = function(message) {
    var messageEl = document.createElement('div');
    messageEl.className = 'basjoo-message basjoo-message-' + message.role;

    var contentEl = document.createElement('div');
    contentEl.className = 'basjoo-message-content';
    this.updateMessageContent(contentEl, message.content);
    messageEl.appendChild(contentEl);

    if (message.sources && message.sources.length > 0) {
      this.renderSources(messageEl, message.sources);
    }

    return messageEl;
  };

  BasjooWidget.prototype.removeStreamingMessage = function() {
    if (this.streamingMessage) this.streamingMessage.remove();
    this.streamingMessage = null;
    this.streamingMessageContent = null;
    this.currentStreamContent = '';
    this.currentStreamSources = [];
  };

  BasjooWidget.prototype.createStreamingMessage = function() {
    var messagesContainer = this.chatWindow.querySelector('.basjoo-messages');
    var messageEl = document.createElement('div');
    messageEl.className = 'basjoo-message basjoo-message-assistant';

    var wrapper = document.createElement('div');
    wrapper.style.display = 'inline';

    var contentEl = document.createElement('div');
    contentEl.className = 'basjoo-message-content';
    contentEl.style.display = 'inline';
    wrapper.appendChild(contentEl);

    var cursor = document.createElement('span');
    cursor.className = 'basjoo-stream-cursor';
    wrapper.appendChild(cursor);

    messageEl.appendChild(wrapper);
    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    this.streamingMessage = messageEl;
    this.streamingMessageContent = contentEl;
    this.currentStreamContent = '';
    this.currentStreamSources = [];
    return messageEl;
  };

  BasjooWidget.prototype.appendToStreamingMessage = function(chunk) {
    if (!this.streamingMessage || !this.streamingMessageContent) {
      this.createStreamingMessage();
    }
    this.currentStreamContent += chunk;
    if (this.streamingMessageContent) {
      this.updateMessageContent(this.streamingMessageContent, this.currentStreamContent);
    }
    var messagesContainer = this.chatWindow.querySelector('.basjoo-messages');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  };

  BasjooWidget.prototype.finalizeStreamingMessage = function(sources) {
    sources = sources || [];
    if (!this.streamingMessage || !this.streamingMessageContent) return;
    if (!this.currentStreamContent.trim()) {
      this.removeStreamingMessage();
      return;
    }

    var cursor = this.streamingMessage.querySelector('.basjoo-stream-cursor');
    if (cursor) cursor.remove();
    this.currentStreamSources = sources;

    if (sources.length > 0) {
      this.renderSources(this.streamingMessage, sources);
    }

    this.messages.push({
      role: 'assistant',
      content: this.currentStreamContent,
      sources: sources,
      timestamp: new Date()
    });

    var messagesContainer = this.chatWindow.querySelector('.basjoo-messages');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    this.streamingMessage = null;
    this.streamingMessageContent = null;
    this.currentStreamContent = '';
    this.currentStreamSources = [];
  };

  BasjooWidget.prototype.addMessage = function(message) {
    var messagesContainer = this.chatWindow.querySelector('.basjoo-messages');
    this.messages.push(message);
    if (!message.content) return;
    messagesContainer.appendChild(this.createMessageElement(message));
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  };

  /**
   * 显示加载动画
   */
  BasjooWidget.prototype.showLoading = function() {
    var messagesContainer = this.chatWindow.querySelector('.basjoo-messages');
    var loadingEl = document.createElement('div');
    loadingEl.className = 'basjoo-loading';
    loadingEl.id = 'basjoo-loading-indicator';
    loadingEl.innerHTML = `
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
    `;
    messagesContainer.appendChild(loadingEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  };

  /**
   * 隐藏加载动画
   */
  BasjooWidget.prototype.hideLoading = function() {
    var loadingEl = document.getElementById('basjoo-loading-indicator');
    if (loadingEl) loadingEl.remove();
  };

  /**
   * 显示错误
   */
  BasjooWidget.prototype.showError = function(message) {
    var self = this;
    var messagesContainer = this.chatWindow.querySelector('.basjoo-messages');
    var errorEl = document.createElement('div');
    errorEl.style.cssText = 'padding:10px 14px;background:#fef2f2;color:#dc2626;border-radius:8px;font-size:13px;margin:8px 0;border:1px solid rgba(220,38,38,0.2);';
    errorEl.textContent = message;
    messagesContainer.appendChild(errorEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    setTimeout(function() { errorEl.remove(); }, 3000);
  };

  /**
   * 加载聊天历史（页面刷新后恢复）
   */
  BasjooWidget.prototype.loadHistory = function() {
    if (!this.sessionId) return;

    var self = this;
    fetch(this.config.apiBase + '/api/v1/chat/messages?session_id=' + encodeURIComponent(this.sessionId))
      .then(function(response) {
        if (!response.ok) throw new Error('Failed to load history');
        return response.json();
      })
      .then(function(messages) {
        if (messages && messages.length > 0) {
          for (var i = 0; i < messages.length; i++) {
            self.addMessage({
              role: messages[i].role === 'user' ? 'user' : 'assistant',
              content: messages[i].content,
              sources: messages[i].sources
            });
            if (messages[i].id > self.lastMessageId) {
              self.lastMessageId = messages[i].id;
            }
          }
          self.startPolling();
        } else {
          // 会话无消息或已过期，清除 sessionId，显示欢迎消息
          self.sessionId = null;
          localStorage.removeItem('basjoo_session_' + self.config.agentId);
          if (self.config.welcomeMessage) {
            self.addMessage({ role: 'assistant', content: self.config.welcomeMessage, timestamp: new Date() });
          }
        }
      })
      .catch(function() {
        // 加载失败（如会话已过期404），清除并显示欢迎消息
        self.sessionId = null;
        localStorage.removeItem('basjoo_session_' + self.config.agentId);
        if (self.config.welcomeMessage) {
          self.addMessage({ role: 'assistant', content: self.config.welcomeMessage, timestamp: new Date() });
        }
      });
  };

  /**
   * 开始轮询新消息
   */
  BasjooWidget.prototype.startPolling = function() {
    if (this.pollIntervalId) return;
    var self = this;
    this.pollIntervalId = setInterval(function() { self.pollMessages(); }, 3000);
  };

  /**
   * 停止轮询
   */
  BasjooWidget.prototype.stopPolling = function() {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  };

  /**
   * 轮询拉取新消息
   */
  BasjooWidget.prototype.pollMessages = function() {
    if (!this.sessionId) return;
    var self = this;
    fetch(this.config.apiBase + '/api/v1/chat/messages?session_id=' + encodeURIComponent(this.sessionId) + '&after_id=' + this.lastMessageId + '&role=assistant')
      .then(function(response) {
        if (!response.ok) return;
        return response.json();
      })
      .then(function(messages) {
        if (!messages) return;
        for (var i = 0; i < messages.length; i++) {
          if (messages[i].content) {
            self.addMessage({ role: 'assistant', content: messages[i].content, sources: messages[i].sources });
            if (!self.isOpen) {
              self.startTitleBlink();
              self.showUnreadBadge();
            }
          }
          if (messages[i].id > self.lastMessageId) {
            self.lastMessageId = messages[i].id;
          }
        }
      })
      .catch(function() {
        // 轮询失败静默忽略
      });
  };

  /**
   * 发送消息
   */
  BasjooWidget.prototype.consumeStream = async function(response) {
    if (!response.body) throw new Error('Streaming response body is unavailable');

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var streamCompleted = false;
    var self = this;

    function processEvent(rawEvent) {
      if (!rawEvent.trim()) return;

      var eventName = 'message';
      var dataLines = [];
      rawEvent.split('\n').forEach(function(line) {
        if (line.indexOf('event:') === 0) {
          eventName = line.slice(6).trim();
        } else if (line.indexOf('data:') === 0) {
          dataLines.push(line.slice(5).replace(/^\s*/, ''));
        }
      });

      if (!dataLines.length) return;
      var payload = JSON.parse(dataLines.join('\n'));

      switch (eventName) {
        case 'sources':
          self.currentStreamSources = Array.isArray(payload.sources) ? payload.sources : [];
          break;
        case 'content':
          self.appendToStreamingMessage(payload.content || '');
          break;
        case 'done':
          if (payload.session_id) {
            self.sessionId = payload.session_id;
            localStorage.setItem('basjoo_session_' + self.config.agentId, self.sessionId);
            self.startPolling();
          }
          if (typeof payload.message_id === 'number' && payload.message_id > self.lastMessageId) {
            self.lastMessageId = payload.message_id;
          }
          if (payload.taken_over) {
            self.removeStreamingMessage();
            self.addMessage({ role: 'assistant', content: self.getText('takenOverNotice'), timestamp: new Date() });
          } else {
            self.finalizeStreamingMessage(self.currentStreamSources);
            if (!self.isOpen) {
              self.startTitleBlink();
              self.showUnreadBadge();
            }
          }
          streamCompleted = true;
          break;
        case 'error':
          throw new Error(payload.error || 'Stream failed');
        default:
          break;
      }
    }

    function findEventDelimiter() {
      var crlfIndex = buffer.indexOf('\r\n\r\n');
      var lfIndex = buffer.indexOf('\n\n');
      if (crlfIndex === -1 && lfIndex === -1) return null;
      if (crlfIndex === -1) return { index: lfIndex, length: 2 };
      if (lfIndex === -1) return { index: crlfIndex, length: 4 };
      return crlfIndex < lfIndex ? { index: crlfIndex, length: 4 } : { index: lfIndex, length: 2 };
    }

    while (!streamCompleted) {
      var result = await reader.read();
      var value = result.value || new Uint8Array();
      buffer += decoder.decode(value, { stream: !result.done });

      var delimiter = findEventDelimiter();
      while (delimiter) {
        var rawEvent = buffer.slice(0, delimiter.index);
        buffer = buffer.slice(delimiter.index + delimiter.length);
        processEvent(rawEvent.replace(/\r\n/g, '\n'));
        if (streamCompleted) break;
        delimiter = findEventDelimiter();
      }

      if (result.done) break;
    }

    if (!streamCompleted) {
      if (buffer.trim()) processEvent(buffer);
      if (!streamCompleted) throw new Error('Stream ended unexpectedly');
    }
  };

  BasjooWidget.prototype.ensureTurnstileReady = async function() {
    if (!this.turnstileSiteKey) return;
    if (window.turnstile && this.turnstileWidgetId) return;

    if (!this.turnstileScriptPromise) {
      this.turnstileScriptPromise = new Promise(function(resolve, reject) {
        var existingScript = document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]');
        if (existingScript) {
          if (window.turnstile) {
            resolve();
            return;
          }
          existingScript.addEventListener('load', function() { resolve(); }, { once: true });
          existingScript.addEventListener('error', function() { reject(new Error('Failed to load Turnstile')); }, { once: true });
          return;
        }

        var script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.onload = function() { resolve(); };
        script.onerror = function() { reject(new Error('Failed to load Turnstile')); };
        document.head.appendChild(script);
      });
    }

    await this.turnstileScriptPromise;

    if (!window.turnstile) {
      throw new Error('Turnstile unavailable');
    }

    if (!this.turnstileContainer) {
      this.turnstileContainer = document.createElement('div');
      this.turnstileContainer.style.display = 'none';
      document.body.appendChild(this.turnstileContainer);
    }

    if (!this.turnstileWidgetId) {
      this.turnstileWidgetId = window.turnstile.render(this.turnstileContainer, {
        sitekey: this.turnstileSiteKey,
        execution: 'execute',
        appearance: 'execute'
      });
    }
  };

  BasjooWidget.prototype.getTurnstileToken = async function() {
    if (!this.turnstileSiteKey) return undefined;

    await this.ensureTurnstileReady();

    if (!window.turnstile || !this.turnstileWidgetId) {
      throw new Error('Turnstile unavailable');
    }

    var self = this;
    return await new Promise(function(resolve, reject) {
      var timeoutId = window.setTimeout(function() { reject(new Error('Turnstile timeout')); }, 10000);
      var container = self.turnstileContainer;

      window.turnstile.remove(self.turnstileWidgetId);
      self.turnstileWidgetId = window.turnstile.render(container, {
        sitekey: self.turnstileSiteKey,
        execution: 'execute',
        appearance: 'execute',
        callback: function(token) {
          window.clearTimeout(timeoutId);
          resolve(token);
        },
        'error-callback': function() {
          window.clearTimeout(timeoutId);
          reject(new Error('Turnstile failed'));
        },
        'expired-callback': function() {
          window.clearTimeout(timeoutId);
          reject(new Error('Turnstile expired'));
        }
      });

      window.turnstile.execute(self.turnstileWidgetId);
    });
  };

  BasjooWidget.prototype.sendMessageWithRetry = async function(text) {
    var lastError = null;

    for (var attempt = 0; attempt <= 1; attempt++) {
      try {
        var turnstileToken = await this.getTurnstileToken();
        var response = await fetch(this.config.apiBase + '/api/v1/chat/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
          },
          body: JSON.stringify({
            agent_id: this.config.agentId,
            message: text,
            locale: this.getEffectiveLocale(),
            session_id: this.sessionId,
            visitor_id: this.visitorId,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            turnstile_token: turnstileToken
          })
        });

        if (!response.ok) {
          var detail = 'HTTP ' + response.status + ': ' + response.statusText;
          try {
            var errorPayload = await response.json();
            detail = errorPayload.message || errorPayload.detail || detail;
          } catch (parseError) {}
          throw new Error(detail);
        }

        this.hideLoading();
        this.createStreamingMessage();
        await this.consumeStream(response);
        return;
      } catch (error) {
        lastError = error;
        var errorText = error && error.message ? String(error.message) : '';
        var isRetryable = error instanceof TypeError
          || errorText.indexOf('fetch') !== -1
          || errorText.indexOf('Failed to fetch') !== -1
          || errorText.indexOf('Stream ended unexpectedly') !== -1;

        if (!isRetryable || attempt >= 1) {
          throw error;
        }

        this.hideLoading();
        this.removeStreamingMessage();
        console.warn('[Basjoo Widget] Stream attempt ' + (attempt + 1) + ' failed, retrying...');
        await new Promise(function(resolve) { window.setTimeout(resolve, 1000); });
        this.showLoading();
      }
    }

    throw lastError;
  };

  BasjooWidget.prototype.sendMessage = async function(text) {
    var self = this;
    if (this.isSending) return;
    this.isSending = true;

    this.addMessage({ role: 'user', content: text });
    this.showLoading();

    try {
      await this.sendMessageWithRetry(text);
    } catch (error) {
      self.hideLoading();
      self.removeStreamingMessage();
      console.error('[Basjoo Widget] Error sending message:', error);

      var errorMessage = self.getText('sendFailed');
      var consoleHint = '';
      var errorText = error && error.message ? String(error.message) : '';

      if (error instanceof TypeError || errorText.indexOf('fetch') !== -1 || errorText.indexOf('NetworkError') !== -1) {
        errorMessage = self.getText('networkError');
        consoleHint = 'Request may be blocked by CORS, network connectivity, or an incorrect apiBase. Current apiBase: ' + (self.config.apiBase || '(not set)');
      } else if (errorText.indexOf('429') !== -1 || errorText.toLowerCase().indexOf('quota') !== -1) {
        errorMessage = self.getText('quotaExceeded');
      } else if (errorText.toLowerCase().indexOf('turnstile') !== -1 || errorText.toLowerCase().indexOf('bot verification') !== -1 || errorText.indexOf('403') !== -1) {
        consoleHint = 'Bot protection verification failed. Check Turnstile site key, secret key, and allowed hostnames.';
      } else if (errorText.indexOf('401') !== -1) {
        consoleHint = 'Authentication failed. Please check the agent configuration and public API access.';
      }

      if (!self.config.apiBase) {
        consoleHint = 'apiBase could not be determined. When embedding the widget from a local file, set apiBase explicitly or load the SDK from the target server.';
      }

      if (consoleHint) {
        console.error('[Basjoo Widget]', consoleHint);
      }

      self.showError(errorMessage);
    } finally {
      this.isSending = false;
    }
  };

  /**
   * 开始标题闪烁
   */
  BasjooWidget.prototype.startTitleBlink = function() {
    if (this.titleBlinkInterval) return;
    this.originalTitle = document.title;
    this.hasUnread = true;
    var self = this;
    var blink = true;
    this.titleBlinkInterval = setInterval(function() {
      document.title = blink ? self.originalTitle : '❗ ' + self.getText('newMessage');
      blink = !blink;
    }, 1000);
  };

  /**
   * 停止标题闪烁
   */
  BasjooWidget.prototype.stopTitleBlink = function() {
    if (this.titleBlinkInterval) {
      clearInterval(this.titleBlinkInterval);
      this.titleBlinkInterval = null;
      document.title = this.originalTitle;
    }
  };

  BasjooWidget.getSdkScript = function() {
    if (document.currentScript && document.currentScript.src && document.currentScript.src.indexOf('sdk.js') !== -1) {
      return document.currentScript;
    }

    var scripts = document.querySelectorAll('script[src]');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].getAttribute('src') || '';
      if (src.indexOf('sdk.js') !== -1) {
        return scripts[i];
      }
    }

    return null;
  };

  BasjooWidget.readAutoInitConfig = function() {
    var script = BasjooWidget.getSdkScript();
    if (!script || !script.src) {
      return null;
    }

    try {
      var scriptUrl = new URL(script.src, window.location.href);
      var params = scriptUrl.searchParams;
      var agentId = params.get('agentId') || params.get('agent_id') || '';
      var apiBase = params.get('apiBase') || params.get('api_base') || scriptUrl.origin;
      var themeColor = params.get('themeColor') || params.get('theme_color') || null;
      var title = params.get('title') || null;
      var welcomeMessage = params.get('welcomeMessage') || params.get('welcome_message') || null;
      var logoUrl = params.get('logoUrl') || params.get('logo_url') || null;
      var language = params.get('language') || 'auto';
      var position = params.get('position') || 'right';
      var theme = params.get('theme') || 'auto';

      if (!agentId && !params.has('autoInit')) {
        return null;
      }

      return {
        agentId: agentId,
        apiBase: apiBase,
        themeColor: themeColor,
        title: title,
        welcomeMessage: welcomeMessage,
        logoUrl: logoUrl,
        language: language,
        position: position,
        theme: theme
      };
    } catch (error) {
      console.warn('[Basjoo Widget] Failed to parse auto-init config from sdk.js URL.', error);
      return null;
    }
  };

  BasjooWidget.autoInit = function() {
    var config = BasjooWidget.readAutoInitConfig();
    if (!config) {
      return;
    }

    if (document.getElementById('basjoo-widget-container')) {
      return;
    }

    new BasjooWidget(config);
  };

  // 暴露到全局
  window.BasjooWidget = BasjooWidget;
  BasjooWidget.autoInit();

})();
