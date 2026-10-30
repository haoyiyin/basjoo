"use strict";(()=>{function v(r,e=[]){if(!r)return{content:r,references:[]};let t=[],i=new Set,s=new Map;for(let a of e)a.type!=="url"||typeof a.url!="string"||!/^https?:\/\//.test(a.url)||s.has(a.url)||s.set(a.url,a);let n=a=>{if(i.has(a))return;i.add(a);let l=s.get(a);t.push({title:l?.title?.trim()||a,url:a})};return{content:r.replace(/\[([^\]]+)\]\((#source-(\d+)|https?:\/\/[^\s)]+)\)/g,(a,l,d,c)=>{if(c){let h=Number(c)-1,u=e[h];return u&&u.type==="url"&&u.url&&/^https?:\/\//.test(u.url)&&n(u.url),l}return s.has(d)?(n(d),l):a}),references:t}}var m={agentId:["agentId","agent_id"],apiBase:["apiBase","api_base"],themeColor:["themeColor","theme_color"],welcomeMessage:["welcomeMessage","welcome_message"],language:["language","locale"],position:["position"],theme:["theme"]};function C(r){if(!r)return"/basjoo-logo.png";try{return new URL("/basjoo-logo.png",`${r}/`).toString()}catch{return"/basjoo-logo.png"}}var x="#basjoo-chat",S="(pointer: fine)",I="basjoo_open_",k="basjoo_rollout_";function j(){let r=window.__BASJOO_CONFIG__;return!r||typeof r!="object"?null:r}function T(r){if(typeof r!="string")return!1;let e=r.lastIndexOf(":");if(e<=0)return!1;let t=r.slice(e+1);return t.length===64&&/^[0-9a-f]{64}$/.test(t)}function M(r,e){if(!Array.isArray(e))return!1;for(let t of e)if(!(typeof t!="string"||!t))try{if(new RegExp(t).test(r))return!0}catch{console.warn(`[Basjoo Widget] Ignoring an invalid excluded_paths pattern: ${t}`)}return!1}function E(r,e){let t=typeof r.path=="string"?r.path.trim():"";if(!t)return!0;try{return new RegExp(t).test(e)}catch{return console.warn(`[Basjoo Widget] Ignoring an invalid starter path pattern: ${t}`),!0}}function _(){try{return window.location.origin}catch{return""}}function B(r,e,t){if(e>=100)return!0;if(e<=0)return!1;let i=`${k}${r}`,s=t.getItem(i);if(s==="in")return!0;if(s==="out")return!1;let n=Math.random()*100<e;return t.setItem(i,n?"in":"out"),n}function y(r){if(typeof r!="string"||!r.trim())return"";let e=r.trim();try{let t=new URL(e,window.location.href);return t.protocol!=="http:"&&t.protocol!=="https:"?"":t.toString()}catch{return""}}var w=class{constructor(){this.memoryStore=new Map;this.storageAvailable=null}isAvailable(){if(this.storageAvailable!==null)return this.storageAvailable;try{let e="__storage_test__";return window.localStorage.setItem(e,"test"),window.localStorage.removeItem(e),this.storageAvailable=!0,!0}catch{return this.storageAvailable=!1,!1}}getItem(e){if(this.isAvailable())try{return window.localStorage.getItem(e)}catch{}return this.memoryStore.get(e)??null}setItem(e,t){if(this.isAvailable())try{window.localStorage.setItem(e,t);return}catch{}this.memoryStore.set(e,t)}removeItem(e){if(this.isAvailable())try{window.localStorage.removeItem(e);return}catch{}this.memoryStore.delete(e)}},p=class r{constructor(e){this.container=null;this.button=null;this.unreadBadge=null;this.chatWindow=null;this.messages=[];this.sessionId=null;this.isOpen=!1;this.VISITOR_STORAGE_KEY="basjoo_visitor_id";this.identitySigned=!1;this.identityRequired=!1;this.effectiveTheme="light";this.originalTitle="";this.titleBlinkInterval=null;this.hasUnread=!1;this.pollIntervalId=null;this.lastMessageId=0;this.isSending=!1;this.streamAbortController=null;this.streamingMessage=null;this.streamingMessageContent=null;this.thinkingIndicator=null;this.thinkingIndicatorText=null;this.thinkingElapsed=0;this.thinkingTimerId=null;this.currentStreamContent="";this.currentStreamSources=[];this.sessionMode="ai";this.isOnline=!0;this.awayMessage="";this.humanNoticeBar=null;this.headerHumanButton=null;this.onlineCheckIntervalId=null;this._buttonClickListener=null;this._closeBtnClickListener=null;this._sendBtnClickListener=null;this._inputKeypressListener=null;this._humanBtnClickListener=null;this._continueAiClickListener=null;this.displayMode="bubble";this.mountTarget=null;this.iframeElement=null;this.cardsRendered=!1;this._cardActionListeners=[];this._starterClickListeners=[];this.embed=j();let t=this.embed?.agent_id,i=this.embed?.api_base,s=this.detectApiBase(e.apiBase||i),n=e.agentId||t||"";if(this.hasTitleOverride=typeof e.title=="string"&&e.title.trim().length>0,this.hasWelcomeMessageOverride=typeof e.welcomeMessage=="string"&&e.welcomeMessage.trim().length>0,this.config={agentId:n,apiBase:s,themeColor:e.themeColor||"",logoUrl:e.logoUrl||C(s),title:e.title||"AI\u52A9\u624B",welcomeMessage:e.welcomeMessage||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F",language:e.language||"auto",position:e.position||"right",theme:e.theme||"auto"},this.STORAGE_KEY=`basjoo_session_${this.config.agentId}`,this.openStateStorageKey=`${I}${this.config.agentId}`,this.storage=new w,this.sessionId=this.storage.getItem(this.STORAGE_KEY),this.visitorId=this.storage.getItem(this.VISITOR_STORAGE_KEY)||this.generateVisitorId(),this.identitySigned=T(this.visitorId),r.instances.push(this),r.pendingIdentity!==void 0){let a=r.pendingIdentity;r.pendingIdentity=void 0,this.identify(a)}let o=this.embed?.display_mode;this.displayMode=o==="inline"||o==="iframe"?o:"bubble",this.effectiveTheme=this.getEffectiveTheme()}static{this.pageContext={before:"",after:""}}static{this.instances=[]}static{this.pendingIdentity=void 0}static setContext(e){let t=e&&typeof e=="object"?e:{};r.pageContext={before:typeof t.before=="string"?t.before:"",after:typeof t.after=="string"?t.after:""}}static applyIdentity(e){r.instances=r.instances.filter(t=>t.container?.isConnected??!1),r.instances.length===0&&(r.pendingIdentity=e??null);for(let t of r.instances.slice())t.identify(e??null)}identify(e){if(e==null){this.identitySigned=!1;let n=this.generateVisitorId();this.visitorId=n,this.clearSessionForIdentityChange(),this.applyBusinessHoursState(),this.renderModeNotice();return}let t=typeof e.email=="string"?e.email.trim().toLowerCase():"",i=typeof e.hash=="string"?e.hash.trim().toLowerCase():"";if(!t||!i){console.warn("[Basjoo Widget] identify() needs both `email` and `hash`; ignoring.",e);return}let s=`${t}:${i}`;s!==this.visitorId&&(this.visitorId=s,this.identitySigned=!0,this.storage.setItem(this.VISITOR_STORAGE_KEY,s),this.clearSessionForIdentityChange(),this.applyBusinessHoursState(),this.renderModeNotice(),this.chatWindow&&this.resumeIdentitySession())}clearSessionForIdentityChange(){this.sessionId=null,this.lastMessageId=0,this.storage.removeItem(this.STORAGE_KEY),this.stopPolling()}async resumeIdentitySession(){if(!this.identitySigned||!this.visitorId)return!1;try{let e=new URL(`${this.config.apiBase}/api/v1/chat/session:current`);e.searchParams.set("agent_id",this.config.agentId),e.searchParams.set("visitor_id",this.visitorId);let t=await fetch(e.toString());if(!t.ok)return!1;let i=await t.json();return i.session_id?(this.sessionId=i.session_id,this.storage.setItem(this.STORAGE_KEY,i.session_id),await this.loadHistory(),!0):!1}catch(e){return console.warn("[Basjoo Widget] Could not resume the signed-in visitor history.",e),!1}}generateVisitorId(){let e=`visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,11)}`;return this.storage.setItem(this.VISITOR_STORAGE_KEY,e),e}detectApiBase(e){if(e)try{let n=new URL(e,window.location.href);if((n.protocol==="http:"||n.protocol==="https:")&&n.port==="3000"){let o=`${n.protocol}//${n.hostname}:8000`;return console.info("[Basjoo Widget] Rewriting configured dev apiBase to direct backend:",o),o}return n.toString().replace(/\/$/,"")}catch{return e}let t=document.currentScript;if(t instanceof HTMLScriptElement&&t.src)try{let n=new URL(t.src,window.location.href);return console.info("[Basjoo Widget] Detected API base from current script:",n.origin),n.origin}catch{}let i=document.querySelectorAll("script[src]");for(let n of i){let o=n.getAttribute("src")||"";if(!(!o.includes("sdk.js")&&!o.includes("basjoo")))try{let a=new URL(o,window.location.href);return console.info("[Basjoo Widget] Detected API base from script src:",a.origin),a.origin}catch{}}let s=window.location.port;if(s==="3000"||s==="5173"){let n=`${window.location.protocol}//${window.location.hostname}:8000`;return console.info("[Basjoo Widget] Development mode detected, using:",n),n}return window.location.protocol==="file:"?(console.error("[Basjoo Widget] Cannot determine API base from a local file. Please set apiBase explicitly."),""):(console.warn("[Basjoo Widget] Falling back to window.location.origin. Set apiBase explicitly if the API is hosted elsewhere."),window.location.origin)}getEffectiveTheme(){return this.config.theme==="light"||this.config.theme==="dark"?this.config.theme:typeof window<"u"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}async loadPublicConfig(){if(!this.config.apiBase){console.warn("[Basjoo Widget] Skipping public config fetch because apiBase could not be determined.");return}try{let e=new URL(`${this.config.apiBase}/api/v1/config:public`);this.config.agentId&&e.searchParams.set("agent_id",this.config.agentId);let t=await fetch(e.toString());if(!t.ok)throw new Error(`HTTP ${t.status}: ${t.statusText}`);let i=await t.json();!this.config.agentId&&i.default_agent_id&&(this.config.agentId=i.default_agent_id),this.config.themeColor=this.config.themeColor||i.widget_color||"#3B82F6",this.hasTitleOverride||(this.config.title=i.widget_title||"AI\u52A9\u624B"),this.hasWelcomeMessageOverride||(this.config.welcomeMessage=i.welcome_message||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F"),this.isOnline=i.online!==!1,this.awayMessage=(i.away_message||"").trim(),this.identityRequired=i.identity_required===!0,this.effectiveTheme=this.getEffectiveTheme()}catch(e){console.warn("[Basjoo Widget] Failed to load public config, using defaults.",e),e instanceof TypeError&&console.warn("[Basjoo Widget] Public config request may be blocked by CORS, network issues, or an incorrect apiBase:",this.config.apiBase)}}isOriginAllowed(){let e=(this.embed?.allowed_domains||[]).filter(i=>typeof i=="string"&&i.length>0);if(e.length===0)return!0;let t=_();return e.includes(t)?!0:(console.error(`Basjoo: origin ${t||"(unknown)"} is not allowed for this agent (allowed: ${e.join(", ")})`),!1)}hasFinePointer(){return typeof window>"u"||typeof window.matchMedia!="function"?!1:window.matchMedia(S).matches}restoreOpenState(){this.hasFinePointer()&&this.storage.getItem(this.openStateStorageKey)==="open"&&this.open(!0)}async init(){if(!document.body){console.warn("[Basjoo Widget] document.body is not available yet. Call init() after DOMContentLoaded or place the embed code near the end of <body>.");return}if(document.getElementById("basjoo-widget-container")){console.warn("[Basjoo Widget] Initialization skipped because #basjoo-widget-container already exists. Avoid loading or initializing the widget twice on the same page.");return}if(M(window.location.pathname,this.embed?.excluded_paths)||!this.isOriginAllowed())return;let e=this.embed?.traffic_percentage;if(!(typeof e=="number"&&!B(this.config.agentId,e,this.storage))){if(await this.loadPublicConfig(),this.originalTitle=document.title,this.createStyles(),this.displayMode==="iframe"){this.mountIframe();return}if(this.displayMode==="inline"){if(!this.mountInline())return}else this.createContainer(),this.createButton();if(this.createChatWindow(),this.displayMode==="inline"?this.open(!0):(this.showGreetingBubble(),this.startTitleBlink()),this.startOnlineWatcher(),this.sessionId){this.loadHistory();return}if(this.identitySigned&&await this.resumeIdentitySession()){this.restoreOpenState();return}!this.renderCards()&&this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date}),this.renderStarters(),this.restoreOpenState()}}mountInline(){let e=this.embed?.inline_container||x,t=this.resolveMountTarget(e);if(!t)return console.warn(`[Basjoo Widget] Inline mode found no container matching "${e}". Add an element with that selector, or change the install setting.`),!1;this.mountTarget=t;let i=document.createElement("div");return i.className="basjoo-inline-host",t.appendChild(i),this.container=i,!0}mountIframe(){let e=this.embed?.inline_container||x,t=this.resolveMountTarget(e);if(!t){console.warn(`[Basjoo Widget] iframe mode found no container matching "${e}". Add an element with that selector, or change the install setting.`);return}this.mountTarget=t;let i=document.createElement("div");i.className="basjoo-inline-host";let s=document.createElement("iframe");s.className="basjoo-inline-frame",s.title=this.config.title;let n=new URL("/widget-demo",`${this.config.apiBase}/`);n.searchParams.set("agent_id",this.config.agentId),s.src=n.toString(),i.appendChild(s),t.appendChild(i),this.container=i,this.iframeElement=s}resolveMountTarget(e){try{return document.querySelector(e)}catch{return console.warn(`[Basjoo Widget] Ignoring an invalid container selector: ${e}`),null}}renderCards(){let e=(this.embed?.cards||[]).filter(s=>!!s&&typeof s=="object");if(e.length===0||this.cardsRendered)return!1;let t=this.chatWindow?.querySelector(".basjoo-messages");if(!t)return!1;this.cardsRendered=!0;let i=document.createElement("div");i.className="basjoo-cards";for(let s of e){let n=document.createElement("div");n.className="basjoo-card";let o=y(s.logo);if(o){let h=document.createElement("img");h.className="basjoo-card-logo",h.src=o,h.alt="",n.appendChild(h)}let a=typeof s.heading=="string"?s.heading.trim():"";if(a){let h=document.createElement("div");h.className="basjoo-card-heading",h.textContent=a,n.appendChild(h)}let l=typeof s.text=="string"?s.text.trim():"";if(l){let h=document.createElement("div");h.className="basjoo-card-text",h.textContent=l,n.appendChild(h)}let d=s.chat??s.kb_search??s.form,c=typeof d=="string"?d.trim():"";if(c){let h=document.createElement("button");h.type="button",h.className="basjoo-card-action",h.textContent=a||c;let u=()=>{this.sendMessage(c)};this._cardActionListeners.push(u),h.addEventListener("click",u),n.appendChild(h)}i.appendChild(n)}return t.appendChild(i),t.scrollTop=t.scrollHeight,!0}renderStarters(){let e=(this.embed?.starters||[]).filter(n=>!!n&&typeof n.label=="string"&&n.label.trim().length>0);if(e.length===0)return;let t=e.filter(n=>E(n,window.location.pathname));if(t.length===0)return;let i=this.chatWindow?.querySelector(".basjoo-input-area");if(!i)return;let s=document.createElement("div");s.className="basjoo-starters";for(let n of t){let o=document.createElement("button");o.type="button",o.className="basjoo-starter",o.textContent=n.label||"";let a;if(n.action==="link"){let l=y(n.url??n.value);a=l?()=>{window.open(l,"_blank","noopener")}:()=>{console.warn(`[Basjoo Widget] Starter "${n.label}" has no usable link target.`)}}else{let l=(n.value??n.label??"").trim();a=()=>{this.sendMessage(l)}}this._starterClickListeners.push(a),o.addEventListener("click",a),s.appendChild(o)}i.parentNode?.insertBefore(s,i)}showGreetingBubble(){if(!this.button)return;let e=document.createElement("div");e.className="basjoo-greeting-bubble",e.textContent=this.getText("greetingBubble");let t=this.config.position;e.style.position="fixed",e.style.bottom="100px",e.style[t]="24px",e.style.zIndex="9999",document.body.appendChild(e),setTimeout(()=>{e.remove()},5e3)}async loadHistory(){if(this.sessionId){try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&visitor_id=${encodeURIComponent(this.visitorId)}`);if(!e.ok){if(await this.reportIdentityRejection(e))return;throw new Error("Failed to load history")}let t=await e.json();if(t&&t.length>0){for(let i of t)this.addMessage({role:i.role==="user"?"user":"assistant",content:i.content,sources:i.sources,timestamp:new Date}),i.id>this.lastMessageId&&(this.lastMessageId=i.id);this.startPolling();return}}catch{}this.sessionId=null,this.storage.removeItem(this.STORAGE_KEY),this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date})}}startTitleBlink(){if(this.titleBlinkInterval)return;this.hasUnread=!0,this.updateUnreadBadge();let e=!0;this.titleBlinkInterval=window.setInterval(()=>{document.title=e?this.originalTitle:"\u2757 "+this.getText("newMessage"),e=!e},1e3)}stopTitleBlink(){this.titleBlinkInterval&&(clearInterval(this.titleBlinkInterval),this.titleBlinkInterval=null),document.title=this.originalTitle,this.hasUnread=!1,this.updateUnreadBadge()}createStyles(){let e=document.createElement("style");e.id="basjoo-widget-styles";let t=this.effectiveTheme==="dark",i=t?"#1a1a2e":"white",s=t?"#e2e8f0":"#1f2937",n=t?"#94a3b8":"#6b7280",o=t?"rgba(148, 163, 184, 0.2)":"#e5e7eb",a=t?"#0f0f1a":"white",l=t?"#2d2d44":"#f3f4f6",d=t?"rgba(239, 68, 68, 0.2)":"#fef2f2";e.textContent=`
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
        color: ${n};
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
        color: ${n};
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
        background: ${i};
        color: ${n};
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
        color: ${s};
        border-bottom-left-radius: 4px;
      }

      #basjoo-widget-container .basjoo-message-error .basjoo-message-content {
        background: ${d};
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
        background: ${a};
        color: ${s};
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
        background: ${d};
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
    `,document.head.appendChild(e)}adjustColor(e,t){let i=!1,s=e;s[0]==="#"&&(s=s.slice(1),i=!0);let n=parseInt(s,16),o=(n>>16)+t,a=(n>>8&255)+t,l=(n&255)+t;return o=Math.max(0,Math.min(255,o)),a=Math.max(0,Math.min(255,a)),l=Math.max(0,Math.min(255,l)),`${i?"#":""}${(o<<16|a<<8|l).toString(16).padStart(6,"0")}`}hexToRgba(e,t){let i=e.replace("#","");if(i.length===3){let[l,d,c]=i.split("");i=`${l}${l}${d}${d}${c}${c}`}let s=parseInt(i,16),n=s>>16&255,o=s>>8&255,a=s&255;return`rgba(${n}, ${o}, ${a}, ${t})`}updateUnreadBadge(){if(this.button){if(this.hasUnread){if(!this.unreadBadge){let e=document.createElement("span");e.className="basjoo-unread-badge",e.textContent="1",this.button.appendChild(e),this.unreadBadge=e}return}this.unreadBadge?.remove(),this.unreadBadge=null}}createContainer(){this.container=document.createElement("div"),this.container.id="basjoo-widget-container",document.body.appendChild(this.container)}createButton(){this.button=document.createElement("div"),this.button.id="basjoo-widget-button",this.button.innerHTML=`
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
    `,this._buttonClickListener=()=>this.toggle(),this.button.addEventListener("click",this._buttonClickListener),this.container.appendChild(this.button),this.updateUnreadBadge()}createChatWindow(){this.chatWindow=document.createElement("div"),this.chatWindow.id="basjoo-chat-window";let e=this.config.logoUrl?this.sanitizeUrlAttribute(this.config.logoUrl):"",t=this.escapeHtml(this.config.title),i=this.escapeHtml(this.getText("inputPlaceholder")),s=this.escapeHtml(this.getText("talkToHuman"));this.chatWindow.innerHTML=`
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
        <input type="text" class="basjoo-input" placeholder="${i}" maxlength="2000">
        <button class="basjoo-send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    `;let n=this.chatWindow.querySelector(".basjoo-close");this._closeBtnClickListener=()=>this.close(),n.addEventListener("click",this._closeBtnClickListener);let o=this.chatWindow.querySelector(".basjoo-input"),a=this.chatWindow.querySelector(".basjoo-send");this._sendBtnClickListener=()=>{if(this.isSending)return;let l=o.value.trim();if(l){if(l.length>2e3){this.showError(this.getText("messageTooLong"));return}this.sendMessage(l),o.value=""}},a.addEventListener("click",this._sendBtnClickListener),this._inputKeypressListener=l=>{l.key==="Enter"&&this._sendBtnClickListener?.()},o.addEventListener("keypress",this._inputKeypressListener),this.headerHumanButton=this.chatWindow.querySelector(".basjoo-human"),this._humanBtnClickListener=()=>{this.requestHumanHandoff()},this.headerHumanButton?.addEventListener("click",this._humanBtnClickListener),this.container.appendChild(this.chatWindow),this.applyBusinessHoursState(),this.renderModeNotice()}startOnlineWatcher(){this.onlineCheckIntervalId||(this.onlineCheckIntervalId=window.setInterval(()=>{this.refreshOnlineState()},6e4))}stopOnlineWatcher(){this.onlineCheckIntervalId&&(window.clearInterval(this.onlineCheckIntervalId),this.onlineCheckIntervalId=null)}async refreshOnlineState(){if(this.config.apiBase)try{let e=new URL(`${this.config.apiBase}/api/v1/config:public`);this.config.agentId&&e.searchParams.set("agent_id",this.config.agentId);let t=await fetch(e.toString());if(!t.ok)return;let i=await t.json(),s=i.online!==!1,n=(i.away_message||"").trim();if(s===this.isOnline&&n===this.awayMessage)return;this.isOnline=s,this.awayMessage=n,this.applyBusinessHoursState()}catch(e){console.warn("[Basjoo Widget] Could not refresh the business-hours state.",e)}}applyBusinessHoursState(){if(!this.chatWindow)return;let e=this.chatWindow.querySelector(".basjoo-input-area"),t=this.chatWindow.querySelector(".basjoo-away"),i=this.identityRequired&&!this.identitySigned,s=this.isOnline?i?this.getText("identityRequired"):null:this.awayMessage||this.getText("awayDefault");if(s===null)e&&(e.hidden=!1),t?.remove();else if(e&&(e.hidden=!0),t)t.textContent=s;else{let n=document.createElement("div");n.className="basjoo-away",n.setAttribute("role","status"),n.textContent=s,this.chatWindow.appendChild(n)}this.headerHumanButton&&(this.headerHumanButton.hidden=!this.isOnline||this.sessionMode==="human"||i)}renderModeNotice(){if(!this.chatWindow)return;let e=this.chatWindow.querySelector(".basjoo-notice");if(!e)return;if(this.sessionMode!=="human"){e.hidden=!0,e.textContent="",this.humanNoticeBar=null,this._continueAiClickListener=null,this.headerHumanButton&&(this.headerHumanButton.hidden=!this.isOnline||this.identityRequired&&!this.identitySigned);return}if(this.headerHumanButton&&(this.headerHumanButton.hidden=!0),this.humanNoticeBar===e)return;e.textContent="",e.hidden=!1;let t=document.createElement("span");t.className="basjoo-notice-text",t.textContent=this.getText("takenOverNotice");let i=document.createElement("button");i.type="button",i.className="basjoo-continue-ai",i.textContent=this.getText("continueWithAi"),this._continueAiClickListener=()=>{this.releaseToAi()},i.addEventListener("click",this._continueAiClickListener),e.appendChild(t),e.appendChild(i),this.humanNoticeBar=e}setSessionMode(e){this.sessionMode=e,this.applyBusinessHoursState(),this.renderModeNotice()}async requestHumanHandoff(){if(!this.sessionId){this.showError(this.getText("humanNeedsSession"));return}try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/escalate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent_id:this.config.agentId,session_id:this.sessionId,visitor_id:this.visitorId,reason:this.getText("talkToHuman")})});if(!e.ok){if(await this.reportIdentityRejection(e))return;throw new Error(`HTTP ${e.status}`)}this.setSessionMode("human"),this.addMessage({role:"assistant",content:this.getText("takenOverNotice"),timestamp:new Date}),this.startPolling()}catch(e){console.error("[Basjoo Widget] Failed to request a human handoff:",e),this.showError(this.getText("humanFailed"))}}async reportIdentityRejection(e){if(e.status!==403)return!1;try{let t=await e.json();if(t?.detail!=="identity_mismatch"&&t?.code!=="identity_mismatch")return!1}catch{return!1}return this.showError(this.getText("identityMismatch")),!0}async releaseToAi(){if(this.sessionId)try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/release`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent_id:this.config.agentId,session_id:this.sessionId,visitor_id:this.visitorId})});if(!e.ok){if(await this.reportIdentityRejection(e))return;throw new Error(`HTTP ${e.status}`)}this.setSessionMode("ai")}catch(e){console.error("[Basjoo Widget] Failed to release the session to AI:",e),this.showError(this.getText("humanFailed"))}}toggle(){if(this.isOpen){this.close();return}this.open()}open(e=!1){this.isOpen=!0,this.chatWindow?.classList.remove("closing"),this.chatWindow?.classList.add("open"),this.persistOpenState(),this.stopTitleBlink(),this.updateUnreadBadge();let t=this.chatWindow?.querySelector(".basjoo-input");setTimeout(()=>{t&&!t.closest(".basjoo-input-area[hidden]")&&!e&&t.focus()},300)}close(){this.isOpen=!1,this.chatWindow?.classList.remove("open"),this.chatWindow?.classList.add("closing"),this.persistOpenState()}persistOpenState(){this.hasFinePointer()&&this.storage.setItem(this.openStateStorageKey,this.isOpen?"open":"closed")}getRequestLocale(){return this.config.language&&this.config.language!=="auto"?this.config.language:navigator.language||"en-US"}getText(e){let t={sendFailed:{"en-US":"Send failed, please try again later","zh-CN":"\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"},networkError:{"en-US":"Network connection failed, please check your connection","zh-CN":"\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC"},quotaExceeded:{"en-US":"Daily message limit reached","zh-CN":"\u4ECA\u65E5\u6D88\u606F\u5DF2\u8FBE\u4E0A\u9650"},takenOverNotice:{"en-US":"Your conversation has been transferred to a human agent. Please wait for their reply.","zh-CN":"\u5DF2\u8F6C\u63A5\u4EBA\u5DE5\u5BA2\u670D\uFF0C\u8BF7\u7B49\u5F85\u56DE\u590D\u3002"},inputPlaceholder:{"en-US":"Type your question...","zh-CN":"\u8F93\u5165\u60A8\u7684\u95EE\u9898..."},messageTooLong:{"en-US":"Message too long (max 2000 characters)","zh-CN":"\u6D88\u606F\u8FC7\u957F\uFF08\u6700\u591A2000\u5B57\u7B26\uFF09"},greetingBubble:{"en-US":"Hi! How can I help you?","zh-CN":"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u60A8\uFF1F"},newMessage:{"en-US":"New message","zh-CN":"\u65B0\u6D88\u606F"},thinking:{"en-US":"Thinking...","zh-CN":"\u601D\u8003\u4E2D..."},references:{"en-US":"References","zh-CN":"\u53C2\u8003\u6765\u6E90"},talkToHuman:{"en-US":"Talk to a human","zh-CN":"\u8F6C\u4EBA\u5DE5"},continueWithAi:{"en-US":"Continue with AI","zh-CN":"\u7EE7\u7EED\u7531 AI \u56DE\u7B54"},awayDefault:{"en-US":"We are away right now. Leave a message and we will get back to you.","zh-CN":"\u5F53\u524D\u975E\u670D\u52A1\u65F6\u95F4\uFF0C\u8BF7\u7559\u8A00\uFF0C\u6211\u4EEC\u4F1A\u5C3D\u5FEB\u56DE\u590D\u3002"},closeWindow:{"en-US":"Close","zh-CN":"\u5173\u95ED"},humanNeedsSession:{"en-US":"Send a message first, then you can ask for a human.","zh-CN":"\u8BF7\u5148\u53D1\u9001\u4E00\u6761\u6D88\u606F\uFF0C\u7136\u540E\u518D\u8F6C\u4EBA\u5DE5\u3002"},humanFailed:{"en-US":"Could not reach a human agent. Please try again.","zh-CN":"\u8F6C\u4EBA\u5DE5\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"},degradedNotice:{"en-US":"Quota reached \u2014 answering with the fallback model","zh-CN":"\u989D\u5EA6\u7528\u5C3D\uFF0C\u5DF2\u4F7F\u7528\u5907\u7528\u6A21\u578B"},identityMismatch:{"en-US":"We could not verify your identity. Please refresh the page and sign in again.","zh-CN":"\u65E0\u6CD5\u9A8C\u8BC1\u60A8\u7684\u8EAB\u4EFD\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u5E76\u91CD\u65B0\u767B\u5F55\u3002"},identityRequired:{"en-US":"Please sign in on this page to start chatting.","zh-CN":"\u8BF7\u5148\u5728\u672C\u9875\u9762\u767B\u5F55\uFF0C\u7136\u540E\u518D\u5F00\u59CB\u5BF9\u8BDD\u3002"}};return this.getRequestLocale().toLowerCase().startsWith("zh")?t[e]["zh-CN"]||t[e]["en-US"]||e:t[e]["en-US"]||t[e]["zh-CN"]||e}escapeHtml(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}sanitizeUrlAttribute(e){try{let t=new URL(e);if(t.protocol==="http:"||t.protocol==="https:")return this.escapeHtml(e)}catch{}return""}renderMarkdown(e){if(!e)return"";let t=e.replace(/\r\n/g,`
`).split(/\n{2,}/).map(n=>n.trim()).filter(Boolean),i=n=>{let o=this.escapeHtml(n);return o=o.replace(/`([^`]+)`/g,"<code>$1</code>"),o=o.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>"),o=o.replace(/__([^_]+)__/g,"<strong>$1</strong>"),o=o.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g,"$1<em>$2</em>"),o=o.replace(/(^|[^_])_([^_]+)_(?!_)/g,"$1<em>$2</em>"),o=o.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(a,l,d)=>{let c=l,h=this.sanitizeUrlAttribute(d);return h?`<a href="${h}" target="_blank" rel="noopener noreferrer">${c}</a>`:c}),o};return t.map(n=>{if(/^```/.test(n)&&/```$/.test(n)){let o=n.replace(/^```\w*\n?/,"").replace(/```$/,"");return`<pre><code>${this.escapeHtml(o)}</code></pre>`}if(/^(?:[-*]\s.+\n?)+$/.test(n))return`<ul>${n.split(`
`).map(a=>a.replace(/^[-*]\s+/,"").trim()).filter(Boolean).map(a=>`<li>${i(a)}</li>`).join("")}</ul>`;if(/^(?:\d+\.\s.+\n?)+$/.test(n))return`<ol>${n.split(`
`).map(a=>a.replace(/^\d+\.\s+/,"").trim()).filter(Boolean).map(a=>`<li>${i(a)}</li>`).join("")}</ol>`;if(/^>\s?/.test(n)){let o=n.split(`
`).map(a=>a.replace(/^>\s?/,"")).join("<br>");return`<blockquote>${i(o)}</blockquote>`}if(/^#{1,6}\s/.test(n)){let o=n.replace(/^#{1,6}\s+/,"");return`<p><strong>${i(o)}</strong></p>`}return`<p>${i(n).replace(/\n/g,"<br>")}</p>`}).join("")}updateMessageContent(e,t,i=!1){e.innerHTML=this.renderMarkdown(t)+(i?'<span class="basjoo-stream-cursor"></span>':"")}createMessageElement(e){let t=document.createElement("div");t.className=`basjoo-message basjoo-message-${e.role}`;let i=document.createElement("div");if(i.className="basjoo-message-content",e.role==="assistant"){let n=v(e.content,e.sources),o=n.references.length>0?`

**${this.getText("references")}**
${n.references.map(a=>`- [${a.title}](${a.url})`).join(`
`)}`:"";this.updateMessageContent(i,n.content+o)}else this.updateMessageContent(i,e.content);t.appendChild(i);let s=document.createElement("div");return s.className="basjoo-message-time",s.textContent=e.timestamp.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),t.appendChild(s),t}formatThinkingText(){return`${this.getText("thinking")} ${this.thinkingElapsed}s`}showThinkingIndicator(e=0){this.hideLoading(),this.currentStreamContent.trim()||(this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null),this.thinkingElapsed=e;let t=this.chatWindow?.querySelector(".basjoo-messages");if(t){if(!this.thinkingIndicator){let i=document.createElement("div");i.className="basjoo-thinking",i.innerHTML=`
        <span class="basjoo-thinking-spinner"></span>
        <span>${this.getText("thinking")}</span>
      `,t.appendChild(i),this.thinkingIndicator=i,this.thinkingIndicatorText=i.querySelector("span:last-child")}this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText()),t.scrollTop=t.scrollHeight,this.thinkingTimerId===null&&(this.thinkingTimerId=window.setInterval(()=>{this.thinkingElapsed+=1,this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText())},1e3))}}hideThinkingIndicator(){this.thinkingTimerId!==null&&(window.clearInterval(this.thinkingTimerId),this.thinkingTimerId=null),this.thinkingIndicator?.remove(),this.thinkingIndicator=null,this.thinkingIndicatorText=null,this.thinkingElapsed=0}removeStreamingMessage(){this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}createStreamingMessage(e=!1){let t=this.chatWindow?.querySelector(".basjoo-messages"),i=document.createElement("div");i.className="basjoo-message basjoo-message-assistant";let s=document.createElement("div");return s.className="basjoo-message-content",this.updateMessageContent(s,this.currentStreamContent,e),i.appendChild(s),t?(t.appendChild(i),t.scrollTop=t.scrollHeight,this.streamingMessage=i,this.streamingMessageContent=s,this.currentStreamContent="",i):(this.streamingMessage=i,this.streamingMessageContent=s,this.currentStreamContent="",i)}appendToStreamingMessage(e){(!this.streamingMessage||!this.streamingMessageContent)&&(this.hideThinkingIndicator(),this.createStreamingMessage()),this.currentStreamContent+=e,this.streamingMessageContent&&this.updateMessageContent(this.streamingMessageContent,this.currentStreamContent,!0);let t=this.chatWindow?.querySelector(".basjoo-messages");t&&(t.scrollTop=t.scrollHeight)}finalizeStreamingMessage(e=[]){if(!this.streamingMessage||!this.streamingMessageContent)return;if(!this.currentStreamContent.trim()){this.removeStreamingMessage();return}this.streamingMessage.querySelector(".basjoo-stream-cursor")?.remove(),this.currentStreamSources=e;let i=v(this.currentStreamContent,e),s=i.references.length>0?`

**${this.getText("references")}**
${i.references.map(a=>`- [${a.title}](${a.url})`).join(`
`)}`:"",n=i.content+s;this.updateMessageContent(this.streamingMessageContent,n),this.messages.push({role:"assistant",content:n,sources:e,timestamp:new Date});let o=this.chatWindow?.querySelector(".basjoo-messages");o.scrollTop=o.scrollHeight,this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}addMessage(e){this.messages.push(e);let t=this.chatWindow?.querySelector(".basjoo-messages");if(!e.content){console.error("Message content is null or undefined:",e);return}if(!t)return;let i=this.createMessageElement(e);t.appendChild(i),t.scrollTop=t.scrollHeight,e.role==="assistant"&&!this.isOpen&&(this.hasUnread=!0,this.updateUnreadBadge())}showLoading(){let e=this.chatWindow?.querySelector(".basjoo-messages");if(!e)return;let t=document.createElement("div");t.className="basjoo-loading",t.id="basjoo-loading",t.innerHTML=`
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
    `,e.appendChild(t),e.scrollTop=e.scrollHeight}hideLoading(){this.chatWindow?.querySelector("#basjoo-loading")?.remove()}showError(e){let t=this.chatWindow?.querySelector(".basjoo-messages");if(!t)return;let i=document.createElement("div");i.className="basjoo-error",i.textContent=e,t.appendChild(i),t.scrollTop=t.scrollHeight,setTimeout(()=>i.remove(),5e3)}showDegradedNotice(e){let t=this.chatWindow?.querySelector(".basjoo-messages");if(!t)return;let i=document.createElement("div");i.className="basjoo-degraded",i.setAttribute("role","status"),i.textContent=e?`${this.getText("degradedNotice")} \xB7 ${e}`:this.getText("degradedNotice"),t.appendChild(i),t.scrollTop=t.scrollHeight}startPolling(){this.pollIntervalId||(this.pollIntervalId=window.setInterval(()=>this.pollMessages(),3e3))}stopPolling(){this.pollIntervalId&&(clearInterval(this.pollIntervalId),this.pollIntervalId=null)}async pollMessages(){if(this.sessionId)try{let e=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&visitor_id=${encodeURIComponent(this.visitorId)}&after_id=${this.lastMessageId}&role=assistant`);if(!e.ok)return;let t=await e.json();for(let i of t)i.content&&(this.addMessage({role:i.role==="user"?"user":"assistant",content:i.content,sources:i.sources,timestamp:new Date}),this.isOpen||this.startTitleBlink()),i.id>this.lastMessageId&&(this.lastMessageId=i.id)}catch{}}cleanupAfterStreamError(){this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage()}async consumeStream(e){if(!e.body)throw new Error("Streaming response body is unavailable");let t=e.body.getReader(),i=new TextDecoder,s="",n=!1,o=d=>{if(!d.trim())return;let c="message",h=[];for(let g of d.split(`
`))g.startsWith("event:")?c=g.slice(6).trim():g.startsWith("data:")&&h.push(g.slice(5).trimStart());if(!h.length)return;let u=JSON.parse(h.join(`
`));switch(c){case"sources":this.currentStreamSources=Array.isArray(u.sources)?u.sources:[];break;case"thinking":this.showThinkingIndicator(typeof u.elapsed=="number"?u.elapsed:0);break;case"thinking_done":this.hideThinkingIndicator();break;case"content":{let g=u.content||"";this.appendToStreamingMessage(g);break}case"done":{let g=u;g.session_id&&(this.sessionId=g.session_id,this.storage.setItem(this.STORAGE_KEY,g.session_id),this.startPolling()),typeof g.message_id=="number"&&g.message_id>this.lastMessageId&&(this.lastMessageId=g.message_id),g.taken_over?(this.removeStreamingMessage(),this.setSessionMode("human"),this.addMessage({role:"assistant",content:this.getText("takenOverNotice"),timestamp:new Date})):(g.mode==="human"&&this.setSessionMode("human"),this.finalizeStreamingMessage(this.currentStreamSources),g.degraded&&this.showDegradedNotice(g.model),this.isOpen||this.startTitleBlink()),n=!0;break}case"error":{let g=u,b=new Error(g.error||"Stream failed");throw g.code&&(b.name=g.code),b}default:break}},a=()=>{let d=s.indexOf(`\r
\r
`),c=s.indexOf(`

`);return d===-1&&c===-1?null:d===-1?{index:c,length:2}:c===-1?{index:d,length:4}:d<c?{index:d,length:4}:{index:c,length:2}},l=9e4;for(;!n;){if(this.streamAbortController?.signal.aborted){t.cancel();return}let d=null;try{let{done:c,value:h}=await Promise.race([t.read(),new Promise((g,b)=>{d=window.setTimeout(()=>b(new Error("Stream read timeout")),l)})]);s+=i.decode(h||new Uint8Array,{stream:!c});let u=a();for(;u;){let g=s.slice(0,u.index);if(s=s.slice(u.index+u.length),o(g.replace(/\r\n/g,`
`)),n)break;u=a()}if(c)break}finally{d!==null&&window.clearTimeout(d)}}if(!n&&(s.trim()&&o(s),!n))throw new Error("Stream ended unexpectedly")}abortStream(){this.streamAbortController?.abort(),this.streamAbortController=null}async sendMessageWithRetry(e){let t=null;for(let i=0;i<=1;i++){this.abortStream(),this.streamAbortController=new AbortController;try{let s=Intl.DateTimeFormat().resolvedOptions().timeZone,n=await fetch(`${this.config.apiBase}/api/v1/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},signal:this.streamAbortController.signal,body:JSON.stringify({agent_id:this.config.agentId,message:e,locale:this.getRequestLocale(),session_id:this.sessionId||void 0,visitor_id:this.visitorId,timezone:s,context_before:r.pageContext.before||void 0,context_after:r.pageContext.after||void 0})});if(!n.ok){let o=`HTTP ${n.status}: ${n.statusText}`;try{let a=await n.json();o=a.message||a.detail||o}catch{}throw new Error(o)}this.hideLoading(),await this.consumeStream(n);return}catch(s){t=s;let n=String(s?.message||"");if(!(!(this.currentStreamContent.trim().length>0)&&(s instanceof TypeError||n.includes("fetch")||n.includes("Failed to fetch")||n.includes("Stream ended unexpectedly")))||i>=1)throw this.cleanupAfterStreamError(),s;this.cleanupAfterStreamError(),console.warn(`[Basjoo Widget] Stream attempt ${i+1} failed, retrying...`),await new Promise(l=>window.setTimeout(l,1e3)),this.showLoading()}}throw t}async sendMessage(e){if(!this.isSending){this.isSending=!0,this.addMessage({role:"user",content:e,timestamp:new Date}),this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage(),this.createStreamingMessage(!0);try{await this.sendMessageWithRetry(e)}catch(t){console.error("[Basjoo Widget] Error sending message:",t);let i=this.getText("sendFailed"),s="",n=String(t?.message||"");t instanceof TypeError||n.includes("fetch")?(i=this.getText("networkError"),s=`Request may be blocked by CORS, network connectivity, or an incorrect apiBase. Current apiBase: ${this.config.apiBase||"(not set)"}`):n.includes("429")||n.toLowerCase().includes("quota")?i=this.getText("quotaExceeded"):t?.name==="ORIGIN_NOT_ALLOWED"||n.toLowerCase().includes("widget origin not allowed")?(i=this.getText("sendFailed"),s="Widget request was blocked because the current page origin is not on the allowed domain list."):t?.name==="identity_mismatch"||n.includes("identity_mismatch")?(i=this.getText("identityMismatch"),s="Signed visitor identity rejected: recompute hmac_sha256(identity_secret, email) for the signed-in visitor and pass it to Basjoo.identify({ email, hash })."):n.includes("401")&&(s="Authentication failed. Please check the agent configuration and public API access."),this.config.apiBase||(s="apiBase could not be determined. When embedding the widget from a local file, set apiBase explicitly or load the SDK from the target server."),s&&console.error("[Basjoo Widget]",s),this.showError(i)}finally{this.isSending=!1}}}destroy(){r.instances=r.instances.filter(o=>o!==this),this.stopPolling(),this.stopTitleBlink(),this.stopOnlineWatcher(),this.hideThinkingIndicator(),this.removeStreamingMessage(),this.abortStream(),this.button&&this._buttonClickListener&&this.button.removeEventListener("click",this._buttonClickListener);let e=this.chatWindow?.querySelector(".basjoo-close");e&&this._closeBtnClickListener&&e.removeEventListener("click",this._closeBtnClickListener);let t=this.chatWindow?.querySelector(".basjoo-send");t&&this._sendBtnClickListener&&t.removeEventListener("click",this._sendBtnClickListener);let i=this.chatWindow?.querySelector(".basjoo-input");i&&this._inputKeypressListener&&i.removeEventListener("keypress",this._inputKeypressListener),this.headerHumanButton&&this._humanBtnClickListener&&this.headerHumanButton.removeEventListener("click",this._humanBtnClickListener);let s=this.humanNoticeBar?.querySelector(".basjoo-continue-ai");s&&this._continueAiClickListener&&s.removeEventListener("click",this._continueAiClickListener),this.humanNoticeBar=null,this.headerHumanButton=null,this._cardActionListeners=[],this._starterClickListeners=[],this.iframeElement=null,this.mountTarget=null,this.container?.remove(),document.getElementById("basjoo-widget-styles")?.remove()}};window.BasjooWidget=p;window.Basjoo={Widget:p,setContext:r=>p.setContext(r),identify:r=>{p.applyIdentity(r)},init:r=>{let e=new p(r);return e.init(),e}};function f(r,e){for(let t of e){let i=r.get(t);if(i&&i.trim())return i.trim()}return null}function $(){if(document.currentScript instanceof HTMLScriptElement)return document.currentScript;let r=Array.from(document.querySelectorAll("script[src]"));for(let e=r.length-1;e>=0;e-=1){let t=r[e],i=t.getAttribute("src")||"";if(i.includes("sdk.js"))try{let s=new URL(i,window.location.href);if(f(s.searchParams,m.agentId))return t}catch{continue}}return null}function L(r){let e=r.getAttribute("src")||r.src;if(!e)return null;let t;try{t=new URL(e,window.location.href)}catch{return null}let i=f(t.searchParams,m.agentId);if(!i)return null;let s={agentId:i},n=f(t.searchParams,m.apiBase);n&&(s.apiBase=n);let o=f(t.searchParams,m.themeColor);o&&(s.themeColor=o);let a=f(t.searchParams,m.welcomeMessage);a&&(s.welcomeMessage=a);let l=f(t.searchParams,m.language);l&&(s.language=l);let d=f(t.searchParams,m.position);(d==="left"||d==="right")&&(s.position=d);let c=f(t.searchParams,m.theme);return(c==="light"||c==="dark"||c==="auto")&&(s.theme=c),s}(function(){let e=window,t=j();if(t&&typeof t.agent_id=="string"&&t.agent_id){if(e.__basjooWidgetAutoInitScheduled)return;e.__basjooWidgetAutoInitScheduled=!0;let o=()=>{new p({agentId:t.agent_id}).init()};if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",o,{once:!0});return}o();return}let i=$();if(!i)return;let s=L(i);if(!s||e.__basjooWidgetAutoInitScheduled)return;e.__basjooWidgetAutoInitScheduled=!0;let n=()=>{new p(s).init()};if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",n,{once:!0});return}n()})();})();
//# sourceMappingURL=basjoo-widget.min.js.map
