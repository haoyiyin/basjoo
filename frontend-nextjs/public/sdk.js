(function (window) {
    'use strict';

    var BasjooSDK = {
        config: null,
        ws: null,
        visitorId: null,
        shadowRoot: null,
        isOpen: false,
        retryCount: 0,
        maxRetries: 5,

        init: function (config) {
            this.config = config;
            this.visitorId = localStorage.getItem('vv_visitor_id');
            if (!this.visitorId) {
                this.visitorId = this.generateUUID();
                localStorage.setItem('vv_visitor_id', this.visitorId);
            }
            this.renderUI();
            this.connectWebSocket();
        },

        autoInit: function () {
            // 自动从script标签读取配置
            var script = document.currentScript || document.querySelector('script[src*="sdk.js"]');
            if (!script) {
                console.error('Basjoo: SDK script not found');
                return;
            }

            var appId = script.getAttribute('data-app-id');
            if (!appId) {
                console.error('Basjoo: data-app-id attribute is required');
                return;
            }

            // 获取apiHost,默认为当前域名
            var apiHost = script.getAttribute('data-api-host') || (window.location.protocol + '//' + window.location.host);

            this.init({
                appId: appId,
                apiHost: apiHost
            });
        },

        generateUUID: function () {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        },

        renderUI: function () {
            var host = document.getElementById('basjoo-host');
            if (!host) {
                host = document.createElement('div');
                host.id = 'basjoo-host';
                document.body.appendChild(host);
            }

            this.shadowRoot = host.attachShadow({ mode: 'open' });

            // Styles
            var style = document.createElement('style');
            style.textContent = `
                .vv-launcher {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    width: 60px;
                    height: 60px;
                    background-color: #FFE135;
                    border-radius: 50%;
                    cursor: pointer;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 9999;
                    transition: transform 0.3s;
                }
                .vv-launcher:hover {
                    transform: scale(1.1);
                }
                .vv-launcher svg {
                    width: 30px;
                    height: 30px;
                    fill: #1A4D2E;
                }
                .vv-window {
                    position: fixed;
                    bottom: 100px;
                    right: 20px;
                    width: 350px;
                    height: 500px;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.15);
                    display: none;
                    flex-direction: column;
                    overflow: hidden;
                    z-index: 9999;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                }
                .vv-window.open {
                    display: flex;
                }
                .vv-header {
                    background: #FFE135;
                    color: #1A4D2E;
                    padding: 16px;
                    font-weight: 600;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .vv-close {
                    cursor: pointer;
                    font-size: 20px;
                }
                .vv-messages {
                    flex: 1;
                    padding: 16px;
                    overflow-y: auto;
                    background: #f9fafb;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .vv-input-area {
                    padding: 12px;
                    border-top: 1px solid #e5e7eb;
                    display: flex;
                    gap: 8px;
                }
                .vv-input {
                    flex: 1;
                    padding: 8px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 20px;
                    outline: none;
                }
                .vv-input:focus {
                    border-color: #FFE135;
                }
                .vv-send {
                    background: #FFE135;
                    color: #1A4D2E;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 20px;
                    cursor: pointer;
                }
                .vv-message {
                    max-width: 80%;
                    padding: 8px 12px;
                    border-radius: 12px;
                    font-size: 14px;
                    line-height: 1.4;
                    word-wrap: break-word;
                }
                .vv-message.user {
                    align-self: flex-end;
                    background: #FFE135;
                    color: #1A4D2E;
                    border-bottom-right-radius: 2px;
                }
                .vv-message.assistant {
                    align-self: flex-start;
                    background: white;
                    border: 1px solid #e5e7eb;
                    border-bottom-left-radius: 2px;
                }
                .vv-message.error {
                    align-self: center;
                    background: #fee2e2;
                    color: #991b1b;
                    border: 1px solid #f87171;
                    font-size: 12px;
                }
                .vv-message.system {
                    align-self: center;
                    background: transparent;
                    color: #6b7280;
                    font-size: 12px;
                    text-align: center;
                    padding: 4px 8px;
                    border: none;
                }
                .vv-message.agent {
                    align-self: flex-start;
                    background: #eff6ff;
                    color: #1e3a8a;
                    border: 1px solid #bfdbfe;
                    border-bottom-left-radius: 2px;
                }
                .vv-typing-dots {
                    display: flex;
                    gap: 4px;
                    padding: 4px;
                }
                .vv-typing-dots span {
                    width: 6px;
                    height: 6px;
                    background: #9ca3af;
                    border-radius: 50%;
                    animation: vv-bounce 1.4s infinite ease-in-out both;
                }
                .vv-typing-dots span:nth-child(1) { animation-delay: -0.32s; }
                .vv-typing-dots span:nth-child(2) { animation-delay: -0.16s; }
                @keyframes vv-bounce {
                    0%, 80%, 100% { transform: scale(0); }
                    40% { transform: scale(1); }
                }
                .vv-timestamp {
                    font-size: 10px;
                    color: #9ca3af;
                    margin-top: 4px;
                    text-align: right;
                }
                .vv-message.user .vv-timestamp {
                    color: #bfdbfe;
                }
            `;
            this.shadowRoot.appendChild(style);

            // HTML
            var container = document.createElement('div');
            container.innerHTML = `
                <div class="vv-launcher" id="launcher">
                    <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
                </div>
                <div class="vv-window" id="window">
                    <div class="vv-header">
                        <span>Customer Support</span>
                        <span class="vv-close" id="close">&times;</span>
                    </div>
                    <div class="vv-messages" id="messages"></div>
                    <div class="vv-input-area">
                        <input type="text" class="vv-input" id="input" placeholder="Type a message..." maxlength="500">
                        <button class="vv-send" id="send">Send</button>
                    </div>
                </div>
            `;
            this.shadowRoot.appendChild(container);

            // Events
            this.shadowRoot.getElementById('launcher').onclick = this.toggleWindow.bind(this);
            this.shadowRoot.getElementById('close').onclick = this.toggleWindow.bind(this);
            this.shadowRoot.getElementById('send').onclick = this.sendMessage.bind(this);
            this.shadowRoot.getElementById('input').onkeypress = (e) => {
                if (e.key === 'Enter') this.sendMessage();
            };
        },

        toggleWindow: function () {
            this.isOpen = !this.isOpen;
            var win = this.shadowRoot.getElementById('window');
            if (this.isOpen) {
                win.classList.add('open');
                this.scrollToBottom();
            } else {
                win.classList.remove('open');
            }
        },

        connectWebSocket: function () {
            var proto = this.config.apiHost.startsWith('https') ? 'wss' : 'ws';
            var host = this.config.apiHost.replace(/^https?:\/\//, '');
            var url = `${proto}://${host}/ws/chat?appId=${this.config.appId}`;
            if (this.visitorId) {
                url += `&visitorId=${this.visitorId}`;
            }

            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                console.log('Basjoo: Connected');
                this.retryCount = 0;
                this.startHeartbeat();
            };

            this.ws.onmessage = (event) => {
                var data = JSON.parse(event.data);
                this.handleMessage(data);
            };

            this.ws.onclose = () => {
                console.log('Basjoo: Disconnected');
                this.stopHeartbeat();
                this.handleReconnect();
            };
        },

        heartbeatInterval: null,

        startHeartbeat: function () {
            this.stopHeartbeat();
            this.heartbeatInterval = setInterval(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30000); // 30 seconds
        },

        stopHeartbeat: function () {
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
            }
        },

        handleReconnect: function () {
            if (this.retryCount < this.maxRetries) {
                var delay = Math.pow(2, this.retryCount) * 1000;
                console.log(`Basjoo: Retrying in ${delay}ms...`);
                setTimeout(this.connectWebSocket.bind(this), delay);
                this.retryCount++;
            } else {
                console.log('Basjoo: Connection failed after max retries');
                this.appendMessage('error', 'Connection lost. Please refresh the page.', Date.now());
            }
        },

        handleMessage: function (data) {
            console.log('Basjoo: Received message', data);
            if (data.type === 'message') {
                this.hideTyping();
                this.appendMessage(data.role, data.content, data.timestamp);
            } else if (data.type === 'message_chunk') {
                this.hideTyping();
                this.appendChunk(data.role, data.content, data.timestamp);
            } else if (data.type === 'typing') {
                this.showTyping();
            } else if (data.type === 'init') {
                if (data.visitorId && data.visitorId !== this.visitorId) {
                    this.visitorId = data.visitorId;
                    localStorage.setItem('vv_visitor_id', this.visitorId);
                }
            } else if (data.type === 'status_change') {
                // Handle session status change (e.g., taken over by human agent)
                this.hideTyping();
                if (data.status === 'taken_over') {
                    this.appendMessage('system', data.message || '客服已接管会话', Date.now());
                }
            } else if (data.type === 'error') {
                this.hideTyping();
                this.appendMessage('error', data.message, Date.now());
            }
        },

        appendChunk: function (role, content, timestamp) {
            var messagesDiv = this.shadowRoot.getElementById('messages');
            var lastMsg = messagesDiv.lastElementChild;

            // Check if the last message is a streaming message from the same role
            if (lastMsg && lastMsg.classList.contains(role) && lastMsg.classList.contains('streaming')) {
                var contentDiv = lastMsg.querySelector('.vv-message-content');
                contentDiv.textContent += content;

                // Update timestamp if needed (optional)
                // var timeDiv = lastMsg.querySelector('.vv-timestamp');
                // ...
            } else {
                // Create new message bubble
                var msgDiv = document.createElement('div');
                msgDiv.className = `vv-message ${role} streaming`;

                var contentDiv = document.createElement('div');
                contentDiv.className = 'vv-message-content';
                contentDiv.textContent = content;
                msgDiv.appendChild(contentDiv);

                if (timestamp) {
                    var timeDiv = document.createElement('div');
                    timeDiv.className = 'vv-timestamp';
                    var date = new Date(timestamp);
                    timeDiv.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                    msgDiv.appendChild(timeDiv);
                }

                messagesDiv.appendChild(msgDiv);
            }
            this.scrollToBottom();
        },

        showTyping: function () {
            var messagesDiv = this.shadowRoot.getElementById('messages');
            if (this.shadowRoot.getElementById('vv-typing')) return;

            var typingDiv = document.createElement('div');
            typingDiv.id = 'vv-typing';
            typingDiv.className = 'vv-message assistant';
            typingDiv.innerHTML = `
                <div class="vv-typing-dots">
                    <span></span><span></span><span></span>
                </div>
            `;
            messagesDiv.appendChild(typingDiv);
            this.scrollToBottom();
        },

        hideTyping: function () {
            var typingDiv = this.shadowRoot.getElementById('vv-typing');
            if (typingDiv) {
                typingDiv.remove();
            }
        },

        sendMessage: function () {
            var input = this.shadowRoot.getElementById('input');
            var content = input.value.trim();
            if (!content) return;

            if (content.length > 500) {
                alert("Message too long (max 500 characters)");
                return;
            }

            this.appendMessage('user', content, Date.now());
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'message',
                    content: content
                }));
            } else {
                this.appendMessage('error', 'Not connected to server.', Date.now());
            }
            input.value = '';
        },

        appendMessage: function (role, content, timestamp) {
            var messagesDiv = this.shadowRoot.getElementById('messages');
            var msgDiv = document.createElement('div');
            msgDiv.className = `vv-message ${role}`;

            var contentDiv = document.createElement('div');
            contentDiv.className = 'vv-message-content';
            contentDiv.textContent = content;
            msgDiv.appendChild(contentDiv);

            if (timestamp) {
                var timeDiv = document.createElement('div');
                timeDiv.className = 'vv-timestamp';
                var date = new Date(timestamp);
                timeDiv.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                msgDiv.appendChild(timeDiv);
            }

            messagesDiv.appendChild(msgDiv);
            this.scrollToBottom();
        },

        scrollToBottom: function () {
            var messagesDiv = this.shadowRoot.getElementById('messages');
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
    };

    window.BasjooSDK = BasjooSDK;

    // 自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            BasjooSDK.autoInit();
        });
    } else {
        BasjooSDK.autoInit();
    }

})(window);
