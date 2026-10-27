// @vitest-environment jsdom
/**
 * Spec §16 — the KB list rebuilt on the shared `list`/`list-row` primitives,
 * and §18 — no manual refresh control anywhere in the KB surfaces.
 *
 * This file is deliberately independent of `KnowledgeBases.test.tsx`: it pins
 * the *new* contract (row content, name link, no expand panel, no unbind, no
 * refresh, `?bindAgent=` entry point) so a regression here cannot be masked by
 * an assertion elsewhere being loosened.
 */
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

/** Keys are returned verbatim so assertions target i18n keys directly. */
function stableT(key: string, params?: Record<string, unknown>) {
	return params ? `${key}|${JSON.stringify(params)}` : key;
}

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: stableT }),
}));

// The source panels have their own suite; here only the composition and the
// absence of a refresh control are asserted.
vi.mock("../../src/views/URLManagement", () => ({
	default: () => <div data-testid="stub-url-panel">urls</div>,
}));

vi.mock("../../src/views/FileUploadManagement", () => ({
	default: () => <div data-testid="stub-file-panel">files</div>,
}));

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
	document_count: 4,
	ready_document_count: 1,
	total_chunks: 7,
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

function LocationProbe() {
	const location = useLocation();
	return (
		<div data-testid="location">{`${location.pathname}${location.search}`}</div>
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

describe("KnowledgeBases list (§16 row contract)", () => {
	it("renders no inline detail panel and no details trigger", async () => {
		renderView();

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);
		expect(screen.queryByTestId("kb-detail-panel")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", {
				name: "knowledgeBases.actions.details",
			}),
		).not.toBeInTheDocument();
		// The expand panel was the last consumer of the old `selected` state, so
		// no row may become a clickable detail selector either.
		expect(
			screen.queryByRole("button", {
				name: "knowledgeBases.actions.sources",
			}),
		).not.toBeInTheDocument();
	});

	it("renders the #27 unbind icon only on a bound row, and unbinds on confirm", async () => {
		mockedApi.bindAgentKnowledgeBase.mockResolvedValue({
			agent: agents[0],
			knowledge_base: unboundKb,
		});
		renderView();

		const boundRow = await screen.findByTestId("kb-row-kb_bound");
		const freeRow = screen.getByTestId("kb-row-kb_free");

		const icon = within(boundRow).getByTestId("kb-unbind-agent-kb_bound");
		expect(icon.tagName).toBe("BUTTON");
		expect(icon).toHaveClass("btn-icon");
		expect(icon).toHaveAttribute(
			"aria-label",
			'knowledgeBases.actions.unbindAgent|{"name":"Support Bot"}',
		);
		expect(icon).toHaveAttribute(
			"title",
			'knowledgeBases.actions.unbindAgent|{"name":"Support Bot"}',
		);
		expect(icon.querySelector("svg")).not.toBeNull();
		// Nothing to unbind on an unbound KB.
		expect(
			within(freeRow).queryByTestId("kb-unbind-agent-kb_free"),
		).toBeNull();

		await userEvent.click(icon);

		expect(window.confirm).toHaveBeenCalledWith(
			'knowledgeBases.actions.unbindAgentConfirm|{"name":"Support Bot"}',
		);
		await waitFor(() =>
			expect(mockedApi.bindAgentKnowledgeBase).toHaveBeenCalledWith(
				"agt_1",
				null,
			),
		);
		expect(mockedApi.bindAgentKnowledgeBase).toHaveBeenCalledTimes(1);
		// The icon sits inside the row, which navigates: clicking it must not
		// follow the row.
		expect(screen.getByTestId("location")).toHaveTextContent(
			/^\/knowledge-bases$/,
		);
	});

	it("unbinds nothing when the confirm is dismissed", async () => {
		vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
		renderView();

		const boundRow = await screen.findByTestId("kb-row-kb_bound");
		await userEvent.click(
			within(boundRow).getByTestId("kb-unbind-agent-kb_bound"),
		);

		expect(window.confirm).toHaveBeenCalled();
		expect(mockedApi.bindAgentKnowledgeBase).not.toHaveBeenCalled();
	});

	it("hides the unbind icon for a non super_admin", async () => {
		authState.role = "admin";
		renderView();

		const boundRow = await screen.findByTestId("kb-row-kb_bound");
		expect(
			within(boundRow).queryByTestId("kb-unbind-agent-kb_bound"),
		).toBeNull();
		// The list's row menu is super-admin only too.
		expect(screen.queryByTestId("kb-actions-kb_bound")).toBeNull();
	});

	it("renders no manual refresh button (spec §18)", async () => {
		renderView();

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);
		expect(
			screen.queryByRole("button", { name: "buttons.refresh" }),
		).not.toBeInTheDocument();
	});

	it("links the KB name to /knowledge-bases/:kbId", async () => {
		renderView();

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);
		expect(screen.getByRole("link", { name: "Bound KB" })).toHaveAttribute(
			"href",
			"/knowledge-bases/kb_bound",
		);
		expect(screen.getByRole("link", { name: "Unbound KB" })).toHaveAttribute(
			"href",
			"/knowledge-bases/kb_free",
		);
	});

	it("shows embedding, documents progress, chunks, status and bound agent per row", async () => {
		renderView();

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);

		const boundRow = screen.getByTestId("kb-row-kb_bound");
		expect(within(boundRow).getByText(/kbForm\.providerJina/)).toBeInTheDocument();
		expect(
			within(boundRow).getByText(/jina-embeddings-v3/),
		).toBeInTheDocument();
		expect(within(boundRow).getByText("2/3")).toBeInTheDocument();
		expect(within(boundRow).getByText("11")).toBeInTheDocument();
		expect(
			within(boundRow).getByText("knowledgeBases.status.active"),
		).toBeInTheDocument();
		expect(within(boundRow).getByText("Support Bot")).toBeInTheDocument();

		const freeRow = screen.getByTestId("kb-row-kb_free");
		expect(
			within(freeRow).getByText(/kbForm\.providerSiliconflow/),
		).toBeInTheDocument();
		expect(within(freeRow).getByText(/BAAI\/bge-m3/)).toBeInTheDocument();
		expect(within(freeRow).getByText("1/4")).toBeInTheDocument();
		expect(within(freeRow).getByText("7")).toBeInTheDocument();
		expect(
			within(freeRow).getByText("knowledgeBases.status.active"),
		).toBeInTheDocument();
		expect(
			within(freeRow).getByText("knowledgeBases.unboundValue"),
		).toBeInTheDocument();
	});

	it("uses the shared list primitives: <ul class=list> of <li class=list-row>", async () => {
		renderView();

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);
		const list = screen.getByTestId("kb-list");
		expect(list.tagName).toBe("UL");
		expect(list).toHaveClass("list");

		const rows = within(list).getAllByRole("listitem");
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			expect(row.tagName).toBe("LI");
			expect(row).toHaveClass("list-row");
			expect(row.querySelector(".list-row-main")).not.toBeNull();
		}
	});
	it("puts creation behind a labelled `+` in page-actions, not a labelled page button", async () => {
		renderView();

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);

		// Same create affordance as the agents list: an icon button in
		// `page-actions` whose accessible name is the create action.
		const trigger = screen.getByTestId("kb-create-open");
		expect(trigger.tagName).toBe("BUTTON");
		expect(trigger).toHaveClass("btn-icon");
		expect(trigger).toHaveAttribute(
			"aria-label",
			"knowledgeBases.newKnowledgeBase",
		);
		expect(trigger.closest(".page-actions")).not.toBeNull();
		expect(trigger.querySelector("svg")).not.toBeNull();
		// Nothing inline: no name field until the sheet opens.
		expect(document.querySelector("input")).toBeNull();

		await userEvent.click(trigger);
		expect(await screen.findByRole("dialog")).toBeInTheDocument();
	});
});

describe("KnowledgeBases ?bindAgent= entry point (§16 keeps the bind flow)", () => {
	it("opens the bind sheet with exactly the bindable KBs and binds the agent", async () => {
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
});

describe("KnowledgeBaseDetail (§18 refresh removal)", () => {
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

	beforeEach(() => {
		vi.clearAllMocks();
		mockedApi.getKnowledgeBase.mockResolvedValue(detailKb);
		mockedApi.getKbSourcesSummary.mockResolvedValue({
			urls: { total: 2, indexed: 2, pending: 0, total_size_kb: 10 },
			files: { total: 1, ready: 1, processing: 0, total_size_kb: 5 },
			has_pending: false,
		});
	});

	it("has no refresh button while still mounting both source panels", async () => {
		render(
			<MemoryRouter initialEntries={["/knowledge-bases/kb_solo"]}>
				<Routes>
					<Route
						path="/knowledge-bases/:kbId"
						element={<KnowledgeBaseDetailView />}
					/>
				</Routes>
			</MemoryRouter>,
		);

		expect(await screen.findByTestId("kb-detail-title")).toHaveTextContent(
			"Solo KB",
		);
		expect(screen.queryByRole("button", { name: "buttons.refresh" })).toBeNull();
		expect(screen.getByTestId("stub-url-panel")).toBeInTheDocument();
		expect(screen.getByTestId("stub-file-panel")).toBeInTheDocument();
	});
});
