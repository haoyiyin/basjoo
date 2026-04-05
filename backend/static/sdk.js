"use strict";(()=>{function w(h,e=[]){if(!h)return{content:h,references:[]};let t=[],s=new Set,n=new Map;for(let a of e)a.type!=="url"||typeof a.url!="string"||!/^https?:\/\//.test(a.url)||n.has(a.url)||n.set(a.url,a);let i=a=>{if(s.has(a))return;s.add(a);let c=n.get(a);t.push({title:c?.title?.trim()||a,url:a})};return{content:h.replace(/\[([^\]]+)\]\((#source-(\d+)|https?:\/\/[^\s)]+)\)/g,(a,c,r,l)=>{if(l){let u=Number(l)-1,g=e[u];return g&&g.type==="url"&&g.url&&/^https?:\/\//.test(g.url)&&i(g.url),c}return n.has(r)?(i(r),c):a}),references:t}}var p={agentId:["agentId","agent_id"],apiBase:["apiBase","api_base"],themeColor:["themeColor","theme_color"],welcomeMessage:["welcomeMessage","welcome_message"],language:["language","locale"],position:["position"],theme:["theme"]};function x(h){if(!h)return"/basjoo-logo.png";try{return new URL("/basjoo-logo.png",`${h}/`).toString()}catch{return"/basjoo-logo.png"}}var b=class{constructor(e){this.container=null;this.button=null;this.unreadBadge=null;this.chatWindow=null;this.messages=[];this.sessionId=null;this.isOpen=!1;this.VISITOR_STORAGE_KEY="basjoo_visitor_id";this.effectiveTheme="light";this.originalTitle="";this.titleBlinkInterval=null;this.hasUnread=!1;this.pollIntervalId=null;this.lastMessageId=0;this.isSending=!1;this.streamingMessage=null;this.streamingMessageContent=null;this.thinkingIndicator=null;this.thinkingIndicatorText=null;this.thinkingElapsed=0;this.thinkingTimerId=null;this.currentStreamContent="";this.currentStreamSources=[];let t=this.detectApiBase(e.apiBase);this.hasTitleOverride=typeof e.title=="string"&&e.title.trim().length>0,this.hasWelcomeMessageOverride=typeof e.welcomeMessage=="string"&&e.welcomeMessage.trim().length>0,this.config={agentId:e.agentId,apiBase:t,themeColor:e.themeColor||"#3B82F6",logoUrl:e.logoUrl||x(t),title:e.title||"AI\u52A9\u624B",welcomeMessage:e.welcomeMessage||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F",language:e.language||"auto",position:e.position||"right",theme:e.theme||"auto"},this.STORAGE_KEY=`basjoo_session_${this.config.agentId}`,this.sessionId=localStorage.getItem(this.STORAGE_KEY),this.visitorId=localStorage.getItem(this.VISITOR_STORAGE_KEY)||this.generateVisitorId(),this.effectiveTheme=this.getEffectiveTheme()}generateVisitorId(){let e=`visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,11)}`;return localStorage.setItem(this.VISITOR_STORAGE_KEY,e),e}detectApiBase(e){if(e)try{let i=new URL(e,window.location.href);if((i.protocol==="http:"||i.protocol==="https:")&&i.port==="3000"){let o=`${i.protocol}//${i.hostname}:8000`;return console.info("[Basjoo Widget] Rewriting configured dev apiBase to direct backend:",o),o}return i.toString().replace(/\/$/,"")}catch{return e}let t=document.currentScript;if(t instanceof HTMLScriptElement&&t.src)try{let i=new URL(t.src,window.location.href);return console.info("[Basjoo Widget] Detected API base from current script:",i.origin),i.origin}catch{}let s=document.querySelectorAll("script[src]");for(let i of s){let o=i.getAttribute("src")||"";if(!(!o.includes("sdk.js")&&!o.includes("basjoo")))try{let a=new URL(o,window.location.href);return console.info("[Basjoo Widget] Detected API base from script src:",a.origin),a.origin}catch{}}let n=window.location.port;if(n==="3000"||n==="5173"){let i=`${window.location.protocol}//${window.location.hostname}:8000`;return console.info("[Basjoo Widget] Development mode detected, using:",i),i}return window.location.protocol==="file:"?(console.error("[Basjoo Widget] Cannot determine API base from a local file. Please set apiBase explicitly."),""):(console.warn("[Basjoo Widget] Falling back to window.location.origin. Set apiBase explicitly if the API is hosted elsewhere."),window.location.origin)}getEffectiveTheme(){return this.config.theme==="light"||this.config.theme==="dark"?this.config.theme:typeof window<"u"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}async loadPublicConfig(){if(!this.config.apiBase){console.warn("[Basjoo Widget] Skipping public config fetch because apiBase could not be determined.");return}try{let e=new URL(`${this.config.apiBase}/api/v1/config:public`);this.config.agentId&&e.searchParams.set("agent_id",this.config.agentId);let t=await fetch(e.toString());if(!t.ok)throw new Error(`HTTP ${t.status}: ${t.statusText}`);let s=await t.json();!this.config.agentId&&s.default_agent_id&&(this.config.agentId=s.default_agent_id),this.config.themeColor=this.config.themeColor||s.widget_color||"#3B82F6",this.hasTitleOverride||(this.config.title=s.widget_title||"AI\u52A9\u624B"),this.hasWelcomeMessageOverride||(this.config.welcomeMessage=s.welcome_message||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F"),this.effectiveTheme=this.getEffectiveTheme()}catch(e){console.warn("[Basjoo Widget] Failed to load public config, using defaults.",e),e instanceof TypeError&&console.warn("[Basjoo Widget] Public config request may be blocked by CORS, network issues, or an incorrect apiBase:",this.config.apiBase)}}async init(){if(!document.body){console.warn("[Basjoo Widget] document.body is not available yet. Call init() after DOMContentLoaded or place the embed code near the end of <body>.");return}if(document.getElementById("basjoo-widget-container")){console.warn("[Basjoo Widget] Initialization skipped because #basjoo-widget-container already exists. Avoid loading or initializing the widget twice on the same page.");return}if(await this.loadPublicConfig(),this.originalTitle=document.title,this.createStyles(),this.createContainer(),this.createButton(),this.createChatWindow(),this.showGreetingBubble(),this.startTitleBlink(),this.sessionId){this.loadHistory();return}this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date})}showGreetingBubble(){if(!this.button)return;let e=document.createElement("div");e.className="basjoo-greeting-bubble",e.textContent=this.getText("greetingBubble");let t=this.config.position;e.style.position="fixed",e.style.bottom="100px",e.style[t]="24px",e.style.zIndex="9999",document.body.appendChild(e),setTimeout(()=>{e.remove()},5e3)}async loadHistory(){if(this.sessionId){try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}`);if(!e.ok)throw new Error("Failed to load history");let t=await e.json();if(t&&t.length>0){for(let s of t)this.addMessage({role:s.role==="user"?"user":"assistant",content:s.content,sources:s.sources,timestamp:new Date}),s.id>this.lastMessageId&&(this.lastMessageId=s.id);this.startPolling();return}}catch{}this.sessionId=null,localStorage.removeItem(this.STORAGE_KEY),this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date})}}startTitleBlink(){if(this.titleBlinkInterval)return;this.hasUnread=!0,this.updateUnreadBadge();let e=!0;this.titleBlinkInterval=window.setInterval(()=>{document.title=e?this.originalTitle:"\u2757 "+this.getText("newMessage"),e=!e},1e3)}stopTitleBlink(){this.titleBlinkInterval&&(clearInterval(this.titleBlinkInterval),this.titleBlinkInterval=null),document.title=this.originalTitle,this.hasUnread=!1,this.updateUnreadBadge()}createStyles(){let e=document.createElement("style");e.id="basjoo-widget-styles";let t=this.effectiveTheme==="dark",s=t?"#1a1a2e":"white",n=t?"#e2e8f0":"#1f2937",i=t?"#94a3b8":"#6b7280",o=t?"rgba(148, 163, 184, 0.2)":"#e5e7eb",a=t?"#0f0f1a":"white",c=t?"#2d2d44":"#f3f4f6",r=t?"rgba(239, 68, 68, 0.2)":"#fef2f2";e.textContent=`
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
        background: ${s};
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
        background: ${a};
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
        color: ${i};
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
        background: ${r};
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
        background: ${i};
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
        background: ${s};
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
        background: ${a};
        color: ${n};
        margin-bottom: 8px !important;
        margin-left: 4px !important;
      }

      .basjoo-input::placeholder {
        color: ${i};
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
        background: ${r};
        color: ${t?"#fca5a5":"#dc2626"};
        font-size: 13px;
        text-align: center;
        border-top: 1px solid ${t?"rgba(239,68,68,0.35)":"#fecaca"};
      }

      #basjoo-widget-container .basjoo-message-time {
        font-size: 11px;
        color: ${i};
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
        color: ${i};
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
    `,document.head.appendChild(e)}adjustColor(e,t){let s=!1,n=e;n[0]==="#"&&(n=n.slice(1),s=!0);let i=parseInt(n,16),o=(i>>16)+t,a=(i>>8&255)+t,c=(i&255)+t;return o=Math.max(0,Math.min(255,o)),a=Math.max(0,Math.min(255,a)),c=Math.max(0,Math.min(255,c)),`${s?"#":""}${(o<<16|a<<8|c).toString(16).padStart(6,"0")}`}hexToRgba(e,t){let s=e.replace("#","");if(s.length===3){let[c,r,l]=s.split("");s=`${c}${c}${r}${r}${l}${l}`}let n=parseInt(s,16),i=n>>16&255,o=n>>8&255,a=n&255;return`rgba(${i}, ${o}, ${a}, ${t})`}updateUnreadBadge(){if(this.button){if(this.hasUnread){if(!this.unreadBadge){let e=document.createElement("span");e.className="basjoo-unread-badge",e.textContent="1",this.button.appendChild(e),this.unreadBadge=e}return}this.unreadBadge?.remove(),this.unreadBadge=null}}createContainer(){this.container=document.createElement("div"),this.container.id="basjoo-widget-container",document.body.appendChild(this.container)}createButton(){this.button=document.createElement("div"),this.button.id="basjoo-widget-button",this.button.innerHTML=`
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
    `,this.chatWindow.querySelector(".basjoo-close").addEventListener("click",()=>this.close());let t=this.chatWindow.querySelector(".basjoo-input"),s=this.chatWindow.querySelector(".basjoo-send"),n=()=>{if(this.isSending)return;let i=t.value.trim();if(i){if(i.length>2e3){this.showError(this.getText("messageTooLong"));return}this.sendMessage(i),t.value=""}};s.addEventListener("click",n),t.addEventListener("keypress",i=>{i.key==="Enter"&&n()}),this.container.appendChild(this.chatWindow)}toggle(){if(this.isOpen){this.close();return}this.open()}open(){this.isOpen=!0,this.chatWindow?.classList.remove("closing"),this.chatWindow?.classList.add("open"),this.stopTitleBlink(),this.updateUnreadBadge();let e=this.chatWindow?.querySelector(".basjoo-input");setTimeout(()=>{e?.focus()},300)}close(){this.isOpen=!1,this.chatWindow?.classList.remove("open"),this.chatWindow?.classList.add("closing")}getRequestLocale(){return this.config.language&&this.config.language!=="auto"?this.config.language:navigator.language||"en-US"}getText(e){let t={sendFailed:{"en-US":"Send failed, please try again later","zh-CN":"\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"},networkError:{"en-US":"Network connection failed, please check your connection","zh-CN":"\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC"},quotaExceeded:{"en-US":"Daily message limit reached","zh-CN":"\u4ECA\u65E5\u6D88\u606F\u5DF2\u8FBE\u4E0A\u9650"},takenOverNotice:{"en-US":"Your conversation has been transferred to a human agent. Please wait for their reply.","zh-CN":"\u5DF2\u8F6C\u63A5\u4EBA\u5DE5\u5BA2\u670D\uFF0C\u8BF7\u7B49\u5F85\u56DE\u590D\u3002"},inputPlaceholder:{"en-US":"Type your question...","zh-CN":"\u8F93\u5165\u60A8\u7684\u95EE\u9898..."},messageTooLong:{"en-US":"Message too long (max 2000 characters)","zh-CN":"\u6D88\u606F\u8FC7\u957F\uFF08\u6700\u591A2000\u5B57\u7B26\uFF09"},greetingBubble:{"en-US":"Hi! How can I help you?","zh-CN":"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u60A8\uFF1F"},newMessage:{"en-US":"New message","zh-CN":"\u65B0\u6D88\u606F"},thinking:{"en-US":"Thinking...","zh-CN":"\u601D\u8003\u4E2D..."},references:{"en-US":"References","zh-CN":"\u53C2\u8003\u6765\u6E90"}};return this.getRequestLocale().toLowerCase().startsWith("zh")?t[e]["zh-CN"]||t[e]["en-US"]||e:t[e]["en-US"]||t[e]["zh-CN"]||e}escapeHtml(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}renderMarkdown(e){if(!e)return"";let t=e.replace(/\r\n/g,`
`).split(/\n{2,}/).map(i=>i.trim()).filter(Boolean),s=i=>{let o=this.escapeHtml(i);return o=o.replace(/`([^`]+)`/g,"<code>$1</code>"),o=o.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>"),o=o.replace(/__([^_]+)__/g,"<strong>$1</strong>"),o=o.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g,"$1<em>$2</em>"),o=o.replace(/(^|[^_])_([^_]+)_(?!_)/g,"$1<em>$2</em>"),o=o.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(a,c,r)=>`<a href="${this.escapeHtml(r)}" target="_blank" rel="noopener noreferrer">${c}</a>`),o};return t.map(i=>{if(/^```/.test(i)&&/```$/.test(i)){let o=i.replace(/^```\w*\n?/,"").replace(/```$/,"");return`<pre><code>${this.escapeHtml(o)}</code></pre>`}if(/^(?:[-*]\s.+\n?)+$/.test(i))return`<ul>${i.split(`
`).map(a=>a.replace(/^[-*]\s+/,"").trim()).filter(Boolean).map(a=>`<li>${s(a)}</li>`).join("")}</ul>`;if(/^(?:\d+\.\s.+\n?)+$/.test(i))return`<ol>${i.split(`
`).map(a=>a.replace(/^\d+\.\s+/,"").trim()).filter(Boolean).map(a=>`<li>${s(a)}</li>`).join("")}</ol>`;if(/^>\s?/.test(i)){let o=i.split(`
`).map(a=>a.replace(/^>\s?/,"")).join("<br>");return`<blockquote>${s(o)}</blockquote>`}if(/^#{1,6}\s/.test(i)){let o=i.replace(/^#{1,6}\s+/,"");return`<p><strong>${s(o)}</strong></p>`}return`<p>${s(i).replace(/\n/g,"<br>")}</p>`}).join("")}updateMessageContent(e,t,s=!1){e.innerHTML=this.renderMarkdown(t)+(s?'<span class="basjoo-stream-cursor"></span>':"")}createMessageElement(e){let t=document.createElement("div");t.className=`basjoo-message basjoo-message-${e.role}`;let s=document.createElement("div");if(s.className="basjoo-message-content",e.role==="assistant"){let i=w(e.content,e.sources),o=i.references.length>0?`

**${this.getText("references")}**
${i.references.map(a=>`- [${a.title}](${a.url})`).join(`
`)}`:"";this.updateMessageContent(s,i.content+o)}else this.updateMessageContent(s,e.content);t.appendChild(s);let n=document.createElement("div");return n.className="basjoo-message-time",n.textContent=e.timestamp.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),t.appendChild(n),t}formatThinkingText(){return`${this.getText("thinking")} ${this.thinkingElapsed}s`}showThinkingIndicator(e=0){this.hideLoading(),this.currentStreamContent.trim()||(this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null),this.thinkingElapsed=e;let t=this.chatWindow?.querySelector(".basjoo-messages");if(t){if(!this.thinkingIndicator){let s=document.createElement("div");s.className="basjoo-thinking",s.innerHTML=`
        <span class="basjoo-thinking-spinner"></span>
        <span>${this.getText("thinking")}</span>
      `,t.appendChild(s),this.thinkingIndicator=s,this.thinkingIndicatorText=s.querySelector("span:last-child")}this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText()),t.scrollTop=t.scrollHeight,this.thinkingTimerId===null&&(this.thinkingTimerId=window.setInterval(()=>{this.thinkingElapsed+=1,this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText())},1e3))}}hideThinkingIndicator(){this.thinkingTimerId!==null&&(window.clearInterval(this.thinkingTimerId),this.thinkingTimerId=null),this.thinkingIndicator?.remove(),this.thinkingIndicator=null,this.thinkingIndicatorText=null,this.thinkingElapsed=0}removeStreamingMessage(){this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}createStreamingMessage(e=!1){let t=this.chatWindow?.querySelector(".basjoo-messages"),s=document.createElement("div");s.className="basjoo-message basjoo-message-assistant";let n=document.createElement("div");return n.className="basjoo-message-content",this.updateMessageContent(n,this.currentStreamContent,e),s.appendChild(n),t?(t.appendChild(s),t.scrollTop=t.scrollHeight,this.streamingMessage=s,this.streamingMessageContent=n,this.currentStreamContent="",s):(this.streamingMessage=s,this.streamingMessageContent=n,this.currentStreamContent="",s)}appendToStreamingMessage(e){(!this.streamingMessage||!this.streamingMessageContent)&&(this.hideThinkingIndicator(),this.createStreamingMessage()),this.currentStreamContent+=e,this.streamingMessageContent&&this.updateMessageContent(this.streamingMessageContent,this.currentStreamContent,!0);let t=this.chatWindow?.querySelector(".basjoo-messages");t&&(t.scrollTop=t.scrollHeight)}finalizeStreamingMessage(e=[]){if(!this.streamingMessage||!this.streamingMessageContent)return;if(!this.currentStreamContent.trim()){this.removeStreamingMessage();return}this.streamingMessage.querySelector(".basjoo-stream-cursor")?.remove(),this.currentStreamSources=e;let s=w(this.currentStreamContent,e),n=s.references.length>0?`

**${this.getText("references")}**
${s.references.map(a=>`- [${a.title}](${a.url})`).join(`
`)}`:"",i=s.content+n;this.updateMessageContent(this.streamingMessageContent,i),this.messages.push({role:"assistant",content:i,sources:e,timestamp:new Date});let o=this.chatWindow?.querySelector(".basjoo-messages");o.scrollTop=o.scrollHeight,this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}addMessage(e){this.messages.push(e);let t=this.chatWindow?.querySelector(".basjoo-messages");if(!e.content){console.error("Message content is null or undefined:",e);return}if(!t)return;let s=this.createMessageElement(e);t.appendChild(s),t.scrollTop=t.scrollHeight,e.role==="assistant"&&!this.isOpen&&(this.hasUnread=!0,this.updateUnreadBadge())}showLoading(){let e=this.chatWindow?.querySelector(".basjoo-messages");if(!e)return;let t=document.createElement("div");t.className="basjoo-loading",t.id="basjoo-loading",t.innerHTML=`
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
    `,e.appendChild(t),e.scrollTop=e.scrollHeight}hideLoading(){this.chatWindow?.querySelector("#basjoo-loading")?.remove()}showError(e){let t=this.chatWindow?.querySelector(".basjoo-messages");if(!t)return;let s=document.createElement("div");s.className="basjoo-error",s.textContent=e,t.appendChild(s),t.scrollTop=t.scrollHeight,setTimeout(()=>s.remove(),5e3)}startPolling(){this.pollIntervalId||(this.pollIntervalId=window.setInterval(()=>this.pollMessages(),3e3))}stopPolling(){this.pollIntervalId&&(clearInterval(this.pollIntervalId),this.pollIntervalId=null)}async pollMessages(){if(this.sessionId)try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&after_id=${this.lastMessageId}&role=assistant`);if(!e.ok)return;let t=await e.json();for(let s of t)s.content&&(this.addMessage({role:s.role==="user"?"user":"assistant",content:s.content,sources:s.sources,timestamp:new Date}),this.isOpen||this.startTitleBlink()),s.id>this.lastMessageId&&(this.lastMessageId=s.id)}catch{}}async consumeStream(e){if(!e.body)throw new Error("Streaming response body is unavailable");let t=e.body.getReader(),s=new TextDecoder,n="",i=!1,o=r=>{if(!r.trim())return;let l="message",u=[];for(let d of r.split(`
`))d.startsWith("event:")?l=d.slice(6).trim():d.startsWith("data:")&&u.push(d.slice(5).trimStart());if(!u.length)return;let g=JSON.parse(u.join(`
`));switch(l){case"sources":this.currentStreamSources=Array.isArray(g.sources)?g.sources:[];break;case"thinking":this.showThinkingIndicator(typeof g.elapsed=="number"?g.elapsed:0);break;case"thinking_done":this.hideThinkingIndicator();break;case"content":{let d=g.content||"";this.appendToStreamingMessage(d);break}case"done":{let d=g;d.session_id&&(this.sessionId=d.session_id,localStorage.setItem(this.STORAGE_KEY,d.session_id),this.startPolling()),typeof d.message_id=="number"&&d.message_id>this.lastMessageId&&(this.lastMessageId=d.message_id),d.taken_over?(this.removeStreamingMessage(),this.addMessage({role:"assistant",content:this.getText("takenOverNotice"),timestamp:new Date})):(this.finalizeStreamingMessage(this.currentStreamSources),this.isOpen||this.startTitleBlink()),i=!0;break}case"error":{let d=g,f=new Error(d.error||"Stream failed");throw d.code&&(f.name=d.code),f}default:break}},a=()=>{let r=n.indexOf(`\r
\r
`),l=n.indexOf(`

`);return r===-1&&l===-1?null:r===-1?{index:l,length:2}:l===-1?{index:r,length:4}:r<l?{index:r,length:4}:{index:l,length:2}},c=9e4;for(;!i;){let r=null;try{let{done:l,value:u}=await Promise.race([t.read(),new Promise((d,f)=>{r=window.setTimeout(()=>f(new Error("Stream read timeout")),c)})]);n+=s.decode(u||new Uint8Array,{stream:!l});let g=a();for(;g;){let d=n.slice(0,g.index);if(n=n.slice(g.index+g.length),o(d.replace(/\r\n/g,`
`)),i)break;g=a()}if(l)break}finally{r!==null&&window.clearTimeout(r)}}if(!i&&(n.trim()&&o(n),!i))throw new Error("Stream ended unexpectedly")}async sendMessageWithRetry(e){let t=null;for(let s=0;s<=1;s++)try{let n=Intl.DateTimeFormat().resolvedOptions().timeZone,i=await fetch(`${this.config.apiBase}/api/v1/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify({agent_id:this.config.agentId,message:e,locale:this.getRequestLocale(),session_id:this.sessionId||void 0,visitor_id:this.visitorId,timezone:n})});if(!i.ok){let o=`HTTP ${i.status}: ${i.statusText}`;try{let a=await i.json();o=a.message||a.detail||o}catch{}throw new Error(o)}this.hideLoading(),await this.consumeStream(i);return}catch(n){t=n;let i=String(n?.message||"");if(!(!(this.currentStreamContent.trim().length>0)&&(n instanceof TypeError||i.includes("fetch")||i.includes("Failed to fetch")||i.includes("Stream ended unexpectedly")))||s>=1)throw n;this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage(),console.warn(`[Basjoo Widget] Stream attempt ${s+1} failed, retrying...`),await new Promise(c=>window.setTimeout(c,1e3)),this.showLoading()}throw t}async sendMessage(e){if(!this.isSending){this.isSending=!0,this.addMessage({role:"user",content:e,timestamp:new Date}),this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage(),this.createStreamingMessage(!0);try{await this.sendMessageWithRetry(e)}catch(t){this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage(),console.error("[Basjoo Widget] Error sending message:",t);let s=this.getText("sendFailed"),n="",i=String(t?.message||"");t instanceof TypeError||i.includes("fetch")?(s=this.getText("networkError"),n=`Request may be blocked by CORS, network connectivity, or an incorrect apiBase. Current apiBase: ${this.config.apiBase||"(not set)"}`):i.includes("429")||i.toLowerCase().includes("quota")?s=this.getText("quotaExceeded"):t?.name==="ORIGIN_NOT_ALLOWED"||i.toLowerCase().includes("widget origin not allowed")?(s=this.getText("sendFailed"),n="Widget request was blocked because the current page origin is not on the allowed domain list."):i.includes("401")&&(n="Authentication failed. Please check the agent configuration and public API access."),this.config.apiBase||(n="apiBase could not be determined. When embedding the widget from a local file, set apiBase explicitly or load the SDK from the target server."),n&&console.error("[Basjoo Widget]",n),this.showError(s)}finally{this.isSending=!1}}}destroy(){this.stopPolling(),this.stopTitleBlink(),this.hideThinkingIndicator(),this.removeStreamingMessage(),this.container?.remove(),document.getElementById("basjoo-widget-styles")?.remove()}};window.BasjooWidget=b;function m(h,e){for(let t of e){let s=h.get(t);if(s&&s.trim())return s.trim()}return null}function v(){if(document.currentScript instanceof HTMLScriptElement)return document.currentScript;let h=Array.from(document.querySelectorAll("script[src]"));for(let e=h.length-1;e>=0;e-=1){let t=h[e],s=t.getAttribute("src")||"";if(s.includes("sdk.js"))try{let n=new URL(s,window.location.href);if(m(n.searchParams,p.agentId))return t}catch{continue}}return null}function j(h){let e=h.getAttribute("src")||h.src;if(!e)return null;let t;try{t=new URL(e,window.location.href)}catch{return null}let s=m(t.searchParams,p.agentId);if(!s)return null;let n={agentId:s},i=m(t.searchParams,p.apiBase);i&&(n.apiBase=i);let o=m(t.searchParams,p.themeColor);o&&(n.themeColor=o);let a=m(t.searchParams,p.welcomeMessage);a&&(n.welcomeMessage=a);let c=m(t.searchParams,p.language);c&&(n.language=c);let r=m(t.searchParams,p.position);(r==="left"||r==="right")&&(n.position=r);let l=m(t.searchParams,p.theme);return(l==="light"||l==="dark"||l==="auto")&&(n.theme=l),n}(function(){let e=window,t=v();if(!t)return;let s=j(t);if(!s||e.__basjooWidgetAutoInitScheduled)return;e.__basjooWidgetAutoInitScheduled=!0;let n=()=>{new b(s).init()};if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",n,{once:!0});return}n()})();})();
//# sourceMappingURL=basjoo-widget.min.js.map
