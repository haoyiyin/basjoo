"use strict";(()=>{function v(r,e=[]){if(!r)return{content:r,references:[]};let t=[],n=new Set,s=new Map;for(let a of e)a.type!=="url"||typeof a.url!="string"||!/^https?:\/\//.test(a.url)||s.has(a.url)||s.set(a.url,a);let i=a=>{if(n.has(a))return;n.add(a);let l=s.get(a);t.push({title:l?.title?.trim()||a,url:a})};return{content:r.replace(/\[([^\]]+)\]\((#source-(\d+)|https?:\/\/[^\s)]+)\)/g,(a,l,c,d)=>{if(d){let h=Number(d)-1,u=e[h];return u&&u.type==="url"&&u.url&&/^https?:\/\//.test(u.url)&&i(u.url),l}return s.has(c)?(i(c),l):a}),references:t}}var p={agentId:["agentId","agent_id"],apiBase:["apiBase","api_base"],themeColor:["themeColor","theme_color"],welcomeMessage:["welcomeMessage","welcome_message"],language:["language","locale"],position:["position"],theme:["theme"]};function C(r){if(!r)return"/basjoo-logo.png";try{return new URL("/basjoo-logo.png",`${r}/`).toString()}catch{return"/basjoo-logo.png"}}var x="#basjoo-chat",S="(pointer: fine)",k="basjoo_open_",T="basjoo_rollout_";function j(){let r=window.__BASJOO_CONFIG__;return!r||typeof r!="object"?null:r}function M(r,e){if(!Array.isArray(e))return!1;for(let t of e)if(!(typeof t!="string"||!t))try{if(new RegExp(t).test(r))return!0}catch{console.warn(`[Basjoo Widget] Ignoring an invalid excluded_paths pattern: ${t}`)}return!1}function I(r,e){let t=typeof r.path=="string"?r.path.trim():"";if(!t)return!0;try{return new RegExp(t).test(e)}catch{return console.warn(`[Basjoo Widget] Ignoring an invalid starter path pattern: ${t}`),!0}}function E(){try{return window.location.origin}catch{return""}}function _(r,e,t){if(e>=100)return!0;if(e<=0)return!1;let n=`${T}${r}`,s=t.getItem(n);if(s==="in")return!0;if(s==="out")return!1;let i=Math.random()*100<e;return t.setItem(n,i?"in":"out"),i}function y(r){if(typeof r!="string"||!r.trim())return"";let e=r.trim();try{let t=new URL(e,window.location.href);return t.protocol!=="http:"&&t.protocol!=="https:"?"":t.toString()}catch{return""}}var w=class{constructor(){this.memoryStore=new Map;this.storageAvailable=null}isAvailable(){if(this.storageAvailable!==null)return this.storageAvailable;try{let e="__storage_test__";return window.localStorage.setItem(e,"test"),window.localStorage.removeItem(e),this.storageAvailable=!0,!0}catch{return this.storageAvailable=!1,!1}}getItem(e){if(this.isAvailable())try{return window.localStorage.getItem(e)}catch{}return this.memoryStore.get(e)??null}setItem(e,t){if(this.isAvailable())try{window.localStorage.setItem(e,t);return}catch{}this.memoryStore.set(e,t)}removeItem(e){if(this.isAvailable())try{window.localStorage.removeItem(e);return}catch{}this.memoryStore.delete(e)}},f=class r{constructor(e){this.container=null;this.button=null;this.unreadBadge=null;this.chatWindow=null;this.messages=[];this.sessionId=null;this.isOpen=!1;this.VISITOR_STORAGE_KEY="basjoo_visitor_id";this.effectiveTheme="light";this.originalTitle="";this.titleBlinkInterval=null;this.hasUnread=!1;this.pollIntervalId=null;this.lastMessageId=0;this.isSending=!1;this.streamAbortController=null;this.streamingMessage=null;this.streamingMessageContent=null;this.thinkingIndicator=null;this.thinkingIndicatorText=null;this.thinkingElapsed=0;this.thinkingTimerId=null;this.currentStreamContent="";this.currentStreamSources=[];this.sessionMode="ai";this.isOnline=!0;this.awayMessage="";this.humanNoticeBar=null;this.headerHumanButton=null;this.onlineCheckIntervalId=null;this._buttonClickListener=null;this._closeBtnClickListener=null;this._sendBtnClickListener=null;this._inputKeypressListener=null;this._humanBtnClickListener=null;this._continueAiClickListener=null;this.displayMode="bubble";this.mountTarget=null;this.iframeElement=null;this.cardsRendered=!1;this._cardActionListeners=[];this._starterClickListeners=[];this.embed=j();let t=this.embed?.agent_id,n=this.embed?.api_base,s=this.detectApiBase(e.apiBase||n),i=e.agentId||t||"";this.hasTitleOverride=typeof e.title=="string"&&e.title.trim().length>0,this.hasWelcomeMessageOverride=typeof e.welcomeMessage=="string"&&e.welcomeMessage.trim().length>0,this.config={agentId:i,apiBase:s,themeColor:e.themeColor||"",logoUrl:e.logoUrl||C(s),title:e.title||"AI\u52A9\u624B",welcomeMessage:e.welcomeMessage||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F",language:e.language||"auto",position:e.position||"right",theme:e.theme||"auto"},this.STORAGE_KEY=`basjoo_session_${this.config.agentId}`,this.openStateStorageKey=`${k}${this.config.agentId}`,this.storage=new w,this.sessionId=this.storage.getItem(this.STORAGE_KEY),this.visitorId=this.storage.getItem(this.VISITOR_STORAGE_KEY)||this.generateVisitorId();let o=this.embed?.display_mode;this.displayMode=o==="inline"||o==="iframe"?o:"bubble",this.effectiveTheme=this.getEffectiveTheme()}static{this.pageContext={before:"",after:""}}static setContext(e){let t=e&&typeof e=="object"?e:{};r.pageContext={before:typeof t.before=="string"?t.before:"",after:typeof t.after=="string"?t.after:""}}generateVisitorId(){let e=`visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,11)}`;return this.storage.setItem(this.VISITOR_STORAGE_KEY,e),e}detectApiBase(e){if(e)try{let i=new URL(e,window.location.href);if((i.protocol==="http:"||i.protocol==="https:")&&i.port==="3000"){let o=`${i.protocol}//${i.hostname}:8000`;return console.info("[Basjoo Widget] Rewriting configured dev apiBase to direct backend:",o),o}return i.toString().replace(/\/$/,"")}catch{return e}let t=document.currentScript;if(t instanceof HTMLScriptElement&&t.src)try{let i=new URL(t.src,window.location.href);return console.info("[Basjoo Widget] Detected API base from current script:",i.origin),i.origin}catch{}let n=document.querySelectorAll("script[src]");for(let i of n){let o=i.getAttribute("src")||"";if(!(!o.includes("sdk.js")&&!o.includes("basjoo")))try{let a=new URL(o,window.location.href);return console.info("[Basjoo Widget] Detected API base from script src:",a.origin),a.origin}catch{}}let s=window.location.port;if(s==="3000"||s==="5173"){let i=`${window.location.protocol}//${window.location.hostname}:8000`;return console.info("[Basjoo Widget] Development mode detected, using:",i),i}return window.location.protocol==="file:"?(console.error("[Basjoo Widget] Cannot determine API base from a local file. Please set apiBase explicitly."),""):(console.warn("[Basjoo Widget] Falling back to window.location.origin. Set apiBase explicitly if the API is hosted elsewhere."),window.location.origin)}getEffectiveTheme(){return this.config.theme==="light"||this.config.theme==="dark"?this.config.theme:typeof window<"u"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}async loadPublicConfig(){if(!this.config.apiBase){console.warn("[Basjoo Widget] Skipping public config fetch because apiBase could not be determined.");return}try{let e=new URL(`${this.config.apiBase}/api/v1/config:public`);this.config.agentId&&e.searchParams.set("agent_id",this.config.agentId);let t=await fetch(e.toString());if(!t.ok)throw new Error(`HTTP ${t.status}: ${t.statusText}`);let n=await t.json();!this.config.agentId&&n.default_agent_id&&(this.config.agentId=n.default_agent_id),this.config.themeColor=this.config.themeColor||n.widget_color||"#3B82F6",this.hasTitleOverride||(this.config.title=n.widget_title||"AI\u52A9\u624B"),this.hasWelcomeMessageOverride||(this.config.welcomeMessage=n.welcome_message||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F"),this.isOnline=n.online!==!1,this.awayMessage=(n.away_message||"").trim(),this.effectiveTheme=this.getEffectiveTheme()}catch(e){console.warn("[Basjoo Widget] Failed to load public config, using defaults.",e),e instanceof TypeError&&console.warn("[Basjoo Widget] Public config request may be blocked by CORS, network issues, or an incorrect apiBase:",this.config.apiBase)}}isOriginAllowed(){let e=(this.embed?.allowed_domains||[]).filter(n=>typeof n=="string"&&n.length>0);if(e.length===0)return!0;let t=E();return e.includes(t)?!0:(console.error(`Basjoo: origin ${t||"(unknown)"} is not allowed for this agent (allowed: ${e.join(", ")})`),!1)}hasFinePointer(){return typeof window>"u"||typeof window.matchMedia!="function"?!1:window.matchMedia(S).matches}restoreOpenState(){this.hasFinePointer()&&this.storage.getItem(this.openStateStorageKey)==="open"&&this.open(!0)}async init(){if(!document.body){console.warn("[Basjoo Widget] document.body is not available yet. Call init() after DOMContentLoaded or place the embed code near the end of <body>.");return}if(document.getElementById("basjoo-widget-container")){console.warn("[Basjoo Widget] Initialization skipped because #basjoo-widget-container already exists. Avoid loading or initializing the widget twice on the same page.");return}if(M(window.location.pathname,this.embed?.excluded_paths)||!this.isOriginAllowed())return;let e=this.embed?.traffic_percentage;if(!(typeof e=="number"&&!_(this.config.agentId,e,this.storage))){if(await this.loadPublicConfig(),this.originalTitle=document.title,this.createStyles(),this.displayMode==="iframe"){this.mountIframe();return}if(this.displayMode==="inline"){if(!this.mountInline())return}else this.createContainer(),this.createButton();if(this.createChatWindow(),this.displayMode==="inline"?this.open(!0):(this.showGreetingBubble(),this.startTitleBlink()),this.startOnlineWatcher(),this.sessionId){this.loadHistory();return}!this.renderCards()&&this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date}),this.renderStarters(),this.restoreOpenState()}}mountInline(){let e=this.embed?.inline_container||x,t=this.resolveMountTarget(e);if(!t)return console.warn(`[Basjoo Widget] Inline mode found no container matching "${e}". Add an element with that selector, or change the install setting.`),!1;this.mountTarget=t;let n=document.createElement("div");return n.className="basjoo-inline-host",t.appendChild(n),this.container=n,!0}mountIframe(){let e=this.embed?.inline_container||x,t=this.resolveMountTarget(e);if(!t){console.warn(`[Basjoo Widget] iframe mode found no container matching "${e}". Add an element with that selector, or change the install setting.`);return}this.mountTarget=t;let n=document.createElement("div");n.className="basjoo-inline-host";let s=document.createElement("iframe");s.className="basjoo-inline-frame",s.title=this.config.title;let i=new URL("/widget-demo",`${this.config.apiBase}/`);i.searchParams.set("agent_id",this.config.agentId),s.src=i.toString(),n.appendChild(s),t.appendChild(n),this.container=n,this.iframeElement=s}resolveMountTarget(e){try{return document.querySelector(e)}catch{return console.warn(`[Basjoo Widget] Ignoring an invalid container selector: ${e}`),null}}renderCards(){let e=(this.embed?.cards||[]).filter(s=>!!s&&typeof s=="object");if(e.length===0||this.cardsRendered)return!1;let t=this.chatWindow?.querySelector(".basjoo-messages");if(!t)return!1;this.cardsRendered=!0;let n=document.createElement("div");n.className="basjoo-cards";for(let s of e){let i=document.createElement("div");i.className="basjoo-card";let o=y(s.logo);if(o){let h=document.createElement("img");h.className="basjoo-card-logo",h.src=o,h.alt="",i.appendChild(h)}let a=typeof s.heading=="string"?s.heading.trim():"";if(a){let h=document.createElement("div");h.className="basjoo-card-heading",h.textContent=a,i.appendChild(h)}let l=typeof s.text=="string"?s.text.trim():"";if(l){let h=document.createElement("div");h.className="basjoo-card-text",h.textContent=l,i.appendChild(h)}let c=s.chat??s.kb_search??s.form,d=typeof c=="string"?c.trim():"";if(d){let h=document.createElement("button");h.type="button",h.className="basjoo-card-action",h.textContent=a||d;let u=()=>{this.sendMessage(d)};this._cardActionListeners.push(u),h.addEventListener("click",u),i.appendChild(h)}n.appendChild(i)}return t.appendChild(n),t.scrollTop=t.scrollHeight,!0}renderStarters(){let e=(this.embed?.starters||[]).filter(i=>!!i&&typeof i.label=="string"&&i.label.trim().length>0);if(e.length===0)return;let t=e.filter(i=>I(i,window.location.pathname));if(t.length===0)return;let n=this.chatWindow?.querySelector(".basjoo-input-area");if(!n)return;let s=document.createElement("div");s.className="basjoo-starters";for(let i of t){let o=document.createElement("button");o.type="button",o.className="basjoo-starter",o.textContent=i.label||"";let a;if(i.action==="link"){let l=y(i.url??i.value);a=l?()=>{window.open(l,"_blank","noopener")}:()=>{console.warn(`[Basjoo Widget] Starter "${i.label}" has no usable link target.`)}}else{let l=(i.value??i.label??"").trim();a=()=>{this.sendMessage(l)}}this._starterClickListeners.push(a),o.addEventListener("click",a),s.appendChild(o)}n.parentNode?.insertBefore(s,n)}showGreetingBubble(){if(!this.button)return;let e=document.createElement("div");e.className="basjoo-greeting-bubble",e.textContent=this.getText("greetingBubble");let t=this.config.position;e.style.position="fixed",e.style.bottom="100px",e.style[t]="24px",e.style.zIndex="9999",document.body.appendChild(e),setTimeout(()=>{e.remove()},5e3)}async loadHistory(){if(this.sessionId){try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&visitor_id=${encodeURIComponent(this.visitorId)}`);if(!e.ok)throw new Error("Failed to load history");let t=await e.json();if(t&&t.length>0){for(let n of t)this.addMessage({role:n.role==="user"?"user":"assistant",content:n.content,sources:n.sources,timestamp:new Date}),n.id>this.lastMessageId&&(this.lastMessageId=n.id);this.startPolling();return}}catch{}this.sessionId=null,this.storage.removeItem(this.STORAGE_KEY),this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date})}}startTitleBlink(){if(this.titleBlinkInterval)return;this.hasUnread=!0,this.updateUnreadBadge();let e=!0;this.titleBlinkInterval=window.setInterval(()=>{document.title=e?this.originalTitle:"\u2757 "+this.getText("newMessage"),e=!e},1e3)}stopTitleBlink(){this.titleBlinkInterval&&(clearInterval(this.titleBlinkInterval),this.titleBlinkInterval=null),document.title=this.originalTitle,this.hasUnread=!1,this.updateUnreadBadge()}createStyles(){let e=document.createElement("style");e.id="basjoo-widget-styles";let t=this.effectiveTheme==="dark",n=t?"#1a1a2e":"white",s=t?"#e2e8f0":"#1f2937",i=t?"#94a3b8":"#6b7280",o=t?"rgba(148, 163, 184, 0.2)":"#e5e7eb",a=t?"#0f0f1a":"white",l=t?"#2d2d44":"#f3f4f6",c=t?"rgba(239, 68, 68, 0.2)":"#fef2f2";e.textContent=`
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

      #basjoo-chat-window {
        position: fixed;
        bottom: 96px;
        ${this.config.position==="left"?"left":"right"}: 24px;
        width: 380px;
        height: 600px;
        max-height: calc(100vh - 120px);
        background: ${n};
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

      .basjoo-header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      /* #43: "Talk to a human" \u2014 a labelled affordance, not icon-only. */
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
        background: ${t?"rgba(148, 163, 184, 0.16)":"#f1f5f9"};
        border-bottom: 1px solid ${o};
        color: ${s};
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
        color: ${t?s:this.adjustColor(this.config.themeColor,-30)};
        border-radius: 16px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
      }

      .basjoo-continue-ai:hover {
        background: ${this.hexToRgba(this.config.themeColor,.12)};
      }

      /* #44: the degraded notice \u2014 one small line, muted, no fill. */
      .basjoo-degraded {
        margin: -8px 0 0 0;
        padding: 0 4px;
        color: ${i};
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
        border: 1px solid ${o};
        border-radius: 12px;
        background: ${l};
      }

      .basjoo-card-logo {
        width: 28px;
        height: 28px;
        margin-bottom: 8px;
        border-radius: 6px;
        object-fit: contain;
      }

      .basjoo-card-heading {
        color: ${s};
        font-size: 14px;
        font-weight: 600;
        line-height: 1.4;
      }

      .basjoo-card-text {
        margin-top: 4px;
        color: ${i};
        font-size: 13px;
        line-height: 1.5;
      }

      .basjoo-card-action {
        margin-top: 8px;
        padding: 6px 12px;
        border: 1px solid ${o};
        border-radius: 999px;
        background: transparent;
        color: ${s};
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }

      .basjoo-card-action:hover {
        background: ${this.hexToRgba(this.config.themeColor,.12)};
      }

      /* #40: starters sit between the transcript and the composer. */
      .basjoo-starters {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 8px 16px;
        border-top: 1px solid ${o};
        flex-shrink: 0;
      }

      .basjoo-starter {
        padding: 6px 12px;
        border: 1px solid ${o};
        border-radius: 999px;
        background: ${a};
        color: ${s};
        font-size: 13px;
        cursor: pointer;
      }

      .basjoo-starter:hover {
        border-color: ${this.config.themeColor};
      }

      /* #43: outside business hours the composer is replaced by this. */
      .basjoo-away {
        padding: 16px 20px 24px 20px;
        border-top: 1px solid ${o};
        background: ${n};
        color: ${i};
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
        background: ${l};
        color: ${s};
        border-bottom-left-radius: 4px;
      }

      #basjoo-widget-container .basjoo-message-error .basjoo-message-content {
        background: ${c};
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
        background: ${n};
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
        color: ${s};
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
        background: ${c};
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
    `,document.head.appendChild(e)}adjustColor(e,t){let n=!1,s=e;s[0]==="#"&&(s=s.slice(1),n=!0);let i=parseInt(s,16),o=(i>>16)+t,a=(i>>8&255)+t,l=(i&255)+t;return o=Math.max(0,Math.min(255,o)),a=Math.max(0,Math.min(255,a)),l=Math.max(0,Math.min(255,l)),`${n?"#":""}${(o<<16|a<<8|l).toString(16).padStart(6,"0")}`}hexToRgba(e,t){let n=e.replace("#","");if(n.length===3){let[l,c,d]=n.split("");n=`${l}${l}${c}${c}${d}${d}`}let s=parseInt(n,16),i=s>>16&255,o=s>>8&255,a=s&255;return`rgba(${i}, ${o}, ${a}, ${t})`}updateUnreadBadge(){if(this.button){if(this.hasUnread){if(!this.unreadBadge){let e=document.createElement("span");e.className="basjoo-unread-badge",e.textContent="1",this.button.appendChild(e),this.unreadBadge=e}return}this.unreadBadge?.remove(),this.unreadBadge=null}}createContainer(){this.container=document.createElement("div"),this.container.id="basjoo-widget-container",document.body.appendChild(this.container)}createButton(){this.button=document.createElement("div"),this.button.id="basjoo-widget-button",this.button.innerHTML=`
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
    `,this._buttonClickListener=()=>this.toggle(),this.button.addEventListener("click",this._buttonClickListener),this.container.appendChild(this.button),this.updateUnreadBadge()}createChatWindow(){this.chatWindow=document.createElement("div"),this.chatWindow.id="basjoo-chat-window";let e=this.config.logoUrl?this.sanitizeUrlAttribute(this.config.logoUrl):"",t=this.escapeHtml(this.config.title),n=this.escapeHtml(this.getText("inputPlaceholder")),s=this.escapeHtml(this.getText("talkToHuman"));this.chatWindow.innerHTML=`
      <div class="basjoo-header">
        <div class="basjoo-header-title">
          ${e?`<img src="${e}" class="basjoo-header-logo" alt="">`:""}
          <span>${t}</span>
        </div>
        <div class="basjoo-header-actions">
          <button class="basjoo-human" type="button" aria-label="${s}" title="${s}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="8.5" cy="7" r="4"></circle>
              <polyline points="17 11 19 13 23 9"></polyline>
            </svg>
            <span class="basjoo-human-label">${s}</span>
          </button>
          <button class="basjoo-close" type="button" aria-label="${this.escapeHtml(this.getText("closeWindow"))}">
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
        <input type="text" class="basjoo-input" placeholder="${n}" maxlength="2000">
        <button class="basjoo-send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    `;let i=this.chatWindow.querySelector(".basjoo-close");this._closeBtnClickListener=()=>this.close(),i.addEventListener("click",this._closeBtnClickListener);let o=this.chatWindow.querySelector(".basjoo-input"),a=this.chatWindow.querySelector(".basjoo-send");this._sendBtnClickListener=()=>{if(this.isSending)return;let l=o.value.trim();if(l){if(l.length>2e3){this.showError(this.getText("messageTooLong"));return}this.sendMessage(l),o.value=""}},a.addEventListener("click",this._sendBtnClickListener),this._inputKeypressListener=l=>{l.key==="Enter"&&this._sendBtnClickListener?.()},o.addEventListener("keypress",this._inputKeypressListener),this.headerHumanButton=this.chatWindow.querySelector(".basjoo-human"),this._humanBtnClickListener=()=>{this.requestHumanHandoff()},this.headerHumanButton?.addEventListener("click",this._humanBtnClickListener),this.container.appendChild(this.chatWindow),this.applyBusinessHoursState(),this.renderModeNotice()}startOnlineWatcher(){this.onlineCheckIntervalId||(this.onlineCheckIntervalId=window.setInterval(()=>{this.refreshOnlineState()},6e4))}stopOnlineWatcher(){this.onlineCheckIntervalId&&(window.clearInterval(this.onlineCheckIntervalId),this.onlineCheckIntervalId=null)}async refreshOnlineState(){if(this.config.apiBase)try{let e=new URL(`${this.config.apiBase}/api/v1/config:public`);this.config.agentId&&e.searchParams.set("agent_id",this.config.agentId);let t=await fetch(e.toString());if(!t.ok)return;let n=await t.json(),s=n.online!==!1,i=(n.away_message||"").trim();if(s===this.isOnline&&i===this.awayMessage)return;this.isOnline=s,this.awayMessage=i,this.applyBusinessHoursState()}catch(e){console.warn("[Basjoo Widget] Could not refresh the business-hours state.",e)}}applyBusinessHoursState(){if(!this.chatWindow)return;let e=this.chatWindow.querySelector(".basjoo-input-area"),t=this.chatWindow.querySelector(".basjoo-away");if(this.isOnline)e&&(e.hidden=!1),t?.remove();else if(e&&(e.hidden=!0),t)t.textContent=this.awayMessage||this.getText("awayDefault");else{let n=document.createElement("div");n.className="basjoo-away",n.setAttribute("role","status"),n.textContent=this.awayMessage||this.getText("awayDefault"),this.chatWindow.appendChild(n)}this.headerHumanButton&&(this.headerHumanButton.hidden=!this.isOnline||this.sessionMode==="human")}renderModeNotice(){if(!this.chatWindow)return;let e=this.chatWindow.querySelector(".basjoo-notice");if(!e)return;if(this.sessionMode!=="human"){e.hidden=!0,e.textContent="",this.humanNoticeBar=null,this._continueAiClickListener=null,this.headerHumanButton&&(this.headerHumanButton.hidden=!this.isOnline);return}if(this.headerHumanButton&&(this.headerHumanButton.hidden=!0),this.humanNoticeBar===e)return;e.textContent="",e.hidden=!1;let t=document.createElement("span");t.className="basjoo-notice-text",t.textContent=this.getText("takenOverNotice");let n=document.createElement("button");n.type="button",n.className="basjoo-continue-ai",n.textContent=this.getText("continueWithAi"),this._continueAiClickListener=()=>{this.releaseToAi()},n.addEventListener("click",this._continueAiClickListener),e.appendChild(t),e.appendChild(n),this.humanNoticeBar=e}setSessionMode(e){this.sessionMode=e,this.applyBusinessHoursState(),this.renderModeNotice()}async requestHumanHandoff(){if(!this.sessionId){this.showError(this.getText("humanNeedsSession"));return}try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/escalate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent_id:this.config.agentId,session_id:this.sessionId,visitor_id:this.visitorId,reason:this.getText("talkToHuman")})});if(!e.ok)throw new Error(`HTTP ${e.status}`);this.setSessionMode("human"),this.addMessage({role:"assistant",content:this.getText("takenOverNotice"),timestamp:new Date}),this.startPolling()}catch(e){console.error("[Basjoo Widget] Failed to request a human handoff:",e),this.showError(this.getText("humanFailed"))}}async releaseToAi(){if(this.sessionId)try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/release`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent_id:this.config.agentId,session_id:this.sessionId,visitor_id:this.visitorId})});if(!e.ok)throw new Error(`HTTP ${e.status}`);this.setSessionMode("ai")}catch(e){console.error("[Basjoo Widget] Failed to release the session to AI:",e),this.showError(this.getText("humanFailed"))}}toggle(){if(this.isOpen){this.close();return}this.open()}open(e=!1){this.isOpen=!0,this.chatWindow?.classList.remove("closing"),this.chatWindow?.classList.add("open"),this.persistOpenState(),this.stopTitleBlink(),this.updateUnreadBadge();let t=this.chatWindow?.querySelector(".basjoo-input");setTimeout(()=>{t&&!t.closest(".basjoo-input-area[hidden]")&&!e&&t.focus()},300)}close(){this.isOpen=!1,this.chatWindow?.classList.remove("open"),this.chatWindow?.classList.add("closing"),this.persistOpenState()}persistOpenState(){this.hasFinePointer()&&this.storage.setItem(this.openStateStorageKey,this.isOpen?"open":"closed")}getRequestLocale(){return this.config.language&&this.config.language!=="auto"?this.config.language:navigator.language||"en-US"}getText(e){let t={sendFailed:{"en-US":"Send failed, please try again later","zh-CN":"\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"},networkError:{"en-US":"Network connection failed, please check your connection","zh-CN":"\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC"},quotaExceeded:{"en-US":"Daily message limit reached","zh-CN":"\u4ECA\u65E5\u6D88\u606F\u5DF2\u8FBE\u4E0A\u9650"},takenOverNotice:{"en-US":"Your conversation has been transferred to a human agent. Please wait for their reply.","zh-CN":"\u5DF2\u8F6C\u63A5\u4EBA\u5DE5\u5BA2\u670D\uFF0C\u8BF7\u7B49\u5F85\u56DE\u590D\u3002"},inputPlaceholder:{"en-US":"Type your question...","zh-CN":"\u8F93\u5165\u60A8\u7684\u95EE\u9898..."},messageTooLong:{"en-US":"Message too long (max 2000 characters)","zh-CN":"\u6D88\u606F\u8FC7\u957F\uFF08\u6700\u591A2000\u5B57\u7B26\uFF09"},greetingBubble:{"en-US":"Hi! How can I help you?","zh-CN":"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u60A8\uFF1F"},newMessage:{"en-US":"New message","zh-CN":"\u65B0\u6D88\u606F"},thinking:{"en-US":"Thinking...","zh-CN":"\u601D\u8003\u4E2D..."},references:{"en-US":"References","zh-CN":"\u53C2\u8003\u6765\u6E90"},talkToHuman:{"en-US":"Talk to a human","zh-CN":"\u8F6C\u4EBA\u5DE5"},continueWithAi:{"en-US":"Continue with AI","zh-CN":"\u7EE7\u7EED\u7531 AI \u56DE\u7B54"},awayDefault:{"en-US":"We are away right now. Leave a message and we will get back to you.","zh-CN":"\u5F53\u524D\u975E\u670D\u52A1\u65F6\u95F4\uFF0C\u8BF7\u7559\u8A00\uFF0C\u6211\u4EEC\u4F1A\u5C3D\u5FEB\u56DE\u590D\u3002"},closeWindow:{"en-US":"Close","zh-CN":"\u5173\u95ED"},humanNeedsSession:{"en-US":"Send a message first, then you can ask for a human.","zh-CN":"\u8BF7\u5148\u53D1\u9001\u4E00\u6761\u6D88\u606F\uFF0C\u7136\u540E\u518D\u8F6C\u4EBA\u5DE5\u3002"},humanFailed:{"en-US":"Could not reach a human agent. Please try again.","zh-CN":"\u8F6C\u4EBA\u5DE5\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"},degradedNotice:{"en-US":"Quota reached \u2014 answering with the fallback model","zh-CN":"\u989D\u5EA6\u7528\u5C3D\uFF0C\u5DF2\u4F7F\u7528\u5907\u7528\u6A21\u578B"}};return this.getRequestLocale().toLowerCase().startsWith("zh")?t[e]["zh-CN"]||t[e]["en-US"]||e:t[e]["en-US"]||t[e]["zh-CN"]||e}escapeHtml(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}sanitizeUrlAttribute(e){try{let t=new URL(e);if(t.protocol==="http:"||t.protocol==="https:")return this.escapeHtml(e)}catch{}return""}renderMarkdown(e){if(!e)return"";let t=e.replace(/\r\n/g,`
`).split(/\n{2,}/).map(i=>i.trim()).filter(Boolean),n=i=>{let o=this.escapeHtml(i);return o=o.replace(/`([^`]+)`/g,"<code>$1</code>"),o=o.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>"),o=o.replace(/__([^_]+)__/g,"<strong>$1</strong>"),o=o.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g,"$1<em>$2</em>"),o=o.replace(/(^|[^_])_([^_]+)_(?!_)/g,"$1<em>$2</em>"),o=o.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(a,l,c)=>{let d=l,h=this.sanitizeUrlAttribute(c);return h?`<a href="${h}" target="_blank" rel="noopener noreferrer">${d}</a>`:d}),o};return t.map(i=>{if(/^```/.test(i)&&/```$/.test(i)){let o=i.replace(/^```\w*\n?/,"").replace(/```$/,"");return`<pre><code>${this.escapeHtml(o)}</code></pre>`}if(/^(?:[-*]\s.+\n?)+$/.test(i))return`<ul>${i.split(`
`).map(a=>a.replace(/^[-*]\s+/,"").trim()).filter(Boolean).map(a=>`<li>${n(a)}</li>`).join("")}</ul>`;if(/^(?:\d+\.\s.+\n?)+$/.test(i))return`<ol>${i.split(`
`).map(a=>a.replace(/^\d+\.\s+/,"").trim()).filter(Boolean).map(a=>`<li>${n(a)}</li>`).join("")}</ol>`;if(/^>\s?/.test(i)){let o=i.split(`
`).map(a=>a.replace(/^>\s?/,"")).join("<br>");return`<blockquote>${n(o)}</blockquote>`}if(/^#{1,6}\s/.test(i)){let o=i.replace(/^#{1,6}\s+/,"");return`<p><strong>${n(o)}</strong></p>`}return`<p>${n(i).replace(/\n/g,"<br>")}</p>`}).join("")}updateMessageContent(e,t,n=!1){e.innerHTML=this.renderMarkdown(t)+(n?'<span class="basjoo-stream-cursor"></span>':"")}createMessageElement(e){let t=document.createElement("div");t.className=`basjoo-message basjoo-message-${e.role}`;let n=document.createElement("div");if(n.className="basjoo-message-content",e.role==="assistant"){let i=v(e.content,e.sources),o=i.references.length>0?`

**${this.getText("references")}**
${i.references.map(a=>`- [${a.title}](${a.url})`).join(`
`)}`:"";this.updateMessageContent(n,i.content+o)}else this.updateMessageContent(n,e.content);t.appendChild(n);let s=document.createElement("div");return s.className="basjoo-message-time",s.textContent=e.timestamp.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),t.appendChild(s),t}formatThinkingText(){return`${this.getText("thinking")} ${this.thinkingElapsed}s`}showThinkingIndicator(e=0){this.hideLoading(),this.currentStreamContent.trim()||(this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null),this.thinkingElapsed=e;let t=this.chatWindow?.querySelector(".basjoo-messages");if(t){if(!this.thinkingIndicator){let n=document.createElement("div");n.className="basjoo-thinking",n.innerHTML=`
        <span class="basjoo-thinking-spinner"></span>
        <span>${this.getText("thinking")}</span>
      `,t.appendChild(n),this.thinkingIndicator=n,this.thinkingIndicatorText=n.querySelector("span:last-child")}this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText()),t.scrollTop=t.scrollHeight,this.thinkingTimerId===null&&(this.thinkingTimerId=window.setInterval(()=>{this.thinkingElapsed+=1,this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText())},1e3))}}hideThinkingIndicator(){this.thinkingTimerId!==null&&(window.clearInterval(this.thinkingTimerId),this.thinkingTimerId=null),this.thinkingIndicator?.remove(),this.thinkingIndicator=null,this.thinkingIndicatorText=null,this.thinkingElapsed=0}removeStreamingMessage(){this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}createStreamingMessage(e=!1){let t=this.chatWindow?.querySelector(".basjoo-messages"),n=document.createElement("div");n.className="basjoo-message basjoo-message-assistant";let s=document.createElement("div");return s.className="basjoo-message-content",this.updateMessageContent(s,this.currentStreamContent,e),n.appendChild(s),t?(t.appendChild(n),t.scrollTop=t.scrollHeight,this.streamingMessage=n,this.streamingMessageContent=s,this.currentStreamContent="",n):(this.streamingMessage=n,this.streamingMessageContent=s,this.currentStreamContent="",n)}appendToStreamingMessage(e){(!this.streamingMessage||!this.streamingMessageContent)&&(this.hideThinkingIndicator(),this.createStreamingMessage()),this.currentStreamContent+=e,this.streamingMessageContent&&this.updateMessageContent(this.streamingMessageContent,this.currentStreamContent,!0);let t=this.chatWindow?.querySelector(".basjoo-messages");t&&(t.scrollTop=t.scrollHeight)}finalizeStreamingMessage(e=[]){if(!this.streamingMessage||!this.streamingMessageContent)return;if(!this.currentStreamContent.trim()){this.removeStreamingMessage();return}this.streamingMessage.querySelector(".basjoo-stream-cursor")?.remove(),this.currentStreamSources=e;let n=v(this.currentStreamContent,e),s=n.references.length>0?`

**${this.getText("references")}**
${n.references.map(a=>`- [${a.title}](${a.url})`).join(`
`)}`:"",i=n.content+s;this.updateMessageContent(this.streamingMessageContent,i),this.messages.push({role:"assistant",content:i,sources:e,timestamp:new Date});let o=this.chatWindow?.querySelector(".basjoo-messages");o.scrollTop=o.scrollHeight,this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}addMessage(e){this.messages.push(e);let t=this.chatWindow?.querySelector(".basjoo-messages");if(!e.content){console.error("Message content is null or undefined:",e);return}if(!t)return;let n=this.createMessageElement(e);t.appendChild(n),t.scrollTop=t.scrollHeight,e.role==="assistant"&&!this.isOpen&&(this.hasUnread=!0,this.updateUnreadBadge())}showLoading(){let e=this.chatWindow?.querySelector(".basjoo-messages");if(!e)return;let t=document.createElement("div");t.className="basjoo-loading",t.id="basjoo-loading",t.innerHTML=`
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
    `,e.appendChild(t),e.scrollTop=e.scrollHeight}hideLoading(){this.chatWindow?.querySelector("#basjoo-loading")?.remove()}showError(e){let t=this.chatWindow?.querySelector(".basjoo-messages");if(!t)return;let n=document.createElement("div");n.className="basjoo-error",n.textContent=e,t.appendChild(n),t.scrollTop=t.scrollHeight,setTimeout(()=>n.remove(),5e3)}showDegradedNotice(e){let t=this.chatWindow?.querySelector(".basjoo-messages");if(!t)return;let n=document.createElement("div");n.className="basjoo-degraded",n.setAttribute("role","status"),n.textContent=e?`${this.getText("degradedNotice")} \xB7 ${e}`:this.getText("degradedNotice"),t.appendChild(n),t.scrollTop=t.scrollHeight}startPolling(){this.pollIntervalId||(this.pollIntervalId=window.setInterval(()=>this.pollMessages(),3e3))}stopPolling(){this.pollIntervalId&&(clearInterval(this.pollIntervalId),this.pollIntervalId=null)}async pollMessages(){if(this.sessionId)try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&visitor_id=${encodeURIComponent(this.visitorId)}&after_id=${this.lastMessageId}&role=assistant`);if(!e.ok)return;let t=await e.json();for(let n of t)n.content&&(this.addMessage({role:n.role==="user"?"user":"assistant",content:n.content,sources:n.sources,timestamp:new Date}),this.isOpen||this.startTitleBlink()),n.id>this.lastMessageId&&(this.lastMessageId=n.id)}catch{}}cleanupAfterStreamError(){this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage()}async consumeStream(e){if(!e.body)throw new Error("Streaming response body is unavailable");let t=e.body.getReader(),n=new TextDecoder,s="",i=!1,o=c=>{if(!c.trim())return;let d="message",h=[];for(let g of c.split(`
`))g.startsWith("event:")?d=g.slice(6).trim():g.startsWith("data:")&&h.push(g.slice(5).trimStart());if(!h.length)return;let u=JSON.parse(h.join(`
`));switch(d){case"sources":this.currentStreamSources=Array.isArray(u.sources)?u.sources:[];break;case"thinking":this.showThinkingIndicator(typeof u.elapsed=="number"?u.elapsed:0);break;case"thinking_done":this.hideThinkingIndicator();break;case"content":{let g=u.content||"";this.appendToStreamingMessage(g);break}case"done":{let g=u;g.session_id&&(this.sessionId=g.session_id,this.storage.setItem(this.STORAGE_KEY,g.session_id),this.startPolling()),typeof g.message_id=="number"&&g.message_id>this.lastMessageId&&(this.lastMessageId=g.message_id),g.taken_over?(this.removeStreamingMessage(),this.setSessionMode("human"),this.addMessage({role:"assistant",content:this.getText("takenOverNotice"),timestamp:new Date})):(g.mode==="human"&&this.setSessionMode("human"),this.finalizeStreamingMessage(this.currentStreamSources),g.degraded&&this.showDegradedNotice(g.model),this.isOpen||this.startTitleBlink()),i=!0;break}case"error":{let g=u,b=new Error(g.error||"Stream failed");throw g.code&&(b.name=g.code),b}default:break}},a=()=>{let c=s.indexOf(`\r
\r
`),d=s.indexOf(`

`);return c===-1&&d===-1?null:c===-1?{index:d,length:2}:d===-1?{index:c,length:4}:c<d?{index:c,length:4}:{index:d,length:2}},l=9e4;for(;!i;){if(this.streamAbortController?.signal.aborted){t.cancel();return}let c=null;try{let{done:d,value:h}=await Promise.race([t.read(),new Promise((g,b)=>{c=window.setTimeout(()=>b(new Error("Stream read timeout")),l)})]);s+=n.decode(h||new Uint8Array,{stream:!d});let u=a();for(;u;){let g=s.slice(0,u.index);if(s=s.slice(u.index+u.length),o(g.replace(/\r\n/g,`
`)),i)break;u=a()}if(d)break}finally{c!==null&&window.clearTimeout(c)}}if(!i&&(s.trim()&&o(s),!i))throw new Error("Stream ended unexpectedly")}abortStream(){this.streamAbortController?.abort(),this.streamAbortController=null}async sendMessageWithRetry(e){let t=null;for(let n=0;n<=1;n++){this.abortStream(),this.streamAbortController=new AbortController;try{let s=Intl.DateTimeFormat().resolvedOptions().timeZone,i=await fetch(`${this.config.apiBase}/api/v1/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},signal:this.streamAbortController.signal,body:JSON.stringify({agent_id:this.config.agentId,message:e,locale:this.getRequestLocale(),session_id:this.sessionId||void 0,visitor_id:this.visitorId,timezone:s,context_before:r.pageContext.before||void 0,context_after:r.pageContext.after||void 0})});if(!i.ok){let o=`HTTP ${i.status}: ${i.statusText}`;try{let a=await i.json();o=a.message||a.detail||o}catch{}throw new Error(o)}this.hideLoading(),await this.consumeStream(i);return}catch(s){t=s;let i=String(s?.message||"");if(!(!(this.currentStreamContent.trim().length>0)&&(s instanceof TypeError||i.includes("fetch")||i.includes("Failed to fetch")||i.includes("Stream ended unexpectedly")))||n>=1)throw this.cleanupAfterStreamError(),s;this.cleanupAfterStreamError(),console.warn(`[Basjoo Widget] Stream attempt ${n+1} failed, retrying...`),await new Promise(l=>window.setTimeout(l,1e3)),this.showLoading()}}throw t}async sendMessage(e){if(!this.isSending){this.isSending=!0,this.addMessage({role:"user",content:e,timestamp:new Date}),this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage(),this.createStreamingMessage(!0);try{await this.sendMessageWithRetry(e)}catch(t){console.error("[Basjoo Widget] Error sending message:",t);let n=this.getText("sendFailed"),s="",i=String(t?.message||"");t instanceof TypeError||i.includes("fetch")?(n=this.getText("networkError"),s=`Request may be blocked by CORS, network connectivity, or an incorrect apiBase. Current apiBase: ${this.config.apiBase||"(not set)"}`):i.includes("429")||i.toLowerCase().includes("quota")?n=this.getText("quotaExceeded"):t?.name==="ORIGIN_NOT_ALLOWED"||i.toLowerCase().includes("widget origin not allowed")?(n=this.getText("sendFailed"),s="Widget request was blocked because the current page origin is not on the allowed domain list."):i.includes("401")&&(s="Authentication failed. Please check the agent configuration and public API access."),this.config.apiBase||(s="apiBase could not be determined. When embedding the widget from a local file, set apiBase explicitly or load the SDK from the target server."),s&&console.error("[Basjoo Widget]",s),this.showError(n)}finally{this.isSending=!1}}}destroy(){this.stopPolling(),this.stopTitleBlink(),this.stopOnlineWatcher(),this.hideThinkingIndicator(),this.removeStreamingMessage(),this.abortStream(),this.button&&this._buttonClickListener&&this.button.removeEventListener("click",this._buttonClickListener);let e=this.chatWindow?.querySelector(".basjoo-close");e&&this._closeBtnClickListener&&e.removeEventListener("click",this._closeBtnClickListener);let t=this.chatWindow?.querySelector(".basjoo-send");t&&this._sendBtnClickListener&&t.removeEventListener("click",this._sendBtnClickListener);let n=this.chatWindow?.querySelector(".basjoo-input");n&&this._inputKeypressListener&&n.removeEventListener("keypress",this._inputKeypressListener),this.headerHumanButton&&this._humanBtnClickListener&&this.headerHumanButton.removeEventListener("click",this._humanBtnClickListener);let s=this.humanNoticeBar?.querySelector(".basjoo-continue-ai");s&&this._continueAiClickListener&&s.removeEventListener("click",this._continueAiClickListener),this.humanNoticeBar=null,this.headerHumanButton=null,this._cardActionListeners=[],this._starterClickListeners=[],this.iframeElement=null,this.mountTarget=null,this.container?.remove(),document.getElementById("basjoo-widget-styles")?.remove()}};window.BasjooWidget=f;window.Basjoo={Widget:f,setContext:r=>f.setContext(r),init:r=>{let e=new f(r);return e.init(),e}};function m(r,e){for(let t of e){let n=r.get(t);if(n&&n.trim())return n.trim()}return null}function B(){if(document.currentScript instanceof HTMLScriptElement)return document.currentScript;let r=Array.from(document.querySelectorAll("script[src]"));for(let e=r.length-1;e>=0;e-=1){let t=r[e],n=t.getAttribute("src")||"";if(n.includes("sdk.js"))try{let s=new URL(n,window.location.href);if(m(s.searchParams,p.agentId))return t}catch{continue}}return null}function $(r){let e=r.getAttribute("src")||r.src;if(!e)return null;let t;try{t=new URL(e,window.location.href)}catch{return null}let n=m(t.searchParams,p.agentId);if(!n)return null;let s={agentId:n},i=m(t.searchParams,p.apiBase);i&&(s.apiBase=i);let o=m(t.searchParams,p.themeColor);o&&(s.themeColor=o);let a=m(t.searchParams,p.welcomeMessage);a&&(s.welcomeMessage=a);let l=m(t.searchParams,p.language);l&&(s.language=l);let c=m(t.searchParams,p.position);(c==="left"||c==="right")&&(s.position=c);let d=m(t.searchParams,p.theme);return(d==="light"||d==="dark"||d==="auto")&&(s.theme=d),s}(function(){let e=window,t=j();if(t&&typeof t.agent_id=="string"&&t.agent_id){if(e.__basjooWidgetAutoInitScheduled)return;e.__basjooWidgetAutoInitScheduled=!0;let o=()=>{new f({agentId:t.agent_id}).init()};if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",o,{once:!0});return}o();return}let n=B();if(!n)return;let s=$(n);if(!s||e.__basjooWidgetAutoInitScheduled)return;e.__basjooWidgetAutoInitScheduled=!0;let i=()=>{new f(s).init()};if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",i,{once:!0});return}i()})();})();
//# sourceMappingURL=basjoo-widget.min.js.map
