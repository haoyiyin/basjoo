"use strict";(()=>{var U="#F9CA02",w=U,y="6px",j="10px",C="14px",S="9999px",T="4px",k="8px",$="12px",M="16px",I="20px",E="24px",_="1.25",L="1.4",B="1.5",A="'Outfit', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif",W="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",D={surface:"hsl(30, 7%, 9.5%)",surfaceRaised:"hsl(30, 8%, 12.5%)",surfaceSunken:"hsl(30, 6%, 13%)",textPrimary:"hsl(40, 20%, 96%)",textSecondary:"hsl(40, 10%, 76%)",textMuted:"hsl(40, 8%, 63%)",textInverse:"hsl(40, 30%, 8%)",border:"hsl(35, 12%, 46%)",borderFocus:"hsl(48, 96%, 49%)",accent:"hsl(48, 96%, 49%)",accentContrast:"hsl(40, 30%, 8%)",error:"hsl(352, 80%, 68%)",errorBg:"hsl(352, 22%, 15%)",success:"hsl(150, 55%, 52%)",successBg:"hsl(150, 20%, 13%)",radiusSm:y,radiusMd:j,radiusLg:C,radiusFull:S,space1:T,space2:k,space3:$,space4:M,space5:I,space6:E,shadow1:"0 1px 2px hsl(30, 40%, 2%, 0.28)",shadow2:"0 2px 6px hsl(30, 40%, 2%, 0.32), 0 8px 20px -12px hsl(30, 40%, 2%, 0.4)",shadow3:"0 12px 32px -16px hsl(30, 40%, 2%, 0.55), 0 2px 8px hsl(30, 40%, 2%, 0.3)",fontDisplay:A,fontText:W,elevation1:"0 1px 2px hsl(30, 40%, 2%, 0.35), 0 0 0 1px hsl(35, 12%, 46%)",elevation2:"0 2px 4px hsl(30, 40%, 2%, 0.5), 0 0 0 1px hsl(35, 12%, 46%)",elevation3:"0 12px 32px hsl(30, 40%, 2%, 0.5), 0 0 0 1px hsl(35, 12%, 46%)",leadingTight:_,leadingSnug:L,leadingNormal:B},z={surface:"hsl(40, 30%, 97.5%)",surfaceRaised:"hsl(40, 25%, 100%)",surfaceSunken:"hsl(40, 15%, 90%)",textPrimary:"hsl(30, 25%, 11%)",textSecondary:"hsl(30, 14%, 30%)",textMuted:"hsl(30, 10%, 40%)",textInverse:"hsl(0, 0%, 100%)",border:"hsl(35, 12%, 46%)",borderFocus:"hsl(38, 92%, 26%)",accent:"hsl(38, 92%, 26%)",accentContrast:"hsl(0, 0%, 100%)",error:"hsl(348, 78%, 38%)",errorBg:"hsl(348, 80%, 95%)",success:"hsl(154, 85%, 24%)",successBg:"hsl(152, 60%, 94%)",radiusSm:y,radiusMd:j,radiusLg:C,radiusFull:S,space1:T,space2:k,space3:$,space4:M,space5:I,space6:E,shadow1:"0 1px 2px hsl(30, 30%, 20%, 0.12)",shadow2:"0 2px 6px hsl(30, 30%, 20%, 0.14), 0 8px 20px -12px hsl(30, 30%, 20%, 0.18)",shadow3:"0 12px 32px -16px hsl(30, 30%, 20%, 0.24), 0 2px 8px hsl(30, 30%, 20%, 0.12)",fontDisplay:A,fontText:W,elevation1:"0 1px 2px hsl(30, 30%, 20%, 0.12), 0 0 0 1px hsl(35, 12%, 46%)",elevation2:"0 2px 4px hsl(30, 30%, 20%, 0.18), 0 0 0 1px hsl(35, 12%, 46%)",elevation3:"0 12px 32px hsl(30, 30%, 20%, 0.18), 0 0 0 1px hsl(35, 12%, 46%)",leadingTight:_,leadingSnug:L,leadingNormal:B},v={light:z,dark:D};function H(r){return r?v.dark:v.light}function N(r,t=[]){if(!r)return{content:r,references:[]};let e=[],n=new Set,i=new Map;for(let a of t)a.type!=="url"||typeof a.url!="string"||!/^https?:\/\//.test(a.url)||i.has(a.url)||i.set(a.url,a);let s=a=>{if(n.has(a))return;n.add(a);let c=i.get(a);e.push({title:c?.title?.trim()||a,url:a})};return{content:r.replace(/\[([^\]]+)\]\((#source-(\d+)|https?:\/\/[^\s)]+)\)/g,(a,c,d,h)=>{if(h){let l=Number(h)-1,u=t[l];return u&&u.type==="url"&&u.url&&/^https?:\/\//.test(u.url)&&s(u.url),c}return i.has(d)?(s(d),c):a}),references:e}}var p={agentId:["agentId","agent_id"],apiBase:["apiBase","api_base"],themeColor:["themeColor","theme_color"],welcomeMessage:["welcomeMessage","welcome_message"],language:["language","locale"],position:["position"],theme:["theme"]};function q(r){if(!r)return"/basjoo-logo.png";try{return new URL("/basjoo-logo.png",`${r}/`).toString()}catch{return"/basjoo-logo.png"}}var P="#basjoo-chat",F="(pointer: fine)",K="basjoo_open_",G="basjoo_rollout_";function O(){let r=window.__BASJOO_CONFIG__;return!r||typeof r!="object"?null:r}function Y(r,t){if(!Array.isArray(t))return!1;for(let e of t)if(!(typeof e!="string"||!e))try{if(new RegExp(e).test(r))return!0}catch{console.warn(`[Basjoo Widget] Ignoring an invalid excluded_paths pattern: ${e}`)}return!1}function V(r,t){let e=typeof r.path=="string"?r.path.trim():"";if(!e)return!0;try{return new RegExp(e).test(t)}catch{return console.warn(`[Basjoo Widget] Ignoring an invalid starter path pattern: ${e}`),!0}}function J(){try{return window.location.origin}catch{return""}}function X(r,t,e){if(t>=100)return!0;if(t<=0)return!1;let n=`${G}${r}`,i=e.getItem(n);if(i==="in")return!0;if(i==="out")return!1;let s=Math.random()*100<t;return e.setItem(n,s?"in":"out"),s}function R(r){if(typeof r!="string"||!r.trim())return"";let t=r.trim();try{let e=new URL(t,window.location.href);return e.protocol!=="http:"&&e.protocol!=="https:"?"":e.toString()}catch{return""}}var x=class{constructor(){this.memoryStore=new Map;this.storageAvailable=null}isAvailable(){if(this.storageAvailable!==null)return this.storageAvailable;try{let t="__storage_test__";return window.localStorage.setItem(t,"test"),window.localStorage.removeItem(t),this.storageAvailable=!0,!0}catch{return this.storageAvailable=!1,!1}}getItem(t){if(this.isAvailable())try{return window.localStorage.getItem(t)}catch{}return this.memoryStore.get(t)??null}setItem(t,e){if(this.isAvailable())try{window.localStorage.setItem(t,e);return}catch{}this.memoryStore.set(t,e)}removeItem(t){if(this.isAvailable())try{window.localStorage.removeItem(t);return}catch{}this.memoryStore.delete(t)}},f=class r{constructor(t){this.container=null;this.button=null;this.unreadBadge=null;this.chatWindow=null;this.messages=[];this.sessionId=null;this.isOpen=!1;this.VISITOR_STORAGE_KEY="basjoo_visitor_id";this.effectiveTheme="light";this.originalTitle="";this.titleBlinkInterval=null;this.hasUnread=!1;this.pollIntervalId=null;this.lastMessageId=0;this.isSending=!1;this.streamAbortController=null;this.streamingMessage=null;this.streamingMessageContent=null;this.thinkingIndicator=null;this.thinkingIndicatorText=null;this.thinkingElapsed=0;this.thinkingTimerId=null;this.currentStreamContent="";this.currentStreamSources=[];this.sessionMode="ai";this.isOnline=!0;this.awayMessage="";this.humanNoticeBar=null;this.headerHumanButton=null;this.onlineCheckIntervalId=null;this._buttonClickListener=null;this._closeBtnClickListener=null;this._sendBtnClickListener=null;this._inputKeypressListener=null;this._humanBtnClickListener=null;this._continueAiClickListener=null;this.displayMode="bubble";this.mountTarget=null;this.iframeElement=null;this.cardsRendered=!1;this._cardActionListeners=[];this._starterClickListeners=[];this.embed=O();let e=this.embed?.agent_id,n=this.embed?.api_base,i=this.detectApiBase(t.apiBase||n),s=t.agentId||e||"";this.hasTitleOverride=typeof t.title=="string"&&t.title.trim().length>0,this.hasWelcomeMessageOverride=typeof t.welcomeMessage=="string"&&t.welcomeMessage.trim().length>0,this.config={agentId:s,apiBase:i,themeColor:t.themeColor||"",logoUrl:t.logoUrl||q(i),title:t.title||"AI\u52A9\u624B",welcomeMessage:t.welcomeMessage||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F",language:t.language||"auto",position:t.position||"right",theme:t.theme||"auto"},this.STORAGE_KEY=`basjoo_session_${this.config.agentId}`,this.openStateStorageKey=`${K}${this.config.agentId}`,this.storage=new x,this.sessionId=this.storage.getItem(this.STORAGE_KEY),this.visitorId=this.storage.getItem(this.VISITOR_STORAGE_KEY)||this.generateVisitorId();let o=this.embed?.display_mode;this.displayMode=o==="inline"||o==="iframe"?o:"bubble",this.effectiveTheme=this.getEffectiveTheme()}static{this.pageContext={before:"",after:""}}static setContext(t){let e=t&&typeof t=="object"?t:{};r.pageContext={before:typeof e.before=="string"?e.before:"",after:typeof e.after=="string"?e.after:""}}generateVisitorId(){let t=`visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,11)}`;return this.storage.setItem(this.VISITOR_STORAGE_KEY,t),t}detectApiBase(t){if(t)try{let s=new URL(t,window.location.href);if((s.protocol==="http:"||s.protocol==="https:")&&s.port==="3000"){let o=`${s.protocol}//${s.hostname}:8000`;return console.info("[Basjoo Widget] Rewriting configured dev apiBase to direct backend:",o),o}return s.toString().replace(/\/$/,"")}catch{return t}let e=document.currentScript;if(e instanceof HTMLScriptElement&&e.src)try{let s=new URL(e.src,window.location.href);return console.info("[Basjoo Widget] Detected API base from current script:",s.origin),s.origin}catch{}let n=document.querySelectorAll("script[src]");for(let s of n){let o=s.getAttribute("src")||"";if(!(!o.includes("sdk.js")&&!o.includes("basjoo")))try{let a=new URL(o,window.location.href);return console.info("[Basjoo Widget] Detected API base from script src:",a.origin),a.origin}catch{}}let i=window.location.port;if(i==="3000"||i==="5173"){let s=`${window.location.protocol}//${window.location.hostname}:8000`;return console.info("[Basjoo Widget] Development mode detected, using:",s),s}return window.location.protocol==="file:"?(console.error("[Basjoo Widget] Cannot determine API base from a local file. Please set apiBase explicitly."),""):(console.warn("[Basjoo Widget] Falling back to window.location.origin. Set apiBase explicitly if the API is hosted elsewhere."),window.location.origin)}getEffectiveTheme(){return this.config.theme==="light"||this.config.theme==="dark"?this.config.theme:typeof window<"u"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}async loadPublicConfig(){if(!this.config.apiBase){console.warn("[Basjoo Widget] Skipping public config fetch because apiBase could not be determined.");return}try{let t=new URL(`${this.config.apiBase}/api/v1/config:public`);this.config.agentId&&t.searchParams.set("agent_id",this.config.agentId);let e=await fetch(t.toString());if(!e.ok)throw new Error(`HTTP ${e.status}: ${e.statusText}`);let n=await e.json();!this.config.agentId&&n.default_agent_id&&(this.config.agentId=n.default_agent_id),this.config.themeColor=this.config.themeColor||n.widget_color||w,this.hasTitleOverride||(this.config.title=n.widget_title||"AI\u52A9\u624B"),this.hasWelcomeMessageOverride||(this.config.welcomeMessage=n.welcome_message||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F"),this.isOnline=n.online!==!1,this.awayMessage=(n.away_message||"").trim(),this.effectiveTheme=this.getEffectiveTheme()}catch(t){console.warn("[Basjoo Widget] Failed to load public config, using defaults.",t),t instanceof TypeError&&console.warn("[Basjoo Widget] Public config request may be blocked by CORS, network issues, or an incorrect apiBase:",this.config.apiBase)}}isOriginAllowed(){let t=(this.embed?.allowed_domains||[]).filter(n=>typeof n=="string"&&n.length>0);if(t.length===0)return!0;let e=J();return t.includes(e)?!0:(console.error(`Basjoo: origin ${e||"(unknown)"} is not allowed for this agent (allowed: ${t.join(", ")})`),!1)}hasFinePointer(){return typeof window>"u"||typeof window.matchMedia!="function"?!1:window.matchMedia(F).matches}restoreOpenState(){this.hasFinePointer()&&this.storage.getItem(this.openStateStorageKey)==="open"&&this.open(!0)}async init(){if(!document.body){console.warn("[Basjoo Widget] document.body is not available yet. Call init() after DOMContentLoaded or place the embed code near the end of <body>.");return}if(document.getElementById("basjoo-widget-container")){console.warn("[Basjoo Widget] Initialization skipped because #basjoo-widget-container already exists. Avoid loading or initializing the widget twice on the same page.");return}if(Y(window.location.pathname,this.embed?.excluded_paths)||!this.isOriginAllowed())return;let t=this.embed?.traffic_percentage;if(!(typeof t=="number"&&!X(this.config.agentId,t,this.storage))){if(await this.loadPublicConfig(),this.originalTitle=document.title,this.createStyles(),this.displayMode==="iframe"){this.mountIframe();return}if(this.displayMode==="inline"){if(!this.mountInline())return}else this.createContainer(),this.createButton();if(this.createChatWindow(),this.displayMode==="inline"?this.open(!0):(this.showGreetingBubble(),this.startTitleBlink()),this.startOnlineWatcher(),this.sessionId){this.loadHistory();return}!this.renderCards()&&this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date}),this.renderStarters(),this.restoreOpenState()}}mountInline(){let t=this.embed?.inline_container||P,e=this.resolveMountTarget(t);if(!e)return console.warn(`[Basjoo Widget] Inline mode found no container matching "${t}". Add an element with that selector, or change the install setting.`),!1;this.mountTarget=e;let n=document.createElement("div");return n.className="basjoo-inline-host",e.appendChild(n),this.container=n,!0}mountIframe(){let t=this.embed?.inline_container||P,e=this.resolveMountTarget(t);if(!e){console.warn(`[Basjoo Widget] iframe mode found no container matching "${t}". Add an element with that selector, or change the install setting.`);return}this.mountTarget=e;let n=document.createElement("div");n.className="basjoo-inline-host";let i=document.createElement("iframe");i.className="basjoo-inline-frame",i.title=this.config.title;let s=new URL("/widget-demo",`${this.config.apiBase}/`);s.searchParams.set("agent_id",this.config.agentId),i.src=s.toString(),n.appendChild(i),e.appendChild(n),this.container=n,this.iframeElement=i}resolveMountTarget(t){try{return document.querySelector(t)}catch{return console.warn(`[Basjoo Widget] Ignoring an invalid container selector: ${t}`),null}}renderCards(){let t=(this.embed?.cards||[]).filter(i=>!!i&&typeof i=="object");if(t.length===0||this.cardsRendered)return!1;let e=this.chatWindow?.querySelector(".basjoo-messages");if(!e)return!1;this.cardsRendered=!0;let n=document.createElement("div");n.className="basjoo-cards";for(let i of t){let s=document.createElement("div");s.className="basjoo-card";let o=R(i.logo);if(o){let l=document.createElement("img");l.className="basjoo-card-logo",l.src=o,l.alt="",s.appendChild(l)}let a=typeof i.heading=="string"?i.heading.trim():"";if(a){let l=document.createElement("div");l.className="basjoo-card-heading",l.textContent=a,s.appendChild(l)}let c=typeof i.text=="string"?i.text.trim():"";if(c){let l=document.createElement("div");l.className="basjoo-card-text",l.textContent=c,s.appendChild(l)}let d=i.chat??i.kb_search??i.form,h=typeof d=="string"?d.trim():"";if(h){let l=document.createElement("button");l.type="button",l.className="basjoo-card-action",l.textContent=a||h;let u=()=>{this.sendMessage(h)};this._cardActionListeners.push(u),l.addEventListener("click",u),s.appendChild(l)}n.appendChild(s)}return e.appendChild(n),e.scrollTop=e.scrollHeight,!0}renderStarters(){let t=(this.embed?.starters||[]).filter(s=>!!s&&typeof s.label=="string"&&s.label.trim().length>0);if(t.length===0)return;let e=t.filter(s=>V(s,window.location.pathname));if(e.length===0)return;let n=this.chatWindow?.querySelector(".basjoo-input-area");if(!n)return;let i=document.createElement("div");i.className="basjoo-starters";for(let s of e){let o=document.createElement("button");o.type="button",o.className="basjoo-starter",o.textContent=s.label||"";let a;if(s.action==="link"){let c=R(s.url??s.value);a=c?()=>{window.open(c,"_blank","noopener")}:()=>{console.warn(`[Basjoo Widget] Starter "${s.label}" has no usable link target.`)}}else{let c=(s.value??s.label??"").trim();a=()=>{this.sendMessage(c)}}this._starterClickListeners.push(a),o.addEventListener("click",a),i.appendChild(o)}n.parentNode?.insertBefore(i,n)}showGreetingBubble(){if(!this.button)return;let t=document.createElement("div");t.className="basjoo-greeting-bubble",t.textContent=this.getText("greetingBubble");let e=this.config.position;t.style.position="fixed",t.style.bottom="100px",t.style[e]="24px",t.style.zIndex="9999",document.body.appendChild(t),setTimeout(()=>{t.remove()},5e3)}async loadHistory(){if(this.sessionId){try{let t=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&visitor_id=${encodeURIComponent(this.visitorId)}`);if(!t.ok)throw new Error("Failed to load history");let e=await t.json();if(e&&e.length>0){for(let n of e)this.addMessage({role:n.role==="user"?"user":"assistant",content:n.content,sources:n.sources,timestamp:new Date}),n.id>this.lastMessageId&&(this.lastMessageId=n.id);this.startPolling();return}}catch{}this.sessionId=null,this.storage.removeItem(this.STORAGE_KEY),this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date})}}startTitleBlink(){if(this.titleBlinkInterval)return;this.hasUnread=!0,this.updateUnreadBadge();let t=!0;this.titleBlinkInterval=window.setInterval(()=>{document.title=t?this.originalTitle:"\u2757 "+this.getText("newMessage"),t=!t},1e3)}stopTitleBlink(){this.titleBlinkInterval&&(clearInterval(this.titleBlinkInterval),this.titleBlinkInterval=null),document.title=this.originalTitle,this.hasUnread=!1,this.updateUnreadBadge()}createStyles(){let t=document.createElement("style");t.id="basjoo-widget-styles";let e=H(this.effectiveTheme==="dark");t.textContent=`
      #basjoo-widget-container, #basjoo-widget-container * {
        box-sizing: border-box;
        font-family: ${e.fontText};
      }

      #basjoo-widget-button {
        position: fixed;
        bottom: ${e.space6};
        ${this.config.position==="left"?"left":"right"}: ${e.space6};
        width: 60px;
        height: 60px;
        border-radius: ${e.radiusFull};
        background-color: ${this.config.themeColor};
        cursor: pointer;
        box-shadow: ${e.shadow2};
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s, box-shadow 0.2s;
        z-index: 9999;
      }

      #basjoo-widget-button:hover {
        transform: scale(1.05);
        box-shadow: ${e.shadow3};
      }

      #basjoo-widget-button svg {
        width: 30px;
        height: 30px;
        fill: ${e.accentContrast};
      }

      .basjoo-unread-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        border-radius: ${e.radiusMd};
        background: ${e.error};
        color: ${e.textInverse};
        font-size: 11px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid ${e.surface};
      }

      .basjoo-greeting-bubble {
        background: ${e.surfaceRaised};
        color: ${e.textPrimary};
        padding: 10px 14px;
        border-radius: ${e.radiusMd};
        box-shadow: ${e.shadow2};
        font-family: ${e.fontDisplay};
        font-size: 13px;
        line-height: ${e.leadingSnug};
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
        background: ${e.surfaceRaised};
        transform: rotate(45deg);
        border-bottom: 1px solid ${e.border};
        border-right: 1px solid ${e.border};
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
        ${this.config.position==="left"?"left":"right"}: ${e.space6};
        width: 380px;
        height: 600px;
        max-height: calc(100vh - 120px);
        background: ${e.surface};
        border-radius: ${e.radiusLg};
        box-shadow: ${e.shadow3};
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
        color: ${e.accentContrast};
        padding: ${e.space5} ${e.space6};
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
      }

      /* Scoped to the container on purpose: the blanket
         #basjoo-widget-container * rule above is (1,0,0) and would otherwise
         out-rank a bare .basjoo-header-title (0,1,0), silently dropping the
         display face. The child rule repeats only the type, because the star
         in the blanket selector otherwise wins inside the title's own span. */
      #basjoo-widget-container .basjoo-header-title {
        display: flex;
        align-items: center;
        gap: ${e.space3};
        font-family: ${e.fontDisplay};
        font-size: 18px;
        font-weight: 600;
      }

      #basjoo-widget-container .basjoo-header-title span {
        font-family: ${e.fontDisplay};
        font-size: 18px;
        font-weight: 600;
      }

      .basjoo-header-logo {
        width: 32px;
        height: 32px;
        object-fit: contain;
        border-radius: ${e.radiusSm};
        background: ${this.hexToRgba(e.accentContrast,.18)};
        padding: ${e.space1};
        flex-shrink: 0;
      }

      .basjoo-close {
        width: 32px;
        height: 32px;
        border: none;
        background: ${this.hexToRgba(e.accentContrast,.15)};
        border-radius: ${e.radiusSm};
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
        color: ${e.accentContrast};
      }

      .basjoo-close:hover {
        background: ${this.hexToRgba(e.accentContrast,.28)};
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
        background: ${e.surfaceSunken};
        border-bottom: 1px solid ${e.border};
        color: ${e.textPrimary};
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
        color: ${this.adjustColor(this.config.themeColor,-30)};
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
        color: ${e.textMuted};
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
        border: 1px solid ${e.border};
        border-radius: 12px;
        background: ${e.surfaceSunken};
      }

      .basjoo-card-logo {
        width: 28px;
        height: 28px;
        margin-bottom: 8px;
        border-radius: 6px;
        object-fit: contain;
      }

      .basjoo-card-heading {
        color: ${e.textPrimary};
        font-size: 14px;
        font-weight: 600;
        line-height: 1.4;
      }

      .basjoo-card-text {
        margin-top: 4px;
        color: ${e.textMuted};
        font-size: 13px;
        line-height: 1.5;
      }

      .basjoo-card-action {
        margin-top: 8px;
        padding: 6px 12px;
        border: 1px solid ${e.border};
        border-radius: 999px;
        background: transparent;
        color: ${e.textPrimary};
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
        border-top: 1px solid ${e.border};
        flex-shrink: 0;
      }

      .basjoo-starter {
        padding: 6px 12px;
        border: 1px solid ${e.border};
        border-radius: 999px;
        background: ${e.surfaceRaised};
        color: ${e.textPrimary};
        font-size: 13px;
        cursor: pointer;
      }

      .basjoo-starter:hover {
        border-color: ${this.config.themeColor};
      }

      /* #43: outside business hours the composer is replaced by this. */
      .basjoo-away {
        padding: 16px 20px 24px 20px;
        border-top: 1px solid ${e.border};
        background: ${e.surfaceRaised};
        color: ${e.textMuted};
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
        padding: ${e.space5};
        display: flex;
        flex-direction: column;
        gap: ${e.space4};
        background: ${e.surfaceSunken};
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
        padding: ${e.space3} ${e.space4};
        border-radius: ${e.radiusLg};
        font-size: 14px;
        line-height: ${e.leadingNormal};
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
        background: ${e.surfaceSunken};
        padding: 1px ${e.space1};
        border-radius: ${e.radiusSm};
      }

      #basjoo-widget-container .basjoo-message-content pre {
        background: ${e.surfaceSunken};
        color: ${e.textPrimary};
        padding: 10px ${e.space3};
        border-radius: ${e.radiusMd};
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
        padding-left: ${e.space3};
        border-left: 3px solid ${e.border};
        color: ${e.textMuted};
      }

      #basjoo-widget-container .basjoo-message-user .basjoo-message-content {
        background: ${this.config.themeColor};
        color: ${e.accentContrast};
        border-bottom-right-radius: ${e.radiusSm};
      }

      #basjoo-widget-container .basjoo-message-user .basjoo-message-content a {
        color: ${e.accentContrast};
      }

      #basjoo-widget-container .basjoo-message-user .basjoo-message-content code {
        background: ${this.hexToRgba(e.accentContrast,.2)};
        color: ${e.accentContrast};
      }

      #basjoo-widget-container .basjoo-message-assistant .basjoo-message-content {
        background: ${e.surfaceRaised};
        color: ${e.textPrimary};
        border-bottom-left-radius: ${e.radiusSm};
      }

      #basjoo-widget-container .basjoo-message-error .basjoo-message-content {
        background: ${e.errorBg};
        color: ${e.error};
        border: 1px solid ${e.error};
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
        gap: ${e.space1};
        padding: ${e.space3} ${e.space4} !important;
        align-self: flex-start;
        margin-top: ${e.space1} !important;
      }

      .basjoo-loading-dot {
        width: 8px;
        height: 8px;
        border-radius: ${e.radiusFull};
        background: ${e.textMuted};
        animation: basjoo-bounce 1.4s infinite ease-in-out both;
      }

      .basjoo-loading-dot:nth-child(1) { animation-delay: -0.32s; }
      .basjoo-loading-dot:nth-child(2) { animation-delay: -0.16s; }

      @keyframes basjoo-bounce {
        0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
        40% { transform: scale(1); opacity: 1; }
      }

      .basjoo-input-area {
        padding: ${e.space4} ${e.space5} ${e.space6} ${e.space5} !important;
        border-top: 1px solid ${e.border};
        display: flex;
        gap: ${e.space3};
        background: ${e.surface};
        flex-shrink: 0;
      }

      .basjoo-input {
        flex: 1;
        height: 48px;
        padding: 0 ${e.space5} !important;
        border: 1px solid ${e.border};
        border-radius: ${e.radiusLg};
        font-size: 14px;
        outline: none;
        transition: all 0.2s;
        background: ${e.surfaceRaised};
        color: ${e.textPrimary};
        margin-bottom: ${e.space2} !important;
        margin-left: ${e.space1} !important;
      }

      .basjoo-input::placeholder {
        color: ${e.textMuted};
      }

      .basjoo-input:focus {
        border-color: ${this.config.themeColor};
        box-shadow: 0 0 0 3px ${this.hexToRgba(this.config.themeColor,.1)};
      }

      .basjoo-send {
        width: 48px;
        height: 48px;
        border: none;
        border-radius: ${e.radiusFull};
        background: ${this.config.themeColor};
        color: ${e.accentContrast};
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
        padding: ${e.space3} ${e.space4};
        background: ${e.errorBg};
        color: ${e.error};
        font-size: 13px;
        text-align: center;
        border-top: 1px solid ${e.error};
      }

      #basjoo-widget-container .basjoo-message-time {
        font-size: 11px;
        color: ${e.textMuted};
        margin-top: ${e.space1};
        padding: 0 ${e.space1};
      }

      #basjoo-widget-container .basjoo-message-user .basjoo-message-time {
        text-align: right;
      }

      .basjoo-thinking {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: ${e.textMuted};
        font-size: 12px;
        margin-top: ${e.space2};
      }

      .basjoo-thinking-spinner {
        width: 12px;
        height: 12px;
        border: 2px solid ${this.hexToRgba(this.config.themeColor,.2)};
        border-top-color: ${this.config.themeColor};
        border-radius: ${e.radiusFull};
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
          left: ${e.space4} !important;
          right: ${e.space4} !important;
        }

        #basjoo-widget-button {
          bottom: ${e.space4};
          ${this.config.position==="left"?"left":"right"}: ${e.space4};
        }
      }
    `,document.head.appendChild(t)}parseColor(t){let e=(t||"").trim(),n=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(e);if(n){let s=n[1],o=s.length===3?s.split("").map(a=>parseInt(a+a,16)):[0,2,4].map(a=>parseInt(s.slice(a,a+2),16));return{r:o[0],g:o[1],b:o[2]}}let i=/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(e);if(i){let s=(Number.parseFloat(i[1])%360+360)%360,o=Number.parseFloat(i[2])/100,a=Number.parseFloat(i[3])/100,c=(1-Math.abs(2*a-1))*o,d=c*(1-Math.abs(s/60%2-1)),h=a-c/2,l;return s<60?l=[c,d,0]:s<120?l=[d,c,0]:s<180?l=[0,c,d]:s<240?l=[0,d,c]:s<300?l=[d,0,c]:l=[c,0,d],{r:Math.round((l[0]+h)*255),g:Math.round((l[1]+h)*255),b:Math.round((l[2]+h)*255)}}return null}adjustColor(t,e){let n=this.parseColor(t);if(!n)return t;let i=c=>Math.max(0,Math.min(255,c+e)),s=i(n.r),o=i(n.g),a=i(n.b);return`#${(s<<16|o<<8|a).toString(16).padStart(6,"0")}`}hexToRgba(t,e){let n=this.parseColor(t)??this.parseColor(w),{r:i,g:s,b:o}=n??{r:0,g:0,b:0};return`rgba(${i}, ${s}, ${o}, ${e})`}updateUnreadBadge(){if(this.button){if(this.hasUnread){if(!this.unreadBadge){let t=document.createElement("span");t.className="basjoo-unread-badge",t.textContent="1",this.button.appendChild(t),this.unreadBadge=t}return}this.unreadBadge?.remove(),this.unreadBadge=null}}createContainer(){this.container=document.createElement("div"),this.container.id="basjoo-widget-container",document.body.appendChild(this.container)}createButton(){this.button=document.createElement("div"),this.button.id="basjoo-widget-button",this.button.innerHTML=`
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
    `,this._buttonClickListener=()=>this.toggle(),this.button.addEventListener("click",this._buttonClickListener),this.container.appendChild(this.button),this.updateUnreadBadge()}createChatWindow(){this.chatWindow=document.createElement("div"),this.chatWindow.id="basjoo-chat-window";let t=this.config.logoUrl?this.sanitizeUrlAttribute(this.config.logoUrl):"",e=this.escapeHtml(this.config.title),n=this.escapeHtml(this.getText("inputPlaceholder")),i=this.escapeHtml(this.getText("talkToHuman"));this.chatWindow.innerHTML=`
      <div class="basjoo-header">
        <div class="basjoo-header-title">
          ${t?`<img src="${t}" class="basjoo-header-logo" alt="">`:""}
          <span>${e}</span>
        </div>
        <div class="basjoo-header-actions">
          <button class="basjoo-human" type="button" aria-label="${i}" title="${i}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="8.5" cy="7" r="4"></circle>
              <polyline points="17 11 19 13 23 9"></polyline>
            </svg>
            <span class="basjoo-human-label">${i}</span>
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
    `;let s=this.chatWindow.querySelector(".basjoo-close");this._closeBtnClickListener=()=>this.close(),s.addEventListener("click",this._closeBtnClickListener);let o=this.chatWindow.querySelector(".basjoo-input"),a=this.chatWindow.querySelector(".basjoo-send");this._sendBtnClickListener=()=>{if(this.isSending)return;let c=o.value.trim();if(c){if(c.length>2e3){this.showError(this.getText("messageTooLong"));return}this.sendMessage(c),o.value=""}},a.addEventListener("click",this._sendBtnClickListener),this._inputKeypressListener=c=>{c.key==="Enter"&&this._sendBtnClickListener?.()},o.addEventListener("keypress",this._inputKeypressListener),this.headerHumanButton=this.chatWindow.querySelector(".basjoo-human"),this._humanBtnClickListener=()=>{this.requestHumanHandoff()},this.headerHumanButton?.addEventListener("click",this._humanBtnClickListener),this.container.appendChild(this.chatWindow),this.applyBusinessHoursState(),this.renderModeNotice()}startOnlineWatcher(){this.onlineCheckIntervalId||(this.onlineCheckIntervalId=window.setInterval(()=>{this.refreshOnlineState()},6e4))}stopOnlineWatcher(){this.onlineCheckIntervalId&&(window.clearInterval(this.onlineCheckIntervalId),this.onlineCheckIntervalId=null)}async refreshOnlineState(){if(this.config.apiBase)try{let t=new URL(`${this.config.apiBase}/api/v1/config:public`);this.config.agentId&&t.searchParams.set("agent_id",this.config.agentId);let e=await fetch(t.toString());if(!e.ok)return;let n=await e.json(),i=n.online!==!1,s=(n.away_message||"").trim();if(i===this.isOnline&&s===this.awayMessage)return;this.isOnline=i,this.awayMessage=s,this.applyBusinessHoursState()}catch(t){console.warn("[Basjoo Widget] Could not refresh the business-hours state.",t)}}applyBusinessHoursState(){if(!this.chatWindow)return;let t=this.chatWindow.querySelector(".basjoo-input-area"),e=this.chatWindow.querySelector(".basjoo-away");if(this.isOnline)t&&(t.hidden=!1),e?.remove();else if(t&&(t.hidden=!0),e)e.textContent=this.awayMessage||this.getText("awayDefault");else{let n=document.createElement("div");n.className="basjoo-away",n.setAttribute("role","status"),n.textContent=this.awayMessage||this.getText("awayDefault"),this.chatWindow.appendChild(n)}this.headerHumanButton&&(this.headerHumanButton.hidden=!this.isOnline||this.sessionMode==="human")}renderModeNotice(){if(!this.chatWindow)return;let t=this.chatWindow.querySelector(".basjoo-notice");if(!t)return;if(this.sessionMode!=="human"){t.hidden=!0,t.textContent="",this.humanNoticeBar=null,this._continueAiClickListener=null,this.headerHumanButton&&(this.headerHumanButton.hidden=!this.isOnline);return}if(this.headerHumanButton&&(this.headerHumanButton.hidden=!0),this.humanNoticeBar===t)return;t.textContent="",t.hidden=!1;let e=document.createElement("span");e.className="basjoo-notice-text",e.textContent=this.getText("takenOverNotice");let n=document.createElement("button");n.type="button",n.className="basjoo-continue-ai",n.textContent=this.getText("continueWithAi"),this._continueAiClickListener=()=>{this.releaseToAi()},n.addEventListener("click",this._continueAiClickListener),t.appendChild(e),t.appendChild(n),this.humanNoticeBar=t}setSessionMode(t){this.sessionMode=t,this.applyBusinessHoursState(),this.renderModeNotice()}async requestHumanHandoff(){if(!this.sessionId){this.showError(this.getText("humanNeedsSession"));return}try{let t=await fetch(`${this.config.apiBase}/api/v1/chat/escalate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent_id:this.config.agentId,session_id:this.sessionId,visitor_id:this.visitorId,reason:this.getText("talkToHuman")})});if(!t.ok)throw new Error(`HTTP ${t.status}`);this.setSessionMode("human"),this.addMessage({role:"assistant",content:this.getText("takenOverNotice"),timestamp:new Date}),this.startPolling()}catch(t){console.error("[Basjoo Widget] Failed to request a human handoff:",t),this.showError(this.getText("humanFailed"))}}async releaseToAi(){if(this.sessionId)try{let t=await fetch(`${this.config.apiBase}/api/v1/chat/release`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent_id:this.config.agentId,session_id:this.sessionId,visitor_id:this.visitorId})});if(!t.ok)throw new Error(`HTTP ${t.status}`);this.setSessionMode("ai")}catch(t){console.error("[Basjoo Widget] Failed to release the session to AI:",t),this.showError(this.getText("humanFailed"))}}toggle(){if(this.isOpen){this.close();return}this.open()}open(t=!1){this.isOpen=!0,this.chatWindow?.classList.remove("closing"),this.chatWindow?.classList.add("open"),this.persistOpenState(),this.stopTitleBlink(),this.updateUnreadBadge();let e=this.chatWindow?.querySelector(".basjoo-input");setTimeout(()=>{e&&!e.closest(".basjoo-input-area[hidden]")&&!t&&e.focus()},300)}close(){this.isOpen=!1,this.chatWindow?.classList.remove("open"),this.chatWindow?.classList.add("closing"),this.persistOpenState()}persistOpenState(){this.hasFinePointer()&&this.storage.setItem(this.openStateStorageKey,this.isOpen?"open":"closed")}getRequestLocale(){return this.config.language&&this.config.language!=="auto"?this.config.language:navigator.language||"en-US"}getText(t){let e={sendFailed:{"en-US":"Send failed, please try again later","zh-CN":"\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"},networkError:{"en-US":"Network connection failed, please check your connection","zh-CN":"\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC"},quotaExceeded:{"en-US":"Daily message limit reached","zh-CN":"\u4ECA\u65E5\u6D88\u606F\u5DF2\u8FBE\u4E0A\u9650"},takenOverNotice:{"en-US":"Your conversation has been transferred to a human agent. Please wait for their reply.","zh-CN":"\u5DF2\u8F6C\u63A5\u4EBA\u5DE5\u5BA2\u670D\uFF0C\u8BF7\u7B49\u5F85\u56DE\u590D\u3002"},inputPlaceholder:{"en-US":"Type your question...","zh-CN":"\u8F93\u5165\u60A8\u7684\u95EE\u9898..."},messageTooLong:{"en-US":"Message too long (max 2000 characters)","zh-CN":"\u6D88\u606F\u8FC7\u957F\uFF08\u6700\u591A2000\u5B57\u7B26\uFF09"},greetingBubble:{"en-US":"Hi! How can I help you?","zh-CN":"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u60A8\uFF1F"},newMessage:{"en-US":"New message","zh-CN":"\u65B0\u6D88\u606F"},thinking:{"en-US":"Thinking...","zh-CN":"\u601D\u8003\u4E2D..."},references:{"en-US":"References","zh-CN":"\u53C2\u8003\u6765\u6E90"},talkToHuman:{"en-US":"Talk to a human","zh-CN":"\u8F6C\u4EBA\u5DE5"},continueWithAi:{"en-US":"Continue with AI","zh-CN":"\u7EE7\u7EED\u7531 AI \u56DE\u7B54"},awayDefault:{"en-US":"We are away right now. Leave a message and we will get back to you.","zh-CN":"\u5F53\u524D\u975E\u670D\u52A1\u65F6\u95F4\uFF0C\u8BF7\u7559\u8A00\uFF0C\u6211\u4EEC\u4F1A\u5C3D\u5FEB\u56DE\u590D\u3002"},closeWindow:{"en-US":"Close","zh-CN":"\u5173\u95ED"},humanNeedsSession:{"en-US":"Send a message first, then you can ask for a human.","zh-CN":"\u8BF7\u5148\u53D1\u9001\u4E00\u6761\u6D88\u606F\uFF0C\u7136\u540E\u518D\u8F6C\u4EBA\u5DE5\u3002"},humanFailed:{"en-US":"Could not reach a human agent. Please try again.","zh-CN":"\u8F6C\u4EBA\u5DE5\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"},degradedNotice:{"en-US":"Quota reached \u2014 answering with the fallback model","zh-CN":"\u989D\u5EA6\u7528\u5C3D\uFF0C\u5DF2\u4F7F\u7528\u5907\u7528\u6A21\u578B"}};return this.getRequestLocale().toLowerCase().startsWith("zh")?e[t]["zh-CN"]||e[t]["en-US"]||t:e[t]["en-US"]||e[t]["zh-CN"]||t}escapeHtml(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}sanitizeUrlAttribute(t){try{let e=new URL(t);if(e.protocol==="http:"||e.protocol==="https:")return this.escapeHtml(t)}catch{}return""}renderMarkdown(t){if(!t)return"";let e=t.replace(/\r\n/g,`
`).split(/\n{2,}/).map(s=>s.trim()).filter(Boolean),n=s=>{let o=this.escapeHtml(s);return o=o.replace(/`([^`]+)`/g,"<code>$1</code>"),o=o.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>"),o=o.replace(/__([^_]+)__/g,"<strong>$1</strong>"),o=o.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g,"$1<em>$2</em>"),o=o.replace(/(^|[^_])_([^_]+)_(?!_)/g,"$1<em>$2</em>"),o=o.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(a,c,d)=>{let h=c,l=this.sanitizeUrlAttribute(d);return l?`<a href="${l}" target="_blank" rel="noopener noreferrer">${h}</a>`:h}),o};return e.map(s=>{if(/^```/.test(s)&&/```$/.test(s)){let o=s.replace(/^```\w*\n?/,"").replace(/```$/,"");return`<pre><code>${this.escapeHtml(o)}</code></pre>`}if(/^(?:[-*]\s.+\n?)+$/.test(s))return`<ul>${s.split(`
`).map(a=>a.replace(/^[-*]\s+/,"").trim()).filter(Boolean).map(a=>`<li>${n(a)}</li>`).join("")}</ul>`;if(/^(?:\d+\.\s.+\n?)+$/.test(s))return`<ol>${s.split(`
`).map(a=>a.replace(/^\d+\.\s+/,"").trim()).filter(Boolean).map(a=>`<li>${n(a)}</li>`).join("")}</ol>`;if(/^>\s?/.test(s)){let o=s.split(`
`).map(a=>a.replace(/^>\s?/,"")).join("<br>");return`<blockquote>${n(o)}</blockquote>`}if(/^#{1,6}\s/.test(s)){let o=s.replace(/^#{1,6}\s+/,"");return`<p><strong>${n(o)}</strong></p>`}return`<p>${n(s).replace(/\n/g,"<br>")}</p>`}).join("")}updateMessageContent(t,e,n=!1){t.innerHTML=this.renderMarkdown(e)+(n?'<span class="basjoo-stream-cursor"></span>':"")}createMessageElement(t){let e=document.createElement("div");e.className=`basjoo-message basjoo-message-${t.role}`;let n=document.createElement("div");if(n.className="basjoo-message-content",t.role==="assistant"){let s=N(t.content,t.sources),o=s.references.length>0?`

**${this.getText("references")}**
${s.references.map(a=>`- [${a.title}](${a.url})`).join(`
`)}`:"";this.updateMessageContent(n,s.content+o)}else this.updateMessageContent(n,t.content);e.appendChild(n);let i=document.createElement("div");return i.className="basjoo-message-time",i.textContent=t.timestamp.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),e.appendChild(i),e}formatThinkingText(){return`${this.getText("thinking")} ${this.thinkingElapsed}s`}showThinkingIndicator(t=0){this.hideLoading(),this.currentStreamContent.trim()||(this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null),this.thinkingElapsed=t;let e=this.chatWindow?.querySelector(".basjoo-messages");if(e){if(!this.thinkingIndicator){let n=document.createElement("div");n.className="basjoo-thinking",n.innerHTML=`
        <span class="basjoo-thinking-spinner"></span>
        <span>${this.getText("thinking")}</span>
      `,e.appendChild(n),this.thinkingIndicator=n,this.thinkingIndicatorText=n.querySelector("span:last-child")}this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText()),e.scrollTop=e.scrollHeight,this.thinkingTimerId===null&&(this.thinkingTimerId=window.setInterval(()=>{this.thinkingElapsed+=1,this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText())},1e3))}}hideThinkingIndicator(){this.thinkingTimerId!==null&&(window.clearInterval(this.thinkingTimerId),this.thinkingTimerId=null),this.thinkingIndicator?.remove(),this.thinkingIndicator=null,this.thinkingIndicatorText=null,this.thinkingElapsed=0}removeStreamingMessage(){this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}createStreamingMessage(t=!1){let e=this.chatWindow?.querySelector(".basjoo-messages"),n=document.createElement("div");n.className="basjoo-message basjoo-message-assistant";let i=document.createElement("div");return i.className="basjoo-message-content",this.updateMessageContent(i,this.currentStreamContent,t),n.appendChild(i),e?(e.appendChild(n),e.scrollTop=e.scrollHeight,this.streamingMessage=n,this.streamingMessageContent=i,this.currentStreamContent="",n):(this.streamingMessage=n,this.streamingMessageContent=i,this.currentStreamContent="",n)}appendToStreamingMessage(t){(!this.streamingMessage||!this.streamingMessageContent)&&(this.hideThinkingIndicator(),this.createStreamingMessage()),this.currentStreamContent+=t,this.streamingMessageContent&&this.updateMessageContent(this.streamingMessageContent,this.currentStreamContent,!0);let e=this.chatWindow?.querySelector(".basjoo-messages");e&&(e.scrollTop=e.scrollHeight)}finalizeStreamingMessage(t=[]){if(!this.streamingMessage||!this.streamingMessageContent)return;if(!this.currentStreamContent.trim()){this.removeStreamingMessage();return}this.streamingMessage.querySelector(".basjoo-stream-cursor")?.remove(),this.currentStreamSources=t;let n=N(this.currentStreamContent,t),i=n.references.length>0?`

**${this.getText("references")}**
${n.references.map(a=>`- [${a.title}](${a.url})`).join(`
`)}`:"",s=n.content+i;this.updateMessageContent(this.streamingMessageContent,s),this.messages.push({role:"assistant",content:s,sources:t,timestamp:new Date});let o=this.chatWindow?.querySelector(".basjoo-messages");o.scrollTop=o.scrollHeight,this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}addMessage(t){this.messages.push(t);let e=this.chatWindow?.querySelector(".basjoo-messages");if(!t.content){console.error("Message content is null or undefined:",t);return}if(!e)return;let n=this.createMessageElement(t);e.appendChild(n),e.scrollTop=e.scrollHeight,t.role==="assistant"&&!this.isOpen&&(this.hasUnread=!0,this.updateUnreadBadge())}showLoading(){let t=this.chatWindow?.querySelector(".basjoo-messages");if(!t)return;let e=document.createElement("div");e.className="basjoo-loading",e.id="basjoo-loading",e.innerHTML=`
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
    `,t.appendChild(e),t.scrollTop=t.scrollHeight}hideLoading(){this.chatWindow?.querySelector("#basjoo-loading")?.remove()}showError(t){let e=this.chatWindow?.querySelector(".basjoo-messages");if(!e)return;let n=document.createElement("div");n.className="basjoo-error",n.textContent=t,e.appendChild(n),e.scrollTop=e.scrollHeight,setTimeout(()=>n.remove(),5e3)}showDegradedNotice(t){let e=this.chatWindow?.querySelector(".basjoo-messages");if(!e)return;let n=document.createElement("div");n.className="basjoo-degraded",n.setAttribute("role","status"),n.textContent=t?`${this.getText("degradedNotice")} \xB7 ${t}`:this.getText("degradedNotice"),e.appendChild(n),e.scrollTop=e.scrollHeight}startPolling(){this.pollIntervalId||(this.pollIntervalId=window.setInterval(()=>this.pollMessages(),3e3))}stopPolling(){this.pollIntervalId&&(clearInterval(this.pollIntervalId),this.pollIntervalId=null)}async pollMessages(){if(this.sessionId)try{let t=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&visitor_id=${encodeURIComponent(this.visitorId)}&after_id=${this.lastMessageId}&role=assistant`);if(!t.ok)return;let e=await t.json();for(let n of e)n.content&&(this.addMessage({role:n.role==="user"?"user":"assistant",content:n.content,sources:n.sources,timestamp:new Date}),this.isOpen||this.startTitleBlink()),n.id>this.lastMessageId&&(this.lastMessageId=n.id)}catch{}}cleanupAfterStreamError(){this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage()}async consumeStream(t){if(!t.body)throw new Error("Streaming response body is unavailable");let e=t.body.getReader(),n=new TextDecoder,i="",s=!1,o=d=>{if(!d.trim())return;let h="message",l=[];for(let g of d.split(`
`))g.startsWith("event:")?h=g.slice(6).trim():g.startsWith("data:")&&l.push(g.slice(5).trimStart());if(!l.length)return;let u=JSON.parse(l.join(`
`));switch(h){case"sources":this.currentStreamSources=Array.isArray(u.sources)?u.sources:[];break;case"thinking":this.showThinkingIndicator(typeof u.elapsed=="number"?u.elapsed:0);break;case"thinking_done":this.hideThinkingIndicator();break;case"content":{let g=u.content||"";this.appendToStreamingMessage(g);break}case"done":{let g=u;g.session_id&&(this.sessionId=g.session_id,this.storage.setItem(this.STORAGE_KEY,g.session_id),this.startPolling()),typeof g.message_id=="number"&&g.message_id>this.lastMessageId&&(this.lastMessageId=g.message_id),g.taken_over?(this.removeStreamingMessage(),this.setSessionMode("human"),this.addMessage({role:"assistant",content:this.getText("takenOverNotice"),timestamp:new Date})):(g.mode==="human"&&this.setSessionMode("human"),this.finalizeStreamingMessage(this.currentStreamSources),g.degraded&&this.showDegradedNotice(g.model),this.isOpen||this.startTitleBlink()),s=!0;break}case"error":{let g=u,b=new Error(g.error||"Stream failed");throw g.code&&(b.name=g.code),b}default:break}},a=()=>{let d=i.indexOf(`\r
\r
`),h=i.indexOf(`

`);return d===-1&&h===-1?null:d===-1?{index:h,length:2}:h===-1?{index:d,length:4}:d<h?{index:d,length:4}:{index:h,length:2}},c=9e4;for(;!s;){if(this.streamAbortController?.signal.aborted){e.cancel();return}let d=null;try{let{done:h,value:l}=await Promise.race([e.read(),new Promise((g,b)=>{d=window.setTimeout(()=>b(new Error("Stream read timeout")),c)})]);i+=n.decode(l||new Uint8Array,{stream:!h});let u=a();for(;u;){let g=i.slice(0,u.index);if(i=i.slice(u.index+u.length),o(g.replace(/\r\n/g,`
`)),s)break;u=a()}if(h)break}finally{d!==null&&window.clearTimeout(d)}}if(!s&&(i.trim()&&o(i),!s))throw new Error("Stream ended unexpectedly")}abortStream(){this.streamAbortController?.abort(),this.streamAbortController=null}async sendMessageWithRetry(t){let e=null;for(let n=0;n<=1;n++){this.abortStream(),this.streamAbortController=new AbortController;try{let i=Intl.DateTimeFormat().resolvedOptions().timeZone,s=await fetch(`${this.config.apiBase}/api/v1/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},signal:this.streamAbortController.signal,body:JSON.stringify({agent_id:this.config.agentId,message:t,locale:this.getRequestLocale(),session_id:this.sessionId||void 0,visitor_id:this.visitorId,timezone:i,context_before:r.pageContext.before||void 0,context_after:r.pageContext.after||void 0})});if(!s.ok){let o=`HTTP ${s.status}: ${s.statusText}`;try{let a=await s.json();o=a.message||a.detail||o}catch{}throw new Error(o)}this.hideLoading(),await this.consumeStream(s);return}catch(i){e=i;let s=String(i?.message||"");if(!(!(this.currentStreamContent.trim().length>0)&&(i instanceof TypeError||s.includes("fetch")||s.includes("Failed to fetch")||s.includes("Stream ended unexpectedly")))||n>=1)throw this.cleanupAfterStreamError(),i;this.cleanupAfterStreamError(),console.warn(`[Basjoo Widget] Stream attempt ${n+1} failed, retrying...`),await new Promise(c=>window.setTimeout(c,1e3)),this.showLoading()}}throw e}async sendMessage(t){if(!this.isSending){this.isSending=!0,this.addMessage({role:"user",content:t,timestamp:new Date}),this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage(),this.createStreamingMessage(!0);try{await this.sendMessageWithRetry(t)}catch(e){console.error("[Basjoo Widget] Error sending message:",e);let n=this.getText("sendFailed"),i="",s=String(e?.message||"");e instanceof TypeError||s.includes("fetch")?(n=this.getText("networkError"),i=`Request may be blocked by CORS, network connectivity, or an incorrect apiBase. Current apiBase: ${this.config.apiBase||"(not set)"}`):s.includes("429")||s.toLowerCase().includes("quota")?n=this.getText("quotaExceeded"):e?.name==="ORIGIN_NOT_ALLOWED"||s.toLowerCase().includes("widget origin not allowed")?(n=this.getText("sendFailed"),i="Widget request was blocked because the current page origin is not on the allowed domain list."):s.includes("401")&&(i="Authentication failed. Please check the agent configuration and public API access."),this.config.apiBase||(i="apiBase could not be determined. When embedding the widget from a local file, set apiBase explicitly or load the SDK from the target server."),i&&console.error("[Basjoo Widget]",i),this.showError(n)}finally{this.isSending=!1}}}destroy(){this.stopPolling(),this.stopTitleBlink(),this.stopOnlineWatcher(),this.hideThinkingIndicator(),this.removeStreamingMessage(),this.abortStream(),this.button&&this._buttonClickListener&&this.button.removeEventListener("click",this._buttonClickListener);let t=this.chatWindow?.querySelector(".basjoo-close");t&&this._closeBtnClickListener&&t.removeEventListener("click",this._closeBtnClickListener);let e=this.chatWindow?.querySelector(".basjoo-send");e&&this._sendBtnClickListener&&e.removeEventListener("click",this._sendBtnClickListener);let n=this.chatWindow?.querySelector(".basjoo-input");n&&this._inputKeypressListener&&n.removeEventListener("keypress",this._inputKeypressListener),this.headerHumanButton&&this._humanBtnClickListener&&this.headerHumanButton.removeEventListener("click",this._humanBtnClickListener);let i=this.humanNoticeBar?.querySelector(".basjoo-continue-ai");i&&this._continueAiClickListener&&i.removeEventListener("click",this._continueAiClickListener),this.humanNoticeBar=null,this.headerHumanButton=null,this._cardActionListeners=[],this._starterClickListeners=[],this.iframeElement=null,this.mountTarget=null,this.container?.remove(),document.getElementById("basjoo-widget-styles")?.remove()}};window.BasjooWidget=f;window.Basjoo={Widget:f,setContext:r=>f.setContext(r),init:r=>{let t=new f(r);return t.init(),t}};function m(r,t){for(let e of t){let n=r.get(e);if(n&&n.trim())return n.trim()}return null}function Q(){if(document.currentScript instanceof HTMLScriptElement)return document.currentScript;let r=Array.from(document.querySelectorAll("script[src]"));for(let t=r.length-1;t>=0;t-=1){let e=r[t],n=e.getAttribute("src")||"";if(n.includes("sdk.js"))try{let i=new URL(n,window.location.href);if(m(i.searchParams,p.agentId))return e}catch{continue}}return null}function Z(r){let t=r.getAttribute("src")||r.src;if(!t)return null;let e;try{e=new URL(t,window.location.href)}catch{return null}let n=m(e.searchParams,p.agentId);if(!n)return null;let i={agentId:n},s=m(e.searchParams,p.apiBase);s&&(i.apiBase=s);let o=m(e.searchParams,p.themeColor);o&&(i.themeColor=o);let a=m(e.searchParams,p.welcomeMessage);a&&(i.welcomeMessage=a);let c=m(e.searchParams,p.language);c&&(i.language=c);let d=m(e.searchParams,p.position);(d==="left"||d==="right")&&(i.position=d);let h=m(e.searchParams,p.theme);return(h==="light"||h==="dark"||h==="auto")&&(i.theme=h),i}(function(){let t=window,e=O();if(e&&typeof e.agent_id=="string"&&e.agent_id){if(t.__basjooWidgetAutoInitScheduled)return;t.__basjooWidgetAutoInitScheduled=!0;let o=()=>{new f({agentId:e.agent_id}).init()};if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",o,{once:!0});return}o();return}let n=Q();if(!n)return;let i=Z(n);if(!i||t.__basjooWidgetAutoInitScheduled)return;t.__basjooWidgetAutoInitScheduled=!0;let s=()=>{new f(i).init()};if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",s,{once:!0});return}s()})();})();
//# sourceMappingURL=basjoo-widget.min.js.map
