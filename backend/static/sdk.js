"use strict";(()=>{var m={agentId:["agentId","agent_id"],apiBase:["apiBase","api_base"],themeColor:["themeColor","theme_color"],welcomeMessage:["welcomeMessage","welcome_message"],language:["language","locale"],position:["position"],theme:["theme"],turnstileSiteKey:["turnstileSiteKey","turnstile_site_key"]},v={en:"en-US",fr:"fr-FR",ja:"ja-JP",de:"de-DE",es:"es-ES","zh-hans":"zh-CN","zh-cn":"zh-CN","zh-sg":"zh-CN","zh-hant":"zh-Hant","zh-tw":"zh-TW","zh-hk":"zh-HK","zh-mo":"zh-HK"},w=["en-US","zh-CN"];function y(u){if(!u)return"/basjoo-logo.png";try{return new URL("/basjoo-logo.png",`${u}/`).toString()}catch{return"/basjoo-logo.png"}}var b=class{constructor(e){this.container=null;this.button=null;this.unreadBadge=null;this.chatWindow=null;this.messages=[];this.sessionId=null;this.isOpen=!1;this.VISITOR_STORAGE_KEY="basjoo_visitor_id";this.effectiveTheme="light";this.originalTitle="";this.titleBlinkInterval=null;this.hasUnread=!1;this.pollIntervalId=null;this.lastMessageId=0;this.isSending=!1;this.streamingMessage=null;this.streamingMessageContent=null;this.thinkingIndicator=null;this.thinkingIndicatorText=null;this.thinkingElapsed=0;this.thinkingTimerId=null;this.currentStreamContent="";this.currentStreamSources=[];this.turnstileSiteKey=null;this.turnstileWidgetId=null;this.turnstileContainer=null;this.turnstileScriptPromise=null;let t=this.detectApiBase(e.apiBase);this.hasTitleOverride=typeof e.title=="string"&&e.title.trim().length>0,this.hasWelcomeMessageOverride=typeof e.welcomeMessage=="string"&&e.welcomeMessage.trim().length>0,this.config={agentId:e.agentId,apiBase:t,themeColor:e.themeColor||"#3B82F6",logoUrl:e.logoUrl||y(t),title:e.title||"AI\u52A9\u624B",welcomeMessage:e.welcomeMessage||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F",language:e.language||"auto",position:e.position||"right",theme:e.theme||"auto",turnstileSiteKey:e.turnstileSiteKey||""},this.STORAGE_KEY=`basjoo_session_${this.config.agentId}`,this.sessionId=localStorage.getItem(this.STORAGE_KEY),this.visitorId=localStorage.getItem(this.VISITOR_STORAGE_KEY)||this.generateVisitorId(),this.effectiveTheme=this.getEffectiveTheme()}generateVisitorId(){let e=`visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,11)}`;return localStorage.setItem(this.VISITOR_STORAGE_KEY,e),e}detectApiBase(e){if(e)try{let s=new URL(e,window.location.href);if((s.protocol==="http:"||s.protocol==="https:")&&s.port==="3000"){let o=`${s.protocol}//${s.hostname}:8000`;return console.info("[Basjoo Widget] Rewriting configured dev apiBase to direct backend:",o),o}return s.toString().replace(/\/$/,"")}catch{return e}let t=document.currentScript;if(t instanceof HTMLScriptElement&&t.src)try{let s=new URL(t.src,window.location.href);return console.info("[Basjoo Widget] Detected API base from current script:",s.origin),s.origin}catch{}let i=document.querySelectorAll("script[src]");for(let s of i){let o=s.getAttribute("src")||"";if(!(!o.includes("sdk.js")&&!o.includes("basjoo")))try{let r=new URL(o,window.location.href);return console.info("[Basjoo Widget] Detected API base from script src:",r.origin),r.origin}catch{}}let n=window.location.port;if(n==="3000"||n==="5173"){let s=`${window.location.protocol}//${window.location.hostname}:8000`;return console.info("[Basjoo Widget] Development mode detected, using:",s),s}return window.location.protocol==="file:"?(console.error("[Basjoo Widget] Cannot determine API base from a local file. Please set apiBase explicitly."),""):(console.warn("[Basjoo Widget] Falling back to window.location.origin. Set apiBase explicitly if the API is hosted elsewhere."),window.location.origin)}getEffectiveTheme(){return this.config.theme==="light"||this.config.theme==="dark"?this.config.theme:typeof window<"u"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}normalizeLocale(e){if(!e)return null;let t=e.trim().replace(/_/g,"-");if(!t)return null;let i=t.split("-").filter(Boolean);if(i.length===0)return null;let n=[i[0].toLowerCase()];for(let o of i.slice(1))/^[A-Za-z]{4}$/.test(o)?n.push(o[0].toUpperCase()+o.slice(1).toLowerCase()):/^[A-Za-z]{2,3}$/.test(o)?n.push(o.toUpperCase()):n.push(o);let s=n.join("-");return v[s.toLowerCase()]||s}getPreferredLocales(){let e=new Set,t=this.config.language!=="auto"?this.normalizeLocale(this.config.language):null;if(t)e.add(t);else{let i=Array.isArray(navigator.languages)&&navigator.languages.length>0?navigator.languages:[navigator.language];for(let n of i){let s=this.normalizeLocale(n);s&&e.add(s)}}for(let i of w)e.add(i);return Array.from(e)}buildLocaleFallbacks(e){let t=this.normalizeLocale(e);if(!t)return[...w];let i=[t],n=t.split("-",1)[0],s=t.toLowerCase();if(n==="zh")t.includes("Hant")||["zh-tw","zh-hk","zh-mo"].includes(s)?i.push("zh-Hant","zh-TW","zh-HK","zh-CN","zh"):i.push("zh-Hans","zh-CN","zh");else{let o={en:"en-US",fr:"fr-FR",ja:"ja-JP",de:"de-DE",es:"es-ES"};o[n]&&i.push(o[n]),i.push(n)}return i.push(...w),Array.from(new Set(i.map(o=>this.normalizeLocale(o)).filter(o=>!!o)))}getEffectiveLocale(){return this.getPreferredLocales()[0]||"en-US"}resolveI18nText(e,t){if(!e)return t;let i=new Map,n=[];for(let[s,o]of Object.entries(e)){if(typeof o!="string")continue;let r=o.trim();if(!r)continue;let c=this.normalizeLocale(s)||s;i.set(c,r),n.push(r)}for(let s of this.getPreferredLocales())for(let o of this.buildLocaleFallbacks(s)){let r=i.get(o);if(r)return r}return n.length>0?n[0]:t}async loadPublicConfig(){if(this.turnstileSiteKey=this.config.turnstileSiteKey||null,!this.config.apiBase){console.warn("[Basjoo Widget] Skipping public config fetch because apiBase could not be determined.");return}try{let e=new URL(`${this.config.apiBase}/api/v1/config:public`);this.config.agentId&&e.searchParams.set("agent_id",this.config.agentId);let t=await fetch(e.toString());if(!t.ok)throw new Error(`HTTP ${t.status}: ${t.statusText}`);let i=await t.json();!this.config.agentId&&i.default_agent_id&&(this.config.agentId=i.default_agent_id),this.config.themeColor=this.config.themeColor||i.widget_color||"#3B82F6",this.hasTitleOverride||(this.config.title=this.resolveI18nText(i.widget_title_i18n,i.widget_title||"AI\u52A9\u624B")),this.hasWelcomeMessageOverride||(this.config.welcomeMessage=this.resolveI18nText(i.welcome_message_i18n,i.welcome_message||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F"));let n=i;this.turnstileSiteKey=n.turnstile_enabled&&n.turnstile_site_key||null,this.effectiveTheme=this.getEffectiveTheme()}catch(e){console.warn("[Basjoo Widget] Failed to load public config, using defaults.",e),e instanceof TypeError&&console.warn("[Basjoo Widget] Public config request may be blocked by CORS, network issues, or an incorrect apiBase:",this.config.apiBase)}}async init(){if(!document.body){console.warn("[Basjoo Widget] document.body is not available yet. Call init() after DOMContentLoaded or place the embed code near the end of <body>.");return}if(document.getElementById("basjoo-widget-container")){console.warn("[Basjoo Widget] Initialization skipped because #basjoo-widget-container already exists. Avoid loading or initializing the widget twice on the same page.");return}if(await this.loadPublicConfig(),this.originalTitle=document.title,this.createStyles(),this.createContainer(),this.createButton(),this.createChatWindow(),this.showGreetingBubble(),this.startTitleBlink(),this.sessionId){this.loadHistory();return}this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date})}showGreetingBubble(){if(!this.button)return;let e=document.createElement("div");e.className="basjoo-greeting-bubble",e.textContent=this.getText("greetingBubble");let t=this.config.position;e.style.position="fixed",e.style.bottom="100px",e.style[t]="24px",e.style.zIndex="9999",document.body.appendChild(e),setTimeout(()=>{e.remove()},5e3)}async loadHistory(){if(this.sessionId){try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}`);if(!e.ok)throw new Error("Failed to load history");let t=await e.json();if(t&&t.length>0){for(let i of t)this.addMessage({role:i.role==="user"?"user":"assistant",content:i.content,sources:i.sources,timestamp:new Date}),i.id>this.lastMessageId&&(this.lastMessageId=i.id);this.startPolling();return}}catch{}this.sessionId=null,localStorage.removeItem(this.STORAGE_KEY),this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date})}}startTitleBlink(){if(this.titleBlinkInterval)return;this.hasUnread=!0,this.updateUnreadBadge();let e=!0;this.titleBlinkInterval=window.setInterval(()=>{document.title=e?this.originalTitle:"\u2757 "+this.getText("newMessage"),e=!e},1e3)}stopTitleBlink(){this.titleBlinkInterval&&(clearInterval(this.titleBlinkInterval),this.titleBlinkInterval=null),document.title=this.originalTitle,this.hasUnread=!1,this.updateUnreadBadge()}createStyles(){let e=document.createElement("style");e.id="basjoo-widget-styles";let t=this.effectiveTheme==="dark",i=t?"#1a1a2e":"white",n=t?"#e2e8f0":"#1f2937",s=t?"#94a3b8":"#6b7280",o=t?"rgba(148, 163, 184, 0.2)":"#e5e7eb",r=t?"#0f0f1a":"white",c=t?"#2d2d44":"#f3f4f6",a=t?"rgba(239, 68, 68, 0.2)":"#fef2f2";e.textContent=`
      #basjoo-widget-container, #basjoo-widget-container * {
        box-sizing: border-box;
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
        color: ${n};
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

      #basjoo-chat-window {
        position: fixed;
        bottom: 96px;
        ${this.config.position==="left"?"left":"right"}: 24px;
        width: 380px;
        height: 600px;
        max-height: calc(100vh - 120px);
        background: ${i};
        border-radius: 20px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transform: scale(0);
        transform-origin: ${this.config.position==="left"?"bottom left":"bottom right"};
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
        background: linear-gradient(135deg, ${this.config.themeColor} 0%, ${this.adjustColor(this.config.themeColor,-20)} 100%);
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
        background: ${r};
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
        color: ${this.adjustColor(this.config.themeColor,-10)};
        text-decoration: underline;
      }

      #basjoo-widget-container .basjoo-message-content blockquote {
        padding-left: 12px;
        border-left: 3px solid rgba(148, 163, 184, 0.4);
        color: ${s};
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
        background: ${c};
        color: ${n};
        border-bottom-left-radius: 4px;
      }

      #basjoo-widget-container .basjoo-message-error .basjoo-message-content {
        background: ${a};
        color: ${t?"#fca5a5":"#dc2626"};
        border: 1px solid ${t?"rgba(239,68,68,0.35)":"#fecaca"};
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
        background: ${s};
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
        border-top: 1px solid ${o};
        display: flex;
        gap: 12px;
        background: ${i};
        flex-shrink: 0;
      }

      .basjoo-input {
        flex: 1;
        height: 48px;
        padding: 0 20px 0 20px !important;
        border: 1px solid ${o};
        border-radius: 24px;
        font-size: 14px;
        outline: none;
        transition: all 0.2s;
        background: ${r};
        color: ${n};
        margin-bottom: 8px !important;
        margin-left: 4px !important;
      }

      .basjoo-input::placeholder {
        color: ${s};
      }

      .basjoo-input:focus {
        border-color: ${this.config.themeColor};
        box-shadow: 0 0 0 3px ${this.hexToRgba(this.config.themeColor,.1)};
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
        box-shadow: 0 4px 12px ${this.hexToRgba(this.config.themeColor,.3)};
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
        background: ${a};
        color: ${t?"#fca5a5":"#dc2626"};
        font-size: 13px;
        text-align: center;
        border-top: 1px solid ${t?"rgba(239,68,68,0.35)":"#fecaca"};
      }

      #basjoo-widget-container .basjoo-message-time {
        font-size: 11px;
        color: ${s};
        margin-top: 4px;
        padding: 0 4px;
      }

      #basjoo-widget-container .basjoo-message-user .basjoo-message-time {
        text-align: right;
      }

      #basjoo-widget-container .basjoo-source-list {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .basjoo-source-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: ${s};
      }

      .basjoo-source-item {
        background: ${r};
        border: 1px solid ${o};
        border-radius: 10px;
        overflow: hidden;
      }

      .basjoo-source-toggle {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border: none;
        background: transparent;
        cursor: pointer;
        text-align: left;
        color: inherit;
      }

      .basjoo-source-item[open] .basjoo-source-arrow {
        transform: rotate(180deg);
      }

      .basjoo-source-index {
        width: 18px;
        height: 18px;
        border-radius: 6px;
        background: ${this.config.themeColor};
        color: white;
        font-size: 10px;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .basjoo-source-title {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
      }

      .basjoo-source-arrow {
        color: ${s};
        transition: transform 0.2s ease;
        flex-shrink: 0;
      }

      .basjoo-source-body {
        padding: 0 12px 12px;
        border-top: 1px solid ${o};
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .basjoo-source-link {
        color: ${this.adjustColor(this.config.themeColor,-10)};
        text-decoration: none;
        font-size: 12px;
        word-break: break-all;
      }

      .basjoo-source-link:hover {
        text-decoration: underline;
      }

      .basjoo-source-snippet {
        font-size: 12px;
        color: ${s};
        line-height: 1.5;
      }

      .basjoo-thinking {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: ${s};
        font-size: 12px;
        margin-top: 8px;
      }

      .basjoo-thinking-spinner {
        width: 12px;
        height: 12px;
        border: 2px solid ${this.hexToRgba(this.config.themeColor,.2)};
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
          ${this.config.position==="left"?"left":"right"}: 16px;
        }
      }
    `,document.head.appendChild(e)}adjustColor(e,t){let i=!1,n=e;n[0]==="#"&&(n=n.slice(1),i=!0);let s=parseInt(n,16),o=(s>>16)+t,r=(s>>8&255)+t,c=(s&255)+t;return o=Math.max(0,Math.min(255,o)),r=Math.max(0,Math.min(255,r)),c=Math.max(0,Math.min(255,c)),`${i?"#":""}${(o<<16|r<<8|c).toString(16).padStart(6,"0")}`}hexToRgba(e,t){let i=e.replace("#","");if(i.length===3){let[c,a,l]=i.split("");i=`${c}${c}${a}${a}${l}${l}`}let n=parseInt(i,16),s=n>>16&255,o=n>>8&255,r=n&255;return`rgba(${s}, ${o}, ${r}, ${t})`}updateUnreadBadge(){if(this.button){if(this.hasUnread){if(!this.unreadBadge){let e=document.createElement("span");e.className="basjoo-unread-badge",e.textContent="1",this.button.appendChild(e),this.unreadBadge=e}return}this.unreadBadge?.remove(),this.unreadBadge=null}}createContainer(){this.container=document.createElement("div"),this.container.id="basjoo-widget-container",document.body.appendChild(this.container)}createButton(){this.button=document.createElement("div"),this.button.id="basjoo-widget-button",this.button.innerHTML=`
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
    `,this.button.addEventListener("click",()=>this.toggle()),this.container.appendChild(this.button),this.updateUnreadBadge()}createChatWindow(){this.chatWindow=document.createElement("div"),this.chatWindow.id="basjoo-chat-window",this.chatWindow.innerHTML=`
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
    `,this.chatWindow.querySelector(".basjoo-close").addEventListener("click",()=>this.close());let t=this.chatWindow.querySelector(".basjoo-input"),i=this.chatWindow.querySelector(".basjoo-send"),n=()=>{if(this.isSending)return;let s=t.value.trim();if(s){if(s.length>2e3){this.showError(this.getText("messageTooLong"));return}this.sendMessage(s),t.value=""}};i.addEventListener("click",n),t.addEventListener("keypress",s=>{s.key==="Enter"&&n()}),this.container.appendChild(this.chatWindow)}toggle(){if(this.isOpen){this.close();return}this.open()}open(){this.isOpen=!0,this.chatWindow?.classList.remove("closing"),this.chatWindow?.classList.add("open"),this.stopTitleBlink(),this.updateUnreadBadge();let e=this.chatWindow?.querySelector(".basjoo-input");setTimeout(()=>{e?.focus()},300)}close(){this.isOpen=!1,this.chatWindow?.classList.remove("open"),this.chatWindow?.classList.add("closing")}getText(e){let t={sendFailed:{"en-US":"Send failed, please try again later","zh-CN":"\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"},networkError:{"en-US":"Network connection failed, please check your connection","zh-CN":"\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC"},quotaExceeded:{"en-US":"Daily message limit reached","zh-CN":"\u4ECA\u65E5\u6D88\u606F\u5DF2\u8FBE\u4E0A\u9650"},takenOverNotice:{"en-US":"Your conversation has been transferred to a human agent. Please wait for their reply.","zh-CN":"\u5DF2\u8F6C\u63A5\u4EBA\u5DE5\u5BA2\u670D\uFF0C\u8BF7\u7B49\u5F85\u56DE\u590D\u3002"},inputPlaceholder:{"en-US":"Type your question...","zh-CN":"\u8F93\u5165\u60A8\u7684\u95EE\u9898..."},citationSources:{"en-US":"Citation Sources","zh-CN":"\u5F15\u7528\u6765\u6E90"},openSource:{"en-US":"Open source","zh-CN":"\u6253\u5F00\u6765\u6E90"},document:{"en-US":"Document","zh-CN":"\u6587\u6863"},messageTooLong:{"en-US":"Message too long (max 2000 characters)","zh-CN":"\u6D88\u606F\u8FC7\u957F\uFF08\u6700\u591A2000\u5B57\u7B26\uFF09"},greetingBubble:{"en-US":"Hi! How can I help you?","zh-CN":"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u60A8\uFF1F"},newMessage:{"en-US":"New message","zh-CN":"\u65B0\u6D88\u606F"},thinking:{"en-US":"Thinking...","zh-CN":"\u601D\u8003\u4E2D..."}};return this.resolveI18nText(t[e],t[e]["en-US"]||t[e]["zh-CN"]||e)}escapeHtml(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}renderMarkdown(e){if(!e)return"";let t=e.replace(/\r\n/g,`
`).split(/\n{2,}/).map(s=>s.trim()).filter(Boolean),i=s=>{let o=this.escapeHtml(s);return o=o.replace(/`([^`]+)`/g,"<code>$1</code>"),o=o.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>"),o=o.replace(/__([^_]+)__/g,"<strong>$1</strong>"),o=o.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g,"$1<em>$2</em>"),o=o.replace(/(^|[^_])_([^_]+)_(?!_)/g,"$1<em>$2</em>"),o=o.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(r,c,a)=>`<a href="${this.escapeHtml(a)}" target="_blank" rel="noopener noreferrer">${c}</a>`),o};return t.map(s=>{if(/^```/.test(s)&&/```$/.test(s)){let o=s.replace(/^```\w*\n?/,"").replace(/```$/,"");return`<pre><code>${this.escapeHtml(o)}</code></pre>`}if(/^(?:[-*]\s.+\n?)+$/.test(s))return`<ul>${s.split(`
`).map(r=>r.replace(/^[-*]\s+/,"").trim()).filter(Boolean).map(r=>`<li>${i(r)}</li>`).join("")}</ul>`;if(/^(?:\d+\.\s.+\n?)+$/.test(s))return`<ol>${s.split(`
`).map(r=>r.replace(/^\d+\.\s+/,"").trim()).filter(Boolean).map(r=>`<li>${i(r)}</li>`).join("")}</ol>`;if(/^>\s?/.test(s)){let o=s.split(`
`).map(r=>r.replace(/^>\s?/,"")).join("<br>");return`<blockquote>${i(o)}</blockquote>`}if(/^#{1,6}\s/.test(s)){let o=s.replace(/^#{1,6}\s+/,"");return`<p><strong>${i(o)}</strong></p>`}return`<p>${i(s).replace(/\n/g,"<br>")}</p>`}).join("")}updateMessageContent(e,t,i=!1){e.innerHTML=this.renderMarkdown(t)+(i?'<span class="basjoo-stream-cursor"></span>':"")}createSourceList(e){let t=document.createElement("div");if(t.className="basjoo-source-list",!e||e.length===0)return t;let i=document.createElement("div");return i.className="basjoo-source-header",i.innerHTML=`
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 12h6"></path>
        <path d="M12 9v6"></path>
        <circle cx="12" cy="12" r="10"></circle>
      </svg>
      <span>${this.getText("citationSources")}</span>
    `,t.appendChild(i),e.forEach((n,s)=>{let o=document.createElement("details");o.className="basjoo-source-item";let r=document.createElement("summary");r.className="basjoo-source-toggle";let c=n.title??n.url??this.getText("document"),a=document.createElement("span");a.className="basjoo-source-index",a.textContent=String(s+1);let l=document.createElement("span");l.className="basjoo-source-title",l.textContent=c;let d=document.createElementNS("http://www.w3.org/2000/svg","svg");d.setAttribute("class","basjoo-source-arrow"),d.setAttribute("width","14"),d.setAttribute("height","14"),d.setAttribute("viewBox","0 0 24 24"),d.setAttribute("fill","none"),d.setAttribute("stroke","currentColor"),d.setAttribute("stroke-width","2");let h=document.createElementNS("http://www.w3.org/2000/svg","polyline");h.setAttribute("points","6 9 12 15 18 9"),d.appendChild(h),r.appendChild(a),r.appendChild(l),r.appendChild(d);let g=document.createElement("div");if(g.className="basjoo-source-body",n.url){let p=document.createElement("a");p.className="basjoo-source-link",p.href=n.url,p.target="_blank",p.rel="noopener noreferrer",p.textContent=`${this.getText("openSource")}: ${n.url}`,g.appendChild(p)}let x=n.snippet??n.question??n.title??n.url??this.getText("document");if(x){let p=document.createElement("div");p.className="basjoo-source-snippet",p.textContent=x,g.appendChild(p)}o.appendChild(r),g.childNodes.length>0&&o.appendChild(g),t.appendChild(o)}),t}createMessageElement(e){let t=document.createElement("div");t.className=`basjoo-message basjoo-message-${e.role}`;let i=document.createElement("div");i.className="basjoo-message-content",this.updateMessageContent(i,e.content),t.appendChild(i),e.sources&&e.sources.length>0&&t.appendChild(this.createSourceList(e.sources));let n=document.createElement("div");return n.className="basjoo-message-time",n.textContent=e.timestamp.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),t.appendChild(n),t}formatThinkingText(){return`${this.getText("thinking")} ${this.thinkingElapsed}s`}showThinkingIndicator(e=0){this.hideLoading(),this.currentStreamContent.trim()||(this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null),this.thinkingElapsed=e;let t=this.chatWindow?.querySelector(".basjoo-messages");if(t){if(!this.thinkingIndicator){let i=document.createElement("div");i.className="basjoo-thinking",i.innerHTML=`
        <span class="basjoo-thinking-spinner"></span>
        <span>${this.getText("thinking")}</span>
      `,t.appendChild(i),this.thinkingIndicator=i,this.thinkingIndicatorText=i.querySelector("span:last-child")}this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText()),t.scrollTop=t.scrollHeight,this.thinkingTimerId===null&&(this.thinkingTimerId=window.setInterval(()=>{this.thinkingElapsed+=1,this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText())},1e3))}}hideThinkingIndicator(){this.thinkingTimerId!==null&&(window.clearInterval(this.thinkingTimerId),this.thinkingTimerId=null),this.thinkingIndicator?.remove(),this.thinkingIndicator=null,this.thinkingIndicatorText=null,this.thinkingElapsed=0}removeStreamingMessage(){this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}createStreamingMessage(e=!1){let t=this.chatWindow?.querySelector(".basjoo-messages"),i=document.createElement("div");i.className="basjoo-message basjoo-message-assistant";let n=document.createElement("div");return n.className="basjoo-message-content",this.updateMessageContent(n,this.currentStreamContent,e),i.appendChild(n),t?(t.appendChild(i),t.scrollTop=t.scrollHeight,this.streamingMessage=i,this.streamingMessageContent=n,this.currentStreamContent="",this.currentStreamSources=[],i):(this.streamingMessage=i,this.streamingMessageContent=n,this.currentStreamContent="",this.currentStreamSources=[],i)}appendToStreamingMessage(e){(!this.streamingMessage||!this.streamingMessageContent)&&(this.hideThinkingIndicator(),this.createStreamingMessage()),this.currentStreamContent+=e,this.streamingMessageContent&&this.updateMessageContent(this.streamingMessageContent,this.currentStreamContent,!0);let t=this.chatWindow?.querySelector(".basjoo-messages");t.scrollTop=t.scrollHeight}finalizeStreamingMessage(e=[]){if(!this.streamingMessage||!this.streamingMessageContent)return;if(!this.currentStreamContent.trim()){this.removeStreamingMessage();return}this.streamingMessage.querySelector(".basjoo-stream-cursor")?.remove(),this.currentStreamSources=e,e.length>0&&this.streamingMessage.appendChild(this.createSourceList(e)),this.messages.push({role:"assistant",content:this.currentStreamContent,sources:e,timestamp:new Date});let i=this.chatWindow?.querySelector(".basjoo-messages");i.scrollTop=i.scrollHeight,this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}addMessage(e){this.messages.push(e);let t=this.chatWindow?.querySelector(".basjoo-messages");if(!e.content){console.error("Message content is null or undefined:",e);return}if(!t)return;let i=this.createMessageElement(e);t.appendChild(i),t.scrollTop=t.scrollHeight,e.role==="assistant"&&!this.isOpen&&(this.hasUnread=!0,this.updateUnreadBadge())}showLoading(){let e=this.chatWindow?.querySelector(".basjoo-messages");if(!e)return;let t=document.createElement("div");t.className="basjoo-loading",t.id="basjoo-loading",t.innerHTML=`
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
    `,e.appendChild(t),e.scrollTop=e.scrollHeight}hideLoading(){this.chatWindow?.querySelector("#basjoo-loading")?.remove()}showError(e){let t=this.chatWindow?.querySelector(".basjoo-messages");if(!t)return;let i=document.createElement("div");i.className="basjoo-error",i.textContent=e,t.appendChild(i),t.scrollTop=t.scrollHeight,setTimeout(()=>i.remove(),5e3)}startPolling(){this.pollIntervalId||(this.pollIntervalId=window.setInterval(()=>this.pollMessages(),3e3))}stopPolling(){this.pollIntervalId&&(clearInterval(this.pollIntervalId),this.pollIntervalId=null)}async pollMessages(){if(this.sessionId)try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&after_id=${this.lastMessageId}&role=assistant`);if(!e.ok)return;let t=await e.json();for(let i of t)i.content&&(this.addMessage({role:i.role==="user"?"user":"assistant",content:i.content,sources:i.sources,timestamp:new Date}),this.isOpen||this.startTitleBlink()),i.id>this.lastMessageId&&(this.lastMessageId=i.id)}catch{}}async consumeStream(e){if(!e.body)throw new Error("Streaming response body is unavailable");let t=e.body.getReader(),i=new TextDecoder,n="",s=!1,o=a=>{if(!a.trim())return;let l="message",d=[];for(let g of a.split(`
`))g.startsWith("event:")?l=g.slice(6).trim():g.startsWith("data:")&&d.push(g.slice(5).trimStart());if(!d.length)return;let h=JSON.parse(d.join(`
`));switch(l){case"sources":this.currentStreamSources=Array.isArray(h.sources)?h.sources:[];break;case"thinking":this.showThinkingIndicator(typeof h.elapsed=="number"?h.elapsed:0);break;case"thinking_done":this.hideThinkingIndicator();break;case"content":this.appendToStreamingMessage(h.content||"");break;case"done":{let g=h;g.session_id&&(this.sessionId=g.session_id,localStorage.setItem(this.STORAGE_KEY,g.session_id),this.startPolling()),typeof g.message_id=="number"&&g.message_id>this.lastMessageId&&(this.lastMessageId=g.message_id),g.taken_over?(this.removeStreamingMessage(),this.addMessage({role:"assistant",content:this.getText("takenOverNotice"),timestamp:new Date})):(this.finalizeStreamingMessage(this.currentStreamSources),this.isOpen||this.startTitleBlink()),s=!0;break}case"error":throw new Error(h.error||"Stream failed");default:break}},r=()=>{let a=n.indexOf(`\r
\r
`),l=n.indexOf(`

`);return a===-1&&l===-1?null:a===-1?{index:l,length:2}:l===-1?{index:a,length:4}:a<l?{index:a,length:4}:{index:l,length:2}},c=9e4;for(;!s;){let{done:a,value:l}=await Promise.race([t.read(),new Promise((h,g)=>{window.setTimeout(()=>g(new Error("Stream read timeout")),c)})]);n+=i.decode(l||new Uint8Array,{stream:!a});let d=r();for(;d;){let h=n.slice(0,d.index);if(n=n.slice(d.index+d.length),o(h.replace(/\r\n/g,`
`)),s)break;d=r()}if(a)break}if(!s&&(n.trim()&&o(n),!s))throw new Error("Stream ended unexpectedly")}async ensureTurnstileReady(){if(!this.turnstileSiteKey||window.turnstile&&this.turnstileWidgetId)return;if(this.turnstileScriptPromise||(this.turnstileScriptPromise=new Promise((t,i)=>{let n=document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]');if(n){if(window.turnstile){t();return}n.addEventListener("load",()=>t(),{once:!0}),n.addEventListener("error",()=>i(new Error("Failed to load Turnstile")),{once:!0});return}let s=document.createElement("script");s.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",s.async=!0,s.defer=!0,s.onload=()=>t(),s.onerror=()=>i(new Error("Failed to load Turnstile")),document.head.appendChild(s)})),await this.turnstileScriptPromise,!window.turnstile)throw new Error("Turnstile unavailable");this.turnstileContainer||(this.turnstileContainer=document.createElement("div"),this.turnstileContainer.style.display="none",document.body.appendChild(this.turnstileContainer));let e=window.turnstile;if(!e)throw new Error("Turnstile unavailable");this.turnstileWidgetId||(this.turnstileWidgetId=e.render(this.turnstileContainer,{sitekey:this.turnstileSiteKey,execution:"execute",appearance:"execute"}))}async getTurnstileToken(){if(this.turnstileSiteKey){if(await this.ensureTurnstileReady(),!window.turnstile||!this.turnstileWidgetId)throw new Error("Turnstile unavailable");return await new Promise((e,t)=>{let i=window.setTimeout(()=>t(new Error("Turnstile timeout")),1e4),n=this.turnstileWidgetId,s=this.turnstileContainer;window.turnstile.remove(n),this.turnstileWidgetId=window.turnstile.render(s,{sitekey:this.turnstileSiteKey,execution:"execute",appearance:"execute",callback:o=>{window.clearTimeout(i),e(o)},"error-callback":()=>{window.clearTimeout(i),t(new Error("Turnstile failed"))},"expired-callback":()=>{window.clearTimeout(i),t(new Error("Turnstile expired"))}}),window.turnstile.execute(this.turnstileWidgetId)})}}async sendMessageWithRetry(e){let t=null;for(let i=0;i<=1;i++)try{let n=Intl.DateTimeFormat().resolvedOptions().timeZone,s=await this.getTurnstileToken(),o=await fetch(`${this.config.apiBase}/api/v1/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify({agent_id:this.config.agentId,message:e,locale:this.getEffectiveLocale(),session_id:this.sessionId||void 0,visitor_id:this.visitorId,timezone:n,turnstile_token:s})});if(!o.ok){let r=`HTTP ${o.status}: ${o.statusText}`;try{let c=await o.json();r=c.message||c.detail||r}catch{}throw new Error(r)}this.hideLoading(),await this.consumeStream(o);return}catch(n){t=n;let s=String(n?.message||"");if(!(n instanceof TypeError||s.includes("fetch")||s.includes("Failed to fetch")||s.includes("Stream ended unexpectedly"))||i>=1)throw n;this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage(),console.warn(`[Basjoo Widget] Stream attempt ${i+1} failed, retrying...`),await new Promise(r=>window.setTimeout(r,1e3)),this.showLoading()}throw t}async sendMessage(e){if(!this.isSending){this.isSending=!0,this.addMessage({role:"user",content:e,timestamp:new Date}),this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage(),this.createStreamingMessage(!0);try{await this.sendMessageWithRetry(e)}catch(t){this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage(),console.error("[Basjoo Widget] Error sending message:",t);let i=this.getText("sendFailed"),n="",s=String(t?.message||"");t instanceof TypeError||s.includes("fetch")?(i=this.getText("networkError"),n=`Request may be blocked by CORS, network connectivity, or an incorrect apiBase. Current apiBase: ${this.config.apiBase||"(not set)"}`):s.includes("429")||s.toLowerCase().includes("quota")?i=this.getText("quotaExceeded"):s.toLowerCase().includes("turnstile")||s.toLowerCase().includes("bot verification")||s.includes("403")?(i=this.getText("sendFailed"),n="Bot protection verification failed. Check Turnstile site key, secret key, and allowed hostnames."):s.includes("401")&&(n="Authentication failed. Please check the agent configuration and public API access."),this.config.apiBase||(n="apiBase could not be determined. When embedding the widget from a local file, set apiBase explicitly or load the SDK from the target server."),n&&console.error("[Basjoo Widget]",n),this.showError(i)}finally{this.isSending=!1}}}destroy(){this.stopPolling(),this.stopTitleBlink(),this.hideThinkingIndicator(),this.removeStreamingMessage();let e=window.turnstile;e&&this.turnstileWidgetId&&e.remove(this.turnstileWidgetId),this.turnstileContainer?.remove(),this.turnstileContainer=null,this.turnstileWidgetId=null,this.container?.remove(),document.getElementById("basjoo-widget-styles")?.remove()}};window.BasjooWidget=b;function f(u,e){for(let t of e){let i=u.get(t);if(i&&i.trim())return i.trim()}return null}function j(){if(document.currentScript instanceof HTMLScriptElement)return document.currentScript;let u=Array.from(document.querySelectorAll("script[src]"));for(let e=u.length-1;e>=0;e-=1){let t=u[e],i=t.getAttribute("src")||"";if(i.includes("sdk.js"))try{let n=new URL(i,window.location.href);if(f(n.searchParams,m.agentId))return t}catch{continue}}return null}function S(u){let e=u.getAttribute("src")||u.src;if(!e)return null;let t;try{t=new URL(e,window.location.href)}catch{return null}let i=f(t.searchParams,m.agentId);if(!i)return null;let n={agentId:i},s=f(t.searchParams,m.apiBase);s&&(n.apiBase=s);let o=f(t.searchParams,m.themeColor);o&&(n.themeColor=o);let r=f(t.searchParams,m.welcomeMessage);r&&(n.welcomeMessage=r);let c=f(t.searchParams,m.language);c&&(n.language=c);let a=f(t.searchParams,m.position);(a==="left"||a==="right")&&(n.position=a);let l=f(t.searchParams,m.theme);(l==="light"||l==="dark"||l==="auto")&&(n.theme=l);let d=f(t.searchParams,m.turnstileSiteKey);return d&&(n.turnstileSiteKey=d),n}(function(){let e=window,t=j();if(!t)return;let i=S(t);if(!i||e.__basjooWidgetAutoInitScheduled)return;e.__basjooWidgetAutoInitScheduled=!0;let n=()=>{new b(i).init()};if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",n,{once:!0});return}n()})();})();
//# sourceMappingURL=basjoo-widget.min.js.map
