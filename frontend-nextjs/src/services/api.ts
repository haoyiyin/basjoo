/**
 * API Service for v1 Endpoints
 */
import { API_BASE_URL } from '../lib/env';

export interface ChatRequest {
  agent_id: string;
  message: string;
  locale?: string;
  session_id?: string;
  params?: {
    temperature?: number;
    max_tokens?: number;
  };
}

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatResponse {
  reply: string;
  sources: Source[];
  usage?: UsageInfo;
  session_id?: string;
  message_id?: number;
  taken_over?: boolean;
}

export interface StreamDoneMeta {
  message_id: number | null;
  session_id?: string;
  usage?: UsageInfo | null;
  taken_over?: boolean;
}

export interface Source {
  type: 'url' | 'qa';
  title?: string;
  url?: string;
  snippet?: string;
  question?: string;
  id?: string;
}

export type ProviderType = 'openai' | 'openai_native' | 'google' | 'anthropic' | 'xai' | 'openrouter' | 'zai' | 'deepseek' | 'volcengine' | 'moonshot' | 'aliyun_bailian';

export interface Agent {
  id: string;
  name: string;
  description?: string;
  system_prompt: string;
  model: string;
  temperature: number;
  max_tokens: number;
  api_format?: 'openai' | 'openai_compatible' | 'anthropic' | 'google';
  api_key?: string;
  api_key_set?: boolean;
  api_key_masked?: string;
  api_base?: string;
  jina_api_key?: string;
  jina_api_key_set?: boolean;
  jina_api_key_masked?: string;
  provider_type?: ProviderType;
  azure_endpoint?: string;
  azure_deployment_name?: string;
  azure_api_version?: string;
  anthropic_version?: string;
  google_project_id?: string;
  google_region?: string;
  provider_config?: Record<string, string | number | boolean>;
  embedding_model: string;
  crawl_max_depth?: number;
  crawl_max_pages?: number;
  top_k: number;
  similarity_threshold: number;
  enable_context: boolean;
  enable_auto_fetch?: boolean;
  url_fetch_interval_days?: number;
  rate_limit_per_hour: number;
  restricted_reply?: string;
  last_error_code?: string | null;
  last_error_message?: string | null;
  last_error_at?: string | null;
  persona_type?: string;
  widget_title?: string;
  widget_color?: string;
  welcome_message?: string;
  history_days?: number;
  allowed_widget_origins?: string[] | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface URLSource {
  id: number;
  url: string;
  normalized_url: string;
  status: 'pending' | 'fetching' | 'success' | 'failed';
  title?: string;
  last_fetch_at?: string;
  is_indexed: boolean;
  created_at: string;
  updated_at?: string;
}

export interface QAItem {
  id: string;
  question: string;
  answer: string;
  tags?: string[];
  is_indexed: boolean;
  created_at: string;
  updated_at?: string;
}

export interface Quota {
  max_agents: number;
  max_urls: number;
  max_qa_items: number;
  max_messages_per_day: number;
  max_total_text_mb: number;
  used_agents: number;
  used_urls: number;
  used_qa_items: number;
  used_messages_today: number;
  used_total_text_mb: number;
  remaining_urls: number;
  remaining_qa_items: number;
  remaining_messages_today: number;
}

class APIService {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private getLocale(): string {
    return localStorage.getItem('basjoo_locale') || 'zh-CN';
  }

  private getStreamBaseUrl(): string {
    if (this.baseUrl) {
      return this.baseUrl;
    }

    if (typeof window === 'undefined') {
      return this.baseUrl;
    }

    const { protocol, hostname, port } = window.location;
    const isFrontendDevPort = port === '3000';

    if ((protocol === 'http:' || protocol === 'https:') && isFrontendDevPort) {
      return `${protocol}//${hostname}:8000`;
    }

    return this.baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Add locale parameter to URL
    const url = new URL(`${this.baseUrl}${endpoint}`, window.location.origin);
    url.searchParams.set('locale', this.getLocale());

    const token = localStorage.getItem('token');

    const response = await fetch(url.toString(), {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ 
        message: response.statusText,
        detail: `HTTP ${response.status}: ${response.statusText}`
      }));
      
      const errorMessage = error.message || error.detail || 'API request failed';
      console.error(`API Error: ${errorMessage}`, {
        status: response.status,
        endpoint,
        url,
        error
      });
      
      throw new Error(errorMessage);
    }

    return response.json();
  }

  async checkHealth(): Promise<{ status: string }> {
    try {
      const result = await this.request<{ status: string }>('/health');
      return result;
    } catch (error) {
      console.error('Health check failed:', error);
      throw new Error('Backend service is not accessible. Please check if the backend is running.');
    }
  }

  // Chat APIs
  async chat(request: ChatRequest): Promise<ChatResponse> {
    // Include locale in request body, but don't override if already provided
    const chatRequest = {
      ...request,
      locale: request.locale || this.getLocale(),
    };
    return this.request<ChatResponse>('/api/v1/chat', {
      method: 'POST',
      body: JSON.stringify(chatRequest),
    });
  }

  async streamChat(
    request: ChatRequest,
    callbacks: {
      onSources: (sources: Source[]) => void;
      onContent: (chunk: string) => void;
      onDone: (meta: StreamDoneMeta) => void;
      onError: (error: string) => void;
      onThinking?: (elapsed: number) => void;
      onThinkingDone?: () => void;
    },
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<void> {
    const chatRequest = {
      ...request,
      locale: request.locale || this.getLocale(),
    };

    const streamBaseUrl = this.getStreamBaseUrl();
    const url = new URL(`${streamBaseUrl}/api/v1/chat/stream`, window.location.origin);
    url.searchParams.set('locale', this.getLocale());

    const token = localStorage.getItem('token');

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(chatRequest),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        message: response.statusText,
        detail: `HTTP ${response.status}: ${response.statusText}`,
      }));
      throw new Error(error.message || error.detail || 'Stream request failed');
    }

    if (!response.body) {
      throw new Error('Streaming response body is unavailable');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let streamEnded = false;

    const processEvent = async (rawEvent: string) => {
      if (!rawEvent.trim()) {
        return;
      }

      let eventName = 'message';
      const dataLines: string[] = [];

      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      if (dataLines.length === 0) {
        return;
      }

      const payload = JSON.parse(dataLines.join('\n'));

      switch (eventName) {
        case 'sources':
          callbacks.onSources(Array.isArray(payload.sources) ? payload.sources : []);
          break;
        case 'thinking':
          callbacks.onThinking?.(typeof payload.elapsed === 'number' ? payload.elapsed : 0);
          break;
        case 'thinking_done':
          callbacks.onThinkingDone?.();
          break;
        case 'content':
          callbacks.onContent(typeof payload.content === 'string' ? payload.content : '');
          break;
        case 'done':
          streamEnded = true;
          callbacks.onDone(payload as StreamDoneMeta);
          break;
        case 'error':
          streamEnded = true;
          callbacks.onError(typeof payload.error === 'string' ? payload.error : 'Stream failed');
          break;
        default:
          break;
      }
    };

    const findEventDelimiter = (): { index: number; length: number } | null => {
      const crlfIndex = buffer.indexOf('\r\n\r\n');
      const lfIndex = buffer.indexOf('\n\n');

      if (crlfIndex === -1 && lfIndex === -1) {
        return null;
      }
      if (crlfIndex === -1) {
        return { index: lfIndex, length: 2 };
      }
      if (lfIndex === -1) {
        return { index: crlfIndex, length: 4 };
      }
      return crlfIndex < lfIndex
        ? { index: crlfIndex, length: 4 }
        : { index: lfIndex, length: 2 };
    };

    const streamReadTimeout = 90_000;

    try {
      while (!streamEnded) {
        const { done, value } = await Promise.race([
          reader.read(),
          new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
            window.setTimeout(() => reject(new Error('Stream read timeout')), streamReadTimeout);
          }),
        ]);

        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

        let delimiter = findEventDelimiter();
        while (delimiter) {
          const rawEvent = buffer.slice(0, delimiter.index);
          buffer = buffer.slice(delimiter.index + delimiter.length);
          await processEvent(rawEvent.replace(/\r\n/g, '\n'));
          if (streamEnded) {
            break;
          }
          delimiter = findEventDelimiter();
        }

        if (done) {
          break;
        }
      }

      if (!streamEnded) {
        if (buffer.trim()) {
          await processEvent(buffer);
        }
        if (!streamEnded) {
          throw new Error('Stream ended unexpectedly');
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // Agent APIs
  async getDefaultAgent(): Promise<Agent> {
    return this.request<Agent>('/api/v1/agent:default');
  }

  async getAgent(agentId: string): Promise<Agent> {
    return this.request<Agent>(`/api/v1/agent?agent_id=${agentId}`);
  }

  async updateAgent(agentId: string, updates: Partial<Agent>): Promise<Agent> {
    return this.request<Agent>(`/api/v1/agent?agent_id=${agentId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async clearAgentError(agentId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/v1/agent:clear-error?agent_id=${agentId}`, {
      method: 'POST',
    });
  }

  async getJinaKeyStatus(agentId: string): Promise<{ agent_id: string; configured: boolean }> {
    return this.request(`/api/v1/agent:jina-key-status?agent_id=${agentId}`);
  }

  async updateJinaApiKey(agentId: string, jina_api_key: string): Promise<{ agent_id: string; configured: boolean }> {
    return this.request(`/api/v1/agent:jina-key?agent_id=${agentId}`, {
      method: 'PUT',
      body: JSON.stringify({ jina_api_key }),
    });
  }

  async getQuota(agentId: string): Promise<Quota> {
    return this.request<Quota>(`/api/v1/quota?agent_id=${agentId}`);
  }

  // URL Management APIs
  async createURLs(agentId: string, urls: string[]): Promise<{ created: number; message: string }> {
    return this.request(`/api/v1/urls:create?agent_id=${agentId}`, {
      method: 'POST',
      body: JSON.stringify({ urls }),
    }).then(result => result as { created: number; message: string });
  }

  async listURLs(agentId: string, skip = 0, limit = 50): Promise<{
    urls: URLSource[];
    total: number;
    quota: { used: number; max: number };
  }> {
    return this.request(`/api/v1/urls:list?agent_id=${agentId}&skip=${skip}&limit=${limit}`);
  }

  async refetchURLs(agentId: string, urlIds?: number[], force = false): Promise<{
    job_id: string;
    status: string;
    message: string;
  }> {
    return this.request(`/api/v1/urls:refetch?agent_id=${agentId}`, {
      method: 'POST',
      body: JSON.stringify({ url_ids: urlIds, force }),
    }).then(result => result as { job_id: string; status: string; message: string });
  }

  async cancelURLTasks(agentId: string): Promise<{ cancelled: number; task_ids: string[]; message: string }> {
    return this.request(`/api/v1/urls:cancel?agent_id=${agentId}`, {
      method: 'POST',
    }).then(result => result as { cancelled: number; task_ids: string[]; message: string });
  }

  async deleteURL(agentId: string, urlId: number): Promise<void> {
    await this.request(`/api/v1/urls:delete?agent_id=${agentId}&url_id=${urlId}`, {
      method: 'DELETE',
    });
  }

  async clearAllUrls(agentId: string): Promise<{ message: string; deleted_count: number }> {
    return this.request(`/api/v1/urls:clear_all?agent_id=${agentId}`, {
      method: 'DELETE',
    }).then(result => result as { message: string; deleted_count: number });
  }

  async discoverURLs(agentId: string, url: string, maxDepth = 1, maxPages = 10): Promise<{
    discovered: number;
    created: number;
    message: string;
  }> {
    return this.request(`/api/v1/urls:discover?agent_id=${agentId}&url=${encodeURIComponent(url)}&max_depth=${maxDepth}&max_pages=${maxPages}`, {
      method: 'POST',
    });
  }

  async crawlSite(agentId: string, url: string, maxDepth = 2, maxPages = 20): Promise<{
    job_id: string;
    status: string;
    discovered: number;
    created: number;
    message: string;
  }> {
    const body = JSON.stringify({ url, max_depth: maxDepth, max_pages: maxPages });
    const result = await this.request<{
      job_id: string;
      status: string;
      discovered: number;
      created: number;
      message: string;
    }>(`/api/v1/urls:crawl_site?agent_id=${agentId}`, {
      method: 'POST',
      body,
    });
    return result;
  }

  // Q&A Management APIs
  async importQA(agentId: string, content: string, format: 'json' | 'csv' = 'json', overwrite = false): Promise<{
    imported: number;
    failed: number;
    errors: string[];
  }> {
    return this.request(`/api/v1/qa:batch_import?agent_id=${agentId}`, {
      method: 'POST',
      body: JSON.stringify({ format, content, overwrite }),
    }).then(result => result as { imported: number; failed: number; errors: string[] });
  }

  async listQA(agentId: string, skip = 0, limit = 50): Promise<{
    items: QAItem[];
    total: number;
    quota: { used: number; max: number };
  }> {
    return this.request(`/api/v1/qa:list?agent_id=${agentId}&skip=${skip}&limit=${limit}`);
  }

  async updateQA(qaId: string, updates: { question?: string; answer?: string; tags?: string[] }): Promise<void> {
    await this.request(`/api/v1/qa:update?qa_id=${qaId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteQA(qaId: string): Promise<void> {
    await this.request(`/api/v1/qa:delete?qa_id=${qaId}`, {
      method: 'DELETE',
    });
  }

  // Index APIs
  async rebuildIndex(agentId: string, force = false): Promise<{
    job_id: string;
    status: string;
    message: string;
  }> {
    return this.request(`/api/v1/index:rebuild?agent_id=${agentId}`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    }).then(result => result as { job_id: string; status: string; message: string });
  }

  async getIndexStatus(agentId: string): Promise<{
    job_id?: string;
    agent_id: string;
    status: string;
    result?: {
      chunks_indexed: number;
      urls_processed: number;
      qa_items_processed: number;
    };
  }> {
    return this.request(`/api/v1/index:status?agent_id=${agentId}`);
  }

  async getIndexInfo(agentId: string): Promise<{
    agent_id: string;
    urls_indexed: number;
    qa_items_indexed: number;
    chunks_indexed: number;
    index_exists: boolean;
  }> {
    return this.request(`/api/v1/index:info?agent_id=${agentId}`);
  }

  // Models API
  async listModels(params: {
    provider_type: 'openai_native' | 'google';
    api_key?: string;
    agent_id?: string;
  }): Promise<string[]> {
    const result = await this.request<{ models: string[] }>('/api/v1/models:list', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return result.models;
  }

  // Tasks Status API
  async getTasksStatus(agentId: string): Promise<{
    agent_id: string;
    is_crawling: boolean;
    is_rebuilding: boolean;
    active_tasks: string[];
    can_modify_index: boolean;
  }> {
    return this.request(`/api/v1/tasks:status?agent_id=${agentId}`);
  }

  // Sources Summary API
  async getSourcesSummary(agentId: string): Promise<{
    urls: { total: number; indexed: number; pending: number; total_size_kb: number };
    qa: { total: number; indexed: number; pending: number; total_size_kb: number };
    has_pending: boolean;
  }> {
    return this.request(`/api/v1/sources:summary?agent_id=${agentId}`);
  }

  // API Test Methods
  async testAIApi(agentId: string, overrides?: Partial<Agent>): Promise<{ success: boolean; message: string }> {
    return this.request(`/api/v1/agent:test-ai-api?agent_id=${agentId}`, {
      method: 'POST',
      body: JSON.stringify(overrides ?? {}),
    });
  }

  async testJinaApi(agentId: string, overrides?: Partial<Agent>): Promise<{ success: boolean; message: string }> {
    return this.request(`/api/v1/agent:test-jina-api?agent_id=${agentId}`, {
      method: 'POST',
      body: JSON.stringify(overrides ?? {}),
    });
  }

  // Admin API methods
  async getAdminSessions(params?: { visitor_id?: string; keyword?: string }): Promise<any[]> {
    let url = '/api/v1/admin/sessions?';
    if (params?.visitor_id) {
      url += `visitor_id=${params.visitor_id}`;
    } else if (params?.keyword) {
      url += `keyword=${params.keyword}`;
    }
    return this.request(url);
  }

  async getAdminSessionMessages(sessionId: string): Promise<any[]> {
    return this.request(`/api/v1/admin/sessions/${sessionId}/messages`);
  }
}

export const api = new APIService();
