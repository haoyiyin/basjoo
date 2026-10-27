// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import KnowledgeBases from "../../src/views/KnowledgeBases";
import KnowledgeBaseDetailView from "../../src/views/KnowledgeBaseDetail";
import { api } from "../../src/services/api";
import type { Agent, KnowledgeBaseDetail } from "../../src/services/api";

const authState: { role: string } = { role: "super_admin" };

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		admin: {
			id: 1,
			name: "Owner",
			email: "owner@example.com",
			role: authState.role,
		},
		logout: vi.fn(),
	}),
}));

vi.mock("../../src/services/api", () => ({
	api: {
		listKnowledgeBases: vi.fn(),
		listAgents: vi.fn(),
		createKnowledgeBase: vi.fn(),
		resetKnowledgeBase: vi.fn(),
		deleteKnowledgeBase: vi.fn(),
		bindAgentKnowledgeBase: vi.fn(),
		testEmbeddingConfig: vi.fn(),
		getKnowledgeBase: vi.fn(),
		getKbSourcesSummary: vi.fn(),
	},
}));

vi.mock("../../src/hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
}));

// Keys are returned verbatim so assertions can target i18n keys directly.
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: stableT }),
}));

// Both panels own their own test file; here they are stubs so that the detail
// page's *composition* can be asserted without duplicating their internals.
vi.mock("../../src/views/URLManagement", () => ({
	default: () => <div data-testid="stub-url-panel">urls</div>,
}));

vi.mock("../../src/views/FileUploadManagement", () => ({
	default: () => <div data-testid="stub-file-panel">files</div>,
}));

// The layout is exercised by its own test; here it only needs to render children.
vi.mock("../../src/components/AdminLayout", () => ({
	default: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="admin-layout">{children}</div>
	),
}));

const mockedApi = vi.mocked(api);

const boundKb: KnowledgeBaseDetail = {
	id: "kb_bound",
	name: "Bound KB",
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
	document_count: 3,
	ready_document_count: 2,
	total_chunks: 11,
	bound_agent: { id: "agt_1", name: "Support Bot" },
};

const unboundKb: KnowledgeBaseDetail = {
	id: "kb_free",
	name: "Unbound KB",
	embedding_provider: "siliconflow",
	embedding_model: "BAAI/bge-m3",
	embedding_base_url: null,
	embedding_batch_size: 4,
	embedding_dimension: 1024,
	chunk_size: 512,
	chunk_overlap: 64,
	status: "active",
	is_locked: false,
	error_message: null,
	document_count: 0,
	ready_document_count: 0,
	total_chunks: 0,
	bound_agent: null,
};

const agents: Agent[] = [
	{
		id: "agt_1",
		name: "Support Bot",
		system_prompt: "prompt",
		model: "gpt-4o-mini",
		temperature: 0.7,
		max_tokens: 1024,
		top_k: 5,
		similarity_threshold: 0.01,
		enable_context: true,
		is_active: true,
		created_at: "2026-01-01T00:00:00Z",
	},
];

function mockList(kbs: KnowledgeBaseDetail[]) {
	mockedApi.listKnowledgeBases.mockResolvedValue({
		knowledge_bases: kbs,
		total: kbs.length,
	});
}

/** `t` must be stable: some views use it in effect dependencies. */
function stableT(key: string, params?: Record<string, unknown>) {
	return params ? `${key}|${JSON.stringify(params)}` : key;
}

/** The view now renders `Link`s and reads `?bindAgent=`, so it needs a router. */
function LocationProbe() {
	const location = useLocation();
	return (
		<div data-testid="location">{`${location.pathname}${location.search}`}</div>
	);
}

/** Row mutations live in the per-row overflow menu (§16 mirrors /agents). */
async function openRowMenu(row: HTMLElement) {
	await userEvent.click(
		within(row).getByRole("button", {
			name: /^knowledgeBases\.rowActions\|/,
		}),
	);
}

function renderView(initialEntry = "/knowledge-bases") {
	return render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<Routes>
				<Route path="/knowledge-bases" element={<KnowledgeBases />} />
				<Route
					path="/knowledge-bases/:kbId"
					element={<div>route:KnowledgeBaseDetail</div>}
				/>
			</Routes>
			<LocationProbe />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	authState.role = "super_admin";
	mockedApi.listAgents.mockResolvedValue({ agents, total: agents.length });
	mockList([boundKb, unboundKb]);
	vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
});

describe("KnowledgeBases view", () => {
	it("renders one row per knowledge base with counts and status", async () => {
		renderView();

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);

	const boundRow = screen.getByTestId("kb-row-kb_bound");
		expect(within(boundRow).getByText("Bound KB")).toBeInTheDocument();
		expect(within(boundRow).getByText("2/3")).toBeInTheDocument();
		expect(within(boundRow).getByText("11")).toBeInTheDocument();
		expect(
			within(boundRow).getByText("knowledgeBases.status.active"),
		).toBeInTheDocument();
		// §16: the embedding provider and model are now row content, not a cell.
		expect(
			within(boundRow).getByText(/kbForm\.providerJina/),
		).toBeInTheDocument();
		expect(
			within(boundRow).getByText(/jina-embeddings-v3/),
		).toBeInTheDocument();

		const freeRow = screen.getByTestId("kb-row-kb_free");
		expect(within(freeRow).getByText("Unbound KB")).toBeInTheDocument();
		expect(
			within(freeRow).getByText("knowledgeBases.unboundValue"),
		).toBeInTheDocument();
	});

	it("shows the bound agent name and no Unbind action for a bound KB", async () => {
		renderView();

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);
		const boundRow = screen.getByTestId("kb-row-kb_bound");
		expect(within(boundRow).getByText("Support Bot")).toBeInTheDocument();
		// §16: unbinding happens from the agent side only, so the KB list never
		// offers an Unbind control (in either direction).
		expect(
			within(boundRow).queryByRole("button", {
				name: "knowledgeBases.actions.unbind",
			}),
		).not.toBeInTheDocument();
		expect(
			within(boundRow).queryByRole("button", {
				name: "knowledgeBases.actions.bind",
			}),
		).not.toBeInTheDocument();
	});

	it("shows a Bind action for an unbound KB and binds it to the chosen agent", async () => {
		mockedApi.bindAgentKnowledgeBase.mockResolvedValue({
			agent: agents[0],
			knowledge_base: unboundKb,
		});
		renderView();

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_free")).toBeInTheDocument(),
		);
		const freeRow = screen.getByTestId("kb-row-kb_free");
		await openRowMenu(freeRow);
		await userEvent.click(
			within(freeRow).getByRole("menuitem", {
				name: "knowledgeBases.actions.bind",
			}),
		);

		const modal = await screen.findByTestId("kb-bind-modal");
		await waitFor(() => expect(mockedApi.listAgents).toHaveBeenCalled());
		await userEvent.selectOptions(
			within(modal).getByLabelText("knowledgeBases.bindAgentLabel"),
			"agt_1",
		);
		await userEvent.click(
			within(modal).getByRole("button", {
				name: "knowledgeBases.bindSubmit",
			}),
		);

		await waitFor(() =>
			expect(mockedApi.bindAgentKnowledgeBase).toHaveBeenCalledWith(
				"agt_1",
				"kb_free",
			),
		);
	});

	it("offers no unbind control anywhere in the KB list", async () => {
		renderView();

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);
		// §16: the per-row Unbind action is gone; unbinding lives on the agent
		// side. Nothing may call the bind API to unbind from this page.
		expect(
			screen.queryByRole("button", {
				name: "knowledgeBases.actions.unbind",
			}),
		).not.toBeInTheDocument();
		const boundRow = screen.getByTestId("kb-row-kb_bound");
		await openRowMenu(boundRow);
		expect(
			within(boundRow).queryByRole("menuitem", {
				name: "knowledgeBases.actions.unbind",
			}),
		).not.toBeInTheDocument();
		expect(mockedApi.bindAgentKnowledgeBase).not.toHaveBeenCalled();
	});

	it("hides every mutating action for a non super_admin", async () => {
		authState.role = "admin";
		renderView();

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);

		expect(
			screen.queryByRole("button", {
				name: "knowledgeBases.newKnowledgeBase",
			}),
		).not.toBeInTheDocument();
		for (const action of ["bind", "unbind", "reset", "delete"]) {
			expect(
				screen.queryByRole("button", {
					name: `knowledgeBases.actions.${action}`,
				}),
			).not.toBeInTheDocument();
		}
		// Read-only affordances stay available: the KB name is now the link that
		// opens /knowledge-bases/:kbId (§16 replaced the `details` button).
		expect(
			screen.getByRole("link", { name: "Bound KB" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "Unbound KB" }),
		).toBeInTheDocument();
	});

	it("surfaces the backend 409 message when deleting a bound KB", async () => {
		mockedApi.deleteKnowledgeBase.mockRejectedValue(
			new Error("KB is bound to an agent. Unbind it first."),
		);
		renderView();

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);
		const boundRow = screen.getByTestId("kb-row-kb_bound");
		await openRowMenu(boundRow);
		await userEvent.click(
			within(boundRow).getByRole("menuitem", {
				name: "knowledgeBases.actions.delete",
			}),
		);

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"KB is bound to an agent. Unbind it first.",
		);
	});

	it("renders the empty state when the workspace has no knowledge bases", async () => {
		mockList([]);
		renderView();

		expect(
			await screen.findByText("knowledgeBases.empty"),
		).toBeInTheDocument();
		expect(screen.queryByRole("table")).not.toBeInTheDocument();
	});

	it("renders an error state with a retry that refetches", async () => {
		mockedApi.listKnowledgeBases.mockRejectedValueOnce(new Error("boom"));
		renderView();

		expect(await screen.findByText("boom")).toBeInTheDocument();
		await userEvent.click(
			screen.getByRole("button", { name: "knowledgeBases.retry" }),
		);
		expect(
			await screen.findByTestId("kb-row-kb_bound"),
		).toBeInTheDocument();
	});

	it("opens the create modal and posts the form values", async () => {
		mockedApi.createKnowledgeBase.mockResolvedValue(unboundKb);
		renderView();

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);
		await userEvent.click(
			screen.getByRole("button", {
				name: "knowledgeBases.newKnowledgeBase",
			}),
		);

		const modal = await screen.findByTestId("kb-form-modal");
		await userEvent.type(
			within(modal).getByLabelText("kbForm.name"),
			"Fresh KB",
		);
		await userEvent.type(
			within(modal).getByLabelText("kbForm.apiKey"),
			"test-jina-key",
		);
		await userEvent.click(
			within(modal).getByRole("button", { name: "kbForm.createSubmit" }),
		);

		await waitFor(() =>
			expect(mockedApi.createKnowledgeBase).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "Fresh KB",
					embedding_provider: "jina",
					embedding_model: "jina-embeddings-v3",
					embedding_api_key: "test-jina-key",
				}),
			),
		);
	});

	it("renders no inline detail panel for any row", async () => {
		renderView();

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_free")).toBeInTheDocument(),
		);
		// §16: the expandable detail panel and its `details` trigger are gone.
		expect(screen.queryByTestId("kb-detail-panel")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", {
				name: "knowledgeBases.actions.details",
			}),
		).not.toBeInTheDocument();
	});

	it("navigates to /knowledge-bases/:kbId from the row's name link", async () => {
		renderView();

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_free")).toBeInTheDocument(),
		);
		// §16: the name is the only navigation affordance; the separate
		// 管理来源 (manage sources) action no longer exists.
		expect(
			screen.queryByRole("link", {
				name: "knowledgeBases.actions.sources",
			}),
		).not.toBeInTheDocument();
		await userEvent.click(
			within(screen.getByTestId("kb-row-kb_free")).getByRole("link", {
				name: "Unbound KB",
			}),
		);

		await waitFor(() =>
			expect(screen.getByTestId("location")).toHaveTextContent(
				"/knowledge-bases/kb_free",
			),
		);
		expect(screen.getByText("route:KnowledgeBaseDetail")).toBeInTheDocument();
	});

	it("opens the bind modal for the agent named in ?bindAgent=", async () => {
		mockedApi.bindAgentKnowledgeBase.mockResolvedValue({
			agent: agents[0],
			knowledge_base: unboundKb,
		});
		renderView("/knowledge-bases?bindAgent=agt_1");

		const modal = await screen.findByTestId("kb-bind-agent-modal");
		await waitFor(() =>
			expect(
				within(modal).getByLabelText("knowledgeBases.bindKbLabel"),
			).toBeInTheDocument(),
		);

		// Only KBs that can actually be bound are offered (kb_bound is taken).
		const options = within(modal).getAllByRole("option");
		expect(options.map((option) => option.textContent)).toEqual([
			"knowledgeBases.bindKbPlaceholder",
			"Unbound KB",
		]);

		await userEvent.selectOptions(
			within(modal).getByLabelText("knowledgeBases.bindKbLabel"),
			"kb_free",
		);
		await userEvent.click(
			within(modal).getByRole("button", {
				name: "knowledgeBases.bindSubmit",
			}),
		);

		await waitFor(() =>
			expect(mockedApi.bindAgentKnowledgeBase).toHaveBeenCalledWith(
				"agt_1",
				"kb_free",
			),
		);
	});

	it("does not open the agent bind modal without ?bindAgent=", async () => {
		renderView();

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);
		expect(
			screen.queryByTestId("kb-bind-agent-modal"),
		).not.toBeInTheDocument();
	});
});

// --- /knowledge-bases/:kbId composition --------------------------------------
// The KB detail page is the single place an operator manages a KB's sources:
// it must mount BOTH the URL panel and the file panel, driven by the route
// parameter, and it must work for an unbound KB (no agent anywhere).

const detailKb: KnowledgeBaseDetail = {
	id: "kb_solo",
	name: "Solo KB",
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
	document_count: 1,
	ready_document_count: 1,
	total_chunks: 9,
	bound_agent: null,
	created_at: "2026-01-01T00:00:00Z",
};

function renderDetail(kbId = "kb_solo") {
	return render(
		<MemoryRouter initialEntries={[`/knowledge-bases/${kbId}`]}>
			<Routes>
				<Route
					path="/knowledge-bases/:kbId"
					element={<KnowledgeBaseDetailView />}
				/>
			</Routes>
		</MemoryRouter>,
	);
}

describe("KnowledgeBaseDetail route composition", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedApi.getKnowledgeBase.mockResolvedValue(detailKb);
		mockedApi.getKbSourcesSummary.mockResolvedValue({
			urls: { total: 2, indexed: 2, pending: 0, total_size_kb: 10 },
			files: { total: 1, ready: 1, processing: 0, total_size_kb: 5 },
			has_pending: false,
		});
	});

	it("loads the KB named by the route parameter, not an agent", async () => {
		renderDetail("kb_solo");

		await waitFor(() => {
			expect(mockedApi.getKnowledgeBase).toHaveBeenCalledWith("kb_solo");
		});
		expect(mockedApi.getKbSourcesSummary).toHaveBeenCalledWith("kb_solo");
	});

	it("mounts both the URL panel and the file panel", async () => {
		renderDetail();

		expect(await screen.findByTestId("stub-url-panel")).toBeInTheDocument();
		expect(await screen.findByTestId("stub-file-panel")).toBeInTheDocument();
	});

	it("renders the KB name and its summary counters", async () => {
		renderDetail();

		expect(await screen.findByTestId("kb-detail-title")).toHaveTextContent(
			"Solo KB",
		);
		expect(await screen.findByTestId("kb-detail-summary")).toBeInTheDocument();
	});

	it("supports an unbound KB: the page never requires a bound agent", async () => {
		renderDetail();

		await screen.findByTestId("kb-detail-title");
		expect(mockedApi.getKnowledgeBase).toHaveBeenCalledWith("kb_solo");
		// No agent-scoped source helper may be used from the KB page.
		expect(mockedApi.listAgents).not.toHaveBeenCalled();
	});
});
