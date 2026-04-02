"use strict";(()=>{var f={en:"en-US",fr:"fr-FR",ja:"ja-JP",de:"de-DE",es:"es-ES","zh-hans":"zh-CN","zh-cn":"zh-CN","zh-sg":"zh-CN","zh-hant":"zh-Hant","zh-tw":"zh-TW","zh-hk":"zh-HK","zh-mo":"zh-HK"},p=["en-US","zh-CN"];function b(u){if(!u)return"/basjoo-logo.png";try{return new URL("/basjoo-logo.png",`${u}/`).toString()}catch{return"/basjoo-logo.png"}}var m=class{constructor(e){this.container=null;this.button=null;this.chatWindow=null;this.messages=[];this.sessionId=null;this.isOpen=!1;this.VISITOR_STORAGE_KEY="basjoo_visitor_id";this.effectiveTheme="light";this.originalTitle="";this.titleBlinkInterval=null;this.hasUnread=!1;this.pollIntervalId=null;this.lastMessageId=0;this.isSending=!1;this.streamingMessage=null;this.streamingMessageContent=null;this.thinkingIndicator=null;this.thinkingIndicatorText=null;this.thinkingElapsed=0;this.thinkingTimerId=null;this.currentStreamContent="";this.currentStreamSources=[];this.turnstileSiteKey=null;this.turnstileWidgetId=null;this.turnstileContainer=null;this.turnstileScriptPromise=null;let t=this.detectApiBase(e.apiBase);this.hasTitleOverride=typeof e.title=="string"&&e.title.trim().length>0,this.hasWelcomeMessageOverride=typeof e.welcomeMessage=="string"&&e.welcomeMessage.trim().length>0,this.config={agentId:e.agentId,apiBase:t,themeColor:e.themeColor||"#3B82F6",logoUrl:e.logoUrl||b(t),title:e.title||"AI\u52A9\u624B",welcomeMessage:e.welcomeMessage||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F",language:e.language||"auto",position:e.position||"right",theme:e.theme||"auto",turnstileSiteKey:e.turnstileSiteKey||""},this.STORAGE_KEY=`basjoo_session_${this.config.agentId}`,this.sessionId=localStorage.getItem(this.STORAGE_KEY),this.visitorId=localStorage.getItem(this.VISITOR_STORAGE_KEY)||this.generateVisitorId(),this.effectiveTheme=this.getEffectiveTheme()}generateVisitorId(){let e=`visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,11)}`;return localStorage.setItem(this.VISITOR_STORAGE_KEY,e),e}detectApiBase(e){if(e)try{let n=new URL(e,window.location.href);if((n.protocol==="http:"||n.protocol==="https:")&&n.port==="3000"){let o=`${n.protocol}//${n.hostname}:8000`;return console.info("[Basjoo Widget] Rewriting configured dev apiBase to direct backend:",o),o}return n.toString().replace(/\/$/,"")}catch{return e}let t=document.currentScript;if(t instanceof HTMLScriptElement&&t.src)try{let n=new URL(t.src,window.location.href);return console.info("[Basjoo Widget] Detected API base from current script:",n.origin),n.origin}catch{}let i=document.querySelectorAll("script[src]");for(let n of i){let o=n.getAttribute("src")||"";if(!(!o.includes("sdk.js")&&!o.includes("basjoo")))try{let r=new URL(o,window.location.href);return console.info("[Basjoo Widget] Detected API base from script src:",r.origin),r.origin}catch{}}let s=window.location.port;if(s==="3000"||s==="5173"){let n=`${window.location.protocol}//${window.location.hostname}:8000`;return console.info("[Basjoo Widget] Development mode detected, using:",n),n}return window.location.protocol==="file:"?(console.error("[Basjoo Widget] Cannot determine API base from a local file. Please set apiBase explicitly."),""):(console.warn("[Basjoo Widget] Falling back to window.location.origin. Set apiBase explicitly if the API is hosted elsewhere."),window.location.origin)}getEffectiveTheme(){return this.config.theme==="light"||this.config.theme==="dark"?this.config.theme:typeof window<"u"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}normalizeLocale(e){if(!e)return null;let t=e.trim().replace(/_/g,"-");if(!t)return null;let i=t.split("-").filter(Boolean);if(i.length===0)return null;let s=[i[0].toLowerCase()];for(let o of i.slice(1))/^[A-Za-z]{4}$/.test(o)?s.push(o[0].toUpperCase()+o.slice(1).toLowerCase()):/^[A-Za-z]{2,3}$/.test(o)?s.push(o.toUpperCase()):s.push(o);let n=s.join("-");return f[n.toLowerCase()]||n}getPreferredLocales(){let e=new Set,t=this.config.language!=="auto"?this.normalizeLocale(this.config.language):null;if(t)e.add(t);else{let i=Array.isArray(navigator.languages)&&navigator.languages.length>0?navigator.languages:[navigator.language];for(let s of i){let n=this.normalizeLocale(s);n&&e.add(n)}}for(let i of p)e.add(i);return Array.from(e)}buildLocaleFallbacks(e){let t=this.normalizeLocale(e);if(!t)return[...p];let i=[t],s=t.split("-",1)[0],n=t.toLowerCase();if(s==="zh")t.includes("Hant")||["zh-tw","zh-hk","zh-mo"].includes(n)?i.push("zh-Hant","zh-TW","zh-HK","zh-CN","zh"):i.push("zh-Hans","zh-CN","zh");else{let o={en:"en-US",fr:"fr-FR",ja:"ja-JP",de:"de-DE",es:"es-ES"};o[s]&&i.push(o[s]),i.push(s)}return i.push(...p),Array.from(new Set(i.map(o=>this.normalizeLocale(o)).filter(o=>!!o)))}getEffectiveLocale(){return this.getPreferredLocales()[0]||"en-US"}resolveI18nText(e,t){if(!e)return t;let i=new Map,s=[];for(let[n,o]of Object.entries(e)){if(typeof o!="string")continue;let r=o.trim();if(!r)continue;let a=this.normalizeLocale(n)||n;i.set(a,r),s.push(r)}for(let n of this.getPreferredLocales())for(let o of this.buildLocaleFallbacks(n)){let r=i.get(o);if(r)return r}return s.length>0?s[0]:t}async loadPublicConfig(){if(this.turnstileSiteKey=this.config.turnstileSiteKey||null,!this.config.apiBase){console.warn("[Basjoo Widget] Skipping public config fetch because apiBase could not be determined.");return}try{let e=new URL(`${this.config.apiBase}/api/v1/config:public`);this.config.agentId&&e.searchParams.set("agent_id",this.config.agentId);let t=await fetch(e.toString());if(!t.ok)throw new Error(`HTTP ${t.status}: ${t.statusText}`);let i=await t.json();!this.config.agentId&&i.default_agent_id&&(this.config.agentId=i.default_agent_id),this.config.themeColor=this.config.themeColor||i.widget_color||"#3B82F6",this.hasTitleOverride||(this.config.title=this.resolveI18nText(i.widget_title_i18n,i.widget_title||"AI\u52A9\u624B")),this.hasWelcomeMessageOverride||(this.config.welcomeMessage=this.resolveI18nText(i.welcome_message_i18n,i.welcome_message||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F"));let s=i;this.turnstileSiteKey=s.turnstile_enabled&&s.turnstile_site_key||null,this.effectiveTheme=this.getEffectiveTheme()}catch(e){console.warn("[Basjoo Widget] Failed to load public config, using defaults.",e),e instanceof TypeError&&console.warn("[Basjoo Widget] Public config request may be blocked by CORS, network issues, or an incorrect apiBase:",this.config.apiBase)}}async init(){if(!document.body){console.warn("[Basjoo Widget] document.body is not available yet. Call init() after DOMContentLoaded or place the embed code near the end of <body>.");return}if(document.getElementById("basjoo-widget-container")){console.warn("[Basjoo Widget] Initialization skipped because #basjoo-widget-container already exists. Avoid loading or initializing the widget twice on the same page.");return}if(await this.loadPublicConfig(),this.originalTitle=document.title,this.createStyles(),this.createContainer(),this.createButton(),this.createChatWindow(),this.showGreetingBubble(),this.startTitleBlink(),this.sessionId){this.loadHistory();return}this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date})}showGreetingBubble(){if(!this.button)return;let e=document.createElement("div");e.className="basjoo-greeting-bubble",e.textContent=this.getText("greetingBubble");let t=this.config.position;e.style.position="fixed",e.style.bottom="100px",e.style[t]="24px",e.style.zIndex="9999",document.body.appendChild(e),setTimeout(()=>{e.remove()},5e3)}async loadHistory(){if(this.sessionId){try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}`);if(!e.ok)throw new Error("Failed to load history");let t=await e.json();if(t&&t.length>0){for(let i of t)this.addMessage({role:i.role==="user"?"user":"assistant",content:i.content,sources:i.sources,timestamp:new Date}),i.id>this.lastMessageId&&(this.lastMessageId=i.id);this.startPolling();return}}catch{}this.sessionId=null,localStorage.removeItem(this.STORAGE_KEY),this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date})}}startTitleBlink(){if(this.titleBlinkInterval)return;this.hasUnread=!0;let e=!0;this.titleBlinkInterval=window.setInterval(()=>{document.title=e?this.originalTitle:"❗ "+this.getText("newMessage"),e=!e},1e3)}stopTitleBlink(){this.titleBlinkInterval&&(clearInterval(this.titleBlinkInterval),this.titleBlinkInterval=null),document.title=this.originalTitle,this.hasUnread=!1}createStyles(){let e=document.createElement("style");e.id="basjoo-widget-styles";let t=this.effectiveTheme==="dark",i=t?"#1a1a2e":"white",s=t?"#e2e8f0":"#1f2937",n=t?"#94a3b8":"#6b7280",o=t?"rgba(148, 163, 184, 0.2)":"#e5e7eb",r=t?"#0f0f1a":"white",a=t?"#2d2d44":"#f3f4f6",l=t?"rgba(239, 68, 68, 0.2)":"#fef2f2";e.textContent=`
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

      .basjoo-message {
        display: flex;
        flex-direction: column;
        max-width: 85%;
        animation: basjoo-message-fadein 0.3s ease-out;
      }

      .basjoo-message-user {
        align-self: flex-end;
      }

      .basjoo-message-assistant {
        align-self: flex-start;
      }

      .basjoo-message-content {
        padding: 12px 16px;
        border-radius: 16px;
        font-size: 14px;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .basjoo-message-content p,
      .basjoo-message-content ul,
      .basjoo-message-content ol,
      .basjoo-message-content pre,
      .basjoo-message-content blockquote {
        margin: 0 0 10px;
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
        padding-left: 18px;
      }

      .basjoo-message-content code {
        font-family: SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace;
        font-size: 12px;
        background: rgba(15, 23, 42, 0.08);
        padding: 1px 4px;
        border-radius: 4px;
      }

      .basjoo-message-content pre {
        background: #0f172a;
        color: #e2e8f0;
        padding: 10px 12px;
        border-radius: 10px;
        overflow-x: auto;
      }

      .basjoo-message-content pre code {
        background: transparent;
        padding: 0;
        color: inherit;
      }

      .basjoo-message-content a {
        color: ${this.adjustColor(this.config.themeColor,-10)};
        text-decoration: underline;
      }

      .basjoo-message-content blockquote {
        padding-left: 12px;
        border-left: 3px solid rgba(148, 163, 184, 0.4);
        color: ${n};
      }

      .basjoo-message-user .basjoo-message-content {
        background: ${this.config.themeColor};
        color: white;
        border-bottom-right-radius: 4px;
      }

      .basjoo-message-user .basjoo-message-content a {
        color: white;
      }

      .basjoo-message-user .basjoo-message-content code {
        background: rgba(255, 255, 255, 0.18);
        color: white;
      }

      .basjoo-message-assistant .basjoo-message-content {
        background: ${a};
        color: ${s};
        border-bottom-left-radius: 4px;
      }

      .basjoo-message-error .basjoo-message-content {
        background: ${l};
        color: ${t?"#fca5a5":"#dc2626"};
        border: 1px solid ${t?"rgba(239,68,68,0.35)":"#fecaca"};
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
        background: ${n};
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
        color: ${s};
        margin-bottom: 8px !important;
        margin-left: 4px !important;
      }

      .basjoo-input::placeholder {
        color: ${n};
      }

      .basjoo-input:focus {
        border-color: ${this.config.themeColor};
        box-shadow: 0 0 0 3px ${this.hexToRgba(this.config.themeColor,0.1)};
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
        box-shadow: 0 4px 12px ${this.hexToRgba(this.config.themeColor,0.3)};
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
        background: ${l};
        color: ${t?"#fca5a5":"#dc2626"};
        font-size: 13px;
        text-align: center;
        border-top: 1px solid ${t?"rgba(239,68,68,0.35)":"#fecaca"};
      }

      .basjoo-message-time {
        font-size: 11px;
        color: ${n};
        margin-top: 4px;
        padding: 0 4px;
      }

      .basjoo-message-user .basjoo-message-time {
        text-align: right;
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

      .basjoo-source-list {
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
        color: ${n};
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
        color: ${n};
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
        color: ${n};
        line-height: 1.5;
      }

      .basjoo-thinking {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: ${n};
        font-size: 12px;
        margin-top: 8px;
      }

      .basjoo-thinking-spinner {
        width: 12px;
        height: 12px;
        border: 2px solid ${this.hexToRgba(this.config.themeColor,0.2)};
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
    `,document.head.appendChild(e)}adjustColor(e,t){let i=!1;e[0]==="#"&&(e=e.slice(1),i=!0);let s=parseInt(e,16),n=(s>>16)+t,o=(s>>8&255)+t,r=(s&255)+t;return n>255?n=255:n<0&&(n=0),o>255?o=255:o<0&&(o=0),r>255?r=255:r<0&&(r=0),(i?"#":"")+((n<<16|o<<8|r).toString(16).padStart(6,"0"))}hexToRgba(e,t){let i=e.replace("#","");if(i.length===3){let[o,r,a]=i.split("");i=`${o}${o}${r}${r}${a}${a}`}let s=parseInt(i,16),n=s>>16&255,o=s>>8&255,r=s&255;return`rgba(${n}, ${o}, ${r}, ${t})`}createContainer(){this.container=document.createElement("div"),this.container.id="basjoo-widget-container",document.body.appendChild(this.container)}createButton(){this.button=document.createElement("div"),this.button.id="basjoo-widget-button",this.button.innerHTML=`
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
    `,this.button.addEventListener("click",()=>this.toggle()),this.container.appendChild(this.button)}createChatWindow(){var e;this.chatWindow=document.createElement("div"),this.chatWindow.id="basjoo-chat-window",this.chatWindow.innerHTML=`
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
    `;let t=this.chatWindow.querySelector(".basjoo-close"),i=this.chatWindow.querySelector(".basjoo-input"),s=this.chatWindow.querySelector(".basjoo-send"),n=()=>{if(this.isSending)return;let o=i.value.trim();o&&(o.length>2e3?(this.showError(this.getText("messageTooLong")),0):(this.sendMessage(o),i.value=""))};s.addEventListener("click",n),i.addEventListener("keypress",o=>{o.key==="Enter"&&n()}),(e=this.container)==null||e.appendChild(this.chatWindow)}toggle(){this.isOpen?this.close():this.open()}open(){var e;this.isOpen=!0,(e=this.chatWindow)==null||e.classList.add("open"),this.stopTitleBlink();let t=this.chatWindow==null?void 0:this.chatWindow.querySelector(".basjoo-input");setTimeout(()=>{t==null||t.focus()},300)}close(){var e;this.isOpen=!1,(e=this.chatWindow)==null||e.classList.remove("open")}showError(e){var t=this.chatWindow==null?void 0:this.chatWindow.querySelector(".basjoo-error");t&&t.remove();let i=document.createElement("div");i.className="basjoo-error",i.textContent=e,this.chatWindow&&this.chatWindow.appendChild(i),setTimeout(()=>{i.remove()},5e3)}getText(e){let t={sendFailed:{"en-US":"Send failed, please try again later","zh-CN":"发送失败，请稍后重试"},networkError:{"en-US":"Network connection failed, please check your connection","zh-CN":"网络连接失败，请检查网络"},quotaExceeded:{"en-US":"Daily message limit reached","zh-CN":"今日消息已达上限"},takenOverNotice:{"en-US":"Your conversation has been transferred to a human agent. Please wait for their reply.","zh-CN":"已转接人工客服，请等待回复。"},inputPlaceholder:{"en-US":"Type your question...","zh-CN":"输入您的问题..."},citationSources:{"en-US":"Citation Sources","zh-CN":"引用来源"},openSource:{"en-US":"Open source","zh-CN":"打开来源"},document:{"en-US":"Document","zh-CN":"文档"},messageTooLong:{"en-US":"Message too long (max 2000 characters)","zh-CN":"消息过长（最多2000字符）"},greetingBubble:{"en-US":"Hi! How can I help you?","zh-CN":"你好！有什么可以帮您？"},newMessage:{"en-US":"New message","zh-CN":"新消息"},thinking:{"en-US":"Thinking...","zh-CN":"思考中..."}};return this.resolveI18nText(t[e],t[e]["en-US"]||t[e]["zh-CN"]||e)}formatMessageContent(e){let t=e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");return t=t.replace(/^### (.*)$/gm,"<h3>$1</h3>"),t=t.replace(/^## (.*)$/gm,"<h2>$1</h2>"),t=t.replace(/^# (.*)$/gm,"<h1>$1</h1>"),t=t.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>"),t=t.replace(/\*(.*?)\*/g,"<em>$1</em>"),t=t.replace(/`([^`]+)`/g,"<code>$1</code>"),t=t.replace(/```([\s\S]*?)```/g,'<pre><code>$1</code></pre>'),t=t.replace(/^> (.*)$/gm,"<blockquote>$1</blockquote>"),t=t.replace(/^- (.*)$/gm,"<li>$1</li>"),t=t.replace(/(<li>.*<\/li>)/gs,"<ul>$1</ul>"),t=t.replace(/\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'),t=t.split(/\n{2,}/).map(i=>i.match(/^<(h\d|ul|pre|blockquote)/)?i:`<p>${i.replace(/\n/g,"<br>")}</p>`).join("")}createSourceList(e){let t=document.createElement("div");if(t.className="basjoo-source-list",!e||e.length===0)return t;let i=document.createElement("div");i.className="basjoo-source-header",i.innerHTML=`
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 12h6"></path>
        <path d="M12 9v6"></path>
        <circle cx="12" cy="12" r="10"></circle>
      </svg>
      <span>${this.getText("citationSources")}</span>
    `,t.appendChild(i),e.forEach((s,n)=>{var l,c,y,d,g;let o=document.createElement("details");o.className="basjoo-source-item";let r=document.createElement("summary");r.className="basjoo-source-toggle";let a=((l=s.title)!=null?l:s.url)||this.getText("document");r.innerHTML=`
        <span class="basjoo-source-index">${n+1}</span>
        <span class="basjoo-source-title">${a}</span>
        <svg class="basjoo-source-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      `;let h=document.createElement("div");if(h.className="basjoo-source-body",s.url){let v=document.createElement("a");v.className="basjoo-source-link",v.href=s.url,v.target="_blank",v.rel="noopener noreferrer",v.textContent=`${this.getText("openSource")}: ${s.url}`,h.appendChild(v)}let w=((c=s.snippet)!=null?c:s.question)||((y=s.title)!=null?y:s.url)||this.getText("document");if(w){let v=document.createElement("div");v.className="basjoo-source-snippet",v.textContent=w,h.appendChild(v)}o.appendChild(r),h.childNodes.length>0&&o.appendChild(h),t.appendChild(o)}),t}createMessageElement(e){let t=document.createElement("div");t.className=`basjoo-message basjoo-message-${e.role}`;let i=document.createElement("div");i.className="basjoo-message-content",i.innerHTML=this.formatMessageContent(e.content),t.appendChild(i),e.sources&&e.sources.length>0&&t.appendChild(this.createSourceList(e.sources));let s=document.createElement("div");return s.className="basjoo-message-time",s.textContent=e.timestamp.toLocaleTimeString([],"hour"in[]?void 0:{hour:"2-digit",minute:"2-digit"}),t.appendChild(s),t}scrollToBottom(){let e=this.chatWindow==null?void 0:this.chatWindow.querySelector(".basjoo-messages");e&&(e.scrollTop=e.scrollHeight)}showLoading(){let e=this.chatWindow==null?void 0:this.chatWindow.querySelector(".basjoo-messages");if(!e)return;let t=document.createElement("div");t.className="basjoo-loading",t.id="basjoo-loading",t.innerHTML=`
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
    `,e.appendChild(t),e.scrollTop=e.scrollHeight}hideLoading(){let e=document.getElementById("basjoo-loading");e&&e.remove()}showThinking(e){let t=this.chatWindow==null?void 0:this.chatWindow.querySelector(".basjoo-messages");if(!t)return;this.thinkingIndicator||(this.thinkingIndicator=document.createElement("div"),this.thinkingIndicator.className="basjoo-thinking",this.thinkingIndicator.innerHTML=`
        <span class="basjoo-thinking-spinner"></span>
        <span>${this.getText("thinking")}</span>
      `,t.appendChild(this.thinkingIndicator)),t.scrollTop=t.scrollHeight}hideThinking(){this.thinkingIndicator&&(this.thinkingIndicator.remove(),this.thinkingIndicator=null)}addMessage(e){let t=this.chatWindow==null?void 0:this.chatWindow.querySelector(".basjoo-messages");if(!t)return;if(!e.content){console.error("Message content is null or undefined:",e);return}this.messages.push(e);let i=this.createMessageElement(e);t.appendChild(i),t.scrollTop=t.scrollHeight}sendMessage(e){if(!e.trim())return;this.addMessage({role:"user",content:e,timestamp:new Date}),this.showLoading(),this.sendMessageWithRetry(e).catch(t=>{this.hideLoading(),this.hideThinking(),console.error("Send message failed:",t),this.addMessage({role:"assistant",content:this.getText("sendFailed"),timestamp:new Date})})}async getTurnstileToken(){if(!this.turnstileSiteKey)return null;if(!this.turnstileScriptPromise){this.turnstileScriptPromise=new Promise((e,t)=>{if((window).turnstile){e();return}let i=document.createElement("script");i.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",i.async=!0,i.defer=!0,i.onload=()=>e(),i.onerror=()=>t(new Error("Failed to load Turnstile script")),document.head.appendChild(i)})}if(await this.turnstileScriptPromise,!this.turnstileContainer){this.turnstileContainer=document.createElement("div"),this.turnstileContainer.style.display="none",document.body.appendChild(this.turnstileContainer)}return new Promise((e,t)=>{let i=window.setTimeout(()=>{t(new Error("Turnstile timed out"))},1e4);if(!this.turnstileWidgetId){this.turnstileWidgetId=window.turnstile.render(this.turnstileContainer,{sitekey:this.turnstileSiteKey,callback:s=>{window.clearTimeout(i),e(s)},"error-callback":()=>{window.clearTimeout(i),t(new Error("Turnstile error"))},"expired-callback":()=>{window.clearTimeout(i),t(new Error("Turnstile expired"))}})}window.turnstile.execute(this.turnstileWidgetId)})}async sendMessageWithRetry(e){let t=null;for(let i=0;i<=1;i++)try{let s=Intl.DateTimeFormat().resolvedOptions().timeZone,n=await this.getTurnstileToken(),o=await fetch(`${this.config.apiBase}/api/v1/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify({agent_id:this.config.agentId,message:e,locale:this.getEffectiveLocale(),session_id:this.sessionId||void 0,visitor_id:this.visitorId,timezone:s,turnstile_token:n})});if(!o.ok){let r=`HTTP ${o.status}: ${o.statusText}`;try{let a=await o.json();r=a.message||a.detail||r}catch{}throw new Error(r)}return this.hideLoading(),await this.consumeStream(o)}catch(s){t=s;let n=String(s==null?void 0:s.message||""),o=s instanceof TypeError||n.includes("fetch")||n.includes("Failed to fetch")||n.includes("Stream ended unexpectedly");if(!o||i>=1)throw s}throw t}async consumeStream(e){var a;let t=e.body;if(!t)throw new Error("Response body is empty");let i=t.getReader(),s=new TextDecoder,n="",o={content:"",sources:[]};for(;;){let{done:l,value:c}=await i.read();if(l)break;n+=s.decode(c,{stream:!0});let y=n.split("\n\n");n=y.pop()||"";for(let d of y){if(!d.startsWith("data:"))continue;let g=d.replace(/^data:\s*/,"");if(!g)continue;try{let h=JSON.parse(g);switch(h.type){case"sources":o.sources=Array.isArray(h.sources)?h.sources:[];break;case"thinking":this.hideLoading(),this.showThinking(h.elapsed);break;case"thinking_done":this.hideThinking();break;case"content":this.hideLoading(),this.hideThinking(),o.content+=h.content||"";break;case"done":this.hideThinking(),o.content&&this.addMessage({role:"assistant",content:o.content,sources:o.sources,timestamp:new Date}),h.session_id&&(this.sessionId=h.session_id,localStorage.setItem(this.STORAGE_KEY,h.session_id)),h.taken_over&&this.addMessage({role:"assistant",content:this.getText("takenOverNotice"),timestamp:new Date});break;case"error":throw new Error(h.error||this.getText("networkError"))}}catch(h){throw console.error("Failed to process stream chunk:",h),h}}}((a=i.releaseLock)==null?void 0:a.call(i))}startPolling(){if(this.pollIntervalId)return;this.pollIntervalId=window.setInterval(async()=>{if(!this.sessionId||this.isOpen)return;try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&after_id=${this.lastMessageId}&role=assistant`);if(!e.ok)return;let t=await e.json();Array.isArray(t)&&t.length>0&&t.forEach(i=>{i.id>this.lastMessageId&&(this.lastMessageId=i.id),this.addMessage({role:"assistant",content:i.content,sources:i.sources,timestamp:new Date}),this.startTitleBlink()})}catch(e){console.warn("Polling failed:",e)}},5e3)}stopPolling(){this.pollIntervalId&&(clearInterval(this.pollIntervalId),this.pollIntervalId=null)}};window.BasjooWidget=m;})();
