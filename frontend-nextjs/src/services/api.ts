/**
 * API Service for v1 Endpoints
 */
import { API_BASE_URL } from "../lib/env";

export interface ChatRequest {
	agent_id: string;
	message: string;
	locale?: string;
	session_id?: string;
	params?: {
		temperature?: number;
		max_tokens?: number;
	};
	/**
	 * #44: ask for a turn that does not consume the daily allowance. The
	 * backend honours it only for an admin bearer token, so this is a hint, not
	 * a grant — it is safe for the Playground to always send it.
	 */
	preview?: boolean;
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
	mode?: "ai" | "human";
	no_answer_reason?: string | null;
	/** #44: true when the fallback model answered. */
	degraded?: boolean;
	/** #44: the model that actually produced the reply. */
	model?: string | null;
}

export interface StreamDoneMeta {
	message_id: number | null;
	session_id?: string;
	usage?: UsageInfo | null;
	taken_over?: boolean;
	/** #43: who answers next. `taken_over` implies `human`. */
	mode?: "ai" | "human";
	/** #43: machine token explaining why the bot stayed silent. */
	no_answer_reason?: string | null;
	/** #44: true when the fallback model answered (primary allowance spent). */
	degraded?: boolean;
	/** #44: the model that actually produced the answer. */
	model?: string | null;
}

export interface Source {
	/** `qa` marks a curated pair; it carries no url and no filename. */
	type: "url" | "file" | "qa";
	title?: string;
	url?: string;
	filename?: string;
	snippet?: string;
	question?: string;
	id?: string;
}

export type ProviderType =
	| "openai"
	| "openai_native"
	| "google"
	| "anthropic"
	| "xai"
	| "openrouter"
	| "zai"
	| "deepseek"
	| "volcengine"
	| "tencentcloud"
	| "moonshot"
	| "aliyun_bailian"
	| "siliconflow";

export type EmbeddingProvider =
	| "jina"
	| "siliconflow"
	| "custom"
	| "local";

export interface Agent {
	id: string;
	workspace_id?: number;
	name: string;
	description?: string;
	avatar?: string | null;
	system_prompt: string;
	/** Operator-written facts that outrank retrieved chunks (#39). */
	fixed_facts?: string | null;
	/** Plain-language escalation prompt, appended after the procedures block (#43). */
	escalation_rules?: string | null;
	/** `{"timezone": IANA, "schedule": [{"day": 0-6, "start": min, "end": min}]}` (#43). */
	business_hours?: BusinessHoursPayload | null;
	/** Widget copy shown outside business hours (#43). */
	away_message?: string | null;
	/** #44: model that answers once the daily allowance is spent. */
	fallback_model?: string | null;
	/** Write-only: a typed value replaces the stored (encrypted) fallback key. */
	fallback_api_key?: string;
	/** #44: whether a fallback key is stored (the key itself is never returned). */
	fallback_api_key_set?: boolean;
	/** #40: regexes matched against `location.pathname`; a match renders nothing. */
	excluded_paths?: string[] | null;
	/** #40: bubble | inline | iframe. */
	display_mode?: "bubble" | "inline" | "iframe" | null;
	/** #40: CSS selector the inline/iframe modes mount into. */
	inline_container?: string | null;
	/** #40: `[{label, action, value, path}]` — `path` scopes a starter to a page. */
	starters?: WidgetStarter[] | null;
	/** #40: entry-screen cards — `[{logo, heading, text, chat|kb_search|form}]`. */
	widget_cards?: WidgetCard[] | null;
	/** #40: share of visitors that get the widget (0-100). */
	traffic_percentage?: number | null;
	/** #47: HTTPS endpoint that receives signed event deliveries. */
	webhook_url?: string | null;
	/** #47: write-only — a typed value replaces the stored (encrypted) secret. */
	webhook_secret?: string;
	/** #47: whether a signing secret is stored (the secret itself is never returned). */
	webhook_secret_set?: boolean;
	model: string;
	temperature: number;
	max_tokens: number;
	api_format?: "openai" | "openai_compatible" | "anthropic" | "google";
	api_key?: string;
	api_key_set?: boolean;
	api_key_masked?: string;
	api_base?: string;
	provider_type?: ProviderType;
	azure_endpoint?: string;
	azure_deployment_name?: string;
	azure_api_version?: string;
	anthropic_version?: string;
	google_project_id?: string;
	google_region?: string;
	provider_config?: Record<string, string | number | boolean>;
	kb_id?: string | null;
	kb_name?: string | null;
	kb_status?: string | null;
	crawl_max_depth?: number;
	crawl_max_pages?: number;
	top_k: number;
	similarity_threshold: number;
	enable_context: boolean;
	enable_auto_fetch?: boolean;
	url_fetch_interval_days?: number;
	rate_limit_per_minute?: number;
	rate_limit_per_hour?: number;
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
	deleted_at?: string | null;
	purge_after?: string | null;
	status?: "active" | "inactive" | "deleted";
	url_count?: number;
	file_count?: number;
	active_session_count?: number;
	/** Distinct visitors with at least one session; absent on older payloads. */
	visitor_count?: number;
	created_at: string;
	updated_at?: string;
}

/** Contract C6 business-hours JSON (#43). */
export interface BusinessHoursPayload {
	timezone: string;
	schedule: Array<{ day: number; start: number; end: number }>;
}

/** #40: one starter chip. `path` is an optional regex scoping it to a page. */
export interface WidgetStarter {
	label: string;
	action: "message" | "link";
	/** Sent text for `message`, the URL for `link`. */
	value?: string;
	url?: string;
	path?: string;
}

/** #40: one entry-screen card. */
export interface WidgetCard {
	logo?: string;
	heading?: string;
	text?: string;
	chat?: string;
	kb_search?: string;
	form?: string;
}

/** Lifecycle state of a knowledge base, mirrored from `KnowledgeBase.status`. */
export type KbStatus = "active" | "resetting" | "processing" | "error";

/** Compact agent reference embedded in a KB detail payload. */
export interface KbAgentRef {
	id: string;
	name: string;
}

/** Workspace-scoped knowledge base: config plus document/chunk counters. */
export interface KnowledgeBaseDetail {
	id: string;
	name: string;
	workspace_id?: number;
	embedding_provider: EmbeddingProvider;
	embedding_model: string;
	embedding_base_url: string | null;
	embedding_batch_size: number;
	embedding_dimension: number | null;
	chunk_size: number;
	chunk_overlap: number;
	status: KbStatus;
	is_locked: boolean;
	error_message: string | null;
	document_count: number;
	ready_document_count: number;
	total_chunks: number;
	bound_agent: KbAgentRef | null;
	created_at?: string | null;
}

/** Payload for `POST /api/v1/knowledge-bases`. The key is probed before persisting. */
export interface KnowledgeBaseCreateInput {
	name: string;
	embedding_provider: EmbeddingProvider;
	embedding_model: string;
	embedding_base_url?: string | null;
	embedding_api_key: string;
	embedding_batch_size?: number;
	chunk_size?: number;
	chunk_overlap?: number;
}

/** Payload for `PATCH /api/v1/knowledge-bases/{id}` (non-embedding fields only). */
export interface KnowledgeBaseUpdateInput {
	name?: string;
	chunk_size?: number;
	chunk_overlap?: number;
}

/** Payload for `POST /api/v1/knowledge-bases/{id}/reset`. */
export interface KnowledgeBaseResetInput {
	embedding_provider: EmbeddingProvider;
	embedding_model: string;
	embedding_base_url?: string | null;
	embedding_api_key?: string;
	embedding_batch_size?: number;
}

/** Payload for `POST /api/v1/knowledge-bases/test-embedding`. */
export interface EmbeddingTestInput {
	embedding_provider: EmbeddingProvider;
	embedding_model: string;
	embedding_base_url?: string | null;
	embedding_api_key: string;
}

/** Result of the embedding provider probe. */
export interface EmbeddingTestResult {
	success: boolean;
	dimension: number | null;
	message: string;
}

/** Derived knowledge base status for one agent. */
export interface KbStatusPayload {
	agent_id: string;
	kb_id: string | null;
	kb_setup_completed: boolean;
	kb: {
		id: string;
		name: string;
		embedding_provider: EmbeddingProvider;
		embedding_model: string;
		status: KbStatus;
	} | null;
}

export interface AgentMember {
	id: number;
	email: string;
	name: string;
	is_active: boolean;
	role: string;
	member_role: "admin" | "support";
}

export interface AgentMemberCreateInput {
	email: string;
	name?: string;
	password?: string;
	role: "admin" | "support";
}

export interface URLSource {
	id: number;
	url: string;
	normalized_url: string;
	status: "pending" | "fetching" | "success" | "failed";
	title?: string;
	last_fetch_at?: string;
	is_indexed: boolean;
	created_at: string;
	updated_at?: string;
	// KB indexing diagnostics
	indexing_status?: "pending" | "processing" | "ready" | "error";
	indexing_error?: string;
	last_error?: string;
}

export interface URLListResponse {
	urls: URLSource[];
	total: number;
	quota: { used: number; max: number };
	job_id?: string;
	auto_fetch_queued?: boolean;
	last_fetch_at?: string;
	is_indexed: boolean;
	created_at: string;
	updated_at?: string;
}

/** Result of `POST /knowledge-bases/{kb_id}/urls:clear_all` and files:clear_all. */
export interface KbClearResponse {
	success?: boolean;
	message?: string;
	deleted_count?: number;
}

/** Result of `POST /knowledge-bases/{kb_id}/urls:refetch`. */
export interface KbUrlRefetchResponse {
	job_id: string;
	status: string;
	message: string;
}

/** Result of `POST /knowledge-bases/{kb_id}/urls:cancel`. */
export interface KbUrlCancelResponse {
	cancelled: number;
	task_ids: string[];
	message: string;
}

/** Result of `POST /knowledge-bases/{kb_id}/urls:crawl_site`. */
export interface KbSiteCrawlResponse {
	job_id: string;
	status: string;
	discovered: number;
	created: number;
	message: string;
}

/** Result of `POST /knowledge-bases/{kb_id}/files:upload`. */
export interface KbFileUploadResponse {
	uploaded: number;
	failed: number;
	files: FileItem[];
	errors: string[];
}

/** Result of `POST /knowledge-bases/{kb_id}/index:rebuild`. */
export interface KbIndexRebuildResponse {
	job_id: string;
	status: string;
	message: string;
}

/** Result of `GET /knowledge-bases/{kb_id}/index:status`. */
export interface KbIndexStatusResponse {
	kb_id: string;
	job_id?: string | null;
	status: string;
	result?: Record<string, unknown> | null;
}

/** Result of `GET /knowledge-bases/{kb_id}/sources:summary`. */
export interface KbSourcesSummaryResponse {
	urls: {
		total: number;
		indexed: number;
		pending: number;
		total_size_kb: number;
	};
	files: {
		total: number;
		ready: number;
		processing: number;
		total_size_kb: number;
	};
	has_pending: boolean;
}

export interface FileItem {
	id: string;
	filename: string;
	file_type: string;
	file_size: number;
	status: "ready" | "processing" | "uploading" | "pending" | "failed";
	created_at: string;
	updated_at?: string;
	// Processing error details (localized, client-safe sentence)
	error_message?: string;
	/** #47: the stored upstream cause, verbatim (`401 Unauthorized from ...`).
	 *  Never translated; the row shows it as the primary line and keeps
	 *  `error_message` beneath it as the friendly explanation. */
	error_detail?: string | null;
	/** #47 two-phase upload: which ingest phase the row is in. */
	processing_stage?: string | null;
}

export interface Quota {
	max_agents: number;
	max_urls: number;
	max_files: number;
	max_messages_per_day: number;
	max_total_text_mb: number;
	used_agents: number;
	used_urls: number;
	used_files: number;
	used_messages_today: number;
	used_total_text_mb: number;
	remaining_urls: number;
	remaining_files: number;
	remaining_messages_today: number;
}

export interface AgentCreateInput {
	name: string;
	description?: string;
	system_prompt?: string;
	persona_type?: string;
	widget_title?: string;
	welcome_message?: string;
}

/**
 * Curated question/answer pair (#39). Stored on the KB and embedded into a
 * dedicated collection, so a hit outranks an ordinary chunk without a reindex.
 */
export interface QaItem {
	id: string;
	kb_id: string;
	question: string;
	answer: string;
	enabled: boolean;
	hits: number;
	last_hit_at?: string | null;
	/** manual | revise | unanswered — how the pair got here. */
	source: string;
	source_message_id?: number | null;
	created_at?: string | null;
	updated_at?: string | null;
}

export interface QaItemListResponse {
	items: QaItem[];
	total: number;
}

export interface QaItemCreateInput {
	question: string;
	answer: string;
}

export interface QaItemUpdateInput {
	question?: string;
	answer?: string;
	enabled?: boolean;
}

export interface QaImportPair {
	question: string;
	answer: string;
}

export interface QaImportResponse {
	created: number;
	skipped: number;
}

export interface ReviseAnswerResponse {
	qa_item: QaItem;
	/** True when an existing pair for the same question was corrected. */
	replaced: boolean;
}

export interface QaFromMessageResponse {
	qa_item: QaItem;
}

/**
 * One row of the #42 unanswered queue. `question` is the visitor's own message
 * (not the answer), `occurrences` is how often the same normalised question was
 * flagged unanswered for that agent.
 */
export interface UnansweredItem {
	message_id: number;
	session_id: string;
	question: string;
	answer: string;
	/** null means "no retrieval signal" — render an em dash, never 0%. */
	confidence: number | null;
	created_at?: string | null;
	occurrences: number;
}

export interface UnansweredList {
	items: UnansweredItem[];
	total: number;
}

/**
 * #45: one tile of the dashboard. `delta_kind` says how to read the delta:
 * `none` means the previous window had nothing to compare against and the value
 * did not move, `new` means the metric did not exist before (never a percentage,
 * because a percentage of zero is not a number an operator should ever see).
 * `window_label` is the comparison window in words — it is not optional, so a
 * tile can never be rendered as a bare number.
 */
export type DeltaKind = "none" | "new" | "pct";

export interface AnalyticsTile {
	value: number;
	previous: number;
	delta: number;
	/** null when the delta is not a percentage (`delta_kind` is not `pct`). */
	delta_pct: number | null;
	delta_kind: DeltaKind;
	/** e.g. "vs previous 7 days" / "vs 前 7 天". */
	window_label: string;
}

export interface AnalyticsWindow {
	from: string;
	to: string;
	previous_from: string;
	previous_to: string;
	days: number;
	label: string;
}

export interface AnalyticsFunnel {
	opens: number;
	conversations: number;
	leads: number;
	conversation_rate: number;
	lead_rate: number;
}

export interface OutcomeSplit {
	resolved: number;
	abandoned: number;
	escalated: number;
	"no-answer": number;
	total: number;
	classified: number;
	unclassified: number;
}

/** A pointer to #42's triage queue, not a copy of it. */
export interface TopUnansweredItem {
	/** Grouped by the queue's own normaliser, so the two surfaces agree. */
	question: string;
	occurrences: number;
	/** The queue's coordinates: deep-link target and "add to Q&A" handle. */
	message_id: number | null;
	last_seen?: string | null;
}

export interface AnalyticsOverview {
	range: AnalyticsRange;
	window: AnalyticsWindow;
	tiles: Record<AnalyticsTileName, AnalyticsTile>;
	funnel: AnalyticsFunnel;
	outcome_split: OutcomeSplit;
	top_unanswered: TopUnansweredItem[];
}

export type AnalyticsRange = "24h" | "7d" | "30d" | "90d";

export type AnalyticsTileName =
	| "sessions"
	| "messages"
	| "ai_replies"
	| "visitors"
	| "leads"
	| "handoffs"
	| "unanswered"
	| "degraded"
	| "negative_feedback"
	| "positive_feedback_rate";

export interface AnalyticsQuery {
	range?: AnalyticsRange;
	agent_id?: string;
}

export interface UnansweredQuery {
	/** ISO-8601; the backend defaults to 30 days back. */
	since?: string;
	agent_id?: string;
	skip?: number;
	limit?: number;
}

/**
 * One ordered step of a procedure. `requires_action` names a channel capability
 * (`link`, `form`, or anything else); a step whose action is unavailable skips
 * the whole procedure, so the value must round-trip freely.
 */
export interface ProcedureStep {
	text: string;
	requires_action?: string | null;
}

export interface Procedure {
	id: string;
	agent_id: string;
	name: string;
	steps: ProcedureStep[];
	enabled: boolean;
	created_at?: string | null;
	updated_at?: string | null;
}

export interface ProcedureListResponse {
	items: Procedure[];
	total: number;
}

export interface ProcedureCreateInput {
	name: string;
	steps: ProcedureStep[];
	enabled?: boolean;
}

export interface ProcedureUpdateInput {
	name?: string;
	steps?: ProcedureStep[];
	enabled?: boolean;
}

export interface FixedFactsResponse {
	fixed_facts?: string | null;
}

export interface DeleteResult {
	deleted: boolean;
	id: string;
}

export async function parseErrorResponse(response: Response): Promise<string> {
	const contentType = (
		response.headers.get("content-type") || ""
	).toLowerCase();

	if (contentType.includes("application/json")) {
		const data = await response.json().catch(() => null);
		if (data?.detail) {
			if (typeof data.detail === "string") return data.detail;
			if (Array.isArray(data.detail)) {
				const messages = data.detail
					.map((e: { msg?: string; message?: string }) => e.msg || e.message)
					.filter(Boolean);
				if (messages.length) return messages.join("; ");
			}
			return JSON.stringify(data.detail);
		}
		if (data?.message) return data.message;
	}

	const text = await response.text().catch(() => "");
	const statusLabel = `${response.status} ${response.statusText || "Request failed"}`;
	if (text.trim()) {
		return `${statusLabel}: ${text.trim().slice(0, 500)}`;
	}
	return statusLabel;
}

class APIService {
	private baseUrl: string;
	private selectedAgentStorageKey = "basjoo_selected_agent_id";

	constructor(baseUrl: string = API_BASE_URL) {
		this.baseUrl = baseUrl;
	}

	private getLocale(): string {
		return localStorage.getItem("basjoo_locale") || "zh-CN";
	}

	private getStreamBaseUrl(): string {
		if (this.baseUrl) {
			return this.baseUrl;
		}

		if (typeof window === "undefined") {
			return this.baseUrl;
		}

		const { protocol, hostname, port } = window.location;
		const isFrontendDevPort = port === "3000";

		if ((protocol === "http:" || protocol === "https:") && isFrontendDevPort) {
			return `${protocol}//${hostname}:8000`;
		}

		return this.baseUrl;
	}

	getSelectedAgentId(): string | null {
		if (typeof window === "undefined") return null;
		return localStorage.getItem(this.selectedAgentStorageKey);
	}

	setSelectedAgentId(agentId: string) {
		if (typeof window === "undefined") return;
		localStorage.setItem(this.selectedAgentStorageKey, agentId);
		window.dispatchEvent(
			new CustomEvent("basjoo-agent-changed", { detail: { agentId } }),
		);
	}

	clearSelectedAgentId() {
		if (typeof window === "undefined") return;
		localStorage.removeItem(this.selectedAgentStorageKey);
		window.dispatchEvent(
			new CustomEvent("basjoo-agent-changed", { detail: { agentId: null } }),
		);
	}

	private async request<T>(
		endpoint: string,
		options: RequestInit = {},
	): Promise<T> {
		// Add locale parameter to URL
		const url = new URL(`${this.baseUrl}${endpoint}`, window.location.origin);
		url.searchParams.set("locale", this.getLocale());

		const token = localStorage.getItem("token");

		const response = await fetch(url.toString(), {
			...options,
			headers: {
				"Content-Type": "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				...options.headers,
			},
		});

		if (!response.ok) {
			const errorMessage = await parseErrorResponse(response);
			console.error(`API Error: ${errorMessage}`, {
				status: response.status,
				endpoint,
				url,
			});
			throw new Error(errorMessage);
		}

		// Handle 204 No Content
		if (response.status === 204) {
			return undefined as T;
		}

		const contentType = (
			response.headers.get("content-type") || ""
		).toLowerCase();
		if (!contentType.includes("application/json")) {
			throw new Error(
				`Expected JSON response but received ${contentType || "unknown content type"}`,
			);
		}

		return response.json();
	}

	async checkHealth(): Promise<{ status: string }> {
		try {
			const result = await this.request<{ status: string }>("/health");
			return result;
		} catch (error) {
			console.error("Health check failed:", error);
			throw new Error(
				"Backend service is not accessible. Please check if the backend is running.",
			);
		}
	}

	// Chat APIs
	async chat(request: ChatRequest): Promise<ChatResponse> {
		// Include locale in request body, but don't override if already provided
		const chatRequest = {
			...request,
			locale: request.locale || this.getLocale(),
		};
		return this.request<ChatResponse>("/api/v1/chat", {
			method: "POST",
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
		},
	): Promise<void> {
		const chatRequest = {
			...request,
			locale: request.locale || this.getLocale(),
		};

		const streamBaseUrl = this.getStreamBaseUrl();
		const url = new URL(
			`${streamBaseUrl}/api/v1/chat/stream`,
			window.location.origin,
		);
		url.searchParams.set("locale", this.getLocale());

		const token = localStorage.getItem("token");

		const response = await fetch(url.toString(), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "text/event-stream",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: JSON.stringify(chatRequest),
			signal: options?.signal,
		});

		if (!response.ok) {
			const message = await parseErrorResponse(response);
			throw new Error(message || "Stream request failed");
		}

		if (!response.body) {
			throw new Error("Streaming response body is unavailable");
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let streamEnded = false;

		const processEvent = async (rawEvent: string) => {
			if (!rawEvent.trim()) {
				return;
			}

			let eventName = "message";
			const dataLines: string[] = [];

			for (const line of rawEvent.split("\n")) {
				if (line.startsWith("event:")) {
					eventName = line.slice(6).trim();
				} else if (line.startsWith("data:")) {
					dataLines.push(line.slice(5).trimStart());
				}
			}

			if (dataLines.length === 0) {
				return;
			}

			const payload = JSON.parse(dataLines.join("\n"));

			switch (eventName) {
				case "sources":
					callbacks.onSources(
						Array.isArray(payload.sources) ? payload.sources : [],
					);
					break;
				case "thinking":
					callbacks.onThinking?.(
						typeof payload.elapsed === "number" ? payload.elapsed : 0,
					);
					break;
				case "thinking_done":
					callbacks.onThinkingDone?.();
					break;
				case "content":
					callbacks.onContent(
						typeof payload.content === "string" ? payload.content : "",
					);
					break;
				case "done":
					streamEnded = true;
					callbacks.onDone(payload as StreamDoneMeta);
					break;
				case "error":
					streamEnded = true;
					callbacks.onError(
						typeof payload.error === "string" ? payload.error : "Stream failed",
					);
					break;
				default:
					break;
			}
		};

		const findEventDelimiter = (): { index: number; length: number } | null => {
			const crlfIndex = buffer.indexOf("\r\n\r\n");
			const lfIndex = buffer.indexOf("\n\n");

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
				let timeoutId: number | null = null;
				const { done, value } = await Promise.race([
					reader.read(),
					new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
						timeoutId = window.setTimeout(
							() => reject(new Error("Stream read timeout")),
							streamReadTimeout,
						);
					}),
				]);
				if (timeoutId !== null) clearTimeout(timeoutId as number);

				buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

				let delimiter = findEventDelimiter();
				while (delimiter) {
					const rawEvent = buffer.slice(0, delimiter.index);
					buffer = buffer.slice(delimiter.index + delimiter.length);
					await processEvent(rawEvent.replace(/\r\n/g, "\n"));
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
					throw new Error("Stream ended unexpectedly");
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	// Agent APIs
	async listAgents(): Promise<{ agents: Agent[]; total: number }> {
		return this.request<{ agents: Agent[]; total: number }>("/api/v1/agents");
	}

	async createAgent(input: AgentCreateInput): Promise<Agent> {
		const agent = await this.request<Agent>("/api/v1/agents", {
			method: "POST",
			body: JSON.stringify(input),
		});
		this.setSelectedAgentId(agent.id);
		return agent;
	}

	async deleteAgent(
		agentId: string,
	): Promise<{ success: boolean; deleted_at?: string; purge_after?: string }> {
		const result = await this.request<{
			success: boolean;
			deleted_at?: string;
			purge_after?: string;
		}>(`/api/v1/agents/${agentId}`, {
			method: "DELETE",
		});

		if (this.getSelectedAgentId() === agentId) {
			this.clearSelectedAgentId();
		}

		return result;
	}

	async pauseAgent(agentId: string): Promise<Agent> {
		return this.request<Agent>(`/api/v1/agents/${agentId}:pause`, {
			method: "POST",
		});
	}

	async resumeAgent(agentId: string): Promise<Agent> {
		return this.request<Agent>(`/api/v1/agents/${agentId}:resume`, {
			method: "POST",
		});
	}

	async restoreAgent(agentId: string): Promise<Agent> {
		const agent = await this.request<Agent>(
			`/api/v1/agents/${agentId}:restore`,
			{
				method: "POST",
			},
		);
		this.setSelectedAgentId(agent.id);
		return agent;
	}

	async listAgentMembers(
		agentId: string,
	): Promise<{ members: AgentMember[]; total: number }> {
		return this.request<{ members: AgentMember[]; total: number }>(
			`/api/v1/agents/${agentId}/members`,
		);
	}

	async createAgentMember(
		agentId: string,
		input: AgentMemberCreateInput,
	): Promise<AgentMember> {
		return this.request<AgentMember>(`/api/v1/agents/${agentId}/members`, {
			method: "POST",
			body: JSON.stringify(input),
		});
	}

	async deleteAgentMember(
		agentId: string,
		adminId: number,
	): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>(
			`/api/v1/agents/${agentId}/members/${adminId}`,
			{
				method: "DELETE",
			},
		);
	}

	async getDefaultAgent(): Promise<Agent> {
		const selectedAgentId = this.getSelectedAgentId();
		if (selectedAgentId) {
			try {
				return await this.getAgent(selectedAgentId);
			} catch (error) {
				this.clearSelectedAgentId();
			}
		}
		return this.request<Agent>("/api/v1/agent:default");
	}

	async getAgent(agentId: string): Promise<Agent> {
		return this.request<Agent>(`/api/v1/agent?agent_id=${agentId}`);
	}

	async updateAgent(agentId: string, updates: Partial<Agent>): Promise<Agent> {
		return this.request<Agent>(`/api/v1/agent?agent_id=${agentId}`, {
			method: "PUT",
			body: JSON.stringify(updates),
		});
	}

	async clearAgentError(agentId: string): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>(
			`/api/v1/agent:clear-error?agent_id=${agentId}`,
			{
				method: "POST",
			},
		);
	}

	async getQuota(agentId: string): Promise<Quota> {
		return this.request<Quota>(`/api/v1/quota?agent_id=${agentId}`);
	}

	/**
	 * #40: the server's own idea of its public address.
	 *
	 * The embed snippet must never be composed from `window.location.origin`: a
	 * dashboard opened on `localhost` would hand out a `localhost` snippet. The
	 * API answers with the forwarded host, so the copied tag is right everywhere.
	 */
	async getPublicOrigin(agentId: string): Promise<string | null> {
		try {
			const payload = await this.request<{ api_base?: string }>(
				`/api/v1/config:public?agent_id=${encodeURIComponent(agentId)}`,
			);
			const origin = payload?.api_base?.trim();
			return origin ? origin.replace(/\/$/, "") : null;
		} catch {
			return null;
		}
	}

	// Knowledge base APIs (workspace-scoped, independent of any agent)
	async kbStatus(agentId: string): Promise<KbStatusPayload> {
		return this.request<KbStatusPayload>(
			`/api/v1/agent:kb-status?agent_id=${agentId}`,
		);
	}

	async listKnowledgeBases(): Promise<{
		knowledge_bases: KnowledgeBaseDetail[];
		total: number;
	}> {
		return this.request<{
			knowledge_bases: KnowledgeBaseDetail[];
			total: number;
		}>("/api/v1/knowledge-bases");
	}

	async createKnowledgeBase(
		input: KnowledgeBaseCreateInput,
	): Promise<KnowledgeBaseDetail> {
		return this.request<KnowledgeBaseDetail>("/api/v1/knowledge-bases", {
			method: "POST",
			body: JSON.stringify(input),
		});
	}

	async getKnowledgeBase(kbId: string): Promise<KnowledgeBaseDetail> {
		return this.request<KnowledgeBaseDetail>(
			`/api/v1/knowledge-bases/${kbId}`,
		);
	}

	async updateKnowledgeBase(
		kbId: string,
		input: KnowledgeBaseUpdateInput,
	): Promise<KnowledgeBaseDetail> {
		return this.request<KnowledgeBaseDetail>(
			`/api/v1/knowledge-bases/${kbId}`,
			{
				method: "PATCH",
				body: JSON.stringify(input),
			},
		);
	}

	async resetKnowledgeBase(
		kbId: string,
		input: KnowledgeBaseResetInput,
	): Promise<{
		status: string;
		kb_id: string;
		requeued_documents: number;
		doc_ids: string[];
	}> {
		return this.request<{
			status: string;
			kb_id: string;
			requeued_documents: number;
			doc_ids: string[];
		}>(`/api/v1/knowledge-bases/${kbId}/reset`, {
			method: "POST",
			body: JSON.stringify(input),
		});
	}

	async deleteKnowledgeBase(kbId: string): Promise<{ deleted: boolean }> {
		return this.request<{ deleted: boolean }>(
			`/api/v1/knowledge-bases/${kbId}`,
			{
				method: "DELETE",
			},
		);
	}

	async bindAgentKnowledgeBase(
		agentId: string,
		kbId: string | null,
	): Promise<{ agent: Agent; knowledge_base: KnowledgeBaseDetail | null }> {
		return this.request<{
			agent: Agent;
			knowledge_base: KnowledgeBaseDetail | null;
		}>(`/api/v1/agents/${agentId}/knowledge-base`, {
			method: "PUT",
			body: JSON.stringify({ kb_id: kbId }),
		});
	}

	async testEmbeddingConfig(
		input: EmbeddingTestInput,
	): Promise<EmbeddingTestResult> {
		return this.request<EmbeddingTestResult>(
			"/api/v1/knowledge-bases/test-embedding",
			{
				method: "POST",
				body: JSON.stringify(input),
			},
		);
	}

	// URL Management APIs
	async createURLs(agentId: string, urls: string[]): Promise<URLListResponse> {
		return this.request(`/api/v1/urls:create?agent_id=${agentId}`, {
			method: "POST",
			body: JSON.stringify({ urls }),
		});
	}

	async listURLs(
		agentId: string,
		skip = 0,
		limit = 100,
	): Promise<{
		urls: URLSource[];
		total: number;
		quota: { used: number; max: number };
	}> {
		return this.request(
			`/api/v1/urls:list?agent_id=${agentId}&skip=${skip}&limit=${limit}`,
		);
	}

	async refetchURLs(
		agentId: string,
		urlIds?: number[],
		force = false,
	): Promise<{
		job_id: string;
		status: string;
		message: string;
	}> {
		return this.request(`/api/v1/urls:refetch?agent_id=${agentId}`, {
			method: "POST",
			body: JSON.stringify({ url_ids: urlIds, force }),
		}).then(
			(result) => result as { job_id: string; status: string; message: string },
		);
	}

	async cancelURLTasks(
		agentId: string,
	): Promise<{ cancelled: number; task_ids: string[]; message: string }> {
		return this.request(`/api/v1/urls:cancel?agent_id=${agentId}`, {
			method: "POST",
		}).then(
			(result) =>
				result as { cancelled: number; task_ids: string[]; message: string },
		);
	}

	async deleteURL(agentId: string, urlId: number): Promise<void> {
		await this.request(
			`/api/v1/urls:delete?agent_id=${agentId}&url_id=${urlId}`,
			{
				method: "DELETE",
			},
		);
	}

	async clearAllUrls(
		agentId: string,
	): Promise<{ message: string; deleted_count: number }> {
		return this.request(`/api/v1/urls:clear_all?agent_id=${agentId}`, {
			method: "POST",
		}).then((result) => result as { message: string; deleted_count: number });
	}

	async discoverURLs(
		agentId: string,
		url: string,
		maxDepth = 1,
		maxPages = 10,
	): Promise<{
		discovered: number;
		created: number;
		message: string;
	}> {
		return this.request(
			`/api/v1/urls:discover?agent_id=${agentId}&url=${encodeURIComponent(url)}&max_depth=${maxDepth}&max_pages=${maxPages}`,
			{
				method: "POST",
			},
		);
	}

	async crawlSite(
		agentId: string,
		url: string,
		maxDepth = 2,
		maxPages = 20,
	): Promise<{
		job_id: string;
		status: string;
		discovered: number;
		created: number;
		message: string;
	}> {
		const body = JSON.stringify({
			url,
			max_depth: maxDepth,
			max_pages: maxPages,
		});
		const result = await this.request<{
			job_id: string;
			status: string;
			discovered: number;
			created: number;
			message: string;
		}>(`/api/v1/urls:crawl_site?agent_id=${agentId}`, {
			method: "POST",
			body,
		});
		return result;
	}

	// File Upload APIs
	async uploadFiles(
		agentId: string,
		files: File[],
	): Promise<{
		uploaded: number;
		failed: number;
		errors: string[];
		files: FileItem[];
	}> {
		const formData = new FormData();
		for (const file of files) {
			formData.append("files", file);
		}
		const token = localStorage.getItem("token");
		const url = new URL(
			`${this.baseUrl}/api/v1/files:upload`,
			window.location.origin,
		);
		url.searchParams.set("agent_id", agentId);
		url.searchParams.set("locale", this.getLocale());

		const response = await fetch(url.toString(), {
			method: "POST",
			headers: {
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: formData,
		});

		if (!response.ok) {
			const errorMessage = await parseErrorResponse(response);
			throw new Error(errorMessage);
		}

		return response.json();
	}

	async listFiles(
		agentId: string,
		skip = 0,
		limit = 100,
	): Promise<{
		files: FileItem[];
		total: number;
	}> {
		return this.request(
			`/api/v1/files:list?agent_id=${agentId}&skip=${skip}&limit=${limit}`,
		);
	}

	async deleteFile(agentId: string, fileId: string): Promise<void> {
		await this.request(
			`/api/v1/files:delete?agent_id=${agentId}&file_id=${fileId}`,
			{
				method: "DELETE",
			},
		);
	}

	async clearAllFiles(
		agentId: string,
	): Promise<{ message: string; deleted_count: number }> {
		return this.request(`/api/v1/files:clear_all?agent_id=${agentId}`, {
			method: "POST",
		}).then((result) => result as { message: string; deleted_count: number });
	}

	// Index APIs
	async rebuildIndex(
		agentId: string,
		force = false,
	): Promise<{
		job_id: string;
		status: string;
		message: string;
	}> {
		return this.request(`/api/v1/index:rebuild?agent_id=${agentId}`, {
			method: "POST",
			body: JSON.stringify({ force }),
		}).then(
			(result) => result as { job_id: string; status: string; message: string },
		);
	}

	async getIndexStatus(agentId: string): Promise<{
		job_id?: string;
		agent_id: string;
		status: string;
		result?: {
			urls_ingested: number;
			errors: string[];
		};
	}> {
		return this.request(`/api/v1/index:status?agent_id=${agentId}`);
	}

	async getIndexInfo(agentId: string): Promise<{
		agent_id: string;
		urls_indexed: number;
		files_indexed: number;
		index_exists: boolean;
		status: string;
	}> {
		return this.request(`/api/v1/index:info?agent_id=${agentId}`);
	}

	// KB-scoped source APIs (canonical routes; no agent in the request path).
	// The KB page composes URL + file management, so these helpers take `kbId`.

	private kbBase(kbId: string): string {
		return `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}`;
	}

	async listKbUrls(
		kbId: string,
		skip = 0,
		limit = 100,
	): Promise<URLListResponse> {
		return this.request<URLListResponse>(
			`${this.kbBase(kbId)}/urls:list?skip=${skip}&limit=${limit}`,
		);
	}

	async createKbUrls(
		kbId: string,
		urls: string[],
	): Promise<URLListResponse> {
		return this.request<URLListResponse>(`${this.kbBase(kbId)}/urls:create`, {
			method: "POST",
			body: JSON.stringify({ urls }),
		});
	}

	async deleteKbUrl(kbId: string, urlId: number): Promise<void> {
		await this.request(`${this.kbBase(kbId)}/urls:delete?url_id=${urlId}`, {
			method: "DELETE",
		});
	}

	async clearKbUrls(kbId: string): Promise<KbClearResponse> {
		return this.request<KbClearResponse>(
			`${this.kbBase(kbId)}/urls:clear_all`,
			{ method: "POST" },
		);
	}

	async refetchKbUrls(
		kbId: string,
		urlIds?: number[],
		force = false,
	): Promise<KbUrlRefetchResponse> {
		return this.request<KbUrlRefetchResponse>(
			`${this.kbBase(kbId)}/urls:refetch`,
			{
				method: "POST",
				body: JSON.stringify({ url_ids: urlIds ?? null, force }),
			},
		);
	}

	async cancelKbUrlTasks(kbId: string): Promise<KbUrlCancelResponse> {
		return this.request<KbUrlCancelResponse>(
			`${this.kbBase(kbId)}/urls:cancel`,
			{ method: "POST" },
		);
	}

	async crawlKbSite(
		kbId: string,
		url: string,
		maxDepth = 2,
		maxPages = 20,
	): Promise<KbSiteCrawlResponse> {
		return this.request<KbSiteCrawlResponse>(
			`${this.kbBase(kbId)}/urls:crawl_site`,
			{
				method: "POST",
				body: JSON.stringify({
					url,
					max_depth: maxDepth,
					max_pages: maxPages,
				}),
			},
		);
	}

	async discoverKbUrls(
		kbId: string,
		url: string,
		maxDepth = 1,
		maxPages = 10,
	): Promise<{ discovered: number; created: number; message: string }> {
		const query = `url=${encodeURIComponent(url)}&max_depth=${maxDepth}&max_pages=${maxPages}`;
		return this.request(`${this.kbBase(kbId)}/urls:discover?${query}`, {
			method: "POST",
		});
	}

	async listKbFiles(
		kbId: string,
		skip = 0,
		limit = 100,
	): Promise<{ files: FileItem[]; total: number; quota: { used: number; max: number } }> {
		return this.request(
			`${this.kbBase(kbId)}/files:list?skip=${skip}&limit=${limit}`,
		);
	}

	async uploadKbFiles(
		kbId: string,
		files: File[],
	): Promise<KbFileUploadResponse> {
		const formData = new FormData();
		for (const file of files) {
			formData.append("files", file);
		}
		const token = localStorage.getItem("token");
		const url = new URL(
			`${this.baseUrl}${this.kbBase(kbId)}/files:upload`,
			window.location.origin,
		);
		url.searchParams.set("locale", this.getLocale());

		const response = await fetch(url.toString(), {
			method: "POST",
			headers: {
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: formData,
		});

		if (!response.ok) {
			throw new Error(await parseErrorResponse(response));
		}

		return response.json();
	}

	async deleteKbFile(kbId: string, fileId: string): Promise<void> {
		await this.request(
			`${this.kbBase(kbId)}/files:delete?file_id=${encodeURIComponent(fileId)}`,
			{ method: "DELETE" },
		);
	}

	async clearKbFiles(kbId: string): Promise<KbClearResponse> {
		return this.request<KbClearResponse>(
			`${this.kbBase(kbId)}/files:clear_all`,
			{ method: "POST" },
		);
	}

	async rebuildKbIndex(
		kbId: string,
		force = false,
	): Promise<KbIndexRebuildResponse> {
		return this.request<KbIndexRebuildResponse>(
			`${this.kbBase(kbId)}/index:rebuild`,
			{ method: "POST", body: JSON.stringify({ force }) },
		);
	}

	async getKbIndexStatus(kbId: string): Promise<KbIndexStatusResponse> {
		return this.request<KbIndexStatusResponse>(
			`${this.kbBase(kbId)}/index:status`,
		);
	}

	async getKbSourcesSummary(kbId: string): Promise<KbSourcesSummaryResponse> {
		return this.request<KbSourcesSummaryResponse>(
			`${this.kbBase(kbId)}/sources:summary`,
		);
	}

	// Models API
	async listModels(params: {
		provider_type: "openai_native" | "google";
		api_key?: string;
		agent_id?: string;
	}): Promise<string[]> {
		const result = await this.request<{ models: string[] }>(
			"/api/v1/models:list",
			{
				method: "POST",
				body: JSON.stringify(params),
			},
		);
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
		urls: {
			total: number;
			indexed: number;
			pending: number;
			total_size_kb: number;
		};
		files: {
			total: number;
			ready: number;
			processing: number;
			total_size_kb: number;
		};
		has_pending: boolean;
	}> {
		return this.request(`/api/v1/sources:summary?agent_id=${agentId}`);
	}

	// API Test Methods
	async testAIApi(
		agentId: string,
		overrides?: Partial<Agent>,
	): Promise<{ success: boolean; message: string }> {
		return this.request(`/api/v1/agent:test-ai-api?agent_id=${agentId}`, {
			method: "POST",
			body: JSON.stringify(overrides ?? {}),
		});
	}

	// Admin API methods
	async getAdminSessions(params?: {
		agent_id?: string;
		visitor_id?: string;
		keyword?: string;
	}): Promise<any[]> {
		let url = "/api/v1/admin/sessions?";
		if (params?.agent_id) {
			url += `agent_id=${params.agent_id}`;
		}
		if (params?.visitor_id) {
			url += `${url.endsWith("?") ? "" : "&"}visitor_id=${params.visitor_id}`;
		} else if (params?.keyword) {
			url += `${url.endsWith("?") ? "" : "&"}keyword=${params.keyword}`;
		}
		return this.request(url);
	}

	async getAdminSessionMessages(sessionId: string): Promise<any[]> {
		return this.request(`/api/v1/admin/sessions/${sessionId}/messages`);
	}

	// ---------------------------------------------------------------- Q&A (#39)

	async listQaItems(
		kbId: string,
		skip = 0,
		limit = 100,
	): Promise<QaItemListResponse> {
		return this.request<QaItemListResponse>(
			`${this.kbBase(kbId)}/qa-items?skip=${skip}&limit=${limit}`,
		);
	}

	async createQaItem(kbId: string, input: QaItemCreateInput): Promise<QaItem> {
		return this.request<QaItem>(`${this.kbBase(kbId)}/qa-items`, {
			method: "POST",
			body: JSON.stringify(input),
		});
	}

	async updateQaItem(
		kbId: string,
		qaId: string,
		input: QaItemUpdateInput,
	): Promise<QaItem> {
		return this.request<QaItem>(
			`${this.kbBase(kbId)}/qa-items/${encodeURIComponent(qaId)}`,
			{ method: "PUT", body: JSON.stringify(input) },
		);
	}

	async deleteQaItem(kbId: string, qaId: string): Promise<void> {
		await this.request(
			`${this.kbBase(kbId)}/qa-items/${encodeURIComponent(qaId)}`,
			{ method: "DELETE" },
		);
	}

	async importQaItems(
		kbId: string,
		items: QaImportPair[],
	): Promise<QaImportResponse> {
		return this.request<QaImportResponse>(
			`${this.kbBase(kbId)}/qa-items:import`,
			{ method: "POST", body: JSON.stringify({ items }) },
		);
	}

	/**
	 * Correct the last assistant answer in a session; the correction becomes a
	 * curated pair on the agent's KB and is effective on the next message.
	 */
	async reviseAnswer(
		sessionId: string,
		answer: string,
	): Promise<ReviseAnswerResponse> {
		return this.request<ReviseAnswerResponse>(
			`/api/v1/admin/sessions/${encodeURIComponent(sessionId)}/revise-answer`,
			{ method: "POST", body: JSON.stringify({ answer }) },
		);
	}

	/** Add an assistant message's turn to the agent's KB as a curated pair. */
	async addQaFromMessage(
		messageId: number,
	): Promise<QaFromMessageResponse> {
		return this.request<QaFromMessageResponse>(
			`/api/v1/admin/qa/from-message/${messageId}`,
			{ method: "POST" },
		);
	}

	// --------------------------------------------------- unanswered (#42)

	/** The triage queue of answers that did not really answer. */
	async getUnanswered(
		query: UnansweredQuery = {},
	): Promise<UnansweredList> {
		const params = new URLSearchParams();
		if (query.since) params.set("since", query.since);
		if (query.agent_id) params.set("agent_id", query.agent_id);
		if (typeof query.skip === "number") params.set("skip", String(query.skip));
		if (typeof query.limit === "number")
			params.set("limit", String(query.limit));
		const suffix = params.toString();
		return this.request<UnansweredList>(
			`/api/v1/admin/sessions/unanswered${suffix ? `?${suffix}` : ""}`,
		);
	}

	// ------------------------------------------------------- analytics (#45)

	/**
	 * The dashboard's whole payload: tiles with deltas *and* the comparison
	 * window in words, the outcome split and the top unanswered questions.
	 *
	 * One request rather than five so the tiles, the funnel and the export link
	 * can never disagree about which window they describe.
	 */
	async getAnalyticsOverview(
		query: AnalyticsQuery = {},
	): Promise<AnalyticsOverview> {
		const params = new URLSearchParams();
		if (query.range) params.set("range", query.range);
		if (query.agent_id) params.set("agent_id", query.agent_id);
		const suffix = params.toString();
		return this.request<AnalyticsOverview>(
			`/api/v1/admin/stats/overview${suffix ? `?${suffix}` : ""}`,
		);
	}

	/**
	 * The CSV for the *same* filters the dashboard is showing.
	 *
	 * Returns the bytes rather than triggering the download here, so the caller
	 * owns the object URL and can revoke it — a leaked blob URL per click is a
	 * slow memory leak in a long-lived admin session.
	 */
	async exportStatsCsv(
		query: AnalyticsQuery = {},
	): Promise<{ blob: Blob; filename: string }> {
		const params = new URLSearchParams();
		if (query.range) params.set("range", query.range);
		if (query.agent_id) params.set("agent_id", query.agent_id);
		// The locale decides the window label the server stamps on the file, so
		// the exported header matches the console's language.
		params.set("locale", this.getLocale());
		const url = new URL(
			`${this.baseUrl}/api/v1/admin/stats/export.csv?${params.toString()}`,
			window.location.origin,
		);
		const token = localStorage.getItem("token");
		const response = await fetch(url.toString(), {
			headers: token ? { Authorization: `Bearer ${token}` } : {},
		});
		if (!response.ok) {
			throw new Error(await parseErrorResponse(response));
		}
		const disposition = response.headers.get("content-disposition") ?? "";
		const match = /filename="?([^";]+)"?/.exec(disposition);
		return {
			blob: await response.blob(),
			filename: match?.[1] ?? "basjoo-stats.csv",
		};
	}

	/**
	 * Take a triaged row out of the queue. The message stays in the transcript;
	 * only `is_unanswered` is cleared.
	 */
	async dismissUnanswered(messageId: number): Promise<{ dismissed: boolean }> {
		return this.request<{ dismissed: boolean }>(
			`/api/v1/admin/sessions/unanswered/${messageId}:dismiss`,
			{ method: "POST" },
		);
	}

	// ---------------------------------------------------------- procedures (#39)

	async listProcedures(agentId: string): Promise<ProcedureListResponse> {
		return this.request<ProcedureListResponse>(
			`/api/v1/agents/${encodeURIComponent(agentId)}/procedures`,
		);
	}

	async createProcedure(
		agentId: string,
		input: ProcedureCreateInput,
	): Promise<Procedure> {
		return this.request<Procedure>(
			`/api/v1/agents/${encodeURIComponent(agentId)}/procedures`,
			{ method: "POST", body: JSON.stringify(input) },
		);
	}

	async updateProcedure(
		agentId: string,
		procedureId: string,
		input: ProcedureUpdateInput,
	): Promise<Procedure> {
		return this.request<Procedure>(
			`/api/v1/agents/${encodeURIComponent(agentId)}/procedures/${encodeURIComponent(procedureId)}`,
			{ method: "PUT", body: JSON.stringify(input) },
		);
	}

	async deleteProcedure(
		agentId: string,
		procedureId: string,
	): Promise<DeleteResult> {
		return this.request<DeleteResult>(
			`/api/v1/agents/${encodeURIComponent(agentId)}/procedures/${encodeURIComponent(procedureId)}`,
			{ method: "DELETE" },
		);
	}

	async updateFixedFacts(
		agentId: string,
		fixedFacts: string | null,
	): Promise<FixedFactsResponse> {
		return this.request<FixedFactsResponse>(
			`/api/v1/agents/${encodeURIComponent(agentId)}/fixed-facts`,
			{ method: "PUT", body: JSON.stringify({ fixed_facts: fixedFacts }) },
		);
	}
}

export const api = new APIService();
