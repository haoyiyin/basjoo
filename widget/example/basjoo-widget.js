var BasjooWidget = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/BasjooWidget.tsx
  var BasjooWidget_exports = {};
  __export(BasjooWidget_exports, {
    default: () => BasjooWidget_default
  });
  var BasjooWidget = class {
    config;
    container = null;
    button = null;
    chatWindow = null;
    messages = [];
    sessionId = null;
    isOpen = false;
    constructor(config) {
      this.config = {
        agentId: config.agentId,
        apiBase: config.apiBase || window.location.origin + (window.location.port === "3000" ? ":8001" : ""),
        themeColor: config.themeColor || "#3B82F6",
        logoUrl: config.logoUrl || "",
        title: config.title || "AI\u52A9\u624B",
        welcomeMessage: config.welcomeMessage || "\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F",
        language: config.language || "auto",
        position: config.position || "right"
      };
    }
    /**
     * 初始化Widget
     */
    init() {
      if (document.getElementById("basjoo-widget-container")) {
        console.warn("Basjoo Widget already initialized");
        return;
      }
      this.createStyles();
      this.createContainer();
      this.createButton();
      this.createChatWindow();
      if (this.config.welcomeMessage) {
        this.addMessage({
          role: "assistant",
          content: this.config.welcomeMessage,
          timestamp: /* @__PURE__ */ new Date()
        });
      }
    }
    /**
     * 创建样式
     */
    createStyles() {
      const style = document.createElement("style");
      style.id = "basjoo-widget-styles";
      style.textContent = `
      #basjoo-widget-container * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }

      #basjoo-widget-button {
        position: fixed;
        bottom: 24px;
        ${this.config.position === "left" ? "left" : "right"}: 24px;
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

      #basjoo-chat-window {
        position: fixed;
        bottom: 96px;
        ${this.config.position === "left" ? "left" : "right"}: 24px;
        width: 380px;
        height: 600px;
        max-height: calc(100vh - 120px);
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
        display: flex;
        flex-direction: column;
        z-index: 9998;
        opacity: 0;
        transform: translateY(20px);
        pointer-events: none;
        transition: opacity 0.3s, transform 0.3s;
      }

      #basjoo-chat-window.open {
        opacity: 1;
        transform: translateY(0);
        pointer-events: all;
      }

      .basjoo-header {
        padding: 16px;
        background: ${this.config.themeColor};
        color: white;
        border-radius: 12px 12px 0 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .basjoo-header-title {
        display: flex;
        align-items: center;
        gap: 12px;
        font-weight: 600;
        font-size: 16px;
      }

      .basjoo-header-logo {
        width: 32px;
        height: 32px;
        border-radius: 6px;
        background: white;
        padding: 4px;
      }

      .basjoo-close {
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        padding: 4px;
        opacity: 0.8;
        transition: opacity 0.2s;
      }

      .basjoo-close:hover {
        opacity: 1;
      }

      .basjoo-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .basjoo-message {
        max-width: 80%;
        padding: 10px 14px;
        border-radius: 12px;
        font-size: 14px;
        line-height: 1.5;
      }

      .basjoo-message-user {
        align-self: flex-end;
        background: ${this.config.themeColor};
        color: white;
        border-bottom-right-radius: 4px;
      }

      .basjoo-message-assistant {
        align-self: flex-start;
        background: #f3f4f6;
        color: #1f2937;
        border-bottom-left-radius: 4px;
      }

      .basjoo-sources {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid #e5e7eb;
        font-size: 12px;
        color: #6b7280;
      }

      .basjoo-sources summary {
        cursor: pointer;
        user-select: none;
      }

      .basjoo-source-item {
        padding: 4px 0;
        color: #9ca3af;
      }

      .basjoo-input-area {
        padding: 12px 16px;
        border-top: 1px solid #e5e7eb;
        display: flex;
        gap: 8px;
      }

      .basjoo-input {
        flex: 1;
        padding: 10px 14px;
        border: 1px solid #d1d5db;
        border-radius: 20px;
        font-size: 14px;
        outline: none;
        transition: border-color 0.2s;
      }

      .basjoo-input:focus {
        border-color: ${this.config.themeColor};
      }

      .basjoo-send {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: ${this.config.themeColor};
        border: none;
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.2s;
      }

      .basjoo-send:hover {
        opacity: 0.9;
      }

      .basjoo-send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .basjoo-loading {
        display: flex;
        gap: 4px;
        padding: 12px;
      }

      .basjoo-loading-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #9ca3af;
        animation: basjoo-bounce 1.4s infinite ease-in-out both;
      }

      .basjoo-loading-dot:nth-child(1) { animation-delay: -0.32s; }
      .basjoo-loading-dot:nth-child(2) { animation-delay: -0.16s; }

      @keyframes basjoo-bounce {
        0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
        40% { transform: scale(1); opacity: 1; }
      }

      .basjoo-error {
        padding: 12px;
        background: #fef2f2;
        color: #991b1b;
        border-radius: 8px;
        font-size: 13px;
        margin: 8px 0;
      }

      @media (max-width: 480px) {
        #basjoo-chat-window {
          width: calc(100vw - 48px);
          height: calc(100vh - 120px);
          bottom: 96px;
          ${this.config.position === "left" ? "left" : "right"}: 24px;
        }
      }
    `;
      document.head.appendChild(style);
    }
    /**
     * 创建容器
     */
    createContainer() {
      this.container = document.createElement("div");
      this.container.id = "basjoo-widget-container";
      document.body.appendChild(this.container);
    }
    /**
     * 创建浮动按钮
     */
    createButton() {
      this.button = document.createElement("div");
      this.button.id = "basjoo-widget-button";
      this.button.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
    `;
      this.button.addEventListener("click", () => this.toggle());
      this.container.appendChild(this.button);
    }
    /**
     * 创建聊天窗口
     */
    createChatWindow() {
      this.chatWindow = document.createElement("div");
      this.chatWindow.id = "basjoo-chat-window";
      this.chatWindow.innerHTML = `
      <div class="basjoo-header">
        <div class="basjoo-header-title">
          ${this.config.logoUrl ? `<img src="${this.config.logoUrl}" class="basjoo-header-logo" alt="">` : ""}
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
        <input type="text" class="basjoo-input" placeholder="\u8F93\u5165\u60A8\u7684\u95EE\u9898...">
        <button class="basjoo-send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    `;
      const closeBtn = this.chatWindow.querySelector(".basjoo-close");
      closeBtn.addEventListener("click", () => this.toggle());
      const input = this.chatWindow.querySelector(".basjoo-input");
      const sendBtn = this.chatWindow.querySelector(".basjoo-send");
      const send = () => {
        const message = input.value.trim();
        if (message) {
          this.sendMessage(message);
          input.value = "";
        }
      };
      sendBtn.addEventListener("click", send);
      input.addEventListener("keypress", (e) => {
        if (e.key === "Enter")
          send();
      });
      this.container.appendChild(this.chatWindow);
    }
    /**
     * 切换聊天窗口
     */
    toggle() {
      this.isOpen = !this.isOpen;
      this.chatWindow?.classList.toggle("open", this.isOpen);
    }
    /**
     * 添加消息到界面
     */
    addMessage(message) {
      this.messages.push(message);
      const messagesContainer = this.chatWindow?.querySelector(".basjoo-messages");
      const messageDiv = document.createElement("div");
      messageDiv.className = `basjoo-message basjoo-message-${message.role}`;
      messageDiv.innerHTML = message.content.replace(/\n/g, "<br>");
      if (message.sources && message.sources.length > 0) {
        const sourcesDiv = document.createElement("details");
        sourcesDiv.className = "basjoo-sources";
        sourcesDiv.innerHTML = `
        <summary>\u5F15\u7528\u6765\u6E90 (${message.sources.length})</summary>
        ${message.sources.map((source) => `
          <div class="basjoo-source-item">
            ${source.type === "url" ? `\u{1F4C4} ${source.title || source.url || "\u6587\u6863"}` : `\u2753 ${source.question}`}
          </div>
        `).join("")}
      `;
        messageDiv.appendChild(sourcesDiv);
      }
      messagesContainer.appendChild(messageDiv);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    /**
     * 显示加载动画
     */
    showLoading() {
      const messagesContainer = this.chatWindow?.querySelector(".basjoo-messages");
      const loadingDiv = document.createElement("div");
      loadingDiv.className = "basjoo-loading";
      loadingDiv.id = "basjoo-loading";
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
    hideLoading() {
      const loading = this.chatWindow?.querySelector("#basjoo-loading");
      loading?.remove();
    }
    /**
     * 显示错误
     */
    showError(message) {
      const messagesContainer = this.chatWindow?.querySelector(".basjoo-messages");
      const errorDiv = document.createElement("div");
      errorDiv.className = "basjoo-error";
      errorDiv.textContent = message;
      messagesContainer.appendChild(errorDiv);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      setTimeout(() => errorDiv.remove(), 5e3);
    }
    /**
     * 发送消息
     */
    async sendMessage(message) {
      this.addMessage({
        role: "user",
        content: message,
        timestamp: /* @__PURE__ */ new Date()
      });
      this.showLoading();
      try {
        const response = await fetch(`${this.config.apiBase}/api/v1/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            agent_id: this.config.agentId,
            message,
            locale: this.config.language === "auto" ? void 0 : this.config.language,
            session_id: this.sessionId || void 0
          })
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        this.hideLoading();
        this.addMessage({
          role: "assistant",
          content: data.reply,
          sources: data.sources,
          timestamp: /* @__PURE__ */ new Date()
        });
        this.sessionId = data.session_id;
      } catch (error) {
        this.hideLoading();
        console.error("Basjoo Widget error:", error);
        let errorMessage = "\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5";
        if (error.message.includes("fetch")) {
          errorMessage = "\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC";
        } else if (error.message.includes("429")) {
          errorMessage = "\u4ECA\u65E5\u6D88\u606F\u5DF2\u8FBE\u4E0A\u9650";
        }
        this.showError(errorMessage);
      }
    }
    /**
     * 销毁Widget
     */
    destroy() {
      this.container?.remove();
      const styles = document.getElementById("basjoo-widget-styles");
      styles?.remove();
    }
  };
  window.BasjooWidget = BasjooWidget;
  var BasjooWidget_default = BasjooWidget;
  return __toCommonJS(BasjooWidget_exports);
})();
