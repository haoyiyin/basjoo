// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import Agents from "../../src/views/Agents";
import KnowledgeBaseSetup from "../../src/views/KnowledgeBaseSetup";
import KBSetupGuard from "../../src/components/KBSetupGuard";
import { api } from "../../src/services/api";
import type { Agent, KnowledgeBaseDetail } from "../../src/services/api";

const authState: { role: string } = { role: "super_admin" };

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		admin: {
			id: 1,
			name: "Test Admin",
			email: "test@example.com",
			role: authState.role,
		},
		token: "test-token",
		logout: vi.fn(),
	}),
}));

vi.mock("../../src/services/api", () => ({
	api: {
		listAgents: vi.fn(),
		createAgent: vi.fn(),
		deleteAgent: vi.fn(),
		restoreAgent: vi.fn(),
		setSelectedAgentId: vi.fn(),
		clearSelectedAgentId: vi.fn(),
		getSelectedAgentId: vi.fn(),
		kbStatus: vi.fn(),
		listKnowledgeBases: vi.fn(),
		createKnowledgeBase: vi.fn(),
		bindAgentKnowledgeBase: vi.fn(),
		testEmbeddingConfig: vi.fn(),
		getKnowledgeBase: vi.fn(),
		resetKnowledgeBase: vi.fn(),
	},
}));

vi.mock("../../src/hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

vi.mock("../../src/components/AdminLayout", () => ({
	default: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="admin-layout">{children}</div>
	),
}));

const mockedApi = vi.mocked(api);

const baseAgent: Agent = {
	id: "agt_1",
	name: "Support Bot",
	description: "Handles support",
	system_prompt: "prompt",
	model: "gpt-4o-mini",
	temperature: 0.7,
	max_tokens: 1024,
	top_k: 5,
	similarity_threshold: 0.01,
	enable_context: true,
	is_active: true,
	deleted_at: null,
	created_at: "2026-01-01T00:00:00Z",
};

const boundAgent: Agent = {
	...baseAgent,
	id: "agt_bound",
	name: "Bound Agent",
	kb_id: "kb_bound",
	kb_name: "Product Docs",
	kb_status: "active",
};

const freeAgent: Agent = {
	...baseAgent,
	id: "agt_free",
	name: "Free Agent",
	kb_id: null,
	kb_name: null,
	kb_status: null,
};

const unboundKb: KnowledgeBaseDetail = {
	id: "kb_free",
	name: "Unbound KB",
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
	document_count: 0,
	ready_document_count: 0,
	total_chunks: 0,
	bound_agent: null,
};

function renderAgents(agents: Agent[] = [boundAgent, freeAgent]) {
	mockedApi.listAgents.mockResolvedValue({
		agents,
		total: agents.length,
	});
	const router = createMemoryRouter(
		[
			{ path: "/agents", element: <Agents /> },
			{ path: "/agents/:agentId/dashboard", element: <div>Dashboard</div> },
		],
		{ initialEntries: ["/agents"] },
	);
	render(<RouterProvider router={router} />);
	return router;
}

beforeEach(() => {
	vi.clearAllMocks();
	authState.role = "super_admin";
	mockedApi.listKnowledgeBases.mockResolvedValue({
		knowledge_bases: [unboundKb],
		total: 1,
	});
	mockedApi.bindAgentKnowledgeBase.mockResolvedValue({
		agent: { ...freeAgent, kb_id: "kb_free" },
		knowledge_base: unboundKb,
	});
});

describe("Agents knowledge-base column", () => {
	it("shows the bound knowledge base name and an em dash when unbound", async () => {
		renderAgents();

		await screen.findByText("Bound Agent");
		expect(screen.getByTestId("agent-kb-name-agt_bound")).toHaveTextContent(
			"Product Docs",
		);
		expect(screen.getByTestId("agent-kb-name-agt_free")).toHaveTextContent(
			"knowledgeBases.unboundValue",
		);
	});

	it("renders Unbind for a bound agent and Bind for an unbound one", async () => {
		renderAgents();

		await screen.findByText("Bound Agent");
		expect(screen.getByTestId("agent-kb-bind-agt_bound")).toHaveTextContent(
			"knowledgeBases.actions.unbind",
		);
		expect(screen.getByTestId("agent-kb-bind-agt_free")).toHaveTextContent(
			"knowledgeBases.actions.bind",
		);
	});

	it("hides the bind/unbind controls from a non super_admin", async () => {
		authState.role = "admin";
		renderAgents();

		await screen.findByText("Bound Agent");
		expect(
			screen.queryByTestId("agent-kb-bind-agt_bound"),
		).not.toBeInTheDocument();
		expect(
			screen.queryByTestId("agent-kb-bind-agt_free"),
		).not.toBeInTheDocument();
		// The column itself stays readable for everyone.
		expect(screen.getByTestId("agent-kb-name-agt_bound")).toHaveTextContent(
			"Product Docs",
		);
	});

	it("binds an existing knowledge base to an unbound agent through the chooser", async () => {
		renderAgents();

		await screen.findByText("Free Agent");
		fireEvent.click(screen.getByTestId("agent-kb-bind-agt_free"));

		const modal = await screen.findByTestId("kb-onboarding-modal");
		fireEvent.click(
			screen.getByRole("button", { name: "agents.kbBindExisting" }),
		);
		fireEvent.change(screen.getByTestId("kb-chooser-select"), {
			target: { value: "kb_free" },
		});
		fireEvent.click(screen.getByTestId("kb-chooser-bind-submit"));

		await waitFor(() => {
			expect(mockedApi.bindAgentKnowledgeBase).toHaveBeenCalledWith(
				"agt_free",
				"kb_free",
			);
		});
		// The list-binding flow stays on the list (no navigation to a dashboard).
		await waitFor(() => {
			expect(
				screen.queryByTestId("kb-onboarding-modal"),
			).not.toBeInTheDocument();
		});
		expect(mockedApi.listAgents).toHaveBeenCalledTimes(2);
	});

	it("unbinds a bound agent after confirmation, calling the API with null", async () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
		renderAgents();

		await screen.findByText("Bound Agent");
		fireEvent.click(screen.getByTestId("agent-kb-bind-agt_bound"));

		await waitFor(() => {
			expect(confirmSpy).toHaveBeenCalledTimes(1);
			expect(mockedApi.bindAgentKnowledgeBase).toHaveBeenCalledWith(
				"agt_bound",
				null,
			);
		});
		confirmSpy.mockRestore();
	});

	it("does not call the API when unbind is not confirmed", async () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
		renderAgents();

		await screen.findByText("Bound Agent");
		fireEvent.click(screen.getByTestId("agent-kb-bind-agt_bound"));

		await waitFor(() => {
			expect(confirmSpy).toHaveBeenCalledTimes(1);
		});
		expect(mockedApi.bindAgentKnowledgeBase).not.toHaveBeenCalled();
		confirmSpy.mockRestore();
	});
});

// --- Agent-scoped knowledge page and the knowledge guard ---------------------
// Both live in the same file set as the list view above: they are the same
// binding surface, just entered from a single agent.
//
// `/agents/:agentId/knowledge` is now a redirect-only view (KnowledgeBaseSetup):
// it reads kbStatus(agentId) and forwards to the bound KB source page, or to
// the KB list with `?bindAgent=` when the agent has no KB. The inline wizard
// that used to live here is gone; the assertions below describe the redirect.

function renderAgentKnowledgePage(agentId = "agt_bound") {
	const router = createMemoryRouter(
		[
			{
				path: "/agents/:agentId/knowledge",
				element: <KnowledgeBaseSetup />,
			},
			{
				path: "/knowledge-bases",
				element: <div>KnowledgeBasesPage</div>,
			},
			{
				path: "/knowledge-bases/:kbId",
				element: <div>KnowledgeBaseDetailPage</div>,
			},
		],
		{ initialEntries: [`/agents/${agentId}/knowledge`] },
	);
	render(<RouterProvider router={router} />);
	return router;
}

describe("agent knowledge page", () => {
	it("redirects a bound agent to its knowledge-base source page", async () => {
		mockedApi.kbStatus.mockResolvedValue({
			agent_id: "agt_bound",
			kb_id: "kb_bound",
			kb_setup_completed: true,
			kb: {
				id: "kb_bound",
				name: "Product Docs",
				embedding_provider: "siliconflow",
				embedding_model: "BAAI/bge-m3",
				status: "active",
			},
		});

		const router = renderAgentKnowledgePage("agt_bound");

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/knowledge-bases/kb_bound");
		});
		expect(mockedApi.kbStatus).toHaveBeenCalledWith("agt_bound");
		// The legacy agent-scoped inline wizard/config surface is gone.
		expect(screen.queryByTestId("kb-wizard")).not.toBeInTheDocument();
		expect(screen.queryByTestId("kb-unbind")).not.toBeInTheDocument();
		expect(mockedApi.getKnowledgeBase).not.toHaveBeenCalled();
	});

	it("redirects an unbound agent to the KB list with the bind query", async () => {
		mockedApi.kbStatus.mockResolvedValue({
			agent_id: "agt_free",
			kb_id: null,
			kb_setup_completed: false,
			kb: null,
		});

		const router = renderAgentKnowledgePage("agt_free");

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/knowledge-bases");
		});
		expect(router.state.location.search).toContain("bindAgent=agt_free");
		expect(mockedApi.bindAgentKnowledgeBase).not.toHaveBeenCalled();
		expect(screen.queryByTestId("kb-bind-existing")).not.toBeInTheDocument();
		expect(screen.queryByTestId("kb-bind-submit")).not.toBeInTheDocument();
	});

	it("no longer renders the inline wizard and never unbinds from this page", async () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
		mockedApi.kbStatus.mockResolvedValue({
			agent_id: "agt_bound",
			kb_id: "kb_bound",
			kb_setup_completed: true,
			kb: {
				id: "kb_bound",
				name: "Product Docs",
				embedding_provider: "jina",
				embedding_model: "jina-embeddings-v3",
				status: "active",
			},
		});

		const router = renderAgentKnowledgePage("agt_bound");

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/knowledge-bases/kb_bound");
		});
		expect(screen.queryByTestId("kb-wizard")).not.toBeInTheDocument();
		expect(screen.queryByTestId("kb-unbind")).not.toBeInTheDocument();
		expect(mockedApi.bindAgentKnowledgeBase).not.toHaveBeenCalled();
		expect(mockedApi.resetKnowledgeBase).not.toHaveBeenCalled();
		expect(mockedApi.getKnowledgeBase).not.toHaveBeenCalled();
		expect(confirmSpy).not.toHaveBeenCalled();
		confirmSpy.mockRestore();
	});
});

describe("KBSetupGuard", () => {
	function renderGuard(mode: "blocking" | "banner") {
		const router = createMemoryRouter(
			[
				{
					path: "/guarded",
					element: (
						<KBSetupGuard agentId="agt_bound" mode={mode}>
							<div>guarded content</div>
						</KBSetupGuard>
					),
				},
				{ path: "/knowledge-bases", element: <div>KnowledgeBasesPage</div> },
				{
					path: "/agents/:agentId/knowledge",
					element: <div>AgentKnowledgePage</div>,
				},
			],
			{ initialEntries: ["/guarded"] },
		);
		render(<RouterProvider router={router} />);
		return router;
	}

	it("renders children when the agent has an active bound KB", async () => {
		mockedApi.kbStatus.mockResolvedValue({
			agent_id: "agt_bound",
			kb_id: "kb_bound",
			kb_setup_completed: true,
			kb: null,
		});

		renderGuard("blocking");
		expect(await screen.findByText("guarded content")).toBeInTheDocument();
	});

	it("banner mode links to the KB list instead of launching the wizard", async () => {
		mockedApi.kbStatus.mockResolvedValue({
			agent_id: "agt_bound",
			kb_id: null,
			kb_setup_completed: false,
			kb: null,
		});

		renderGuard("banner");
		const link = await screen.findByRole("link", { name: "kb.setupButton" });
		expect(link).toHaveAttribute("href", "/knowledge-bases");
		// Children still render under the banner.
		expect(screen.getByText("guarded content")).toBeInTheDocument();
	});

	it("blocking mode links to the KB list and offers no agent knowledge page link", async () => {
		mockedApi.kbStatus.mockResolvedValue({
			agent_id: "agt_bound",
			kb_id: null,
			kb_setup_completed: false,
			kb: null,
		});

		renderGuard("blocking");
		expect(
			await screen.findByRole("link", { name: "kb.guardOpenList" }),
		).toHaveAttribute("href", "/knowledge-bases");
		// Setup happens in /knowledge-bases now; the agent knowledge page link
		// (and the inline wizard it used to open) is gone.
		expect(
			screen.queryByRole("link", { name: "kb.guardAgentPage" }),
		).not.toBeInTheDocument();
		expect(screen.queryByTestId("kb-wizard")).not.toBeInTheDocument();
		expect(screen.queryByText("guarded content")).not.toBeInTheDocument();
	});
});
