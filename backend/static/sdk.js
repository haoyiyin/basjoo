"use strict";(()=>{function x(h,e=[]){if(!h)return{content:h,references:[]};let t=[],s=new Set,i=new Map;for(let a of e)a.type!=="url"||typeof a.url!="string"||!/^https?:\/\//.test(a.url)||i.has(a.url)||i.set(a.url,a);let n=a=>{if(s.has(a))return;s.add(a);let l=i.get(a);t.push({title:l?.title?.trim()||a,url:a})};return{content:h.replace(/\[([^\]]+)\]\((#source-(\d+)|https?:\/\/[^\s)]+)\)/g,(a,l,r,c)=>{if(c){let m=Number(c)-1,g=e[m];return g&&g.type==="url"&&g.url&&/^https?:\/\//.test(g.url)&&n(g.url),l}return i.has(r)?(n(r),l):a}),references:t}}var u={agentId:["agentId","agent_id"],apiBase:["apiBase","api_base"],themeColor:["themeColor","theme_color"],welcomeMessage:["welcomeMessage","welcome_message"],language:["language","locale"],position:["position"],theme:["theme"]},v={en:"en-US",fr:"fr-FR",ja:"ja-JP",de:"de-DE",es:"es-ES","zh-hans":"zh-CN","zh-cn":"zh-CN","zh-sg":"zh-CN","zh-hant":"zh-Hant","zh-tw":"zh-TW","zh-hk":"zh-HK","zh-mo":"zh-HK"},w=["en-US","zh-CN"];function j(h){if(!h)return"/basjoo-logo.png";try{return new URL("/basjoo-logo.png",`${h}/`).toString()}catch{return"/basjoo-logo.png"}}var b=class{constructor(e){this.container=null;this.button=null;this.unreadBadge=null;this.chatWindow=null;this.messages=[];this.sessionId=null;this.isOpen=!1;this.VISITOR_STORAGE_KEY="basjoo_visitor_id";this.effectiveTheme="light";this.originalTitle="";this.titleBlinkInterval=null;this.hasUnread=!1;this.pollIntervalId=null;this.lastMessageId=0;this.isSending=!1;this.streamingMessage=null;this.streamingMessageContent=null;this.thinkingIndicator=null;this.thinkingIndicatorText=null;this.thinkingElapsed=0;this.thinkingTimerId=null;this.currentStreamContent="";this.currentStreamSources=[];let t=this.detectApiBase(e.apiBase);this.hasTitleOverride=typeof e.title=="string"&&e.title.trim().length>0,this.hasWelcomeMessageOverride=typeof e.welcomeMessage=="string"&&e.welcomeMessage.trim().length>0,this.config={agentId:e.agentId,apiBase:t,themeColor:e.themeColor||"#3B82F6",logoUrl:e.logoUrl||j(t),title:e.title||"AI\u52A9\u624B",welcomeMessage:e.welcomeMessage||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F",language:e.language||"auto",position:e.position||"right",theme:e.theme||"auto"},this.STORAGE_KEY=`basjoo_session_${this.config.agentId}`,this.sessionId=localStorage.getItem(this.STORAGE_KEY),this.visitorId=localStorage.getItem(this.VISITOR_STORAGE_KEY)||this.generateVisitorId(),this.effectiveTheme=this.getEffectiveTheme()}generateVisitorId(){let e=`visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,11)}`;return localStorage.setItem(this.VISITOR_STORAGE_KEY,e),e}detectApiBase(e){if(e)try{let n=new URL(e,window.location.href);if((n.protocol==="http:"||n.protocol==="https:")&&n.port==="3000"){let o=`${n.protocol}//${n.hostname}:8000`;return console.info("[Basjoo Widget] Rewriting configured dev apiBase to direct backend:",o),o}return n.toString().replace(/\/$/,"")}catch{return e}let t=document.currentScript;if(t instanceof HTMLScriptElement&&t.src)try{let n=new URL(t.src,window.location.href);return console.info("[Basjoo Widget] Detected API base from current script:",n.origin),n.origin}catch{}let s=document.querySelectorAll("script[src]");for(let n of s){let o=n.getAttribute("src")||"";if(!(!o.includes("sdk.js")&&!o.includes("basjoo")))try{let a=new URL(o,window.location.href);return console.info("[Basjoo Widget] Detected API base from script src:",a.origin),a.origin}catch{}}let i=window.location.port;if(i==="3000"||i==="5173"){let n=`${window.location.protocol}//${window.location.hostname}:8000`;return console.info("[Basjoo Widget] Development mode detected, using:",n),n}return window.location.protocol==="file:"?(console.error("[Basjoo Widget] Cannot determine API base from a local file. Please set apiBase explicitly."),""):(console.warn("[Basjoo Widget] Falling back to window.location.origin. Set apiBase explicitly if the API is hosted elsewhere."),window.location.origin)}getEffectiveTheme(){return this.config.theme==="light"||this.config.theme==="dark"?this.config.theme:typeof window<"u"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}normalizeLocale(e){if(!e)return null;let t=e.trim().replace(/_/g,"-");if(!t)return null;let s=t.split("-").filter(Boolean);if(s.length===0)return null;let i=[s[0].toLowerCase()];for(let o of s.slice(1))/^[A-Za-z]{4}$/.test(o)?i.push(o[0].toUpperCase()+o.slice(1).toLowerCase()):/^[A-Za-z]{2,3}$/.test(o)?i.push(o.toUpperCase()):i.push(o);let n=i.join("-");return v[n.toLowerCase()]||n}getPreferredLocales(){let e=new Set,t=this.config.language!=="auto"?this.normalizeLocale(this.config.language):null;if(t)e.add(t);else{let s=Array.isArray(navigator.languages)&&navigator.languages.length>0?navigator.languages:[navigator.language];for(let i of s){let n=this.normalizeLocale(i);n&&e.add(n)}}for(let s of w)e.add(s);return Array.from(e)}buildLocaleFallbacks(e){let t=this.normalizeLocale(e);if(!t)return[...w];let s=[t],i=t.split("-",1)[0],n=t.toLowerCase();if(i==="zh")t.includes("Hant")||["zh-tw","zh-hk","zh-mo"].includes(n)?s.push("zh-Hant","zh-TW","zh-HK","zh-CN","zh"):s.push("zh-Hans","zh-CN","zh");else{let o={en:"en-US",fr:"fr-FR",ja:"ja-JP",de:"de-DE",es:"es-ES"};o[i]&&s.push(o[i]),s.push(i)}return s.push(...w),Array.from(new Set(s.map(o=>this.normalizeLocale(o)).filter(o=>!!o)))}getEffectiveLocale(){return this.getPreferredLocales()[0]||"en-US"}resolveI18nText(e,t){if(!e)return t;let s=new Map,i=[];for(let[n,o]of Object.entries(e)){if(typeof o!="string")continue;let a=o.trim();if(!a)continue;let l=this.normalizeLocale(n)||n;s.set(l,a),i.push(a)}for(let n of this.getPreferredLocales())for(let o of this.buildLocaleFallbacks(n)){let a=s.get(o);if(a)return a}return i.length>0?i[0]:t}async loadPublicConfig(){if(!this.config.apiBase){console.warn("[Basjoo Widget] Skipping public config fetch because apiBase could not be determined.");return}try{let e=new URL(`${this.config.apiBase}/api/v1/config:public`);this.config.agentId&&e.searchParams.set("agent_id",this.config.agentId);let t=await fetch(e.toString());if(!t.ok)throw new Error(`HTTP ${t.status}: ${t.statusText}`);let s=await t.json();!this.config.agentId&&s.default_agent_id&&(this.config.agentId=s.default_agent_id),this.config.themeColor=this.config.themeColor||s.widget_color||"#3B82F6",this.hasTitleOverride||(this.config.title=this.resolveI18nText(s.widget_title_i18n,s.widget_title||"AI\u52A9\u624B")),this.hasWelcomeMessageOverride||(this.config.welcomeMessage=this.resolveI18nText(s.welcome_message_i18n,s.welcome_message||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F")),this.effectiveTheme=this.getEffectiveTheme()}catch(e){console.warn("[Basjoo Widget] Failed to load public config, using defaults.",e),e instanceof TypeError&&console.warn("[Basjoo Widget] Public config request may be blocked by CORS, network issues, or an incorrect apiBase:",this.config.apiBase)}}async init(){if(!document.body){console.warn("[Basjoo Widget] document.body is not available yet. Call init() after DOMContentLoaded or place the embed code near the end of <body>.");return}if(document.getElementById("basjoo-widget-container")){console.warn("[Basjoo Widget] Initialization skipped because #basjoo-widget-container already exists. Avoid loading or initializing the widget twice on the same page.");return}if(await this.loadPublicConfig(),this.originalTitle=document.title,this.createStyles(),this.createContainer(),this.createButton(),this.createChatWindow(),this.showGreetingBubble(),this.startTitleBlink(),this.sessionId){this.loadHistory();return}this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date})}showGreetingBubble(){if(!this.button)return;let e=document.createElement("div");e.className="basjoo-greeting-bubble",e.textContent=this.getText("greetingBubble");let t=this.config.position;e.style.position="fixed",e.style.bottom="100px",e.style[t]="24px",e.style.zIndex="9999",document.body.appendChild(e),setTimeout(()=>{e.remove()},5e3)}async loadHistory(){if(this.sessionId){try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}`);if(!e.ok)throw new Error("Failed to load history");let t=await e.json();if(t&&t.length>0){for(let s of t)this.addMessage({role:s.role==="user"?"user":"assistant",content:s.content,sources:s.sources,timestamp:new Date}),s.id>this.lastMessageId&&(this.lastMessageId=s.id);this.startPolling();return}}catch{}this.sessionId=null,localStorage.removeItem(this.STORAGE_KEY),this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date})}}startTitleBlink(){if(this.titleBlinkInterval)return;this.hasUnread=!0,this.updateUnreadBadge();let e=!0;this.titleBlinkInterval=window.setInterval(()=>{document.title=e?this.originalTitle:"\u2757 "+this.getText("newMessage"),e=!e},1e3)}stopTitleBlink(){this.titleBlinkInterval&&(clearInterval(this.titleBlinkInterval),this.titleBlinkInterval=null),document.title=this.originalTitle,this.hasUnread=!1,this.updateUnreadBadge()}createStyles(){let e=document.createElement("style");e.id="basjoo-widget-styles";let t=this.effectiveTheme==="dark",s=t?"#1a1a2e":"white",i=t?"#e2e8f0":"#1f2937",n=t?"#94a3b8":"#6b7280",o=t?"rgba(148, 163, 184, 0.2)":"#e5e7eb",a=t?"#0f0f1a":"white",l=t?"#2d2d44":"#f3f4f6",r=t?"rgba(239, 68, 68, 0.2)":"#fef2f2";e.textContent=`
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
        color: ${i};
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
        color: ${n};
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
        background: ${l};
        color: ${i};
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
        color: ${i};
        margin-bottom: 8px !important;
        margin-left: 4px !important;
      }

      .basjoo-input::placeholder {
        color: ${n};
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
        color: ${n};
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
        color: ${n};
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
    `,document.head.appendChild(e)}adjustColor(e,t){let s=!1,i=e;i[0]==="#"&&(i=i.slice(1),s=!0);let n=parseInt(i,16),o=(n>>16)+t,a=(n>>8&255)+t,l=(n&255)+t;return o=Math.max(0,Math.min(255,o)),a=Math.max(0,Math.min(255,a)),l=Math.max(0,Math.min(255,l)),`${s?"#":""}${(o<<16|a<<8|l).toString(16).padStart(6,"0")}`}hexToRgba(e,t){let s=e.replace("#","");if(s.length===3){let[l,r,c]=s.split("");s=`${l}${l}${r}${r}${c}${c}`}let i=parseInt(s,16),n=i>>16&255,o=i>>8&255,a=i&255;return`rgba(${n}, ${o}, ${a}, ${t})`}updateUnreadBadge(){if(this.button){if(this.hasUnread){if(!this.unreadBadge){let e=document.createElement("span");e.className="basjoo-unread-badge",e.textContent="1",this.button.appendChild(e),this.unreadBadge=e}return}this.unreadBadge?.remove(),this.unreadBadge=null}}createContainer(){this.container=document.createElement("div"),this.container.id="basjoo-widget-container",document.body.appendChild(this.container)}createButton(){this.button=document.createElement("div"),this.button.id="basjoo-widget-button",this.button.innerHTML=`
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
    `,this.chatWindow.querySelector(".basjoo-close").addEventListener("click",()=>this.close());let t=this.chatWindow.querySelector(".basjoo-input"),s=this.chatWindow.querySelector(".basjoo-send"),i=()=>{if(this.isSending)return;let n=t.value.trim();if(n){if(n.length>2e3){this.showError(this.getText("messageTooLong"));return}this.sendMessage(n),t.value=""}};s.addEventListener("click",i),t.addEventListener("keypress",n=>{n.key==="Enter"&&i()}),this.container.appendChild(this.chatWindow)}toggle(){if(this.isOpen){this.close();return}this.open()}open(){this.isOpen=!0,this.chatWindow?.classList.remove("closing"),this.chatWindow?.classList.add("open"),this.stopTitleBlink(),this.updateUnreadBadge();let e=this.chatWindow?.querySelector(".basjoo-input");setTimeout(()=>{e?.focus()},300)}close(){this.isOpen=!1,this.chatWindow?.classList.remove("open"),this.chatWindow?.classList.add("closing")}getText(e){let t={sendFailed:{"en-US":"Send failed, please try again later","zh-CN":"\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"},networkError:{"en-US":"Network connection failed, please check your connection","zh-CN":"\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC"},quotaExceeded:{"en-US":"Daily message limit reached","zh-CN":"\u4ECA\u65E5\u6D88\u606F\u5DF2\u8FBE\u4E0A\u9650"},takenOverNotice:{"en-US":"Your conversation has been transferred to a human agent. Please wait for their reply.","zh-CN":"\u5DF2\u8F6C\u63A5\u4EBA\u5DE5\u5BA2\u670D\uFF0C\u8BF7\u7B49\u5F85\u56DE\u590D\u3002"},inputPlaceholder:{"en-US":"Type your question...","zh-CN":"\u8F93\u5165\u60A8\u7684\u95EE\u9898..."},messageTooLong:{"en-US":"Message too long (max 2000 characters)","zh-CN":"\u6D88\u606F\u8FC7\u957F\uFF08\u6700\u591A2000\u5B57\u7B26\uFF09"},greetingBubble:{"en-US":"Hi! How can I help you?","zh-CN":"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u60A8\uFF1F"},newMessage:{"en-US":"New message","zh-CN":"\u65B0\u6D88\u606F"},thinking:{"en-US":"Thinking...","zh-CN":"\u601D\u8003\u4E2D..."},references:{"en-US":"References","zh-CN":"\u53C2\u8003\u6765\u6E90"}};return this.resolveI18nText(t[e],t[e]["en-US"]||t[e]["zh-CN"]||e)}escapeHtml(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}renderMarkdown(e){if(!e)return"";let t=e.replace(/\r\n/g,`
`).split(/\n{2,}/).map(n=>n.trim()).filter(Boolean),s=n=>{let o=this.escapeHtml(n);return o=o.replace(/`([^`]+)`/g,"<code>$1</code>"),o=o.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>"),o=o.replace(/__([^_]+)__/g,"<strong>$1</strong>"),o=o.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g,"$1<em>$2</em>"),o=o.replace(/(^|[^_])_([^_]+)_(?!_)/g,"$1<em>$2</em>"),o=o.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(a,l,r)=>`<a href="${this.escapeHtml(r)}" target="_blank" rel="noopener noreferrer">${l}</a>`),o};return t.map(n=>{if(/^```/.test(n)&&/```$/.test(n)){let o=n.replace(/^```\w*\n?/,"").replace(/```$/,"");return`<pre><code>${this.escapeHtml(o)}</code></pre>`}if(/^(?:[-*]\s.+\n?)+$/.test(n))return`<ul>${n.split(`
`).map(a=>a.replace(/^[-*]\s+/,"").trim()).filter(Boolean).map(a=>`<li>${s(a)}</li>`).join("")}</ul>`;if(/^(?:\d+\.\s.+\n?)+$/.test(n))return`<ol>${n.split(`
`).map(a=>a.replace(/^\d+\.\s+/,"").trim()).filter(Boolean).map(a=>`<li>${s(a)}</li>`).join("")}</ol>`;if(/^>\s?/.test(n)){let o=n.split(`
`).map(a=>a.replace(/^>\s?/,"")).join("<br>");return`<blockquote>${s(o)}</blockquote>`}if(/^#{1,6}\s/.test(n)){let o=n.replace(/^#{1,6}\s+/,"");return`<p><strong>${s(o)}</strong></p>`}return`<p>${s(n).replace(/\n/g,"<br>")}</p>`}).join("")}updateMessageContent(e,t,s=!1){e.innerHTML=this.renderMarkdown(t)+(s?'<span class="basjoo-stream-cursor"></span>':"")}createMessageElement(e){let t=document.createElement("div");t.className=`basjoo-message basjoo-message-${e.role}`;let s=document.createElement("div");if(s.className="basjoo-message-content",e.role==="assistant"){let n=x(e.content,e.sources),o=n.references.length>0?`

**${this.getText("references")}**
${n.references.map(a=>`- [${a.title}](${a.url})`).join(`
`)}`:"";this.updateMessageContent(s,n.content+o)}else this.updateMessageContent(s,e.content);t.appendChild(s);let i=document.createElement("div");return i.className="basjoo-message-time",i.textContent=e.timestamp.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),t.appendChild(i),t}formatThinkingText(){return`${this.getText("thinking")} ${this.thinkingElapsed}s`}showThinkingIndicator(e=0){this.hideLoading(),this.currentStreamContent.trim()||(this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null),this.thinkingElapsed=e;let t=this.chatWindow?.querySelector(".basjoo-messages");if(t){if(!this.thinkingIndicator){let s=document.createElement("div");s.className="basjoo-thinking",s.innerHTML=`
        <span class="basjoo-thinking-spinner"></span>
        <span>${this.getText("thinking")}</span>
      `,t.appendChild(s),this.thinkingIndicator=s,this.thinkingIndicatorText=s.querySelector("span:last-child")}this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText()),t.scrollTop=t.scrollHeight,this.thinkingTimerId===null&&(this.thinkingTimerId=window.setInterval(()=>{this.thinkingElapsed+=1,this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText())},1e3))}}hideThinkingIndicator(){this.thinkingTimerId!==null&&(window.clearInterval(this.thinkingTimerId),this.thinkingTimerId=null),this.thinkingIndicator?.remove(),this.thinkingIndicator=null,this.thinkingIndicatorText=null,this.thinkingElapsed=0}removeStreamingMessage(){this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}createStreamingMessage(e=!1){let t=this.chatWindow?.querySelector(".basjoo-messages"),s=document.createElement("div");s.className="basjoo-message basjoo-message-assistant";let i=document.createElement("div");return i.className="basjoo-message-content",this.updateMessageContent(i,this.currentStreamContent,e),s.appendChild(i),t?(t.appendChild(s),t.scrollTop=t.scrollHeight,this.streamingMessage=s,this.streamingMessageContent=i,this.currentStreamContent="",s):(this.streamingMessage=s,this.streamingMessageContent=i,this.currentStreamContent="",s)}appendToStreamingMessage(e){(!this.streamingMessage||!this.streamingMessageContent)&&(this.hideThinkingIndicator(),this.createStreamingMessage()),this.currentStreamContent+=e,this.streamingMessageContent&&this.updateMessageContent(this.streamingMessageContent,this.currentStreamContent,!0);let t=this.chatWindow?.querySelector(".basjoo-messages");t&&(t.scrollTop=t.scrollHeight)}finalizeStreamingMessage(e=[]){if(!this.streamingMessage||!this.streamingMessageContent)return;if(!this.currentStreamContent.trim()){this.removeStreamingMessage();return}this.streamingMessage.querySelector(".basjoo-stream-cursor")?.remove(),this.currentStreamSources=e;let s=x(this.currentStreamContent,e),i=s.references.length>0?`

**${this.getText("references")}**
${s.references.map(a=>`- [${a.title}](${a.url})`).join(`
`)}`:"",n=s.content+i;this.updateMessageContent(this.streamingMessageContent,n),this.messages.push({role:"assistant",content:n,sources:e,timestamp:new Date});let o=this.chatWindow?.querySelector(".basjoo-messages");o.scrollTop=o.scrollHeight,this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}addMessage(e){this.messages.push(e);let t=this.chatWindow?.querySelector(".basjoo-messages");if(!e.content){console.error("Message content is null or undefined:",e);return}if(!t)return;let s=this.createMessageElement(e);t.appendChild(s),t.scrollTop=t.scrollHeight,e.role==="assistant"&&!this.isOpen&&(this.hasUnread=!0,this.updateUnreadBadge())}showLoading(){let e=this.chatWindow?.querySelector(".basjoo-messages");if(!e)return;let t=document.createElement("div");t.className="basjoo-loading",t.id="basjoo-loading",t.innerHTML=`
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
    `,e.appendChild(t),e.scrollTop=e.scrollHeight}hideLoading(){this.chatWindow?.querySelector("#basjoo-loading")?.remove()}showError(e){let t=this.chatWindow?.querySelector(".basjoo-messages");if(!t)return;let s=document.createElement("div");s.className="basjoo-error",s.textContent=e,t.appendChild(s),t.scrollTop=t.scrollHeight,setTimeout(()=>s.remove(),5e3)}startPolling(){this.pollIntervalId||(this.pollIntervalId=window.setInterval(()=>this.pollMessages(),3e3))}stopPolling(){this.pollIntervalId&&(clearInterval(this.pollIntervalId),this.pollIntervalId=null)}async pollMessages(){if(this.sessionId)try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&after_id=${this.lastMessageId}&role=assistant`);if(!e.ok)return;let t=await e.json();for(let s of t)s.content&&(this.addMessage({role:s.role==="user"?"user":"assistant",content:s.content,sources:s.sources,timestamp:new Date}),this.isOpen||this.startTitleBlink()),s.id>this.lastMessageId&&(this.lastMessageId=s.id)}catch{}}async consumeStream(e){if(!e.body)throw new Error("Streaming response body is unavailable");let t=e.body.getReader(),s=new TextDecoder,i="",n=!1,o=r=>{if(!r.trim())return;let c="message",m=[];for(let d of r.split(`
`))d.startsWith("event:")?c=d.slice(6).trim():d.startsWith("data:")&&m.push(d.slice(5).trimStart());if(!m.length)return;let g=JSON.parse(m.join(`
`));switch(c){case"sources":this.currentStreamSources=Array.isArray(g.sources)?g.sources:[];break;case"thinking":this.showThinkingIndicator(typeof g.elapsed=="number"?g.elapsed:0);break;case"thinking_done":this.hideThinkingIndicator();break;case"content":{let d=g.content||"";this.appendToStreamingMessage(d);break}case"done":{let d=g;d.session_id&&(this.sessionId=d.session_id,localStorage.setItem(this.STORAGE_KEY,d.session_id),this.startPolling()),typeof d.message_id=="number"&&d.message_id>this.lastMessageId&&(this.lastMessageId=d.message_id),d.taken_over?(this.removeStreamingMessage(),this.addMessage({role:"assistant",content:this.getText("takenOverNotice"),timestamp:new Date})):(this.finalizeStreamingMessage(this.currentStreamSources),this.isOpen||this.startTitleBlink()),n=!0;break}case"error":{let d=g,f=new Error(d.error||"Stream failed");throw d.code&&(f.name=d.code),f}default:break}},a=()=>{let r=i.indexOf(`\r
\r
`),c=i.indexOf(`

`);return r===-1&&c===-1?null:r===-1?{index:c,length:2}:c===-1?{index:r,length:4}:r<c?{index:r,length:4}:{index:c,length:2}},l=9e4;for(;!n;){let r=null;try{let{done:c,value:m}=await Promise.race([t.read(),new Promise((d,f)=>{r=window.setTimeout(()=>f(new Error("Stream read timeout")),l)})]);i+=s.decode(m||new Uint8Array,{stream:!c});let g=a();for(;g;){let d=i.slice(0,g.index);if(i=i.slice(g.index+g.length),o(d.replace(/\r\n/g,`
`)),n)break;g=a()}if(c)break}finally{r!==null&&window.clearTimeout(r)}}if(!n&&(i.trim()&&o(i),!n))throw new Error("Stream ended unexpectedly")}async sendMessageWithRetry(e){let t=null;for(let s=0;s<=1;s++)try{let i=Intl.DateTimeFormat().resolvedOptions().timeZone,n=await fetch(`${this.config.apiBase}/api/v1/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify({agent_id:this.config.agentId,message:e,locale:this.getEffectiveLocale(),session_id:this.sessionId||void 0,visitor_id:this.visitorId,timezone:i})});if(!n.ok){let o=`HTTP ${n.status}: ${n.statusText}`;try{let a=await n.json();o=a.message||a.detail||o}catch{}throw new Error(o)}this.hideLoading(),await this.consumeStream(n);return}catch(i){t=i;let n=String(i?.message||"");if(!(!(this.currentStreamContent.trim().length>0)&&(i instanceof TypeError||n.includes("fetch")||n.includes("Failed to fetch")||n.includes("Stream ended unexpectedly")))||s>=1)throw i;this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage(),console.warn(`[Basjoo Widget] Stream attempt ${s+1} failed, retrying...`),await new Promise(l=>window.setTimeout(l,1e3)),this.showLoading()}throw t}async sendMessage(e){if(!this.isSending){this.isSending=!0,this.addMessage({role:"user",content:e,timestamp:new Date}),this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage(),this.createStreamingMessage(!0);try{await this.sendMessageWithRetry(e)}catch(t){this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage(),console.error("[Basjoo Widget] Error sending message:",t);let s=this.getText("sendFailed"),i="",n=String(t?.message||"");t instanceof TypeError||n.includes("fetch")?(s=this.getText("networkError"),i=`Request may be blocked by CORS, network connectivity, or an incorrect apiBase. Current apiBase: ${this.config.apiBase||"(not set)"}`):n.includes("429")||n.toLowerCase().includes("quota")?s=this.getText("quotaExceeded"):t?.name==="ORIGIN_NOT_ALLOWED"||n.toLowerCase().includes("widget origin not allowed")?(s=this.getText("sendFailed"),i="Widget request was blocked because the current page origin is not on the allowed domain list."):n.includes("401")&&(i="Authentication failed. Please check the agent configuration and public API access."),this.config.apiBase||(i="apiBase could not be determined. When embedding the widget from a local file, set apiBase explicitly or load the SDK from the target server."),i&&console.error("[Basjoo Widget]",i),this.showError(s)}finally{this.isSending=!1}}}destroy(){this.stopPolling(),this.stopTitleBlink(),this.hideThinkingIndicator(),this.removeStreamingMessage(),this.container?.remove(),document.getElementById("basjoo-widget-styles")?.remove()}};window.BasjooWidget=b;function p(h,e){for(let t of e){let s=h.get(t);if(s&&s.trim())return s.trim()}return null}function y(){if(document.currentScript instanceof HTMLScriptElement)return document.currentScript;let h=Array.from(document.querySelectorAll("script[src]"));for(let e=h.length-1;e>=0;e-=1){let t=h[e],s=t.getAttribute("src")||"";if(s.includes("sdk.js"))try{let i=new URL(s,window.location.href);if(p(i.searchParams,u.agentId))return t}catch{continue}}return null}function S(h){let e=h.getAttribute("src")||h.src;if(!e)return null;let t;try{t=new URL(e,window.location.href)}catch{return null}let s=p(t.searchParams,u.agentId);if(!s)return null;let i={agentId:s},n=p(t.searchParams,u.apiBase);n&&(i.apiBase=n);let o=p(t.searchParams,u.themeColor);o&&(i.themeColor=o);let a=p(t.searchParams,u.welcomeMessage);a&&(i.welcomeMessage=a);let l=p(t.searchParams,u.language);l&&(i.language=l);let r=p(t.searchParams,u.position);(r==="left"||r==="right")&&(i.position=r);let c=p(t.searchParams,u.theme);return(c==="light"||c==="dark"||c==="auto")&&(i.theme=c),i}(function(){let e=window,t=y();if(!t)return;let s=S(t);if(!s||e.__basjooWidgetAutoInitScheduled)return;e.__basjooWidgetAutoInitScheduled=!0;let i=()=>{new b(s).init()};if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",i,{once:!0});return}i()})();})();
//# sourceMappingURL=basjoo-widget.min.js.map
