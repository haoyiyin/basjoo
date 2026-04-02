"use strict";(()=>{var w={en:"en-US",fr:"fr-FR",ja:"ja-JP",de:"de-DE",es:"es-ES","zh-hans":"zh-CN","zh-cn":"zh-CN","zh-sg":"zh-CN","zh-hant":"zh-Hant","zh-tw":"zh-TW","zh-hk":"zh-HK","zh-mo":"zh-HK"},m=["en-US","zh-CN"],v=["agentId","apiBase","themeColor","logoUrl","title","welcomeMessage","language","position","theme","turnstileSiteKey"],f="__basjooWidgetAutoInitScheduled";function x(u){if(!u)return"/basjoo-logo.png";try{return new URL("/basjoo-logo.png",`${u}/`).toString()}catch{return"/basjoo-logo.png"}}function y(u){try{let e=new URL(u.src,window.location.href);if(!v.some(o=>e.searchParams.has(o)))return null;let i=e.searchParams.get("agentId")?.trim()||"";if(!i)return console.warn("[Basjoo Widget] Detected sdk.js query parameters but agentId is missing. The widget will not initialize automatically."),null;let s=e.searchParams.get("position")?.trim(),n=e.searchParams.get("theme")?.trim();return{agentId:i,apiBase:e.searchParams.get("apiBase")?.trim()||void 0,themeColor:e.searchParams.get("themeColor")?.trim()||void 0,logoUrl:e.searchParams.get("logoUrl")?.trim()||void 0,title:e.searchParams.get("title")?.trim()||void 0,welcomeMessage:e.searchParams.get("welcomeMessage")?.trim()||void 0,language:e.searchParams.get("language")?.trim()||void 0,position:s==="left"||s==="right"?s:void 0,theme:n==="light"||n==="dark"||n==="auto"?n:void 0,turnstileSiteKey:e.searchParams.get("turnstileSiteKey")?.trim()||void 0}}catch{return console.warn("[Basjoo Widget] Failed to parse sdk.js query parameters for auto-initialization."),null}}var p=class{constructor(e){this.container=null;this.button=null;this.chatWindow=null;this.messages=[];this.sessionId=null;this.isOpen=!1;this.VISITOR_STORAGE_KEY="basjoo_visitor_id";this.effectiveTheme="light";this.originalTitle="";this.titleBlinkInterval=null;this.hasUnread=!1;this.pollIntervalId=null;this.lastMessageId=0;this.isSending=!1;this.streamingMessage=null;this.streamingMessageContent=null;this.thinkingIndicator=null;this.thinkingIndicatorText=null;this.thinkingElapsed=0;this.thinkingTimerId=null;this.currentStreamContent="";this.currentStreamSources=[];this.turnstileSiteKey=null;this.turnstileWidgetId=null;this.turnstileContainer=null;this.turnstileScriptPromise=null;let t=this.detectApiBase(e.apiBase);this.config={agentId:e.agentId,apiBase:t,themeColor:e.themeColor||"#3B82F6",logoUrl:e.logoUrl||x(t),title:e.title||"AI\u52A9\u624B",welcomeMessage:e.welcomeMessage||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F",language:e.language||"auto",position:e.position||"right",theme:e.theme||"auto",turnstileSiteKey:e.turnstileSiteKey||""},this.STORAGE_KEY=`basjoo_session_${this.config.agentId}`,this.sessionId=localStorage.getItem(this.STORAGE_KEY),this.visitorId=localStorage.getItem(this.VISITOR_STORAGE_KEY)||this.generateVisitorId(),this.effectiveTheme=this.getEffectiveTheme(),this.loadPublicConfig()}generateVisitorId(){let e=`visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,11)}`;return localStorage.setItem(this.VISITOR_STORAGE_KEY,e),e}detectApiBase(e){if(e)try{let n=new URL(e,window.location.href);if((n.protocol==="http:"||n.protocol==="https:")&&n.port==="3000"){let o=`${n.protocol}//${n.hostname}:8000`;return console.info("[Basjoo Widget] Rewriting configured dev apiBase to direct backend:",o),o}return n.toString().replace(/\/$/,"")}catch{return e}let t=document.currentScript;if(t instanceof HTMLScriptElement&&t.src)try{let n=new URL(t.src,window.location.href);return console.info("[Basjoo Widget] Detected API base from current script:",n.origin),n.origin}catch{}let i=document.querySelectorAll("script[src]");for(let n of i){let o=n.getAttribute("src")||"";if(!(!o.includes("sdk.js")&&!o.includes("basjoo")))try{let r=new URL(o,window.location.href);return console.info("[Basjoo Widget] Detected API base from script src:",r.origin),r.origin}catch{}}let s=window.location.port;if(s==="3000"||s==="5173"){let n=`${window.location.protocol}//${window.location.hostname}:8000`;return console.info("[Basjoo Widget] Development mode detected, using:",n),n}return window.location.protocol==="file:"?(console.error("[Basjoo Widget] Cannot determine API base from a local file. Please set apiBase explicitly."),""):(console.warn("[Basjoo Widget] Falling back to window.location.origin. Set apiBase explicitly if the API is hosted elsewhere."),window.location.origin)}getEffectiveTheme(){return this.config.theme==="light"||this.config.theme==="dark"?this.config.theme:typeof window<"u"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}normalizeLocale(e){if(!e)return null;let t=e.trim().replace(/_/g,"-");if(!t)return null;let i=t.split("-").filter(Boolean);if(i.length===0)return null;let s=[i[0].toLowerCase()];for(let o of i.slice(1))/^[A-Za-z]{4}$/.test(o)?s.push(o[0].toUpperCase()+o.slice(1).toLowerCase()):/^[A-Za-z]{2,3}$/.test(o)?s.push(o.toUpperCase()):s.push(o);let n=s.join("-");return w[n.toLowerCase()]||n}getPreferredLocales(){let e=new Set,t=this.config.language!=="auto"?this.normalizeLocale(this.config.language):null;if(t)e.add(t);else{let i=Array.isArray(navigator.languages)&&navigator.languages.length>0?navigator.languages:[navigator.language];for(let s of i){let n=this.normalizeLocale(s);n&&e.add(n)}}for(let i of m)e.add(i);return Array.from(e)}buildLocaleFallbacks(e){let t=this.normalizeLocale(e);if(!t)return[...m];let i=[t],s=t.split("-",1)[0],n=t.toLowerCase();if(s==="zh")t.includes("Hant")||["zh-tw","zh-hk","zh-mo"].includes(n)?i.push("zh-Hant","zh-TW","zh-HK","zh-CN","zh"):i.push("zh-Hans","zh-CN","zh");else{let o={en:"en-US",fr:"fr-FR",ja:"ja-JP",de:"de-DE",es:"es-ES"};o[s]&&i.push(o[s]),i.push(s)}return i.push(...m),Array.from(new Set(i.map(o=>this.normalizeLocale(o)).filter(o=>!!o)))}getEffectiveLocale(){return this.getPreferredLocales()[0]||"en-US"}resolveI18nText(e,t){if(!e)return t;let i=new Map,s=[];for(let[n,o]of Object.entries(e)){if(typeof o!="string")continue;let r=o.trim();if(!r)continue;let a=this.normalizeLocale(n)||n;i.set(a,r),s.push(r)}for(let n of this.getPreferredLocales())for(let o of this.buildLocaleFallbacks(n)){let r=i.get(o);if(r)return r}return s.length>0?s[0]:t}async loadPublicConfig(){if(this.turnstileSiteKey=this.config.turnstileSiteKey||null,!this.config.apiBase){console.warn("[Basjoo Widget] Skipping public config fetch because apiBase could not be determined.");return}try{let e=new URL(`${this.config.apiBase}/api/v1/config:public`);this.config.agentId&&e.searchParams.set("agent_id",this.config.agentId);let t=await fetch(e.toString());if(!t.ok)throw new Error(`HTTP ${t.status}: ${t.statusText}`);let i=await t.json();!this.config.agentId&&i.default_agent_id&&(this.config.agentId=i.default_agent_id),this.config.themeColor=this.config.themeColor||i.widget_color||"#3B82F6",this.config.title=this.config.title||this.resolveI18nText(i.widget_title_i18n,i.widget_title||"AI\u52A9\u624B"),this.config.welcomeMessage=this.config.welcomeMessage||this.resolveI18nText(i.welcome_message_i18n,i.welcome_message||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F");let s=i;this.turnstileSiteKey=s.turnstile_enabled&&s.turnstile_site_key||null,this.effectiveTheme=this.getEffectiveTheme()}catch(e){console.warn("[Basjoo Widget] Failed to load public config, using defaults.",e),e instanceof TypeError&&console.warn("[Basjoo Widget] Public config request may be blocked by CORS, network issues, or an incorrect apiBase:",this.config.apiBase)}}init(){if(!document.body){console.warn("[Basjoo Widget] document.body is not available yet. Call init() after DOMContentLoaded or place the embed code near the end of <body>.");return}if(document.getElementById("basjoo-widget-container")){console.warn("[Basjoo Widget] Initialization skipped because #basjoo-widget-container already exists. Avoid loading or initializing the widget twice on the same page.");return}if(this.originalTitle=document.title,this.createStyles(),this.createContainer(),this.createButton(),this.createChatWindow(),this.showGreetingBubble(),this.startTitleBlink(),this.sessionId){this.loadHistory();return}this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date})}showGreetingBubble(){if(!this.button)return;let e=document.createElement("div");e.className="basjoo-greeting-bubble",e.textContent=this.getText("greetingBubble");let t=this.config.position;e.style.position="fixed",e.style.bottom="100px",e.style[t]="24px",e.style.zIndex="9999",document.body.appendChild(e),setTimeout(()=>{e.remove()},5e3)}async loadHistory(){if(this.sessionId){try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}`);if(!e.ok)throw new Error("Failed to load history");let t=await e.json();if(t&&t.length>0){for(let i of t)this.addMessage({role:i.role==="user"?"user":"assistant",content:i.content,sources:i.sources,timestamp:new Date}),i.id>this.lastMessageId&&(this.lastMessageId=i.id);this.startPolling();return}}catch{}this.sessionId=null,localStorage.removeItem(this.STORAGE_KEY),this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date})}}startTitleBlink(){if(this.titleBlinkInterval)return;this.hasUnread=!0;let e=!0;this.titleBlinkInterval=window.setInterval(()=>{document.title=e?this.originalTitle:"\u2757 "+this.getText("newMessage"),e=!e},1e3)}stopTitleBlink(){this.titleBlinkInterval&&(clearInterval(this.titleBlinkInterval),this.titleBlinkInterval=null),document.title=this.originalTitle,this.hasUnread=!1}createStyles(){let e=document.createElement("style");e.id="basjoo-widget-styles";let t=this.effectiveTheme==="dark",i=t?"#1a1a2e":"white",s=t?"#e2e8f0":"#1f2937",n=t?"#94a3b8":"#6b7280",o=t?"rgba(148, 163, 184, 0.2)":"#e5e7eb",r=t?"#0f0f1a":"white",a=t?"#2d2d44":"#f3f4f6",l=t?"rgba(239, 68, 68, 0.2)":"#fef2f2";e.textContent=`
      #basjoo-widget-container * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }

      #basjoo-widget-button {
        position: fixed;
        bottom: 24px;
        ${this.config.position==="left"?"left":"right"}: 24px;
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

      .basjoo-greeting-bubble {
        background: white;
        color: ${s};
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
        ${this.config.position==="left"?"left":"right"}: 30px;
        width: 12px;
        height: 12px;
        background: white;
        transform: rotate(45deg);
        border-bottom: 1px solid ${o};
        border-right: 1px solid ${o};
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

      #basjoo-widget-button svg {
        width: 30px;
        height: 30px;
        fill: white;
      }

      #basjoo-chat-window {
        position: fixed;
        bottom: 96px;
        ${this.config.position==="left"?"left":"right"}: 24px;
        width: 380px;
        height: 600px;
        max-height: calc(100vh - 120px);
        background: ${i};
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, ${t?"0.4":"0.15"});
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
        background: ${i};
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
        white-space: pre-wrap;
        word-break: break-word;
      }

      .basjoo-message-assistant {
        align-self: flex-start;
        background: ${a};
        color: ${s};
        border-bottom-left-radius: 4px;
        word-break: break-word;
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
        background: ${t?"rgba(15, 15, 26, 0.8)":"rgba(255, 255, 255, 0.75)"};
        border: 1px solid ${o};
        border-radius: 6px;
        padding: 0.1rem 0.35rem;
      }

      .basjoo-message-content pre {
        overflow-x: auto;
        padding: 0.875rem 1rem;
        background: ${t?"#0f0f1a":"#ffffff"};
        border: 1px solid ${o};
        border-radius: 10px;
      }

      .basjoo-message-content pre code {
        background: transparent;
        border: none;
        padding: 0;
      }

      .basjoo-message-content a {
        color: ${this.config.themeColor};
        text-decoration: underline;
      }

      .basjoo-message-content blockquote {
        padding-left: 0.875rem;
        border-left: 3px solid ${this.config.themeColor};
        color: ${n};
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

      .basjoo-sources {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .basjoo-sources-label {
        font-size: 12px;
        color: ${n};
      }

      .basjoo-citation-card {
        background: ${a};
        border: 1px solid ${o};
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
        background: ${this.config.themeColor};
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
        color: ${s};
      }

      .basjoo-citation-arrow {
        color: ${n};
        transition: transform 0.2s ease;
        flex-shrink: 0;
      }

      .basjoo-citation-card[open] .basjoo-citation-arrow {
        transform: rotate(180deg);
      }

      .basjoo-citation-body {
        border-top: 1px solid ${o};
        padding: 8px 10px;
        font-size: 12px;
        color: ${n};
        line-height: 1.5;
      }

      .basjoo-citation-link {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
        color: ${this.config.themeColor};
        text-decoration: none;
        word-break: break-all;
      }

      .basjoo-input-area {
        padding: 12px 16px;
        border-top: 1px solid ${o};
        display: flex;
        gap: 8px;
        background: ${i};
      }

      .basjoo-input {
        flex: 1;
        padding: 10px 14px;
        border: 1px solid ${o};
        border-radius: 20px;
        font-size: 14px;
        outline: none;
        transition: border-color 0.2s;
        background: ${r};
        color: ${s};
      }

      .basjoo-input::placeholder {
        color: ${n};
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
        background: ${n};
        animation: basjoo-bounce 1.4s infinite ease-in-out both;
      }

      .basjoo-loading-dot:nth-child(1) { animation-delay: -0.32s; }
      .basjoo-loading-dot:nth-child(2) { animation-delay: -0.16s; }

      .basjoo-thinking {
        display: flex;
        align-items: center;
        gap: 8px;
        align-self: flex-start;
        max-width: 80%;
        padding: 10px 14px;
        border-radius: 12px;
        border-bottom-left-radius: 4px;
        background: ${a};
        color: ${s};
        font-size: 14px;
        line-height: 1.5;
      }

      .basjoo-thinking-icon {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: ${n};
        animation: basjoo-pulse 1.5s ease-in-out infinite;
        flex-shrink: 0;
      }

      @keyframes basjoo-bounce {
        0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
        40% { transform: scale(1); opacity: 1; }
      }

      @keyframes basjoo-pulse {
        0%, 100% { opacity: 0.45; transform: scale(0.9); }
        50% { opacity: 1; transform: scale(1.1); }
      }

      .basjoo-error {
        padding: 12px;
        background: ${l};
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
          ${this.config.position==="left"?"left":"right"}: 24px;
        }
      }
    `,document.head.appendChild(e)}createContainer(){this.container=document.createElement("div"),this.container.id="basjoo-widget-container",document.body.appendChild(this.container)}createButton(){this.button=document.createElement("div"),this.button.id="basjoo-widget-button",this.button.innerHTML=`
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
    `,this.button.addEventListener("click",()=>this.toggle()),this.container.appendChild(this.button)}createChatWindow(){this.chatWindow=document.createElement("div"),this.chatWindow.id="basjoo-chat-window",this.chatWindow.innerHTML=`
      <div class="basjoo-header">
        <div class="basjoo-header-title">
          ${this.config.logoUrl?`<img src="${this.config.logoUrl}" class="basjoo-header-logo" alt="">`:""}
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
        <input type="text" class="basjoo-input" placeholder="${this.getText("inputPlaceholder")}" maxlength="2000">
        <button class="basjoo-send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    `,this.chatWindow.querySelector(".basjoo-close").addEventListener("click",()=>this.toggle());let t=this.chatWindow.querySelector(".basjoo-input"),i=this.chatWindow.querySelector(".basjoo-send"),s=()=>{if(this.isSending)return;let n=t.value.trim();if(n){if(n.length>2e3){this.showError(this.getText("messageTooLong"));return}this.sendMessage(n),t.value=""}};i.addEventListener("click",s),t.addEventListener("keypress",n=>{n.key==="Enter"&&s()}),this.container.appendChild(this.chatWindow)}toggle(){this.isOpen=!this.isOpen,this.chatWindow?.classList.toggle("open",this.isOpen),this.isOpen&&this.stopTitleBlink()}getText(e){let t={sendFailed:{"en-US":"Send failed, please try again later","zh-CN":"\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"},networkError:{"en-US":"Network connection failed, please check your connection","zh-CN":"\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC"},quotaExceeded:{"en-US":"Daily message limit reached","zh-CN":"\u4ECA\u65E5\u6D88\u606F\u5DF2\u8FBE\u4E0A\u9650"},takenOverNotice:{"en-US":"Your conversation has been transferred to a human agent. Please wait for their reply.","zh-CN":"\u5DF2\u8F6C\u63A5\u4EBA\u5DE5\u5BA2\u670D\uFF0C\u8BF7\u7B49\u5F85\u56DE\u590D\u3002"},inputPlaceholder:{"en-US":"Type your question...","zh-CN":"\u8F93\u5165\u60A8\u7684\u95EE\u9898..."},citationSources:{"en-US":"Citation Sources","zh-CN":"\u5F15\u7528\u6765\u6E90"},openSource:{"en-US":"Open source","zh-CN":"\u6253\u5F00\u6765\u6E90"},document:{"en-US":"Document","zh-CN":"\u6587\u6863"},messageTooLong:{"en-US":"Message too long (max 2000 characters)","zh-CN":"\u6D88\u606F\u8FC7\u957F\uFF08\u6700\u591A2000\u5B57\u7B26\uFF09"},greetingBubble:{"en-US":"Hi! How can I help you?","zh-CN":"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u60A8\uFF1F"},newMessage:{"en-US":"New message","zh-CN":"\u65B0\u6D88\u606F"},thinking:{"en-US":"Thinking...","zh-CN":"\u601D\u8003\u4E2D..."}};return this.resolveI18nText(t[e],t[e]["en-US"]||t[e]["zh-CN"]||e)}escapeHtml(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}renderMarkdown(e){if(!e)return"";let t=e.replace(/\r\n/g,`
`).split(/\n{2,}/).map(n=>n.trim()).filter(Boolean),i=n=>{let o=this.escapeHtml(n);return o=o.replace(/`([^`]+)`/g,"<code>$1</code>"),o=o.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>"),o=o.replace(/__([^_]+)__/g,"<strong>$1</strong>"),o=o.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g,"$1<em>$2</em>"),o=o.replace(/(^|[^_])_([^_]+)_(?!_)/g,"$1<em>$2</em>"),o=o.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(r,a,l)=>`<a href="${this.escapeHtml(l)}" target="_blank" rel="noopener noreferrer">${a}</a>`),o};return t.map(n=>{if(/^```/.test(n)&&/```$/.test(n)){let o=n.replace(/^```\w*\n?/,"").replace(/```$/,"");return`<pre><code>${this.escapeHtml(o)}</code></pre>`}if(/^(?:[-*]\s.+\n?)+$/.test(n))return`<ul>${n.split(`
`).map(r=>r.replace(/^[-*]\s+/,"").trim()).filter(Boolean).map(r=>`<li>${i(r)}</li>`).join("")}</ul>`;if(/^(?:\d+\.\s.+\n?)+$/.test(n))return`<ol>${n.split(`
`).map(r=>r.replace(/^\d+\.\s+/,"").trim()).filter(Boolean).map(r=>`<li>${i(r)}</li>`).join("")}</ol>`;if(/^>\s?/.test(n)){let o=n.split(`
`).map(r=>r.replace(/^>\s?/,"")).join("<br>");return`<blockquote>${i(o)}</blockquote>`}if(/^#{1,6}\s/.test(n)){let o=n.replace(/^#{1,6}\s+/,"");return`<p><strong>${i(o)}</strong></p>`}return`<p>${i(n).replace(/\n/g,"<br>")}</p>`}).join("")}updateMessageContent(e,t){e.innerHTML=this.renderMarkdown(t)}createCitationCard(e,t){let i=document.createElement("details");i.className="basjoo-citation-card";let s=document.createElement("summary");s.className="basjoo-citation-trigger";let n=document.createElement("span");n.className="basjoo-citation-number",n.textContent=String(t+1);let o=document.createElement("span");o.className="basjoo-citation-title",o.textContent=e.type==="url"?e.title||e.url||this.getText("document"):e.question||this.getText("citationSources");let r=document.createElement("span");r.className="basjoo-citation-arrow",r.innerHTML=`
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `,s.appendChild(n),s.appendChild(o),s.appendChild(r),i.appendChild(s);let a=document.createElement("div");if(a.className="basjoo-citation-body",e.type==="url"&&e.url){let c=document.createElement("a");c.className="basjoo-citation-link",c.href=e.url,c.target="_blank",c.rel="noopener noreferrer",c.textContent=this.getText("openSource"),a.appendChild(c);let g=document.createElement("div");g.textContent=e.url,a.appendChild(g)}let l=document.createElement("div");return l.textContent=e.snippet||e.question||e.title||e.url||this.getText("document"),a.appendChild(l),i.appendChild(a),i}renderSources(e,t){if(!t.length)return;let i=document.createElement("div");i.className="basjoo-sources";let s=document.createElement("div");s.className="basjoo-sources-label",s.textContent=`${this.getText("citationSources")} (${t.length})`,i.appendChild(s),t.forEach((n,o)=>{i.appendChild(this.createCitationCard(n,o))}),e.appendChild(i)}createMessageElement(e){let t=document.createElement("div");t.className=`basjoo-message basjoo-message-${e.role}`;let i=document.createElement("div");return i.className="basjoo-message-content",this.updateMessageContent(i,e.content),t.appendChild(i),e.sources&&e.sources.length>0&&this.renderSources(t,e.sources),t}formatThinkingText(){return`${this.getText("thinking")} ${this.thinkingElapsed}s`}showThinkingIndicator(e=0){if(this.hideLoading(),this.thinkingElapsed=e,!this.thinkingIndicator){let t=this.chatWindow?.querySelector(".basjoo-messages"),i=document.createElement("div");i.className="basjoo-thinking";let s=document.createElement("span");s.className="basjoo-thinking-icon",i.appendChild(s);let n=document.createElement("span");i.appendChild(n),t.appendChild(i),t.scrollTop=t.scrollHeight,this.thinkingIndicator=i,this.thinkingIndicatorText=n}this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText()),this.thinkingTimerId===null&&(this.thinkingTimerId=window.setInterval(()=>{this.thinkingElapsed+=1,this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText())},1e3))}hideThinkingIndicator(){this.thinkingTimerId!==null&&(window.clearInterval(this.thinkingTimerId),this.thinkingTimerId=null),this.thinkingIndicator?.remove(),this.thinkingIndicator=null,this.thinkingIndicatorText=null,this.thinkingElapsed=0}removeStreamingMessage(){this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}createStreamingMessage(){let e=this.chatWindow?.querySelector(".basjoo-messages"),t=document.createElement("div");t.className="basjoo-message basjoo-message-assistant";let i=document.createElement("div");i.style.display="inline";let s=document.createElement("div");s.className="basjoo-message-content",s.style.display="inline",i.appendChild(s);let n=document.createElement("span");return n.className="basjoo-stream-cursor",i.appendChild(n),t.appendChild(i),e.appendChild(t),e.scrollTop=e.scrollHeight,this.streamingMessage=t,this.streamingMessageContent=s,this.currentStreamContent="",this.currentStreamSources=[],t}appendToStreamingMessage(e){(!this.streamingMessage||!this.streamingMessageContent)&&(this.hideThinkingIndicator(),this.createStreamingMessage()),this.currentStreamContent+=e,this.streamingMessageContent&&this.updateMessageContent(this.streamingMessageContent,this.currentStreamContent);let t=this.chatWindow?.querySelector(".basjoo-messages");t.scrollTop=t.scrollHeight}finalizeStreamingMessage(e=[]){if(!this.streamingMessage||!this.streamingMessageContent)return;if(!this.currentStreamContent.trim()){this.removeStreamingMessage();return}this.streamingMessage.querySelector(".basjoo-stream-cursor")?.remove(),this.currentStreamSources=e,e.length>0&&this.renderSources(this.streamingMessage,e),this.messages.push({role:"assistant",content:this.currentStreamContent,sources:e,timestamp:new Date});let i=this.chatWindow?.querySelector(".basjoo-messages");i.scrollTop=i.scrollHeight,this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}addMessage(e){this.messages.push(e);let t=this.chatWindow?.querySelector(".basjoo-messages");if(!e.content){console.error("Message content is null or undefined:",e);return}let i=this.createMessageElement(e);t.appendChild(i),t.scrollTop=t.scrollHeight}showLoading(){let e=this.chatWindow?.querySelector(".basjoo-messages"),t=document.createElement("div");t.className="basjoo-loading",t.id="basjoo-loading",t.innerHTML=`
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
    `,e.appendChild(t),e.scrollTop=e.scrollHeight}hideLoading(){this.chatWindow?.querySelector("#basjoo-loading")?.remove()}showError(e){let t=this.chatWindow?.querySelector(".basjoo-messages"),i=document.createElement("div");i.className="basjoo-error",i.textContent=e,t.appendChild(i),t.scrollTop=t.scrollHeight,setTimeout(()=>i.remove(),5e3)}startPolling(){this.pollIntervalId||(this.pollIntervalId=window.setInterval(()=>this.pollMessages(),3e3))}stopPolling(){this.pollIntervalId&&(clearInterval(this.pollIntervalId),this.pollIntervalId=null)}async pollMessages(){if(this.sessionId)try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&after_id=${this.lastMessageId}&role=assistant`);if(!e.ok)return;let t=await e.json();for(let i of t)i.content&&(this.addMessage({role:i.role==="user"?"user":"assistant",content:i.content,sources:i.sources,timestamp:new Date}),this.isOpen||this.startTitleBlink()),i.id>this.lastMessageId&&(this.lastMessageId=i.id)}catch{}}async consumeStream(e){if(!e.body)throw new Error("Streaming response body is unavailable");let t=e.body.getReader(),i=new TextDecoder,s="",n=!1,o=l=>{if(!l.trim())return;let c="message",g=[];for(let d of l.split(`
`))d.startsWith("event:")?c=d.slice(6).trim():d.startsWith("data:")&&g.push(d.slice(5).trimStart());if(!g.length)return;let h=JSON.parse(g.join(`
`));switch(c){case"sources":this.currentStreamSources=Array.isArray(h.sources)?h.sources:[];break;case"thinking":this.showThinkingIndicator(typeof h.elapsed=="number"?h.elapsed:0);break;case"thinking_done":this.hideThinkingIndicator();break;case"content":this.appendToStreamingMessage(h.content||"");break;case"done":{let d=h;d.session_id&&(this.sessionId=d.session_id,localStorage.setItem(this.STORAGE_KEY,d.session_id),this.startPolling()),typeof d.message_id=="number"&&d.message_id>this.lastMessageId&&(this.lastMessageId=d.message_id),d.taken_over?(this.removeStreamingMessage(),this.addMessage({role:"assistant",content:this.getText("takenOverNotice"),timestamp:new Date})):(this.finalizeStreamingMessage(this.currentStreamSources),this.isOpen||this.startTitleBlink()),n=!0;break}case"error":throw new Error(h.error||"Stream failed");default:break}},r=()=>{let l=s.indexOf(`\r
\r
`),c=s.indexOf(`

`);return l===-1&&c===-1?null:l===-1?{index:c,length:2}:c===-1?{index:l,length:4}:l<c?{index:l,length:4}:{index:c,length:2}},a=9e4;for(;!n;){let{done:l,value:c}=await Promise.race([t.read(),new Promise((h,d)=>{window.setTimeout(()=>d(new Error("Stream read timeout")),a)})]);s+=i.decode(c||new Uint8Array,{stream:!l});let g=r();for(;g;){let h=s.slice(0,g.index);if(s=s.slice(g.index+g.length),o(h.replace(/\r\n/g,`
`)),n)break;g=r()}if(l)break}if(!n&&(s.trim()&&o(s),!n))throw new Error("Stream ended unexpectedly")}async ensureTurnstileReady(){if(!this.turnstileSiteKey||window.turnstile&&this.turnstileWidgetId)return;if(this.turnstileScriptPromise||(this.turnstileScriptPromise=new Promise((t,i)=>{let s=document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]');if(s){if(window.turnstile){t();return}s.addEventListener("load",()=>t(),{once:!0}),s.addEventListener("error",()=>i(new Error("Failed to load Turnstile")),{once:!0});return}let n=document.createElement("script");n.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",n.async=!0,n.defer=!0,n.onload=()=>t(),n.onerror=()=>i(new Error("Failed to load Turnstile")),document.head.appendChild(n)})),await this.turnstileScriptPromise,!window.turnstile)throw new Error("Turnstile unavailable");this.turnstileContainer||(this.turnstileContainer=document.createElement("div"),this.turnstileContainer.style.display="none",document.body.appendChild(this.turnstileContainer));let e=window.turnstile;if(!e)throw new Error("Turnstile unavailable");this.turnstileWidgetId||(this.turnstileWidgetId=e.render(this.turnstileContainer,{sitekey:this.turnstileSiteKey,execution:"execute",appearance:"execute"}))}async getTurnstileToken(){if(this.turnstileSiteKey){if(await this.ensureTurnstileReady(),!window.turnstile||!this.turnstileWidgetId)throw new Error("Turnstile unavailable");return await new Promise((e,t)=>{let i=window.setTimeout(()=>t(new Error("Turnstile timeout")),1e4),s=this.turnstileWidgetId,n=this.turnstileContainer;window.turnstile.remove(s),this.turnstileWidgetId=window.turnstile.render(n,{sitekey:this.turnstileSiteKey,execution:"execute",appearance:"execute",callback:o=>{window.clearTimeout(i),e(o)},"error-callback":()=>{window.clearTimeout(i),t(new Error("Turnstile failed"))},"expired-callback":()=>{window.clearTimeout(i),t(new Error("Turnstile expired"))}}),window.turnstile.execute(this.turnstileWidgetId)})}}async sendMessageWithRetry(e){let t=null;for(let i=0;i<=1;i++)try{let s=Intl.DateTimeFormat().resolvedOptions().timeZone,n=await this.getTurnstileToken(),o=await fetch(`${this.config.apiBase}/api/v1/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify({agent_id:this.config.agentId,message:e,locale:this.getEffectiveLocale(),session_id:this.sessionId||void 0,visitor_id:this.visitorId,timezone:s,turnstile_token:n})});if(!o.ok){let r=`HTTP ${o.status}: ${o.statusText}`;try{let a=await o.json();r=a.message||a.detail||r}catch{}throw new Error(r)}this.hideLoading(),await this.consumeStream(o);return}catch(s){t=s;let n=String(s?.message||"");if(!(s instanceof TypeError||n.includes("fetch")||n.includes("Failed to fetch")||n.includes("Stream ended unexpectedly"))||i>=1)throw s;this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage(),console.warn(`[Basjoo Widget] Stream attempt ${i+1} failed, retrying...`),await new Promise(r=>window.setTimeout(r,1e3)),this.showLoading()}throw t}async sendMessage(e){if(!this.isSending){this.isSending=!0,this.addMessage({role:"user",content:e,timestamp:new Date}),this.showLoading();try{await this.sendMessageWithRetry(e)}catch(t){this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage(),console.error("[Basjoo Widget] Error sending message:",t);let i=this.getText("sendFailed"),s="",n=String(t?.message||"");t instanceof TypeError||n.includes("fetch")?(i=this.getText("networkError"),s=`Request may be blocked by CORS, network connectivity, or an incorrect apiBase. Current apiBase: ${this.config.apiBase||"(not set)"}`):n.includes("429")||n.toLowerCase().includes("quota")?i=this.getText("quotaExceeded"):n.toLowerCase().includes("turnstile")||n.toLowerCase().includes("bot verification")||n.includes("403")?(i=this.getText("sendFailed"),s="Bot protection verification failed. Check Turnstile site key, secret key, and allowed hostnames."):n.includes("401")&&(s="Authentication failed. Please check the agent configuration and public API access."),this.config.apiBase||(s="apiBase could not be determined. When embedding the widget from a local file, set apiBase explicitly or load the SDK from the target server."),s&&console.error("[Basjoo Widget]",s),this.showError(i)}finally{this.isSending=!1}}}destroy(){this.stopPolling(),this.stopTitleBlink(),this.hideThinkingIndicator(),this.removeStreamingMessage();let e=window.turnstile;e&&this.turnstileWidgetId&&e.remove(this.turnstileWidgetId),this.turnstileContainer?.remove(),this.turnstileContainer=null,this.turnstileWidgetId=null,this.container?.remove(),document.getElementById("basjoo-widget-styles")?.remove()}};window.BasjooWidget=p;var b=document.currentScript;if(b instanceof HTMLScriptElement){let u=y(b);if(u){let e=window;if(e[f])console.warn("[Basjoo Widget] Automatic initialization already ran on this page. Skipping duplicate sdk.js bootstrap.");else{e[f]=!0;let t=()=>new p(u).init();document.readyState==="loading"?document.addEventListener("DOMContentLoaded",t,{once:!0}):t()}}}})();
//# sourceMappingURL=basjoo-widget.min.js.map
