// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import KnowledgeBases from "../../src/views/KnowledgeBases";
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
	},
}));

vi.mock("../../src/hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
}));

// Keys are returned verbatim so assertions can target i18n keys directly.
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, unknown>) =>
			params ? `${key}|${JSON.stringify(params)}` : key,
	}),
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

beforeEach(() => {
	vi.clearAllMocks();
	authState.role = "super_admin";
	mockedApi.listAgents.mockResolvedValue({ agents, total: agents.length });
	mockList([boundKb, unboundKb]);
	vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
});

describe("KnowledgeBases view", () => {
	it("renders one row per knowledge base with counts and status", async () => {
		render(<KnowledgeBases />);

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

		const freeRow = screen.getByTestId("kb-row-kb_free");
		expect(within(freeRow).getByText("Unbound KB")).toBeInTheDocument();
		expect(
			within(freeRow).getByText("knowledgeBases.unboundValue"),
		).toBeInTheDocument();
	});

	it("shows the bound agent name and an Unbind action for a bound KB", async () => {
		render(<KnowledgeBases />);

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);
		const boundRow = screen.getByTestId("kb-row-kb_bound");
		expect(within(boundRow).getByText("Support Bot")).toBeInTheDocument();
		expect(
			within(boundRow).getByRole("button", {
				name: "knowledgeBases.actions.unbind",
			}),
		).toBeInTheDocument();
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
		render(<KnowledgeBases />);

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_free")).toBeInTheDocument(),
		);
		const freeRow = screen.getByTestId("kb-row-kb_free");
		await userEvent.click(
			within(freeRow).getByRole("button", {
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

	it("unbinds a bound KB after confirmation", async () => {
		mockedApi.bindAgentKnowledgeBase.mockResolvedValue({
			agent: agents[0],
			knowledge_base: null,
		});
		render(<KnowledgeBases />);

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);
		await userEvent.click(
			within(screen.getByTestId("kb-row-kb_bound")).getByRole("button", {
				name: "knowledgeBases.actions.unbind",
			}),
		);

		await waitFor(() =>
			expect(mockedApi.bindAgentKnowledgeBase).toHaveBeenCalledWith(
				"agt_1",
				null,
			),
		);
		expect(window.confirm).toHaveBeenCalled();
	});

	it("hides every mutating action for a non super_admin", async () => {
		authState.role = "admin";
		render(<KnowledgeBases />);

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
		// Read-only affordances stay available.
		expect(
			screen.getAllByRole("button", {
				name: "knowledgeBases.actions.details",
			}).length,
		).toBeGreaterThan(0);
	});

	it("surfaces the backend 409 message when deleting a bound KB", async () => {
		mockedApi.deleteKnowledgeBase.mockRejectedValue(
			new Error("KB is bound to an agent. Unbind it first."),
		);
		render(<KnowledgeBases />);

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);
		await userEvent.click(
			within(screen.getByTestId("kb-row-kb_bound")).getByRole("button", {
				name: "knowledgeBases.actions.delete",
			}),
		);

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"KB is bound to an agent. Unbind it first.",
		);
	});

	it("renders the empty state when the workspace has no knowledge bases", async () => {
		mockList([]);
		render(<KnowledgeBases />);

		expect(
			await screen.findByText("knowledgeBases.empty"),
		).toBeInTheDocument();
		expect(screen.queryByRole("table")).not.toBeInTheDocument();
	});

	it("renders an error state with a retry that refetches", async () => {
		mockedApi.listKnowledgeBases.mockRejectedValueOnce(new Error("boom"));
		render(<KnowledgeBases />);

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
		render(<KnowledgeBases />);

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

	it("opens the detail panel for the selected row", async () => {
		render(<KnowledgeBases />);

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_free")).toBeInTheDocument(),
		);
		await userEvent.click(
			within(screen.getByTestId("kb-row-kb_free")).getByRole("button", {
				name: "knowledgeBases.actions.details",
			}),
		);

		const panel = await screen.findByTestId("kb-detail-panel");
		expect(within(panel).getByText("Unbound KB")).toBeInTheDocument();
		expect(
			within(panel).getByText("BAAI/bge-m3"),
		).toBeInTheDocument();
	});
});
