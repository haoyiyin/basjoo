"use strict";(()=>{var V="#F9CA02",y=V,k="6px",M="10px",T="14px",$="9999px",I="4px",E="8px",L="12px",_="16px",B="20px",A="24px",H="1.25",N="1.4",R="1.5",P="'Outfit', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif",W="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",G={surface:"hsl(30, 7%, 9.5%)",surfaceRaised:"hsl(30, 8%, 12.5%)",surfaceSunken:"hsl(30, 6%, 13%)",textPrimary:"hsl(40, 20%, 96%)",textSecondary:"hsl(40, 10%, 76%)",textMuted:"hsl(40, 8%, 63%)",textInverse:"hsl(40, 30%, 8%)",border:"hsl(35, 12%, 46%)",borderFocus:"hsl(48, 96%, 49%)",accent:"hsl(48, 96%, 49%)",accentContrast:"hsl(40, 30%, 8%)",error:"hsl(352, 80%, 68%)",errorBg:"hsl(352, 22%, 15%)",success:"hsl(150, 55%, 52%)",successBg:"hsl(150, 20%, 13%)",radiusSm:k,radiusMd:M,radiusLg:T,radiusFull:$,space1:I,space2:E,space3:L,space4:_,space5:B,space6:A,shadow1:"0 1px 2px hsl(30, 40%, 2%, 0.28)",shadow2:"0 2px 6px hsl(30, 40%, 2%, 0.32), 0 8px 20px -12px hsl(30, 40%, 2%, 0.4)",shadow3:"0 12px 32px -16px hsl(30, 40%, 2%, 0.55), 0 2px 8px hsl(30, 40%, 2%, 0.3)",fontDisplay:P,fontText:W,elevation1:"0 1px 2px hsl(30, 40%, 2%, 0.35), 0 0 0 1px hsl(35, 12%, 46%)",elevation2:"0 2px 4px hsl(30, 40%, 2%, 0.5), 0 0 0 1px hsl(35, 12%, 46%)",elevation3:"0 12px 32px hsl(30, 40%, 2%, 0.5), 0 0 0 1px hsl(35, 12%, 46%)",leadingTight:H,leadingSnug:N,leadingNormal:R},K={surface:"hsl(40, 30%, 97.5%)",surfaceRaised:"hsl(40, 25%, 100%)",surfaceSunken:"hsl(40, 15%, 90%)",textPrimary:"hsl(30, 25%, 11%)",textSecondary:"hsl(30, 14%, 30%)",textMuted:"hsl(30, 10%, 40%)",textInverse:"hsl(0, 0%, 100%)",border:"hsl(35, 12%, 46%)",borderFocus:"hsl(38, 92%, 26%)",accent:"hsl(38, 92%, 26%)",accentContrast:"hsl(0, 0%, 100%)",error:"hsl(348, 78%, 38%)",errorBg:"hsl(348, 80%, 95%)",success:"hsl(154, 85%, 24%)",successBg:"hsl(152, 60%, 94%)",radiusSm:k,radiusMd:M,radiusLg:T,radiusFull:$,space1:I,space2:E,space3:L,space4:_,space5:B,space6:A,shadow1:"0 1px 2px hsl(30, 30%, 20%, 0.12)",shadow2:"0 2px 6px hsl(30, 30%, 20%, 0.14), 0 8px 20px -12px hsl(30, 30%, 20%, 0.18)",shadow3:"0 12px 32px -16px hsl(30, 30%, 20%, 0.24), 0 2px 8px hsl(30, 30%, 20%, 0.12)",fontDisplay:P,fontText:W,elevation1:"0 1px 2px hsl(30, 30%, 20%, 0.12), 0 0 0 1px hsl(35, 12%, 46%)",elevation2:"0 2px 4px hsl(30, 30%, 20%, 0.18), 0 0 0 1px hsl(35, 12%, 46%)",elevation3:"0 12px 32px hsl(30, 30%, 20%, 0.18), 0 0 0 1px hsl(35, 12%, 46%)",leadingTight:H,leadingSnug:N,leadingNormal:R},j={light:K,dark:G};function U(r){return r?j.dark:j.light}function O(r,t=[]){if(!r)return{content:r,references:[]};let e=[],i=new Set,n=new Map;for(let o of t)o.type!=="url"||typeof o.url!="string"||!/^https?:\/\//.test(o.url)||n.has(o.url)||n.set(o.url,o);let s=o=>{if(i.has(o))return;i.add(o);let l=n.get(o);e.push({title:l?.title?.trim()||o,url:o})};return{content:r.replace(/\[([^\]]+)\]\((#source-(\d+)|https?:\/\/[^\s)]+)\)/g,(o,l,c,h)=>{if(h){let d=Number(h)-1,p=t[d];return p&&p.type==="url"&&p.url&&/^https?:\/\//.test(p.url)&&s(p.url),l}return n.has(c)?(s(c),l):o}),references:e}}var f={agentId:["agentId","agent_id"],apiBase:["apiBase","api_base"],themeColor:["themeColor","theme_color"],welcomeMessage:["welcomeMessage","welcome_message"],language:["language","locale"],position:["position"],theme:["theme"]};function Y(r){if(!r)return"/basjoo-logo.png";try{return new URL("/basjoo-logo.png",`${r}/`).toString()}catch{return"/basjoo-logo.png"}}var q="#basjoo-chat",J="(pointer: fine)",X="basjoo_open_",Q="basjoo_rollout_",w=1e3,x=5,Z=5*1024*1024;function z(){let r=window.__BASJOO_CONFIG__;return!r||typeof r!="object"?null:r}function ee(r){if(typeof r!="string")return!1;let t=r.lastIndexOf(":");if(t<=0)return!1;let e=r.slice(t+1);return e.length===64&&/^[0-9a-f]{64}$/.test(e)}function te(r,t){if(!Array.isArray(t))return!1;for(let e of t)if(!(typeof e!="string"||!e))try{if(new RegExp(e).test(r))return!0}catch{console.warn(`[Basjoo Widget] Ignoring an invalid excluded_paths pattern: ${e}`)}return!1}function ie(r,t){let e=typeof r.path=="string"?r.path.trim():"";if(!e)return!0;try{return new RegExp(e).test(t)}catch{return console.warn(`[Basjoo Widget] Ignoring an invalid starter path pattern: ${e}`),!0}}function ne(){try{return window.location.origin}catch{return""}}function se(r,t,e){if(t>=100)return!0;if(t<=0)return!1;let i=`${Q}${r}`,n=e.getItem(i);if(n==="in")return!0;if(n==="out")return!1;let s=Math.random()*100<t;return e.setItem(i,s?"in":"out"),s}function F(r){if(typeof r!="string"||!r.trim())return"";let t=r.trim();try{let e=new URL(t,window.location.href);return e.protocol!=="http:"&&e.protocol!=="https:"?"":e.toString()}catch{return""}}var C=class{constructor(){this.memoryStore=new Map;this.storageAvailable=null}isAvailable(){if(this.storageAvailable!==null)return this.storageAvailable;try{let t="__storage_test__";return window.localStorage.setItem(t,"test"),window.localStorage.removeItem(t),this.storageAvailable=!0,!0}catch{return this.storageAvailable=!1,!1}}getItem(t){if(this.isAvailable())try{return window.localStorage.getItem(t)}catch{}return this.memoryStore.get(t)??null}setItem(t,e){if(this.isAvailable())try{window.localStorage.setItem(t,e);return}catch{}this.memoryStore.set(t,e)}removeItem(t){if(this.isAvailable())try{window.localStorage.removeItem(t);return}catch{}this.memoryStore.delete(t)}},m=class r{constructor(t){this.container=null;this.button=null;this.unreadBadge=null;this.chatWindow=null;this.messages=[];this.sessionId=null;this.isOpen=!1;this.VISITOR_STORAGE_KEY="basjoo_visitor_id";this.identitySigned=!1;this.identityRequired=!1;this.effectiveTheme="light";this.originalTitle="";this.titleBlinkInterval=null;this.hasUnread=!1;this.pollIntervalId=null;this.lastMessageId=0;this.isSending=!1;this.streamAbortController=null;this.streamingMessage=null;this.streamingMessageContent=null;this.thinkingIndicator=null;this.thinkingIndicatorText=null;this.thinkingElapsed=0;this.thinkingTimerId=null;this.currentStreamContent="";this.currentStreamSources=[];this.sessionMode="ai";this.isOnline=!0;this.awayMessage="";this.humanNoticeBar=null;this.headerHumanButton=null;this.onlineCheckIntervalId=null;this._buttonClickListener=null;this._closeBtnClickListener=null;this._sendBtnClickListener=null;this._inputKeypressListener=null;this._humanBtnClickListener=null;this._continueAiClickListener=null;this.displayMode="bubble";this.mountTarget=null;this.iframeElement=null;this.cardsRendered=!1;this._cardActionListeners=[];this._starterClickListeners=[];this.pendingAttachments=[];this.uploadsInFlight=0;this.prechatMode="off";this.aiDisclosure="";this.prechatValues=null;this.prechatPending=!1;this.prechatSkipped=!1;this.headerMenuButton=null;this.headerMenu=null;this.newChatButton=null;this.endChatButton=null;this.realTurnCount=0;this._menuBtnClickListener=null;this._newChatClickListener=null;this._endChatClickListener=null;this._attachBtnClickListener=null;this._attachInputChangeListener=null;this._prechatSubmitListener=null;this._prechatSkipClickListener=null;this._documentClickListener=null;this.embed=z();let e=this.embed?.agent_id,i=this.embed?.api_base,n=this.detectApiBase(t.apiBase||i),s=t.agentId||e||"";if(this.hasTitleOverride=typeof t.title=="string"&&t.title.trim().length>0,this.hasWelcomeMessageOverride=typeof t.welcomeMessage=="string"&&t.welcomeMessage.trim().length>0,this.config={agentId:s,apiBase:n,themeColor:t.themeColor||"",logoUrl:t.logoUrl||Y(n),title:t.title||"AI\u52A9\u624B",welcomeMessage:t.welcomeMessage||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F",language:t.language||"auto",position:t.position||"right",theme:t.theme||"auto"},this.STORAGE_KEY=`basjoo_session_${this.config.agentId}`,this.openStateStorageKey=`${X}${this.config.agentId}`,this.storage=new C,this.sessionId=this.storage.getItem(this.STORAGE_KEY),this.visitorId=this.storage.getItem(this.VISITOR_STORAGE_KEY)||this.generateVisitorId(),this.identitySigned=ee(this.visitorId),r.instances.push(this),r.pendingIdentity!==void 0){let o=r.pendingIdentity;r.pendingIdentity=void 0,this.identify(o)}let a=this.embed?.display_mode;this.displayMode=a==="inline"||a==="iframe"?a:"bubble",this.effectiveTheme=this.getEffectiveTheme()}static{this.pageContext={before:"",after:""}}static{this.instances=[]}static{this.pendingIdentity=void 0}static setContext(t){let e=t&&typeof t=="object"?t:{};r.pageContext={before:typeof e.before=="string"?e.before:"",after:typeof e.after=="string"?e.after:""}}static applyIdentity(t){r.instances=r.instances.filter(e=>e.container?.isConnected??!1),r.instances.length===0&&(r.pendingIdentity=t??null);for(let e of r.instances.slice())e.identify(t??null)}identify(t){if(t==null){this.identitySigned=!1;let s=this.generateVisitorId();this.visitorId=s,this.clearSessionForIdentityChange(),this.applyBusinessHoursState(),this.renderModeNotice();return}let e=typeof t.email=="string"?t.email.trim().toLowerCase():"",i=typeof t.hash=="string"?t.hash.trim().toLowerCase():"";if(!e||!i){console.warn("[Basjoo Widget] identify() needs both `email` and `hash`; ignoring.",t);return}let n=`${e}:${i}`;n!==this.visitorId&&(this.visitorId=n,this.identitySigned=!0,this.storage.setItem(this.VISITOR_STORAGE_KEY,n),this.clearSessionForIdentityChange(),this.applyBusinessHoursState(),this.renderModeNotice(),this.chatWindow&&this.resumeIdentitySession())}clearSessionForIdentityChange(){this.sessionId=null,this.lastMessageId=0,this.storage.removeItem(this.STORAGE_KEY),this.stopPolling()}async resumeIdentitySession(){if(!this.identitySigned||!this.visitorId)return!1;try{let t=new URL(`${this.config.apiBase}/api/v1/chat/session:current`);t.searchParams.set("agent_id",this.config.agentId),t.searchParams.set("visitor_id",this.visitorId);let e=await fetch(t.toString());if(!e.ok)return!1;let i=await e.json();return i.session_id?(this.sessionId=i.session_id,this.storage.setItem(this.STORAGE_KEY,i.session_id),await this.loadHistory(),!0):!1}catch(t){return console.warn("[Basjoo Widget] Could not resume the signed-in visitor history.",t),!1}}generateVisitorId(){let t=`visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,11)}`;return this.storage.setItem(this.VISITOR_STORAGE_KEY,t),t}detectApiBase(t){if(t)try{let s=new URL(t,window.location.href);if((s.protocol==="http:"||s.protocol==="https:")&&s.port==="3000"){let a=`${s.protocol}//${s.hostname}:8000`;return console.info("[Basjoo Widget] Rewriting configured dev apiBase to direct backend:",a),a}return s.toString().replace(/\/$/,"")}catch{return t}let e=document.currentScript;if(e instanceof HTMLScriptElement&&e.src)try{let s=new URL(e.src,window.location.href);return console.info("[Basjoo Widget] Detected API base from current script:",s.origin),s.origin}catch{}let i=document.querySelectorAll("script[src]");for(let s of i){let a=s.getAttribute("src")||"";if(!(!a.includes("sdk.js")&&!a.includes("basjoo")))try{let o=new URL(a,window.location.href);return console.info("[Basjoo Widget] Detected API base from script src:",o.origin),o.origin}catch{}}let n=window.location.port;if(n==="3000"||n==="5173"){let s=`${window.location.protocol}//${window.location.hostname}:8000`;return console.info("[Basjoo Widget] Development mode detected, using:",s),s}return window.location.protocol==="file:"?(console.error("[Basjoo Widget] Cannot determine API base from a local file. Please set apiBase explicitly."),""):(console.warn("[Basjoo Widget] Falling back to window.location.origin. Set apiBase explicitly if the API is hosted elsewhere."),window.location.origin)}getEffectiveTheme(){return this.config.theme==="light"||this.config.theme==="dark"?this.config.theme:typeof window<"u"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}async loadPublicConfig(){if(!this.config.apiBase){console.warn("[Basjoo Widget] Skipping public config fetch because apiBase could not be determined.");return}try{let t=new URL(`${this.config.apiBase}/api/v1/config:public`);this.config.agentId&&t.searchParams.set("agent_id",this.config.agentId);let e=await fetch(t.toString());if(!e.ok)throw new Error(`HTTP ${e.status}: ${e.statusText}`);let i=await e.json();!this.config.agentId&&i.default_agent_id&&(this.config.agentId=i.default_agent_id),this.config.themeColor=this.config.themeColor||i.widget_color||y,this.hasTitleOverride||(this.config.title=i.widget_title||"AI\u52A9\u624B"),this.hasWelcomeMessageOverride||(this.config.welcomeMessage=i.welcome_message||"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u52A9\u60A8\u7684\u5417\uFF1F"),this.isOnline=i.online!==!1,this.awayMessage=(i.away_message||"").trim(),this.identityRequired=i.identity_required===!0;let n=typeof i.prechat_mode=="string"?i.prechat_mode:"";this.prechatMode=n==="optional"||n==="required"?n:"off",this.aiDisclosure=typeof i.ai_disclosure=="string"?i.ai_disclosure.trim():"",this.effectiveTheme=this.getEffectiveTheme()}catch(t){console.warn("[Basjoo Widget] Failed to load public config, using defaults.",t),t instanceof TypeError&&console.warn("[Basjoo Widget] Public config request may be blocked by CORS, network issues, or an incorrect apiBase:",this.config.apiBase)}}isOriginAllowed(){let t=(this.embed?.allowed_domains||[]).filter(i=>typeof i=="string"&&i.length>0);if(t.length===0)return!0;let e=ne();return t.includes(e)?!0:(console.error(`Basjoo: origin ${e||"(unknown)"} is not allowed for this agent (allowed: ${t.join(", ")})`),!1)}hasFinePointer(){return typeof window>"u"||typeof window.matchMedia!="function"?!1:window.matchMedia(J).matches}restoreOpenState(){this.hasFinePointer()&&this.storage.getItem(this.openStateStorageKey)==="open"&&this.open(!0)}async init(){if(!document.body){console.warn("[Basjoo Widget] document.body is not available yet. Call init() after DOMContentLoaded or place the embed code near the end of <body>.");return}if(document.getElementById("basjoo-widget-container")){console.warn("[Basjoo Widget] Initialization skipped because #basjoo-widget-container already exists. Avoid loading or initializing the widget twice on the same page.");return}if(te(window.location.pathname,this.embed?.excluded_paths)||!this.isOriginAllowed())return;let t=this.embed?.traffic_percentage;if(!(typeof t=="number"&&!se(this.config.agentId,t,this.storage))){if(await this.loadPublicConfig(),this.originalTitle=document.title,this.createStyles(),this.displayMode==="iframe"){this.mountIframe();return}if(this.displayMode==="inline"){if(!this.mountInline())return}else this.createContainer(),this.createButton();if(this.createChatWindow(),this.displayMode==="inline"?this.open(!0):(this.showGreetingBubble(),this.startTitleBlink()),this.startOnlineWatcher(),this.sessionId){this.loadHistory();return}if(this.identitySigned&&await this.resumeIdentitySession()){this.restoreOpenState();return}!this.renderCards()&&this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date}),this.renderStarters(),this.restoreOpenState()}}mountInline(){let t=this.embed?.inline_container||q,e=this.resolveMountTarget(t);if(!e)return console.warn(`[Basjoo Widget] Inline mode found no container matching "${t}". Add an element with that selector, or change the install setting.`),!1;this.mountTarget=e;let i=document.createElement("div");return i.className="basjoo-inline-host",e.appendChild(i),this.container=i,!0}mountIframe(){let t=this.embed?.inline_container||q,e=this.resolveMountTarget(t);if(!e){console.warn(`[Basjoo Widget] iframe mode found no container matching "${t}". Add an element with that selector, or change the install setting.`);return}this.mountTarget=e;let i=document.createElement("div");i.className="basjoo-inline-host";let n=document.createElement("iframe");n.className="basjoo-inline-frame",n.title=this.config.title;let s=new URL("/widget-demo",`${this.config.apiBase}/`);s.searchParams.set("agent_id",this.config.agentId),n.src=s.toString(),i.appendChild(n),e.appendChild(i),this.container=i,this.iframeElement=n}resolveMountTarget(t){try{return document.querySelector(t)}catch{return console.warn(`[Basjoo Widget] Ignoring an invalid container selector: ${t}`),null}}renderCards(){let t=(this.embed?.cards||[]).filter(n=>!!n&&typeof n=="object");if(t.length===0||this.cardsRendered)return!1;let e=this.chatWindow?.querySelector(".basjoo-messages");if(!e)return!1;this.cardsRendered=!0;let i=document.createElement("div");i.className="basjoo-cards";for(let n of t){let s=document.createElement("div");s.className="basjoo-card";let a=F(n.logo);if(a){let d=document.createElement("img");d.className="basjoo-card-logo",d.src=a,d.alt="",s.appendChild(d)}let o=typeof n.heading=="string"?n.heading.trim():"";if(o){let d=document.createElement("div");d.className="basjoo-card-heading",d.textContent=o,s.appendChild(d)}let l=typeof n.text=="string"?n.text.trim():"";if(l){let d=document.createElement("div");d.className="basjoo-card-text",d.textContent=l,s.appendChild(d)}let c=n.chat??n.kb_search??n.form,h=typeof c=="string"?c.trim():"";if(h){let d=document.createElement("button");d.type="button",d.className="basjoo-card-action",d.textContent=o||h;let p=()=>{this.sendMessage(h)};this._cardActionListeners.push(p),d.addEventListener("click",p),s.appendChild(d)}i.appendChild(s)}return e.appendChild(i),e.scrollTop=e.scrollHeight,!0}renderStarters(){let t=(this.embed?.starters||[]).filter(s=>!!s&&typeof s.label=="string"&&s.label.trim().length>0);if(t.length===0)return;let e=t.filter(s=>ie(s,window.location.pathname));if(e.length===0)return;let i=this.chatWindow?.querySelector(".basjoo-input-area");if(!i)return;let n=document.createElement("div");n.className="basjoo-starters";for(let s of e){let a=document.createElement("button");a.type="button",a.className="basjoo-starter",a.textContent=s.label||"";let o;if(s.action==="link"){let l=F(s.url??s.value);o=l?()=>{window.open(l,"_blank","noopener")}:()=>{console.warn(`[Basjoo Widget] Starter "${s.label}" has no usable link target.`)}}else{let l=(s.value??s.label??"").trim();o=()=>{this.sendMessage(l)}}this._starterClickListeners.push(o),a.addEventListener("click",o),n.appendChild(a)}i.parentNode?.insertBefore(n,i)}showGreetingBubble(){if(!this.button)return;let t=document.createElement("div");t.className="basjoo-greeting-bubble",t.textContent=this.getText("greetingBubble");let e=this.config.position;t.style.position="fixed",t.style.bottom="100px",t.style[e]="24px",t.style.zIndex="9999",document.body.appendChild(t),setTimeout(()=>{t.remove()},5e3)}async loadHistory(){if(this.sessionId){try{let t=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&visitor_id=${encodeURIComponent(this.visitorId)}`);if(!t.ok){if(await this.reportIdentityRejection(t))return;throw new Error("Failed to load history")}let e=await t.json();if(e&&e.length>0){let i=0;for(let n of e){if(this.realTurnCount+=1,n.role==="user")i=typeof n.rating=="number"?n.rating:0,this.addMessage({role:"user",content:n.content,sources:n.sources,timestamp:new Date});else{let s=n.sender_type==="human",a=n.mode==="human"||n.mode==="scripted"?n.mode:s?"human":"ai";this.addMessage({role:"assistant",content:n.content,sources:n.sources,timestamp:new Date,messageId:a==="human"?null:n.id,rating:a==="human"?0:i,answerMode:a})}n.id>this.lastMessageId&&(this.lastMessageId=n.id)}this.startPolling(),this.updateVisitorMenuState(),this.renderPrechat(),this.applyBusinessHoursState();return}}catch{}this.sessionId=null,this.storage.removeItem(this.STORAGE_KEY),this.renderPrechat(),this.applyBusinessHoursState(),this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date})}}startTitleBlink(){if(this.titleBlinkInterval)return;this.hasUnread=!0,this.updateUnreadBadge();let t=!0;this.titleBlinkInterval=window.setInterval(()=>{document.title=t?this.originalTitle:"\u2757 "+this.getText("newMessage"),t=!t},1e3)}stopTitleBlink(){this.titleBlinkInterval&&(clearInterval(this.titleBlinkInterval),this.titleBlinkInterval=null),document.title=this.originalTitle,this.hasUnread=!1,this.updateUnreadBadge()}createStyles(){let t=document.createElement("style");t.id="basjoo-widget-styles";let e=U(this.effectiveTheme==="dark");t.textContent=`
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
        border: 1px solid ${this.hexToRgba(e.accentContrast,.35)};
        background: ${this.hexToRgba(e.accentContrast,.15)};
        border-radius: 16px;
        cursor: pointer;
        color: ${e.accentContrast};
        font-size: 13px;
        font-weight: 500;
        transition: background 0.2s;
      }

      .basjoo-human:hover {
        background: ${this.hexToRgba(e.accentContrast,.28)};
      }

      .basjoo-human[hidden] {
        display: none;
      }

      .basjoo-human svg {
        flex-shrink: 0;
      }

      /* #75: the visitor menu (New chat / End chat) sits beside the handoff
         button; the panel is anchored to its wrapper so it cannot escape the
         header on a narrow phone. */
      .basjoo-menu-wrap {
        position: relative;
        display: flex;
        align-items: center;
      }

      .basjoo-menu-toggle {
        width: 32px;
        height: 32px;
        padding: 0;
        border: none;
        background: ${this.hexToRgba(e.accentContrast,.15)};
        border-radius: ${e.radiusSm};
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: ${e.accentContrast};
        transition: background 0.2s;
      }

      .basjoo-menu-toggle:hover {
        background: ${this.hexToRgba(e.accentContrast,.28)};
      }

      .basjoo-menu {
        position: absolute;
        top: 38px;
        right: 0;
        min-width: 168px;
        padding: ${e.space1};
        background: ${e.surfaceRaised};
        border: 1px solid ${e.border};
        border-radius: ${e.radiusMd};
        box-shadow: ${e.shadow2};
        display: flex;
        flex-direction: column;
        gap: 2px;
        z-index: 1;
      }

      .basjoo-menu[hidden] {
        display: none;
      }

      .basjoo-menu-item {
        min-height: 32px;
        padding: 0 ${e.space3};
        border: none;
        background: transparent;
        color: ${e.textPrimary};
        border-radius: ${e.radiusSm};
        font-size: 13px;
        text-align: left;
        cursor: pointer;
      }

      .basjoo-menu-item:hover:not(:disabled) {
        background: ${e.surfaceSunken};
      }

      .basjoo-menu-item:disabled {
        color: ${e.textMuted};
        opacity: 0.6;
        cursor: not-allowed;
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

      /* #73: the operator's AI-disclosure copy rides in the same bar as the
         human-handoff notice, so the widget still has exactly one notice slot. */
      .basjoo-disclosure {
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

      /* #60: the scripted-answer notice \u2014 one small line, muted, no fill. */
      .basjoo-scripted {
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

      /* #71: the attachment chips sit between the transcript and the composer,
         the same slot the starters use. */
      .basjoo-attachments {
        display: flex;
        flex-wrap: wrap;
        gap: ${e.space2};
        padding: ${e.space3} ${e.space5} 0 ${e.space5};
        border-top: 1px solid ${e.border};
        background: ${e.surface};
        flex-shrink: 0;
      }

      .basjoo-attachments[hidden] {
        display: none;
      }

      .basjoo-attachment {
        display: inline-flex;
        align-items: center;
        gap: ${e.space2};
        max-width: 100%;
        padding: ${e.space1} ${e.space2};
        border: 1px solid ${e.border};
        border-radius: ${e.radiusMd};
        background: ${e.surfaceRaised};
        color: ${e.textSecondary};
        font-size: 12px;
      }

      .basjoo-attachment-name {
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .basjoo-attachment-thumb {
        width: 28px;
        height: 28px;
        border-radius: ${e.radiusSm};
        object-fit: cover;
      }

      .basjoo-attachment-remove {
        padding: 0 ${e.space1};
        border: none;
        background: transparent;
        color: ${e.textMuted};
        font-size: 14px;
        line-height: 1;
        cursor: pointer;
      }

      .basjoo-attachment-remove:hover {
        color: ${e.error};
      }

      .basjoo-attach {
        width: 48px;
        height: 48px;
        border: 1px solid ${e.border};
        border-radius: ${e.radiusFull};
        background: ${e.surfaceRaised};
        color: ${e.textSecondary};
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .basjoo-attach:hover:not(:disabled) {
        border-color: ${this.config.themeColor};
      }

      .basjoo-attach:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .basjoo-attach svg {
        width: 20px;
        height: 20px;
        stroke: currentColor;
      }

      .basjoo-file-input {
        display: none;
      }

      /* #73: the prechat form. In "required" mode it *replaces* the composer
         until the visitor submits; in "optional" mode it sits above it and
         offers a skip. Either way the values are overlay state: they are sent
         as prechat on the first turn and never become transcript rows. */
      .basjoo-prechat {
        display: flex;
        flex-direction: column;
        gap: ${e.space2};
        padding: ${e.space4} ${e.space5} ${e.space5} ${e.space5};
        border-top: 1px solid ${e.border};
        background: ${e.surfaceRaised};
        flex-shrink: 0;
      }

      .basjoo-prechat[hidden] {
        display: none;
      }

      .basjoo-prechat-title {
        color: ${e.textPrimary};
        font-family: ${e.fontDisplay};
        font-size: 14px;
        font-weight: 600;
      }

      .basjoo-prechat-label {
        color: ${e.textMuted};
        font-size: 12px;
      }

      .basjoo-prechat-input {
        height: 40px;
        padding: 0 ${e.space3};
        border: 1px solid ${e.border};
        border-radius: ${e.radiusMd};
        background: ${e.surface};
        color: ${e.textPrimary};
        font-size: 14px;
        outline: none;
      }

      .basjoo-prechat-input:focus {
        border-color: ${this.config.themeColor};
      }

      .basjoo-prechat-error {
        color: ${e.error};
        font-size: 12px;
      }

      .basjoo-prechat-actions {
        display: flex;
        align-items: center;
        gap: ${e.space2};
        margin-top: ${e.space1};
      }

      .basjoo-prechat-submit {
        min-height: 32px;
        padding: 0 ${e.space4};
        border: none;
        border-radius: ${e.radiusFull};
        background: ${this.config.themeColor};
        color: ${e.accentContrast};
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }

      .basjoo-prechat-skip {
        min-height: 32px;
        padding: 0 ${e.space3};
        border: 1px solid ${e.border};
        border-radius: ${e.radiusFull};
        background: transparent;
        color: ${e.textSecondary};
        font-size: 13px;
        cursor: pointer;
      }

      /* #70: the thumbs row under an AI answer. */
      .basjoo-feedback {
        display: flex;
        align-items: center;
        gap: ${e.space1};
        margin-top: ${e.space1};
      }

      .basjoo-thumb {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid transparent;
        border-radius: ${e.radiusFull};
        background: transparent;
        color: ${e.textMuted};
        cursor: pointer;
        transition: color 0.2s, background 0.2s;
      }

      .basjoo-thumb:hover {
        color: ${e.textPrimary};
        background: ${e.surfaceSunken};
      }

      .basjoo-thumb[aria-pressed='true'] {
        color: ${e.accentContrast};
        background: ${this.config.themeColor};
        border-color: ${this.config.themeColor};
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
    `,document.head.appendChild(t)}parseColor(t){let e=(t||"").trim(),i=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(e);if(i){let s=i[1],a=s.length===3?s.split("").map(o=>parseInt(o+o,16)):[0,2,4].map(o=>parseInt(s.slice(o,o+2),16));return{r:a[0],g:a[1],b:a[2]}}let n=/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(e);if(n){let s=(Number.parseFloat(n[1])%360+360)%360,a=Number.parseFloat(n[2])/100,o=Number.parseFloat(n[3])/100,l=(1-Math.abs(2*o-1))*a,c=l*(1-Math.abs(s/60%2-1)),h=o-l/2,d;return s<60?d=[l,c,0]:s<120?d=[c,l,0]:s<180?d=[0,l,c]:s<240?d=[0,c,l]:s<300?d=[c,0,l]:d=[l,0,c],{r:Math.round((d[0]+h)*255),g:Math.round((d[1]+h)*255),b:Math.round((d[2]+h)*255)}}return null}adjustColor(t,e){let i=this.parseColor(t);if(!i)return t;let n=l=>Math.max(0,Math.min(255,l+e)),s=n(i.r),a=n(i.g),o=n(i.b);return`#${(s<<16|a<<8|o).toString(16).padStart(6,"0")}`}hexToRgba(t,e){let i=this.parseColor(t)??this.parseColor(y),{r:n,g:s,b:a}=i??{r:0,g:0,b:0};return`rgba(${n}, ${s}, ${a}, ${e})`}updateUnreadBadge(){if(this.button){if(this.hasUnread){if(!this.unreadBadge){let t=document.createElement("span");t.className="basjoo-unread-badge",t.textContent="1",this.button.appendChild(t),this.unreadBadge=t}return}this.unreadBadge?.remove(),this.unreadBadge=null}}createContainer(){this.container=document.createElement("div"),this.container.id="basjoo-widget-container",document.body.appendChild(this.container)}createButton(){this.button=document.createElement("div"),this.button.id="basjoo-widget-button",this.button.innerHTML=`
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
    `,this._buttonClickListener=()=>this.toggle(),this.button.addEventListener("click",this._buttonClickListener),this.container.appendChild(this.button),this.updateUnreadBadge()}createChatWindow(){this.chatWindow=document.createElement("div"),this.chatWindow.id="basjoo-chat-window";let t=this.config.logoUrl?this.sanitizeUrlAttribute(this.config.logoUrl):"",e=this.escapeHtml(this.config.title),i=this.escapeHtml(this.getText("inputPlaceholder")),n=this.escapeHtml(this.getText("talkToHuman")),s=this.escapeHtml(this.getText("visitorMenu")),a=this.escapeHtml(this.getText("newChat")),o=this.escapeHtml(this.getText("endChat")),l=this.escapeHtml(this.getText("attachFile"));this.chatWindow.innerHTML=`
      <div class="basjoo-header">
        <div class="basjoo-header-title">
          ${t?`<img src="${t}" class="basjoo-header-logo" alt="">`:""}
          <span>${e}</span>
        </div>
        <div class="basjoo-header-actions">
          <button class="basjoo-human" type="button" aria-label="${n}" title="${n}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="8.5" cy="7" r="4"></circle>
              <polyline points="17 11 19 13 23 9"></polyline>
            </svg>
            <span class="basjoo-human-label">${n}</span>
          </button>
          <div class="basjoo-menu-wrap">
            <button class="basjoo-menu-toggle" type="button" aria-label="${s}" title="${s}" aria-haspopup="true" aria-expanded="false">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="2"></circle>
                <circle cx="12" cy="12" r="2"></circle>
                <circle cx="12" cy="19" r="2"></circle>
              </svg>
            </button>
            <div class="basjoo-menu" role="menu" hidden>
              <button class="basjoo-menu-item basjoo-new-chat" type="button" role="menuitem" disabled>${a}</button>
              <button class="basjoo-menu-item basjoo-end-chat" type="button" role="menuitem" disabled>${o}</button>
            </div>
          </div>
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
      <form class="basjoo-prechat" hidden novalidate>
        <div class="basjoo-prechat-title">${this.escapeHtml(this.getText("prechatTitle"))}</div>
        <label class="basjoo-prechat-label" for="basjoo-prechat-name">${this.escapeHtml(this.getText("prechatName"))}</label>
        <input id="basjoo-prechat-name" class="basjoo-prechat-input basjoo-prechat-name-input" type="text" autocomplete="name" maxlength="120">
        <label class="basjoo-prechat-label" for="basjoo-prechat-email">${this.escapeHtml(this.getText("prechatEmail"))}</label>
        <input id="basjoo-prechat-email" class="basjoo-prechat-input basjoo-prechat-email-input" type="email" autocomplete="email" maxlength="255">
        <div class="basjoo-prechat-error" role="alert" hidden></div>
        <div class="basjoo-prechat-actions">
          <button class="basjoo-prechat-submit" type="submit">${this.escapeHtml(this.getText("prechatSubmit"))}</button>
          <button class="basjoo-prechat-skip" type="button" hidden>${this.escapeHtml(this.getText("prechatSkip"))}</button>
        </div>
      </form>
      <div class="basjoo-attachments" hidden></div>
      <div class="basjoo-input-area">
        <input type="text" class="basjoo-input" placeholder="${i}" maxlength="${w}">
        <input type="file" class="basjoo-file-input" multiple hidden accept=".txt,.md,.html,.pdf,.docx,.xlsx,.png,.jpg,.jpeg">
        <button class="basjoo-attach" type="button" aria-label="${l}" title="${l}">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
          </svg>
        </button>
        <button class="basjoo-send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    `;let c=this.chatWindow.querySelector(".basjoo-close");this._closeBtnClickListener=()=>this.close(),c.addEventListener("click",this._closeBtnClickListener);let h=this.chatWindow.querySelector(".basjoo-input"),d=this.chatWindow.querySelector(".basjoo-send");this._sendBtnClickListener=()=>{if(this.isSending||this.uploadsInFlight>0)return;let g=h.value.trim();if(g){if(g.length>w){this.showError(this.getText("messageTooLong"));return}this.sendMessage(g),h.value=""}},d.addEventListener("click",this._sendBtnClickListener),this._inputKeypressListener=g=>{g.key==="Enter"&&this._sendBtnClickListener?.()},h.addEventListener("keypress",this._inputKeypressListener),this.headerHumanButton=this.chatWindow.querySelector(".basjoo-human"),this._humanBtnClickListener=()=>{this.requestHumanHandoff()},this.headerHumanButton?.addEventListener("click",this._humanBtnClickListener),this.headerMenuButton=this.chatWindow.querySelector(".basjoo-menu-toggle"),this.headerMenu=this.chatWindow.querySelector(".basjoo-menu"),this.newChatButton=this.chatWindow.querySelector(".basjoo-new-chat"),this.endChatButton=this.chatWindow.querySelector(".basjoo-end-chat"),this._menuBtnClickListener=()=>{this.toggleVisitorMenu()},this.headerMenuButton?.addEventListener("click",this._menuBtnClickListener),this._newChatClickListener=()=>{this.closeVisitorMenu(),this.startNewChat()},this.newChatButton?.addEventListener("click",this._newChatClickListener),this._endChatClickListener=()=>{this.closeVisitorMenu(),this.endChat()},this.endChatButton?.addEventListener("click",this._endChatClickListener),this._documentClickListener=g=>{if(!this.headerMenu||this.headerMenu.hidden)return;let S=g.target;S&&this.headerMenu.parentElement?.contains(S)||this.closeVisitorMenu()},document.addEventListener("click",this._documentClickListener);let p=this.chatWindow.querySelector(".basjoo-attach"),u=this.chatWindow.querySelector(".basjoo-file-input");this._attachBtnClickListener=()=>{u?.click()},p?.addEventListener("click",this._attachBtnClickListener),this._attachInputChangeListener=()=>{let g=u?.files;g&&g.length>0&&this.uploadAttachments(Array.from(g)),u&&(u.value="")},u?.addEventListener("change",this._attachInputChangeListener);let v=this.chatWindow.querySelector(".basjoo-prechat"),D=this.chatWindow.querySelector(".basjoo-prechat-skip");this._prechatSubmitListener=g=>{g.preventDefault(),this.submitPrechat()},v?.addEventListener("submit",this._prechatSubmitListener),this._prechatSkipClickListener=()=>{this.skipPrechat()},D?.addEventListener("click",this._prechatSkipClickListener),this.container.appendChild(this.chatWindow),this.renderPrechat(),this.applyBusinessHoursState(),this.renderModeNotice(),this.updateVisitorMenuState()}startOnlineWatcher(){this.onlineCheckIntervalId||(this.onlineCheckIntervalId=window.setInterval(()=>{this.refreshOnlineState()},6e4))}stopOnlineWatcher(){this.onlineCheckIntervalId&&(window.clearInterval(this.onlineCheckIntervalId),this.onlineCheckIntervalId=null)}async refreshOnlineState(){if(this.config.apiBase)try{let t=new URL(`${this.config.apiBase}/api/v1/config:public`);this.config.agentId&&t.searchParams.set("agent_id",this.config.agentId);let e=await fetch(t.toString());if(!e.ok)return;let i=await e.json(),n=i.online!==!1,s=(i.away_message||"").trim();if(n===this.isOnline&&s===this.awayMessage)return;this.isOnline=n,this.awayMessage=s,this.applyBusinessHoursState()}catch(t){console.warn("[Basjoo Widget] Could not refresh the business-hours state.",t)}}applyBusinessHoursState(){if(!this.chatWindow)return;let t=this.chatWindow.querySelector(".basjoo-input-area"),e=this.chatWindow.querySelector(".basjoo-away"),i=this.identityRequired&&!this.identitySigned,n=this.prechatMode==="required"&&this.prechatIsOpen(),s=this.isOnline?i?this.getText("identityRequired"):null:this.awayMessage||this.getText("awayDefault");if(n&&s===null)t&&(t.hidden=!0),e?.remove();else if(s===null)t&&(t.hidden=!1),e?.remove();else if(t&&(t.hidden=!0),e)e.textContent=s;else{let a=document.createElement("div");a.className="basjoo-away",a.setAttribute("role","status"),a.textContent=s,this.chatWindow.appendChild(a)}this.headerHumanButton&&(this.headerHumanButton.hidden=!this.isOnline||this.sessionMode==="human"||i)}renderModeNotice(){if(!this.chatWindow)return;let t=this.chatWindow.querySelector(".basjoo-notice");if(!t)return;if(this.sessionMode!=="human"){this.humanNoticeBar=null,this._continueAiClickListener=null,this.headerHumanButton&&(this.headerHumanButton.hidden=!this.isOnline||this.identityRequired&&!this.identitySigned),this.renderDisclosure(t);return}if(this.headerHumanButton&&(this.headerHumanButton.hidden=!0),this.humanNoticeBar===t)return;t.textContent="",t.hidden=!1;let e=document.createElement("span");e.className="basjoo-notice-text",e.textContent=this.getText("takenOverNotice");let i=document.createElement("button");i.type="button",i.className="basjoo-continue-ai",i.textContent=this.getText("continueWithAi"),this._continueAiClickListener=()=>{this.releaseToAi()},i.addEventListener("click",this._continueAiClickListener),t.appendChild(e),t.appendChild(i),this.humanNoticeBar=t}renderDisclosure(t){if(!this.aiDisclosure){t.hidden=!0,t.textContent="";return}t.textContent="",t.hidden=!1;let e=document.createElement("span");e.className="basjoo-disclosure",e.setAttribute("data-testid","basjoo-ai-disclosure"),e.textContent=this.aiDisclosure,t.appendChild(e)}setSessionMode(t){this.sessionMode=t,this.applyBusinessHoursState(),this.renderModeNotice()}renderPrechat(){if(!this.chatWindow)return;let t=this.chatWindow.querySelector(".basjoo-prechat");if(!t)return;t.hidden=!this.prechatIsOpen();let e=t.querySelector(".basjoo-prechat-skip");e&&(e.hidden=this.prechatMode!=="optional")}prechatIsOpen(){return this.prechatMode==="off"||this.prechatValues!==null||this.prechatSkipped?!1:this.realTurnCount===0&&this.sessionId===null}submitPrechat(){if(!this.chatWindow)return;let t=this.chatWindow.querySelector(".basjoo-prechat-name-input"),e=this.chatWindow.querySelector(".basjoo-prechat-email-input"),i=this.chatWindow.querySelector(".basjoo-prechat-error"),n=(t?.value||"").trim(),s=(e?.value||"").trim(),a=o=>{i&&(i.textContent=o,i.hidden=!1)};if(!n){a(this.getText("prechatNameRequired"));return}if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)){a(this.getText("prechatEmailInvalid"));return}i&&(i.hidden=!0,i.textContent=""),this.prechatValues={name:n,email:s},this.prechatPending=!0,this.renderPrechat(),this.applyBusinessHoursState()}skipPrechat(){this.prechatSkipped=!0,this.prechatValues=null,this.prechatPending=!1,this.renderPrechat(),this.applyBusinessHoursState()}pendingPrechat(){if(!(!this.prechatPending||!this.prechatValues))return{name:this.prechatValues.name,email:this.prechatValues.email}}async uploadAttachments(t){if(t.length===0)return;let e=[];for(let i of t){if(this.pendingAttachments.length+e.length>=x){this.showError(this.getText("attachmentTooMany"));break}if(i.size>Z){this.showError(this.getText("attachmentTooLarge"));continue}e.push(i)}if(e.length!==0){this.uploadsInFlight+=1,this.updateComposerDisabledState();try{for(let i of e)try{let n=new FormData;n.append("file",i);let s=new URL(`${this.config.apiBase}/api/v1/chat/attachments`);this.sessionId&&s.searchParams.set("session_id",this.sessionId),s.searchParams.set("visitor_id",this.visitorId),s.searchParams.set("agent_id",this.config.agentId);let a=await fetch(s.toString(),{method:"POST",body:n});if(!a.ok){if(await this.reportIdentityRejection(a))break;throw new Error(`HTTP ${a.status}`)}let o=await a.json();if(!o.id)throw new Error("Attachment response carried no id");let l=o.kind==="image"||i.type.startsWith("image/")?"image":"document",c={id:o.id,filename:o.filename||i.name,mime:o.mime||i.type||"",kind:l,previewUrl:l==="image"?this.createPreviewUrl(i):void 0};this.pendingAttachments.push(c)}catch(n){console.error("[Basjoo Widget] Attachment upload failed:",n),this.showError(this.getText("attachmentUploadFailed"))}}finally{this.uploadsInFlight-=1,this.updateComposerDisabledState(),this.renderAttachments()}}}createPreviewUrl(t){if(!(typeof URL>"u"||typeof URL.createObjectURL!="function"))try{return URL.createObjectURL(t)}catch{return}}renderAttachments(){if(!this.chatWindow)return;let t=this.chatWindow.querySelector(".basjoo-attachments");if(t){if(t.textContent="",this.pendingAttachments.length===0){t.hidden=!0;return}t.hidden=!1;for(let e of this.pendingAttachments){let i=document.createElement("span");if(i.className="basjoo-attachment",i.setAttribute("data-attachment-id",e.id),e.kind==="image"&&e.previewUrl){let a=document.createElement("img");a.className="basjoo-attachment-thumb",a.src=e.previewUrl,a.alt=e.filename,i.appendChild(a)}let n=document.createElement("span");n.className="basjoo-attachment-name",n.textContent=e.filename,i.appendChild(n);let s=document.createElement("button");s.type="button",s.className="basjoo-attachment-remove",s.setAttribute("aria-label",this.getText("attachmentRemove")),s.setAttribute("title",this.getText("attachmentRemove")),s.textContent="\xD7",s.addEventListener("click",()=>{this.removeAttachment(e.id)}),i.appendChild(s),t.appendChild(i)}}}removeAttachment(t){let e=this.pendingAttachments.findIndex(n=>n.id===t);if(e===-1)return;let[i]=this.pendingAttachments.splice(e,1);i?.previewUrl&&typeof URL<"u"&&typeof URL.revokeObjectURL=="function"&&URL.revokeObjectURL(i.previewUrl),this.renderAttachments()}clearAttachments(){for(let t of this.pendingAttachments)t.previewUrl&&typeof URL<"u"&&typeof URL.revokeObjectURL=="function"&&URL.revokeObjectURL(t.previewUrl);this.pendingAttachments=[],this.renderAttachments()}updateComposerDisabledState(){if(!this.chatWindow)return;let t=this.chatWindow.querySelector(".basjoo-send");t&&(t.disabled=this.uploadsInFlight>0);let e=this.chatWindow.querySelector(".basjoo-attach");e&&(e.disabled=this.uploadsInFlight>0)}toggleVisitorMenu(){if(!this.headerMenu)return;let t=this.headerMenu.hidden;this.headerMenu.hidden=!t,this.headerMenuButton?.setAttribute("aria-expanded",t?"true":"false")}closeVisitorMenu(){!this.headerMenu||this.headerMenu.hidden||(this.headerMenu.hidden=!0,this.headerMenuButton?.setAttribute("aria-expanded","false"))}updateVisitorMenuState(){let t=this.realTurnCount>0;this.newChatButton&&(this.newChatButton.disabled=!t),this.endChatButton&&(this.endChatButton.disabled=!t)}startNewChat(){this.stopPolling(),this.abortStream(),this.cleanupAfterStreamError(),this.sessionId=null,this.lastMessageId=0,this.storage.removeItem(this.STORAGE_KEY),this.clearAttachments();let t=this.chatWindow?.querySelector(".basjoo-messages");t&&(t.textContent=""),this.messages=[],this.realTurnCount=0,this.setSessionMode("ai"),this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date}),this.updateVisitorMenuState()}async endChat(){if(!this.sessionId)return;let t=this.sessionId;try{let i=await fetch(`${this.config.apiBase}/api/v1/chat/session:end`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent_id:this.config.agentId,session_id:t,visitor_id:this.visitorId})});if(!i.ok){if(await this.reportIdentityRejection(i))return;throw new Error(`HTTP ${i.status}`)}}catch(i){console.error("[Basjoo Widget] Failed to end the chat:",i),this.showError(this.getText("endChatFailed"));return}this.stopPolling(),this.abortStream(),this.cleanupAfterStreamError(),this.sessionId=null,this.lastMessageId=0,this.storage.removeItem(this.STORAGE_KEY),this.clearAttachments();let e=this.chatWindow?.querySelector(".basjoo-messages");e&&(e.textContent=""),this.messages=[],this.realTurnCount=0,this.setSessionMode("ai"),this.config.welcomeMessage&&this.addMessage({role:"assistant",content:this.config.welcomeMessage,timestamp:new Date}),this.updateVisitorMenuState()}async requestHumanHandoff(){if(!this.sessionId){this.showError(this.getText("humanNeedsSession"));return}try{let t=await fetch(`${this.config.apiBase}/api/v1/chat/escalate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent_id:this.config.agentId,session_id:this.sessionId,visitor_id:this.visitorId,reason:this.getText("talkToHuman")})});if(!t.ok){if(await this.reportIdentityRejection(t))return;throw new Error(`HTTP ${t.status}`)}this.setSessionMode("human"),this.addMessage({role:"assistant",content:this.getText("takenOverNotice"),timestamp:new Date}),this.startPolling()}catch(t){console.error("[Basjoo Widget] Failed to request a human handoff:",t),this.showError(this.getText("humanFailed"))}}async reportIdentityRejection(t){if(t.status!==403)return!1;try{let e=await t.json();if(e?.detail!=="identity_mismatch"&&e?.code!=="identity_mismatch")return!1}catch{return!1}return this.showError(this.getText("identityMismatch")),!0}async releaseToAi(){if(this.sessionId)try{let t=await fetch(`${this.config.apiBase}/api/v1/chat/release`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent_id:this.config.agentId,session_id:this.sessionId,visitor_id:this.visitorId})});if(!t.ok){if(await this.reportIdentityRejection(t))return;throw new Error(`HTTP ${t.status}`)}this.setSessionMode("ai")}catch(t){console.error("[Basjoo Widget] Failed to release the session to AI:",t),this.showError(this.getText("humanFailed"))}}toggle(){if(this.isOpen){this.close();return}this.open()}open(t=!1){this.isOpen=!0,this.chatWindow?.classList.remove("closing"),this.chatWindow?.classList.add("open"),this.persistOpenState(),this.stopTitleBlink(),this.updateUnreadBadge();let e=this.chatWindow?.querySelector(".basjoo-input");setTimeout(()=>{e&&!e.closest(".basjoo-input-area[hidden]")&&!t&&e.focus()},300)}close(){this.isOpen=!1,this.chatWindow?.classList.remove("open"),this.chatWindow?.classList.add("closing"),this.persistOpenState()}persistOpenState(){this.hasFinePointer()&&this.storage.setItem(this.openStateStorageKey,this.isOpen?"open":"closed")}getRequestLocale(){return this.config.language&&this.config.language!=="auto"?this.config.language:navigator.language||"en-US"}getText(t){let e={sendFailed:{"en-US":"Send failed, please try again later","zh-CN":"\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"},networkError:{"en-US":"Network connection failed, please check your connection","zh-CN":"\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC"},takenOverNotice:{"en-US":"Your conversation has been transferred to a human agent. Please wait for their reply.","zh-CN":"\u5DF2\u8F6C\u63A5\u4EBA\u5DE5\u5BA2\u670D\uFF0C\u8BF7\u7B49\u5F85\u56DE\u590D\u3002"},inputPlaceholder:{"en-US":"Type your question...","zh-CN":"\u8F93\u5165\u60A8\u7684\u95EE\u9898..."},messageTooLong:{"en-US":`Message too long (max ${w} characters)`,"zh-CN":`\u6D88\u606F\u8FC7\u957F\uFF08\u6700\u591A${w}\u5B57\u7B26\uFF09`},greetingBubble:{"en-US":"Hi! How can I help you?","zh-CN":"\u4F60\u597D\uFF01\u6709\u4EC0\u4E48\u53EF\u4EE5\u5E2E\u60A8\uFF1F"},newMessage:{"en-US":"New message","zh-CN":"\u65B0\u6D88\u606F"},thinking:{"en-US":"Thinking...","zh-CN":"\u601D\u8003\u4E2D..."},references:{"en-US":"References","zh-CN":"\u53C2\u8003\u6765\u6E90"},talkToHuman:{"en-US":"Talk to a human","zh-CN":"\u8F6C\u4EBA\u5DE5"},continueWithAi:{"en-US":"Continue with AI","zh-CN":"\u7EE7\u7EED\u7531 AI \u56DE\u7B54"},awayDefault:{"en-US":"We are away right now. Leave a message and we will get back to you.","zh-CN":"\u5F53\u524D\u975E\u670D\u52A1\u65F6\u95F4\uFF0C\u8BF7\u7559\u8A00\uFF0C\u6211\u4EEC\u4F1A\u5C3D\u5FEB\u56DE\u590D\u3002"},closeWindow:{"en-US":"Close","zh-CN":"\u5173\u95ED"},humanNeedsSession:{"en-US":"Send a message first, then you can ask for a human.","zh-CN":"\u8BF7\u5148\u53D1\u9001\u4E00\u6761\u6D88\u606F\uFF0C\u7136\u540E\u518D\u8F6C\u4EBA\u5DE5\u3002"},humanFailed:{"en-US":"Could not reach a human agent. Please try again.","zh-CN":"\u8F6C\u4EBA\u5DE5\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"},scriptedNotice:{"en-US":"Answered from a saved FAQ","zh-CN":"\u7531\u5E38\u89C1\u95EE\u9898\u81EA\u52A8\u56DE\u7B54"},identityMismatch:{"en-US":"We could not verify your identity. Please refresh the page and sign in again.","zh-CN":"\u65E0\u6CD5\u9A8C\u8BC1\u60A8\u7684\u8EAB\u4EFD\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u5E76\u91CD\u65B0\u767B\u5F55\u3002"},identityRequired:{"en-US":"Please sign in on this page to start chatting.","zh-CN":"\u8BF7\u5148\u5728\u672C\u9875\u9762\u767B\u5F55\uFF0C\u7136\u540E\u518D\u5F00\u59CB\u5BF9\u8BDD\u3002"},thumbUp:{"en-US":"Helpful","zh-CN":"\u6709\u5E2E\u52A9"},thumbDown:{"en-US":"Not helpful","zh-CN":"\u6CA1\u6709\u5E2E\u52A9"},attachFile:{"en-US":"Attach a file","zh-CN":"\u6DFB\u52A0\u9644\u4EF6"},attachmentTooMany:{"en-US":`You can attach up to ${x} files`,"zh-CN":`\u6700\u591A\u53EA\u80FD\u6DFB\u52A0 ${x} \u4E2A\u6587\u4EF6`},attachmentTooLarge:{"en-US":"Each file must be 5 MB or smaller","zh-CN":"\u5355\u4E2A\u6587\u4EF6\u4E0D\u80FD\u8D85\u8FC7 5 MB"},attachmentUploadFailed:{"en-US":"That file could not be uploaded. Please try again.","zh-CN":"\u6587\u4EF6\u4E0A\u4F20\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002"},attachmentRemove:{"en-US":"Remove attachment","zh-CN":"\u79FB\u9664\u9644\u4EF6"},prechatTitle:{"en-US":"Before we start","zh-CN":"\u5F00\u59CB\u4E4B\u524D"},prechatName:{"en-US":"Name","zh-CN":"\u59D3\u540D"},prechatEmail:{"en-US":"E-mail","zh-CN":"\u90AE\u7BB1"},prechatSubmit:{"en-US":"Start chat","zh-CN":"\u5F00\u59CB\u5BF9\u8BDD"},prechatSkip:{"en-US":"Skip","zh-CN":"\u8DF3\u8FC7"},prechatNameRequired:{"en-US":"Please enter your name.","zh-CN":"\u8BF7\u8F93\u5165\u60A8\u7684\u59D3\u540D\u3002"},prechatEmailInvalid:{"en-US":"Please enter a valid e-mail address.","zh-CN":"\u8BF7\u8F93\u5165\u6709\u6548\u7684\u90AE\u7BB1\u5730\u5740\u3002"},visitorMenu:{"en-US":"Chat options","zh-CN":"\u5BF9\u8BDD\u9009\u9879"},newChat:{"en-US":"New chat","zh-CN":"\u65B0\u5BF9\u8BDD"},endChat:{"en-US":"End chat","zh-CN":"\u7ED3\u675F\u5BF9\u8BDD"},endChatFailed:{"en-US":"Could not end the chat. Please try again.","zh-CN":"\u7ED3\u675F\u5BF9\u8BDD\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002"}};return this.getRequestLocale().toLowerCase().startsWith("zh")?e[t]["zh-CN"]||e[t]["en-US"]||t:e[t]["en-US"]||e[t]["zh-CN"]||t}escapeHtml(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}sanitizeUrlAttribute(t){try{let e=new URL(t);if(e.protocol==="http:"||e.protocol==="https:")return this.escapeHtml(t)}catch{}return""}renderMarkdown(t){if(!t)return"";let e=t.replace(/\r\n/g,`
`).split(/\n{2,}/).map(s=>s.trim()).filter(Boolean),i=s=>{let a=this.escapeHtml(s);return a=a.replace(/`([^`]+)`/g,"<code>$1</code>"),a=a.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>"),a=a.replace(/__([^_]+)__/g,"<strong>$1</strong>"),a=a.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g,"$1<em>$2</em>"),a=a.replace(/(^|[^_])_([^_]+)_(?!_)/g,"$1<em>$2</em>"),a=a.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(o,l,c)=>{let h=l,d=this.sanitizeUrlAttribute(c);return d?`<a href="${d}" target="_blank" rel="noopener noreferrer">${h}</a>`:h}),a};return e.map(s=>{if(/^```/.test(s)&&/```$/.test(s)){let a=s.replace(/^```\w*\n?/,"").replace(/```$/,"");return`<pre><code>${this.escapeHtml(a)}</code></pre>`}if(/^(?:[-*]\s.+\n?)+$/.test(s))return`<ul>${s.split(`
`).map(o=>o.replace(/^[-*]\s+/,"").trim()).filter(Boolean).map(o=>`<li>${i(o)}</li>`).join("")}</ul>`;if(/^(?:\d+\.\s.+\n?)+$/.test(s))return`<ol>${s.split(`
`).map(o=>o.replace(/^\d+\.\s+/,"").trim()).filter(Boolean).map(o=>`<li>${i(o)}</li>`).join("")}</ol>`;if(/^>\s?/.test(s)){let a=s.split(`
`).map(o=>o.replace(/^>\s?/,"")).join("<br>");return`<blockquote>${i(a)}</blockquote>`}if(/^#{1,6}\s/.test(s)){let a=s.replace(/^#{1,6}\s+/,"");return`<p><strong>${i(a)}</strong></p>`}return`<p>${i(s).replace(/\n/g,"<br>")}</p>`}).join("")}updateMessageContent(t,e,i=!1){t.innerHTML=this.renderMarkdown(e)+(i?'<span class="basjoo-stream-cursor"></span>':"")}createMessageElement(t){let e=document.createElement("div");e.className=`basjoo-message basjoo-message-${t.role}`;let i=document.createElement("div");if(i.className="basjoo-message-content",t.role==="assistant"){let s=O(t.content,t.sources),a=s.references.length>0?`

**${this.getText("references")}**
${s.references.map(o=>`- [${o.title}](${o.url})`).join(`
`)}`:"";this.updateMessageContent(i,s.content+a)}else this.updateMessageContent(i,t.content);e.appendChild(i),this.renderFeedback(e,t);let n=document.createElement("div");return n.className="basjoo-message-time",n.textContent=t.timestamp.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),e.appendChild(n),e}isRateableMessage(t){return t.role!=="assistant"||typeof t.messageId!="number"?!1:(t.answerMode??"ai")==="ai"}renderFeedback(t,e){if(!this.isRateableMessage(e))return;let i=e.messageId,n=document.createElement("div");n.className="basjoo-feedback",n.setAttribute("data-message-id",String(i)),n.setAttribute("data-rating",String(e.rating??0));let s=document.createElement("button");s.type="button",s.className="basjoo-thumb basjoo-thumb-up",s.setAttribute("data-value","1"),s.setAttribute("aria-label",this.getText("thumbUp")),s.setAttribute("title",this.getText("thumbUp")),s.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v12"></path><path d="M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88z"></path></svg>';let a=document.createElement("button");a.type="button",a.className="basjoo-thumb basjoo-thumb-down",a.setAttribute("data-value","-1"),a.setAttribute("aria-label",this.getText("thumbDown")),a.setAttribute("title",this.getText("thumbDown")),a.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V2"></path><path d="M9 18.12L10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88z"></path></svg>';for(let o of[s,a])o.addEventListener("click",()=>{let l=o===s?1:-1;this.castVote(i,l,n)});n.appendChild(s),n.appendChild(a),this.paintVote(n,e.rating??0),t.appendChild(n)}paintVote(t,e){t.setAttribute("data-rating",String(e));let i=t.querySelector(".basjoo-thumb-up"),n=t.querySelector(".basjoo-thumb-down");i&&i.setAttribute("aria-pressed",e===1?"true":"false"),n&&n.setAttribute("aria-pressed",e===-1?"true":"false")}async castVote(t,e,i){if(!this.sessionId)return;let s=Number(i.getAttribute("data-rating")||"0")===e?0:e;try{let a=new URL(`${this.config.apiBase}/api/v1/chat/feedback`);a.searchParams.set("session_id",this.sessionId),a.searchParams.set("message_id",String(t)),a.searchParams.set("visitor_id",this.visitorId);let o=await fetch(a.toString(),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({value:s})});if(!o.ok){if(await this.reportIdentityRejection(o))return;throw new Error(`HTTP ${o.status}`)}this.paintVote(i,s);let l=this.messages.find(c=>c.messageId===t);l&&(l.rating=s)}catch(a){console.error("[Basjoo Widget] Failed to save the message feedback:",a)}}formatThinkingText(){return`${this.getText("thinking")} ${this.thinkingElapsed}s`}showThinkingIndicator(t=0){this.hideLoading(),this.currentStreamContent.trim()||(this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null),this.thinkingElapsed=t;let e=this.chatWindow?.querySelector(".basjoo-messages");if(e){if(!this.thinkingIndicator){let i=document.createElement("div");i.className="basjoo-thinking",i.innerHTML=`
        <span class="basjoo-thinking-spinner"></span>
        <span>${this.getText("thinking")}</span>
      `,e.appendChild(i),this.thinkingIndicator=i,this.thinkingIndicatorText=i.querySelector("span:last-child")}this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText()),e.scrollTop=e.scrollHeight,this.thinkingTimerId===null&&(this.thinkingTimerId=window.setInterval(()=>{this.thinkingElapsed+=1,this.thinkingIndicatorText&&(this.thinkingIndicatorText.textContent=this.formatThinkingText())},1e3))}}hideThinkingIndicator(){this.thinkingTimerId!==null&&(window.clearInterval(this.thinkingTimerId),this.thinkingTimerId=null),this.thinkingIndicator?.remove(),this.thinkingIndicator=null,this.thinkingIndicatorText=null,this.thinkingElapsed=0}removeStreamingMessage(){this.streamingMessage?.remove(),this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}createStreamingMessage(t=!1){let e=this.chatWindow?.querySelector(".basjoo-messages"),i=document.createElement("div");i.className="basjoo-message basjoo-message-assistant";let n=document.createElement("div");return n.className="basjoo-message-content",this.updateMessageContent(n,this.currentStreamContent,t),i.appendChild(n),e?(e.appendChild(i),e.scrollTop=e.scrollHeight,this.streamingMessage=i,this.streamingMessageContent=n,this.currentStreamContent="",i):(this.streamingMessage=i,this.streamingMessageContent=n,this.currentStreamContent="",i)}appendToStreamingMessage(t){(!this.streamingMessage||!this.streamingMessageContent)&&(this.hideThinkingIndicator(),this.createStreamingMessage()),this.currentStreamContent+=t,this.streamingMessageContent&&this.updateMessageContent(this.streamingMessageContent,this.currentStreamContent,!0);let e=this.chatWindow?.querySelector(".basjoo-messages");e&&(e.scrollTop=e.scrollHeight)}finalizeStreamingMessage(t=[],e){if(!this.streamingMessage||!this.streamingMessageContent)return;if(!this.currentStreamContent.trim()){this.removeStreamingMessage();return}this.streamingMessage.querySelector(".basjoo-stream-cursor")?.remove(),this.currentStreamSources=t;let n=O(this.currentStreamContent,t),s=n.references.length>0?`

**${this.getText("references")}**
${n.references.map(p=>`- [${p.title}](${p.url})`).join(`
`)}`:"",a=n.content+s;this.updateMessageContent(this.streamingMessageContent,a);let o=e?.mode,l=o==="human"||o==="scripted"?o:"ai",c=typeof e?.message_id=="number"?e.message_id:null,h={role:"assistant",content:a,sources:t,timestamp:new Date,messageId:c,rating:0,answerMode:l};this.messages.push(h),this.renderFeedback(this.streamingMessage,h);let d=this.chatWindow?.querySelector(".basjoo-messages");d.scrollTop=d.scrollHeight,this.streamingMessage=null,this.streamingMessageContent=null,this.currentStreamContent="",this.currentStreamSources=[]}addMessage(t){this.messages.push(t);let e=this.chatWindow?.querySelector(".basjoo-messages");if(!t.content){console.error("Message content is null or undefined:",t);return}if(!e)return;let i=this.createMessageElement(t);e.appendChild(i),e.scrollTop=e.scrollHeight,t.role==="assistant"&&!this.isOpen&&(this.hasUnread=!0,this.updateUnreadBadge()),this.updateVisitorMenuState()}showLoading(){let t=this.chatWindow?.querySelector(".basjoo-messages");if(!t)return;let e=document.createElement("div");e.className="basjoo-loading",e.id="basjoo-loading",e.innerHTML=`
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
      <div class="basjoo-loading-dot"></div>
    `,t.appendChild(e),t.scrollTop=t.scrollHeight}hideLoading(){this.chatWindow?.querySelector("#basjoo-loading")?.remove()}showError(t){let e=this.chatWindow?.querySelector(".basjoo-messages");if(!e)return;let i=document.createElement("div");i.className="basjoo-error",i.textContent=t,e.appendChild(i),e.scrollTop=e.scrollHeight,setTimeout(()=>i.remove(),5e3)}showScriptedNotice(){let t=this.chatWindow?.querySelector(".basjoo-messages");if(!t)return;let e=document.createElement("div");e.className="basjoo-scripted",e.setAttribute("role","status"),e.textContent=this.getText("scriptedNotice"),t.appendChild(e),t.scrollTop=t.scrollHeight}startPolling(){this.pollIntervalId||(this.pollIntervalId=window.setInterval(()=>this.pollMessages(),3e3))}stopPolling(){this.pollIntervalId&&(clearInterval(this.pollIntervalId),this.pollIntervalId=null)}async pollMessages(){if(this.sessionId)try{let t=await fetch(`${this.config.apiBase}/api/v1/chat/messages?session_id=${encodeURIComponent(this.sessionId)}&visitor_id=${encodeURIComponent(this.visitorId)}&after_id=${this.lastMessageId}&role=assistant`);if(!t.ok)return;let e=await t.json();for(let i of e){if(i.content){let n=i.sender_type==="human";this.realTurnCount+=1,this.addMessage({role:i.role==="user"?"user":"assistant",content:i.content,sources:i.sources,timestamp:new Date,messageId:n?null:i.id,rating:0,answerMode:n?"human":"ai"}),this.isOpen||this.startTitleBlink()}i.id>this.lastMessageId&&(this.lastMessageId=i.id)}this.updateVisitorMenuState()}catch{}}cleanupAfterStreamError(){this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage()}async consumeStream(t){if(!t.body)throw new Error("Streaming response body is unavailable");let e=t.body.getReader(),i=new TextDecoder,n="",s=!1,a=c=>{if(!c.trim())return;let h="message",d=[];for(let u of c.split(`
`))u.startsWith("event:")?h=u.slice(6).trim():u.startsWith("data:")&&d.push(u.slice(5).trimStart());if(!d.length)return;let p=JSON.parse(d.join(`
`));switch(h){case"sources":this.currentStreamSources=Array.isArray(p.sources)?p.sources:[];break;case"thinking":this.showThinkingIndicator(typeof p.elapsed=="number"?p.elapsed:0);break;case"thinking_done":this.hideThinkingIndicator();break;case"content":{let u=p.content||"";this.appendToStreamingMessage(u);break}case"done":{let u=p;u.session_id&&(this.sessionId=u.session_id,this.storage.setItem(this.STORAGE_KEY,u.session_id),this.startPolling()),typeof u.message_id=="number"&&u.message_id>this.lastMessageId&&(this.lastMessageId=u.message_id),u.taken_over?(this.removeStreamingMessage(),this.setSessionMode("human"),this.addMessage({role:"assistant",content:this.getText("takenOverNotice"),timestamp:new Date})):(u.mode==="human"&&this.setSessionMode("human"),this.finalizeStreamingMessage(this.currentStreamSources,u),u.mode==="scripted"&&u.matched_by&&this.showScriptedNotice(),this.isOpen||this.startTitleBlink()),s=!0;break}case"error":{let u=p,v=new Error(u.error||"Stream failed");throw u.code&&(v.name=u.code),v}default:break}},o=()=>{let c=n.indexOf(`\r
\r
`),h=n.indexOf(`

`);return c===-1&&h===-1?null:c===-1?{index:h,length:2}:h===-1?{index:c,length:4}:c<h?{index:c,length:4}:{index:h,length:2}},l=9e4;for(;!s;){if(this.streamAbortController?.signal.aborted){e.cancel();return}let c=null;try{let{done:h,value:d}=await Promise.race([e.read(),new Promise((u,v)=>{c=window.setTimeout(()=>v(new Error("Stream read timeout")),l)})]);n+=i.decode(d||new Uint8Array,{stream:!h});let p=o();for(;p;){let u=n.slice(0,p.index);if(n=n.slice(p.index+p.length),a(u.replace(/\r\n/g,`
`)),s)break;p=o()}if(h)break}finally{c!==null&&window.clearTimeout(c)}}if(!s&&(n.trim()&&a(n),!s))throw new Error("Stream ended unexpectedly")}abortStream(){this.streamAbortController?.abort(),this.streamAbortController=null}async sendMessageWithRetry(t){let e=null;for(let i=0;i<=1;i++){this.abortStream(),this.streamAbortController=new AbortController;try{let n=Intl.DateTimeFormat().resolvedOptions().timeZone,s=await fetch(`${this.config.apiBase}/api/v1/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},signal:this.streamAbortController.signal,body:JSON.stringify({agent_id:this.config.agentId,message:t,locale:this.getRequestLocale(),session_id:this.sessionId||void 0,visitor_id:this.visitorId,timezone:n,context_before:r.pageContext.before||void 0,context_after:r.pageContext.after||void 0,attachment_ids:this.pendingAttachments.length>0?this.pendingAttachments.slice(0,x).map(a=>a.id):void 0,prechat:this.pendingPrechat()})});if(!s.ok){let a=`HTTP ${s.status}: ${s.statusText}`;try{let o=await s.json(),l=o.message||o.detail||a;a=Array.isArray(l)?l.map(c=>[c?.type,c?.msg].filter(Boolean).join(": ")||JSON.stringify(c)).join("; "):String(l),a=`HTTP ${s.status}: ${a}`}catch{}throw new Error(a)}this.hideLoading(),await this.consumeStream(s);return}catch(n){e=n;let s=String(n?.message||"");if(!(!(this.currentStreamContent.trim().length>0)&&(n instanceof TypeError||s.includes("fetch")||s.includes("Failed to fetch")||s.includes("Stream ended unexpectedly")))||i>=1)throw this.cleanupAfterStreamError(),n;this.cleanupAfterStreamError(),console.warn(`[Basjoo Widget] Stream attempt ${i+1} failed, retrying...`),await new Promise(l=>window.setTimeout(l,1e3)),this.showLoading()}}throw e}async sendMessage(t){if(!this.isSending){if(this.isSending=!0,this.uploadsInFlight>0){this.isSending=!1;return}if(this.prechatMode==="required"&&this.prechatIsOpen()){this.isSending=!1;return}this.addMessage({role:"user",content:t,timestamp:new Date}),this.realTurnCount+=1,this.updateVisitorMenuState(),this.hideLoading(),this.hideThinkingIndicator(),this.removeStreamingMessage(),this.createStreamingMessage(!0);try{await this.sendMessageWithRetry(t)}catch(e){console.error("[Basjoo Widget] Error sending message:",e);let i=this.getText("sendFailed"),n="",s=String(e?.message||"");e instanceof TypeError||s.includes("fetch")?(i=this.getText("networkError"),n=`Request may be blocked by CORS, network connectivity, or an incorrect apiBase. Current apiBase: ${this.config.apiBase||"(not set)"}`):e?.name==="ORIGIN_NOT_ALLOWED"||s.toLowerCase().includes("widget origin not allowed")?(i=this.getText("sendFailed"),n="Widget request was blocked because the current page origin is not on the allowed domain list."):e?.name==="identity_mismatch"||s.includes("identity_mismatch")?(i=this.getText("identityMismatch"),n="Signed visitor identity rejected: recompute hmac_sha256(identity_secret, email) for the signed-in visitor and pass it to Basjoo.identify({ email, hash })."):s.includes("422")||s.includes("string_too_long")||s.includes("too_long")?(i=this.getText("messageTooLong"),n=`Request rejected by validation (422 string_too_long): message exceeds MAX_MESSAGE_LENGTH=${w}.`):s.includes("401")&&(n="Authentication failed. Please check the agent configuration and public API access."),this.config.apiBase||(n="apiBase could not be determined. When embedding the widget from a local file, set apiBase explicitly or load the SDK from the target server."),n&&console.error("[Basjoo Widget]",n),this.showError(i)}finally{this.isSending=!1,this.prechatPending=!1,this.clearAttachments()}}}destroy(){r.instances=r.instances.filter(h=>h!==this),this.stopPolling(),this.stopTitleBlink(),this.stopOnlineWatcher(),this.hideThinkingIndicator(),this.removeStreamingMessage(),this.abortStream(),this.button&&this._buttonClickListener&&this.button.removeEventListener("click",this._buttonClickListener);let t=this.chatWindow?.querySelector(".basjoo-close");t&&this._closeBtnClickListener&&t.removeEventListener("click",this._closeBtnClickListener);let e=this.chatWindow?.querySelector(".basjoo-send");e&&this._sendBtnClickListener&&e.removeEventListener("click",this._sendBtnClickListener);let i=this.chatWindow?.querySelector(".basjoo-input");i&&this._inputKeypressListener&&i.removeEventListener("keypress",this._inputKeypressListener),this.headerHumanButton&&this._humanBtnClickListener&&this.headerHumanButton.removeEventListener("click",this._humanBtnClickListener);let n=this.humanNoticeBar?.querySelector(".basjoo-continue-ai");n&&this._continueAiClickListener&&n.removeEventListener("click",this._continueAiClickListener),this.humanNoticeBar=null,this.headerHumanButton=null,this.headerMenuButton&&this._menuBtnClickListener&&this.headerMenuButton.removeEventListener("click",this._menuBtnClickListener),this.newChatButton&&this._newChatClickListener&&this.newChatButton.removeEventListener("click",this._newChatClickListener),this.endChatButton&&this._endChatClickListener&&this.endChatButton.removeEventListener("click",this._endChatClickListener),this._documentClickListener&&(document.removeEventListener("click",this._documentClickListener),this._documentClickListener=null),this.headerMenuButton=null,this.headerMenu=null,this.newChatButton=null,this.endChatButton=null;let s=this.chatWindow?.querySelector(".basjoo-attach");s&&this._attachBtnClickListener&&s.removeEventListener("click",this._attachBtnClickListener);let a=this.chatWindow?.querySelector(".basjoo-file-input");a&&this._attachInputChangeListener&&a.removeEventListener("change",this._attachInputChangeListener),this.clearAttachments();let o=this.chatWindow?.querySelector(".basjoo-prechat");o&&this._prechatSubmitListener&&o.removeEventListener("submit",this._prechatSubmitListener);let l=this.chatWindow?.querySelector(".basjoo-prechat-skip");l&&this._prechatSkipClickListener&&l.removeEventListener("click",this._prechatSkipClickListener),this._cardActionListeners=[],this._starterClickListeners=[],this.iframeElement=null,this.mountTarget=null,this.container?.remove(),document.getElementById("basjoo-widget-styles")?.remove()}};window.BasjooWidget=m;window.Basjoo={Widget:m,setContext:r=>m.setContext(r),identify:r=>{m.applyIdentity(r)},init:r=>{let t=new m(r);return t.init(),t}};function b(r,t){for(let e of t){let i=r.get(e);if(i&&i.trim())return i.trim()}return null}function ae(){if(document.currentScript instanceof HTMLScriptElement)return document.currentScript;let r=Array.from(document.querySelectorAll("script[src]"));for(let t=r.length-1;t>=0;t-=1){let e=r[t],i=e.getAttribute("src")||"";if(i.includes("sdk.js"))try{let n=new URL(i,window.location.href);if(b(n.searchParams,f.agentId))return e}catch{continue}}return null}function oe(r){let t=r.getAttribute("src")||r.src;if(!t)return null;let e;try{e=new URL(t,window.location.href)}catch{return null}let i=b(e.searchParams,f.agentId);if(!i)return null;let n={agentId:i},s=b(e.searchParams,f.apiBase);s&&(n.apiBase=s);let a=b(e.searchParams,f.themeColor);a&&(n.themeColor=a);let o=b(e.searchParams,f.welcomeMessage);o&&(n.welcomeMessage=o);let l=b(e.searchParams,f.language);l&&(n.language=l);let c=b(e.searchParams,f.position);(c==="left"||c==="right")&&(n.position=c);let h=b(e.searchParams,f.theme);return(h==="light"||h==="dark"||h==="auto")&&(n.theme=h),n}(function(){let t=window,e=z();if(e&&typeof e.agent_id=="string"&&e.agent_id){if(t.__basjooWidgetAutoInitScheduled)return;t.__basjooWidgetAutoInitScheduled=!0;let a=()=>{new m({agentId:e.agent_id}).init()};if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",a,{once:!0});return}a();return}let i=ae();if(!i)return;let n=oe(i);if(!n||t.__basjooWidgetAutoInitScheduled)return;t.__basjooWidgetAutoInitScheduled=!0;let s=()=>{new m(n).init()};if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",s,{once:!0});return}s()})();})();
//# sourceMappingURL=basjoo-widget.min.js.map
