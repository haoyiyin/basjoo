"use strict";(()=>{var U="#F9CA02",w=U,y="6px",S="10px",j="14px",C="9999px",T="4px",$="8px",M="12px",k="16px",I="20px",E="24px",L="1.25",_="1.4",B="1.5",A="'Outfit', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif",P="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",H={surface:"hsl(30, 7%, 9.5%)",surfaceRaised:"hsl(30, 8%, 12.5%)",surfaceSunken:"hsl(30, 6%, 13%)",textPrimary:"hsl(40, 20%, 96%)",textSecondary:"hsl(40, 10%, 76%)",textMuted:"hsl(40, 8%, 63%)",textInverse:"hsl(40, 30%, 8%)",border:"hsl(35, 12%, 46%)",borderFocus:"hsl(48, 96%, 49%)",accent:"hsl(48, 96%, 49%)",accentContrast:"hsl(40, 30%, 8%)",error:"hsl(352, 80%, 68%)",errorBg:"hsl(352, 22%, 15%)",success:"hsl(150, 55%, 52%)",successBg:"hsl(150, 20%, 13%)",radiusSm:y,radiusMd:S,radiusLg:j,radiusFull:C,space1:T,space2:$,space3:M,space4:k,space5:I,space6:E,shadow1:"0 1px 2px hsl(30, 40%, 2%, 0.28)",shadow2:"0 2px 6px hsl(30, 40%, 2%, 0.32), 0 8px 20px -12px hsl(30, 40%, 2%, 0.4)",shadow3:"0 12px 32px -16px hsl(30, 40%, 2%, 0.55), 0 2px 8px hsl(30, 40%, 2%, 0.3)",fontDisplay:A,fontText:P,elevation1:"0 1px 2px hsl(30, 40%, 2%, 0.35), 0 0 0 1px hsl(35, 12%, 46%)",elevation2:"0 2px 4px hsl(30, 40%, 2%, 0.5), 0 0 0 1px hsl(35, 12%, 46%)",elevation3:"0 12px 32px hsl(30, 40%, 2%, 0.5), 0 0 0 1px hsl(35, 12%, 46%)",leadingTight:L,leadingSnug:_,leadingNormal:B},D={surface:"hsl(40, 30%, 97.5%)",surfaceRaised:"hsl(40, 25%, 100%)",surfaceSunken:"hsl(40, 15%, 90%)",textPrimary:"hsl(30, 25%, 11%)",textSecondary:"hsl(30, 14%, 30%)",textMuted:"hsl(30, 10%, 40%)",textInverse:"hsl(0, 0%, 100%)",border:"hsl(35, 12%, 46%)",borderFocus:"hsl(38, 92%, 26%)",accent:"hsl(38, 92%, 26%)",accentContrast:"hsl(0, 0%, 100%)",error:"hsl(348, 78%, 38%)",errorBg:"hsl(348, 80%, 95%)",success:"hsl(154, 85%, 24%)",successBg:"hsl(152, 60%, 94%)",radiusSm:y,radiusMd:S,radiusLg:j,radiusFull:C,space1:T,space2:$,space3:M,space4:k,space5:I,space6:E,shadow1:"0 1px 2px hsl(30, 30%, 20%, 0.12)",shadow2:"0 2px 6px hsl(30, 30%, 20%, 0.14), 0 8px 20px -12px hsl(30, 30%, 20%, 0.18)",shadow3:"0 12px 32px -16px hsl(30, 30%, 20%, 0.24), 0 2px 8px hsl(30, 30%, 20%, 0.12)",fontDisplay:A,fontText:P,elevation1:"0 1px 2px hsl(30, 30%, 20%, 0.12), 0 0 0 1px hsl(35, 12%, 46%)",elevation2:"0 2px 4px hsl(30, 30%, 20%, 0.18), 0 0 0 1px hsl(35, 12%, 46%)",elevation3:"0 12px 32px hsl(30, 30%, 20%, 0.18), 0 0 0 1px hsl(35, 12%, 46%)",leadingTight:L,leadingSnug:_,leadingNormal:B},x={light:D,dark:H};function R(h){return h?x.dark:x.light}function W(h,t=[]){if(!h)return{content:h,references:[]};let e=[],s=new Set,i=new Map;for(let o of t)o.type!=="url"||typeof o.url!="string"||!/^https?:\/\//.test(o.url)||i.has(o.url)||i.set(o.url,o);let n=o=>{if(s.has(o))return;s.add(o);let c=i.get(o);e.push({title:c?.title?.trim()||o,url:o})};return{content:h.replace(/\[([^\]]+)\]\((#source-(\d+)|https?:\/\/[^\s)]+)\)/g,(o,c,a,l)=>{if(l){let g=Number(l)-1,u=t[g];return u&&u.type==="url"&&u.url&&/^https?:\/\//.test(u.url)&&n(u.url),c}return i.has(a)?(n(a),c):o}),references:e}}var p={agentId:["agentId","agent_id"],apiBase:["apiBase","api_base"],themeColor:["themeColor","theme_color"],welcomeMessage:["welcomeMessage","welcome_message"],language:["language","locale"],position:["position"],theme:["theme"]};function N(h){if(!h)return"/basjoo-logo.png";try{return new URL("/basjoo-logo.png",`${h}/`).toString()}catch{return"/basjoo-logo.png"}}var v=class{constructor(){this.memoryStore=new Map;this.storageAvailable=null}isAvailable(){if(this.storageAvailable!==null)return this.storageAvailable;try{let t="__storage_test__";return window.localStorage.setItem(t,"test"),window.localStorage.removeItem(t),this.storageAvailable=!0,!0}catch{return this.storageAvailable=!1,!1}}getItem(t){if(this.isAvailable())try{return window.localStorage.getItem(t)}catch{}return this.memoryStore.get(t)??null}setItem(t,e){if(this.isAvailable())try{window.localStorage.setItem(t,e);return}catch{}this.memoryStore.set(t,e)}removeItem(t){if(this.isAvailable())try{window.localStorage.removeItem(t);return}catch{}this.memoryStore.delete(t)}},b=class{constructor(t){this.container=null;this.button=null;this.unreadBadge=null;this.chatWindow=null;this.messages=[];this.sessionId=null;this.isOpen=!1;this.VISITOR_STORAGE_KEY="basjoo_visitor_id";this.effectiveTheme="light";this.originalTitle="";this.titleBlinkInterval=null;this.hasUnread=!1;this.pollIntervalId=null;this.lastMessageId=0;this.isSending=!1;this.streamAbortController=null;this.streamingMessage=null;this.streamingMessageContent=null;this.thinkingIndicator=null;this.thinkingIndicatorText=null;this.thinkingElapsed=0;this.thinkingTimerId=null;this.currentStreamContent="";this.currentStreamSources=[];this._buttonClickListener=null;this._closeBtnClickListener=null;this._sendBtnClickListener=null;this._inputKeypressListener=null;let e=this.detectApiBase(t.apiBase);this.hasTitleOverride=typeof t.title=="string"&&t.title.trim().length>0,this.hasWelcomeMessageOverride=typeof t.welcomeMessage=="string"&&t.welcomeMessage.trim().length>0,this.config={agentId:t.agentId,apiBase:e,themeColor:t.themeColor||"",logoUrl:t.logoUrl||N(e),title:t.title||"AI\u52A9\u624B",welcomeMessage:t.welcomeMessage||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F",language:t.language||"auto",position:t.position||"right",theme:t.theme||"auto"},this.STORAGE_KEY=`basjoo_session_${this.config.agentId}`,this.storage=new v,this.sessionId=this.storage.getItem(this.STORAGE_KEY),this.visitorId=this.storage.getItem(this.VISITOR_STORAGE_KEY)||this.generateVisitorId(),this.effectiveTheme=this.getEffectiveTheme()}generateVisitorId(){let t=`visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,11)}`;return this.storage.setItem(this.VISITOR_STORAGE_KEY,t),t}detectApiBase(t){if(t)try{let n=new URL(t,window.location.href);if((n.protocol==="http:"||n.protocol==="https:")&&n.port==="3000"){let r=`${n.protocol}//${n.hostname}:8000`;return console.info("[Basjoo Widget] Rewriting configured dev apiBase to direct backend:",r),r}return n.toString().replace(/\/$/,"")}catch{return t}let e=document.currentScript;if(e instanceof HTMLScriptElement&&e.src)try{let n=new URL(e.src,window.location.href);return console.info("[Basjoo Widget] Detected API base from current script:",n.origin),n.origin}catch{}let s=document.querySelectorAll("script[src]");for(let n of s){let r=n.getAttribute("src")||"";if(!(!r.includes("sdk.js")&&!r.includes("basjoo")))try{let o=new URL(r,window.location.href);return console.info("[Basjoo Widget] Detected API base from script src:",o.origin),o.origin}catch{}}let i=window.location.port;if(i==="3000"||i==="5173"){let n=`${window.location.protocol}//${window.location.hostname}:8000`;return console.info("[Basjoo Widget] Development mode detected, using:",n),n}return window.location.protocol==="file:"?(console.error("[Basjoo Widget] Cannot determine API base from a local file. Please set apiBase explicitly."),""):(console.warn("[Basjoo Widget] Falling back to window.location.origin. Set apiBase explicitly if the API is hosted elsewhere."),window.location.origin)}getEffectiveTheme(){return this.config.theme==="light"||this.config.theme==="dark"?this.config.theme:typeof window<"u"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}async loadPublicConfig(){if(!this.config.apiBase){console.warn("[Basjoo Widget] Skipping public config fetch because apiBase could not be determined.");return}try{let t=new URL(`${this.config.apiBase}/api/v1/config:public`);this.config.agentId&&t.searchParams.set("agent_id",this.config.agentId);let e=await fetch(t.toString());if(!e.ok)throw new Error(`HTTP ${e.status}: ${e.statusText}`);let s=await e.json();!this.config.agentId&&s.default_agent_id&&(this.config.agentId=s.default_agent_id),this.config.themeColor=this.config.themeColor||s.widget_color||w,this.hasTitleOverride||(this.config.title=s.widget_title||"AI\u52A9\u624B"),this.hasWelcomeMessageOverride||(this.config.welcomeMessage=s.welcome_message||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F"),this.effectiveTheme=this.getEffectiveTheme()}catch(t){console.warn("[Basjoo Widget] Failed to load public config, using defaults.",t),t instanceof TypeError&&console.warn("[Basjoo Widget] Public config request may be blocked by CORS, network issues, or an incorrect apiBase:",this.config.apiBase)}}async init(){if(!document.body){console.warn("[Basjoo Widget] document.body is not available yet. Call init() after DOMContentLoaded or place the embed code near the end of <body>.");return}if(document.getElementById("basjoo-widget-container")){console.warn("[Basjoo Widget] Initialization skipped because #basjoo-widget-container already exists. Avoid loading or initializing the widget twice on the same page.");return}if(await this.loadPublicConfig(),this.originalTitle=document.title,this.createStyles(),this.createContainer(),this.createButton(),this.createChatWindow(),this.showGreetingBubble(),this.startTitleBlink(),this.sessionId){this.loadHistory();return}this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date})}showGreetingBubble(){if(!this.button)return;let t=document.createElement("div");t.className="basjoo-greeting-bubble",t.textContent=this.getText("greetingBubble");let e=this.config.position;t.style.position="fixed",t.style.bottom="100px",t.style[e]="24px",t.style.zIndex="9999",document.body.appendChild(t),setTimeout(()=>{t.remove()},5e3)}async loadHistory(){if(this.sessionId){try{let t=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&visitor_id=${encodeURIComponent(this.visitorId)}`);if(!t.ok)throw new Error("Failed to load history");let e=await t.json();if(e&&e.length>0){for(let s of e)this.addMessage({role:s.role==="user"?"user":"assistant",content:s.content,sources:s.sources,timestamp:new Date}),s.id>this.lastMessageId&&(this.lastMessageId=s.id);this.startPolling();return}}catch{}this.sessionId=null,this.storage.removeItem(this.STORAGE_KEY),this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date})}}startTitleBlink(){if(this.titleBlinkInterval)return;this.hasUnread=!0,this.updateUnreadBadge();let t=!0;this.titleBlinkInterval=window.setInterval(()=>{document.title=t?this.originalTitle:"\u2757 "+this.getText("newMessage"),t=!t},1e3)}stopTitleBlink(){this.titleBlinkInterval&&(clearInterval(this.titleBlinkInterval),this.titleBlinkInterval=null),document.title=this.originalTitle,this.hasUnread=!1,this.updateUnreadBadge()}createStyles(){let t=document.createElement("style");t.id="basjoo-widget-styles";let e=R(this.effectiveTheme==="dark");t.textContent=`
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
    `,document.head.appendChild(t)}parseColor(t){let e=(t||"").trim(),s=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(e);if(s){let n=s[1],r=n.length===3?n.split("").map(o=>parseInt(o+o,16)):[0,2,4].map(o=>parseInt(n.slice(o,o+2),16));return{r:r[0],g:r[1],b:r[2]}}let i=/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(e);if(i){let n=(Number.parseFloat(i[1])%360+360)%360,r=Number.parseFloat(i[2])/100,o=Number.parseFloat(i[3])/100,c=(1-Math.abs(2*o-1))*r,a=c*(1-Math.abs(n/60%2-1)),l=o-c/2,g;return n<60?g=[c,a,0]:n<120?g=[a,c,0]:n<180?g=[0,c,a]:n<240?g=[0,a,c]:n<300?g=[a,0,c]:g=[c,0,a],{r:Math.round((g[0]+l)*255),g:Math.round((g[1]+l)*255),b:Math.round((g[2]+l)*255)}}return null}adjustColor(t,e){let s=this.parseColor(t);if(!s)return t;let i=c=>Math.max(0,Math.min(255,c+e)),n=i(s.r),r=i(s.g),o=i(s.b);return`#${(n<<16|r<<8|o).toString(16).padStart(6,"0")}`}hexToRgba(t,e){let s=this.parseColor(t)??this.parseColor(w),{r:i,g:n,b:r}=s??{r:0,g:0,b:0};return`rgba(${i}, ${n}, ${r}, ${e})`}updateUnreadBadge(){if(this.button){if(this.hasUnread){if(!this.unreadBadge){let t=document.createElement("span");t.className="basjoo-unread-badge",t.textContent="1",this.button.appendChild(t),this.unreadBadge=t}return}this.unreadBadge?.remove(),this.unreadBadge=null}}createContainer(){this.container=document.createElement("div"),this.container.id="basjoo-widget-container",document.body.appendChild(this.container)}createButton(){this.button=document.createElement("div"),this.button.id="basjoo-widget-button",this.button.innerHTML=`
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
    `,this._buttonClickListener=()=>this.toggle(),this.button.addEventListener("click",this._buttonClickListener),this.container.appendChild(this.button),this.updateUnreadBadge()}createChatWindow(){this.chatWindow=document.createElement("div"),this.chatWindow.id="basjoo-chat-window";let t=this.config.logoUrl?this.sanitizeUrlAttribute(this.config.logoUrl):"",e=this.escapeHtml(this.config.title),s=this.escapeHtml(this.getText("inputPlaceholder"));this.chatWindow.innerHTML=`
      <div class="basjoo-header">
        <div class="basjoo-header-title">
          ${t?`<img src="${t}" class="basjoo-header-logo" alt="">`:""}
          <span>${e}</span>
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
        <input type="text" class="basjoo-input" placeholder="${s}" maxlength="2000">
        <button class="basjoo-send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    `;let i=this.chatWindow.querySelector(".basjoo-close");this._closeBtnClickListener=()=>this.close(),i.addEventListener("click",this._closeBtnClickListener);let n=this.chatWindow.querySelector(".basjoo-input"),r=this.chatWindow.querySelector(".basjoo-send");this._sendBtnClickListener=()=>{if(this.isSending)return;let o=n.value.trim();if(o){if(o.length>2e3){this.showError(this.getText("messageTooLong"));return}this.sendMessage(o),n.value=""}},r.addEventListener("click",this._sendBtnClickListener),this._inputKeypressListener=o=>{o.key==="Enter"&&this._sendBtnClickListener?.()},n.addEventListener("keypress",this._inputKeypressListener),this.container.appendChild(this.chatWindow)}toggle(){if(this.isOpen){this.close();return}this.open()}open(){this.isOpen=!0,this.chatWindow?.classList.remove("closing"),this.chatWindow?.classList.add("open"),this.stopTitleBlink(),this.updateUnreadBadge();let t=this.chatWindow?.querySelector(".basjoo-input");setTimeout(()=>{t?.focus()},300)}close(){this.isOpen=!1,this.chatWindow?.classList.remove("open"),this.chatWindow?.classList.add("closing")}getRequestLocale(){return this.config.language&&this.config.language!=="auto"?this.config.language:navigator.language||"en-US"}getText(t){let e={sendFailed:{"en-US":"Send failed, please try again later","zh-CN":"\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"},networkError:{"en-US":"Network connection failed, please check your connection","zh-CN":"\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC"},quotaExceeded:{"en-US":"Daily message limit reached","zh-CN":"\u4ECA\u65E5\u6D88\u606F\u5DF2\u8FBE\u4E0A\u9650"},takenOverNotice:{"en-US":"Your conversation has been transferred to a human agent. Please wait for their reply.","zh-CN":"\u5DF2\u8F6C\u63A5\u4EBA\u5DE5\u5BA2\u670D\uFF0C\u8BF7\u7B49\u5F85\u56DE\u590D\u3002"},inputPlaceholder:{"en-US":"Type your question...","zh-CN":"\u8F93\u5165\u60A8\u7684\u95EE\u9898..."},messageTooLong:{"en-US":"Message too long (max 2000 characters)","zh-CN":"\u6D88\u606F\u8FC7\u957F\uFF08\u6700\u591A2000\u5B57\u7B26\uFF09"},greetingBubble:{"en-US":"Hi! How can I help you?","zh-CN":"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u60A8\uFF1F"},newMessage:{"en-US":"New message","zh-CN":"\u65B0\u6D88\u606F"},thinking:{"en-US":"Thinking...","zh-CN":"\u601D\u8003\u4E2D..."},references:{"en-US":"References","zh-CN":"\u53C2\u8003\u6765\u6E90"}};return this.getRequestLocale().toLowerCase().startsWith("zh")?e[t]["zh-CN"]||e[t]["en-US"]||t:e[t]["en-US"]||e[t]["zh-CN"]||t}escapeHtml(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}sanitizeUrlAttribute(t){try{let e=new URL(t);if(e.protocol==="http:"||e.protocol==="https:")return this.escapeHtml(t)}catch{}return""}renderMarkdown(t){if(!t)return"";let e=t.replace(/\r\n/g,`
`).split(/\n{2,}/).map(n=>n.trim()).filter(Boolean),s=n=>{let r=this.escapeHtml(n);return r=r.replace(/`([^`]+)`/g,"<code>$1</code>"),r=r.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>"),r=r.replace(/__([^_]+)__/g,"<strong>$1</strong>"),r=r.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g,"$1<em>$2</em>"),r=r.replace(/(^|[^_])_([^_]+)_(?!_)/g,"$1<em>$2</em>"),r=r.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(o,c,a)=>{let l=c,g=this.sanitizeUrlAttribute(a);return g?`<a href="${g}" target="_blank" rel="noopener noreferrer">${l}</a>`:l}),r};return e.map(n=>{if(/^```/.test(n)&&/```$/.test(n)){let r=n.replace(/^```\w*\n?/,"").replace(/```$/,"");return`<pre><code>${this.escapeHtml(r)}</code></pre>`}if(/^(?:[-*]\s.+\n?)+$/.test(n))return`<ul>${n.split(`
`).map(o=>o.replace(/^[-*]\s+/,"").trim()).filter(Boolean).map(o=>`<li>${s(o)}</li>`).join("")}</ul>`;if(/^(?:\d+\.\s.+\n?)+$/.test(n))return`<ol>${n.split(`
`).map(o=>o.replace(/^\d+\.\s+/,"").trim()).filter(Boolean).map(o=>`<li>${s(o)}</li>`).join("")}</ol>`;if(/^>\s?/.test(n)){let r=n.split(`
`).map(o=>o.replace(/^>\s?/,"")).join("<br>");return`<blockquote>${s(r)}</blockquote>`}if(/^#{1,6}\s/.test(n)){let r=n.replace(/^#{1,6}\s+/,"");return`<p><strong>${s(r)}</strong></p>`}return`<p>${s(n).replace(/\n/g,"<br>")}</p>`}).join("")}updateMessageContent(t,e,s=!1){t.innerHTML=this.renderMarkdown(e)+(s?'<span class="basjoo-stream-cursor"></span>':"")}createMessageElement(t){let e=document.createElement("div");e.className=`basjoo-message basjoo-message-${t.role}`;let s=document.createElement("div");if(s.className="basjoo-message-content",t.role==="assistant"){let n=W(t.content,t.sources),r=n.references.length>0?`

**${this.getText("references")}**
${n.references.map(o=>`- [${o.title}](${o.url})`).join(`
`)}`:"";this.updateMessageContent(s,n.content+r)}else this.updateMessageContent(s,t.content);e.appendChild(s);let i=document.createElement("div");return i.className="basjoo-message-time",i.textContent=t.timestamp.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),e.appendChild(i),e}formatThinkingText(){return`${this.getText("thinking")} ${this.thinkingElapsed}s`}showThinkingIndicator(t=0){this.hideLoading(),this.currentStreamContent.trim()||(this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null),this.thinkingElapsed=t;let e=this.chatWindow?.querySelector(".basjoo-messages");if(e){if(!this.thinkingIndicator){let s=document.createElement("div");s.className="basjoo-thinking",s.innerHTML=`
        <span class="basjoo-thinking-spinner"></span>
        <span>${this.getText("thinking")}</span>
      `,e.appendChild(s),this.thinkingIndicator=s,this.thinkingIndicatorText=s.querySelector("span:last-child")}this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText()),e.scrollTop=e.scrollHeight,this.thinkingTimerId===null&&(this.thinkingTimerId=window.setInterval(()=>{this.thinkingElapsed+=1,this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText())},1e3))}}hideThinkingIndicator(){this.thinkingTimerId!==null&&(window.clearInterval(this.thinkingTimerId),this.thinkingTimerId=null),this.thinkingIndicator?.remove(),this.thinkingIndicator=null,this.thinkingIndicatorText=null,this.thinkingElapsed=0}removeStreamingMessage(){this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}createStreamingMessage(t=!1){let e=this.chatWindow?.querySelector(".basjoo-messages"),s=document.createElement("div");s.className="basjoo-message basjoo-message-assistant";let i=document.createElement("div");return i.className="basjoo-message-content",this.updateMessageContent(i,this.currentStreamContent,t),s.appendChild(i),e?(e.appendChild(s),e.scrollTop=e.scrollHeight,this.streamingMessage=s,this.streamingMessageContent=i,this.currentStreamContent="",s):(this.streamingMessage=s,this.streamingMessageContent=i,this.currentStreamContent="",s)}appendToStreamingMessage(t){(!this.streamingMessage||!this.streamingMessageContent)&&(this.hideThinkingIndicator(),this.createStreamingMessage()),this.currentStreamContent+=t,this.streamingMessageContent&&this.updateMessageContent(this.streamingMessageContent,this.currentStreamContent,!0);let e=this.chatWindow?.querySelector(".basjoo-messages");e&&(e.scrollTop=e.scrollHeight)}finalizeStreamingMessage(t=[]){if(!this.streamingMessage||!this.streamingMessageContent)return;if(!this.currentStreamContent.trim()){this.removeStreamingMessage();return}this.streamingMessage.querySelector(".basjoo-stream-cursor")?.remove(),this.currentStreamSources=t;let s=W(this.currentStreamContent,t),i=s.references.length>0?`

**${this.getText("references")}**
${s.references.map(o=>`- [${o.title}](${o.url})`).join(`
`)}`:"",n=s.content+i;this.updateMessageContent(this.streamingMessageContent,n),this.messages.push({role:"assistant",content:n,sources:t,timestamp:new Date});let r=this.chatWindow?.querySelector(".basjoo-messages");r.scrollTop=r.scrollHeight,this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}addMessage(t){this.messages.push(t);let e=this.chatWindow?.querySelector(".basjoo-messages");if(!t.content){console.error("Message content is null or undefined:",t);return}if(!e)return;let s=this.createMessageElement(t);e.appendChild(s),e.scrollTop=e.scrollHeight,t.role==="assistant"&&!this.isOpen&&(this.hasUnread=!0,this.updateUnreadBadge())}showLoading(){let t=this.chatWindow?.querySelector(".basjoo-messages");if(!t)return;let e=document.createElement("div");e.className="basjoo-loading",e.id="basjoo-loading",e.innerHTML=`
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
    `,t.appendChild(e),t.scrollTop=t.scrollHeight}hideLoading(){this.chatWindow?.querySelector("#basjoo-loading")?.remove()}showError(t){let e=this.chatWindow?.querySelector(".basjoo-messages");if(!e)return;let s=document.createElement("div");s.className="basjoo-error",s.textContent=t,e.appendChild(s),e.scrollTop=e.scrollHeight,setTimeout(()=>s.remove(),5e3)}startPolling(){this.pollIntervalId||(this.pollIntervalId=window.setInterval(()=>this.pollMessages(),3e3))}stopPolling(){this.pollIntervalId&&(clearInterval(this.pollIntervalId),this.pollIntervalId=null)}async pollMessages(){if(this.sessionId)try{let t=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&visitor_id=${encodeURIComponent(this.visitorId)}&after_id=${this.lastMessageId}&role=assistant`);if(!t.ok)return;let e=await t.json();for(let s of e)s.content&&(this.addMessage({role:s.role==="user"?"user":"assistant",content:s.content,sources:s.sources,timestamp:new Date}),this.isOpen||this.startTitleBlink()),s.id>this.lastMessageId&&(this.lastMessageId=s.id)}catch{}}cleanupAfterStreamError(){this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage()}async consumeStream(t){if(!t.body)throw new Error("Streaming response body is unavailable");let e=t.body.getReader(),s=new TextDecoder,i="",n=!1,r=a=>{if(!a.trim())return;let l="message",g=[];for(let d of a.split(`
`))d.startsWith("event:")?l=d.slice(6).trim():d.startsWith("data:")&&g.push(d.slice(5).trimStart());if(!g.length)return;let u=JSON.parse(g.join(`
`));switch(l){case"sources":this.currentStreamSources=Array.isArray(u.sources)?u.sources:[];break;case"thinking":this.showThinkingIndicator(typeof u.elapsed=="number"?u.elapsed:0);break;case"thinking_done":this.hideThinkingIndicator();break;case"content":{let d=u.content||"";this.appendToStreamingMessage(d);break}case"done":{let d=u;d.session_id&&(this.sessionId=d.session_id,this.storage.setItem(this.STORAGE_KEY,d.session_id),this.startPolling()),typeof d.message_id=="number"&&d.message_id>this.lastMessageId&&(this.lastMessageId=d.message_id),d.taken_over?(this.removeStreamingMessage(),this.addMessage({role:"assistant",content:this.getText("takenOverNotice"),timestamp:new Date})):(this.finalizeStreamingMessage(this.currentStreamSources),this.isOpen||this.startTitleBlink()),n=!0;break}case"error":{let d=u,f=new Error(d.error||"Stream failed");throw d.code&&(f.name=d.code),f}default:break}},o=()=>{let a=i.indexOf(`\r
\r
`),l=i.indexOf(`

`);return a===-1&&l===-1?null:a===-1?{index:l,length:2}:l===-1?{index:a,length:4}:a<l?{index:a,length:4}:{index:l,length:2}},c=9e4;for(;!n;){if(this.streamAbortController?.signal.aborted){e.cancel();return}let a=null;try{let{done:l,value:g}=await Promise.race([e.read(),new Promise((d,f)=>{a=window.setTimeout(()=>f(new Error("Stream read timeout")),c)})]);i+=s.decode(g||new Uint8Array,{stream:!l});let u=o();for(;u;){let d=i.slice(0,u.index);if(i=i.slice(u.index+u.length),r(d.replace(/\r\n/g,`
`)),n)break;u=o()}if(l)break}finally{a!==null&&window.clearTimeout(a)}}if(!n&&(i.trim()&&r(i),!n))throw new Error("Stream ended unexpectedly")}abortStream(){this.streamAbortController?.abort(),this.streamAbortController=null}async sendMessageWithRetry(t){let e=null;for(let s=0;s<=1;s++){this.abortStream(),this.streamAbortController=new AbortController;try{let i=Intl.DateTimeFormat().resolvedOptions().timeZone,n=await fetch(`${this.config.apiBase}/api/v1/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},signal:this.streamAbortController.signal,body:JSON.stringify({agent_id:this.config.agentId,message:t,locale:this.getRequestLocale(),session_id:this.sessionId||void 0,visitor_id:this.visitorId,timezone:i})});if(!n.ok){let r=`HTTP ${n.status}: ${n.statusText}`;try{let o=await n.json();r=o.message||o.detail||r}catch{}throw new Error(r)}this.hideLoading(),await this.consumeStream(n);return}catch(i){e=i;let n=String(i?.message||"");if(!(!(this.currentStreamContent.trim().length>0)&&(i instanceof TypeError||n.includes("fetch")||n.includes("Failed to fetch")||n.includes("Stream ended unexpectedly")))||s>=1)throw this.cleanupAfterStreamError(),i;this.cleanupAfterStreamError(),console.warn(`[Basjoo Widget] Stream attempt ${s+1} failed, retrying...`),await new Promise(c=>window.setTimeout(c,1e3)),this.showLoading()}}throw e}async sendMessage(t){if(!this.isSending){this.isSending=!0,this.addMessage({role:"user",content:t,timestamp:new Date}),this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage(),this.createStreamingMessage(!0);try{await this.sendMessageWithRetry(t)}catch(e){console.error("[Basjoo Widget] Error sending message:",e);let s=this.getText("sendFailed"),i="",n=String(e?.message||"");e instanceof TypeError||n.includes("fetch")?(s=this.getText("networkError"),i=`Request may be blocked by CORS, network connectivity, or an incorrect apiBase. Current apiBase: ${this.config.apiBase||"(not set)"}`):n.includes("429")||n.toLowerCase().includes("quota")?s=this.getText("quotaExceeded"):e?.name==="ORIGIN_NOT_ALLOWED"||n.toLowerCase().includes("widget origin not allowed")?(s=this.getText("sendFailed"),i="Widget request was blocked because the current page origin is not on the allowed domain list."):n.includes("401")&&(i="Authentication failed. Please check the agent configuration and public API access."),this.config.apiBase||(i="apiBase could not be determined. When embedding the widget from a local file, set apiBase explicitly or load the SDK from the target server."),i&&console.error("[Basjoo Widget]",i),this.showError(s)}finally{this.isSending=!1}}}destroy(){this.stopPolling(),this.stopTitleBlink(),this.hideThinkingIndicator(),this.removeStreamingMessage(),this.abortStream(),this.button&&this._buttonClickListener&&this.button.removeEventListener("click",this._buttonClickListener);let t=this.chatWindow?.querySelector(".basjoo-close");t&&this._closeBtnClickListener&&t.removeEventListener("click",this._closeBtnClickListener);let e=this.chatWindow?.querySelector(".basjoo-send");e&&this._sendBtnClickListener&&e.removeEventListener("click",this._sendBtnClickListener);let s=this.chatWindow?.querySelector(".basjoo-input");s&&this._inputKeypressListener&&s.removeEventListener("keypress",this._inputKeypressListener),this.container?.remove(),document.getElementById("basjoo-widget-styles")?.remove()}};window.BasjooWidget=b;function m(h,t){for(let e of t){let s=h.get(e);if(s&&s.trim())return s.trim()}return null}function O(){if(document.currentScript instanceof HTMLScriptElement)return document.currentScript;let h=Array.from(document.querySelectorAll("script[src]"));for(let t=h.length-1;t>=0;t-=1){let e=h[t],s=e.getAttribute("src")||"";if(s.includes("sdk.js"))try{let i=new URL(s,window.location.href);if(m(i.searchParams,p.agentId))return e}catch{continue}}return null}function q(h){let t=h.getAttribute("src")||h.src;if(!t)return null;let e;try{e=new URL(t,window.location.href)}catch{return null}let s=m(e.searchParams,p.agentId);if(!s)return null;let i={agentId:s},n=m(e.searchParams,p.apiBase);n&&(i.apiBase=n);let r=m(e.searchParams,p.themeColor);r&&(i.themeColor=r);let o=m(e.searchParams,p.welcomeMessage);o&&(i.welcomeMessage=o);let c=m(e.searchParams,p.language);c&&(i.language=c);let a=m(e.searchParams,p.position);(a==="left"||a==="right")&&(i.position=a);let l=m(e.searchParams,p.theme);return(l==="light"||l==="dark"||l==="auto")&&(i.theme=l),i}(function(){let t=window,e=O();if(!e)return;let s=q(e);if(!s||t.__basjooWidgetAutoInitScheduled)return;t.__basjooWidgetAutoInitScheduled=!0;let i=()=>{new b(s).init()};if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",i,{once:!0});return}i()})();})();
//# sourceMappingURL=basjoo-widget.min.js.map
