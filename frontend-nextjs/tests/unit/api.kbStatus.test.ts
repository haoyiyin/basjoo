// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "../../src/services/api";
import type { KbStatusPayload, KnowledgeBaseDetail } from "../../src/services/api";

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function stubFetch(payload: unknown, status = 200) {
	return vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValueOnce(jsonResponse(payload, status));
}

/** The request helper relies on the token + locale stored in localStorage. */
function stubStorage(entries: Record<string, string> = {}) {
	vi.stubGlobal("localStorage", {
		getItem: vi.fn((key: string) => entries[key] ?? null),
		setItem: vi.fn(),
		removeItem: vi.fn(),
		clear: vi.fn(),
	});
}

const kbFixture: KnowledgeBaseDetail = {
	id: "kb_1",
	name: "Product docs",
	workspace_id: 1,
	embedding_provider: "jina",
	embedding_model: "jina-embeddings-v3",
	embedding_base_url: null,
	embedding_batch_size: 4,
	embedding_dimension: 1024,
	chunk_size: 512,
	chunk_overlap: 64,
	status: "active",
	is_locked: false,
	error_message: null,
	document_count: 2,
	ready_document_count: 2,
	total_chunks: 7,
	bound_agent: { id: "agt_1", name: "Support Bot" },
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("api.kbStatus", () => {
	it("returns the derived kb status payload", async () => {
		const payload: KbStatusPayload = {
			agent_id: "agt_test",
			kb_id: "kb_1",
			kb_setup_completed: true,
			kb: {
				id: "kb_1",
				name: "Product docs",
				embedding_provider: "jina",
				embedding_model: "jina-embeddings-v3",
				status: "active",
			},
		};
		stubStorage({ basjoo_locale: "en" });
		const spy = stubFetch(payload);

		const result = await api.kbStatus("agt_test");

		expect(result).toEqual(payload);
		expect(result.kb_id).toBe("kb_1");
		expect(result.kb?.embedding_provider).toBe("jina");
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("/api/v1/agent:kb-status?agent_id=agt_test"),
			expect.objectContaining({ headers: expect.any(Object) }),
		);
	});

	it("reports an unbound agent with a null kb", async () => {
		const payload: KbStatusPayload = {
			agent_id: "agt_test",
			kb_id: null,
			kb_setup_completed: false,
			kb: null,
		};
		stubStorage({ basjoo_locale: "en" });
		stubFetch(payload);

		const result = await api.kbStatus("agt_test");

		expect(result.kb_setup_completed).toBe(false);
		expect(result.kb).toBeNull();
	});
});

describe("api knowledge-base methods", () => {
	it("listKnowledgeBases hits GET /api/v1/knowledge-bases", async () => {
		stubStorage({ basjoo_locale: "en" });
		const spy = stubFetch({ knowledge_bases: [kbFixture], total: 1 });

		const result = await api.listKnowledgeBases();

		expect(result.total).toBe(1);
		expect(result.knowledge_bases[0].bound_agent).toEqual({
			id: "agt_1",
			name: "Support Bot",
		});
		const [calledUrl, init] = spy.mock.calls[0];
		expect(String(calledUrl)).toContain("/api/v1/knowledge-bases");
		expect((init as RequestInit).method).toBeUndefined();
	});

	it("bindAgentKnowledgeBase(id, null) PUTs {kb_id: null} to /api/v1/agents/{id}/knowledge-base", async () => {
		stubStorage({ basjoo_locale: "en" });
		const spy = stubFetch({
			agent: { id: "agt_1", name: "Support Bot" },
			knowledge_base: null,
		});

		const result = await api.bindAgentKnowledgeBase("agt_1", null);

		expect(result.knowledge_base).toBeNull();
		const [calledUrl, init] = spy.mock.calls[0];
		expect(String(calledUrl)).toContain(
			"/api/v1/agents/agt_1/knowledge-base",
		);
		expect((init as RequestInit).method).toBe("PUT");
		expect(JSON.parse(String((init as RequestInit).body))).toEqual({
			kb_id: null,
		});
	});

	it("resetKnowledgeBase POSTs the new embedding config to /reset", async () => {
		stubStorage({ basjoo_locale: "en" });
		const spy = stubFetch({
			status: "active",
			kb_id: "kb_1",
			requeued_documents: 2,
			doc_ids: ["doc_1", "doc_2"],
		});

		const result = await api.resetKnowledgeBase("kb_1", {
			embedding_provider: "jina",
			embedding_model: "jina-embeddings-v2-base-en",
			embedding_api_key: "test-jina-key",
		});

		expect(result.requeued_documents).toBe(2);
		const [calledUrl, init] = spy.mock.calls[0];
		expect(String(calledUrl)).toContain("/api/v1/knowledge-bases/kb_1/reset");
		expect((init as RequestInit).method).toBe("POST");
		expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
			embedding_model: "jina-embeddings-v2-base-en",
		});
	});
});
