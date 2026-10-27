// @vitest-environment jsdom
import React from "react";
import {
	render,
	screen,
	waitFor,
	fireEvent,
	within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import Agents from "../../src/views/Agents";
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
	},
}));

vi.mock("../../src/hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
}));

// Keys are returned verbatim so assertions can target i18n keys directly.
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

// The layout is exercised by its own test; here it only needs to render children.
vi.mock("../../src/components/AdminLayout", () => ({
	default: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="admin-layout">{children}</div>
	),
}));

const mockedApi = vi.mocked(api);

const activeAgent: Agent = {
	id: "agt_active",
	name: "Active Agent",
	description: "",
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

const deletedAgent: Agent = {
	...activeAgent,
	id: "agt_deleted",
	name: "Deleted Agent",
	is_active: false,
	deleted_at: "2026-06-01T00:00:00Z",
	purge_after: "2026-06-08T00:00:00Z",
};

const restoredAgent: Agent = {
	...deletedAgent,
	is_active: true,
	deleted_at: null,
	purge_after: null,
};

const newAgent: Agent = {
	...activeAgent,
	id: "agt_new",
	name: "New Agent",
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

const boundKb: KnowledgeBaseDetail = {
	...unboundKb,
	id: "kb_bound",
	name: "Bound KB",
	bound_agent: { id: "agt_active", name: "Active Agent" },
};

const inactiveKb: KnowledgeBaseDetail = {
	...unboundKb,
	id: "kb_error",
	name: "Broken KB",
	status: "error",
};

function renderAgents(initialAgents: Agent[] = [activeAgent, deletedAgent]) {
	mockedApi.listAgents.mockResolvedValue({
		agents: initialAgents,
		total: initialAgents.length,
	});

	const router = createMemoryRouter(
		[
			{ path: "/agents", element: <Agents /> },
			{ path: "/agents/:agentId/dashboard", element: <div>Dashboard</div> },
			{ path: "/agents/:agentId/knowledge", element: <div>Knowledge</div> },
		],
		{ initialEntries: ["/agents"] },
	);

	render(<RouterProvider router={router} />);
	return router;
}

/**
 * §15: the create form is no longer inline. It lives in a sheet that the `+`
 * in `page-actions` opens, so every create flow starts by opening that sheet.
 */
async function openCreateSheet() {
	fireEvent.click(screen.getByTestId("agent-create-open"));
	return screen.findByTestId("agent-create-sheet");
}

async function createAgentThroughForm(name = "New Agent") {
	await openCreateSheet();
	fireEvent.change(screen.getByPlaceholderText("agents.namePlaceholder"), {
		target: { value: name },
	});
	fireEvent.click(screen.getByRole("button", { name: "agents.create" }));
	return screen.findByTestId("kb-onboarding-modal");
}

beforeEach(() => {
	vi.clearAllMocks();
	authState.role = "super_admin";
	mockedApi.createAgent.mockResolvedValue(newAgent);
	mockedApi.deleteAgent.mockResolvedValue({ success: true });
	mockedApi.restoreAgent.mockResolvedValue(restoredAgent);
	mockedApi.listKnowledgeBases.mockResolvedValue({
		knowledge_bases: [unboundKb, boundKb, inactiveKb],
		total: 3,
	});
	mockedApi.createKnowledgeBase.mockResolvedValue({
		...unboundKb,
		id: "kb_new",
		name: "Brand New KB",
	});
	mockedApi.bindAgentKnowledgeBase.mockResolvedValue({
		agent: { ...newAgent, kb_id: "kb_free" },
		knowledge_base: unboundKb,
	});
});

describe("Agents knowledge-base chooser after creating an agent", () => {
	it("opens a three-action chooser listing only unbound active knowledge bases", async () => {
		renderAgents([activeAgent]);
		await screen.findByText("Active Agent");

		const modal = await createAgentThroughForm();

		expect(
			within(modal).getByRole("button", { name: "agents.kbBindExisting" }),
		).toBeInTheDocument();
		expect(
			within(modal).getByRole("button", { name: "agents.kbCreateNew" }),
		).toBeInTheDocument();
		expect(
			within(modal).getByRole("button", { name: "agents.kbOnboardingSkip" }),
		).toBeInTheDocument();
		// The wizard's one-click init button is gone.
		expect(
			within(modal).queryByRole("button", { name: "kb.initButton" }),
		).not.toBeInTheDocument();
		expect(mockedApi.listKnowledgeBases).toHaveBeenCalledTimes(1);

		// "Bind an existing KB" opens the picker; only the unbound + active KB is offered.
		fireEvent.click(
			within(modal).getByRole("button", { name: "agents.kbBindExisting" }),
		);

		const select = await within(modal).findByTestId("kb-chooser-select");
		const options = Array.from(
			(select as HTMLSelectElement).options,
		).map((option) => option.value);
		expect(options).toEqual(["", "kb_free"]);
		expect(
			within(modal).queryByText("Bound KB"),
		).not.toBeInTheDocument();
		expect(
			within(modal).queryByText("Broken KB"),
		).not.toBeInTheDocument();
	});

	it("binds the selected knowledge base to the new agent and enters its dashboard", async () => {
		const router = renderAgents([activeAgent]);
		await screen.findByText("Active Agent");

		const modal = await createAgentThroughForm();
		fireEvent.click(
			within(modal).getByRole("button", { name: "agents.kbBindExisting" }),
		);
		fireEvent.change(await within(modal).findByTestId("kb-chooser-select"), {
			target: { value: "kb_free" },
		});
		fireEvent.click(within(modal).getByTestId("kb-chooser-bind-submit"));

		await waitFor(() => {
			expect(mockedApi.bindAgentKnowledgeBase).toHaveBeenCalledWith(
				"agt_new",
				"kb_free",
			);
		});
		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/agents/agt_new/dashboard");
		});
		expect(mockedApi.setSelectedAgentId).toHaveBeenCalledWith("agt_new");
		expect(mockedApi.createKnowledgeBase).not.toHaveBeenCalled();
	});

	it("creates a knowledge base through the shared form modal and binds it", async () => {
		const router = renderAgents([activeAgent]);
		await screen.findByText("Active Agent");

		const modal = await createAgentThroughForm();
		fireEvent.click(
			within(modal).getByRole("button", { name: "agents.kbCreateNew" }),
		);

		const form = await screen.findByTestId("kb-form-modal");
		fireEvent.change(within(form).getByLabelText("kbForm.name"), {
			target: { value: "Brand New KB" },
		});
		fireEvent.change(within(form).getByLabelText("kbForm.apiKey"), {
			target: { value: "jina_test_key" },
		});
		fireEvent.click(
			within(form).getByRole("button", { name: "kbForm.createSubmit" }),
		);

		await waitFor(() => {
			expect(mockedApi.createKnowledgeBase).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "Brand New KB",
					embedding_provider: "jina",
					embedding_model: "jina-embeddings-v3",
					embedding_api_key: "jina_test_key",
				}),
			);
		});
		await waitFor(() => {
			expect(mockedApi.bindAgentKnowledgeBase).toHaveBeenCalledWith(
				"agt_new",
				"kb_new",
			);
		});
		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/agents/agt_new/dashboard");
		});
	});

	it("skip closes the chooser without creating or binding anything", async () => {
		const router = renderAgents([activeAgent]);
		await screen.findByText("Active Agent");

		const modal = await createAgentThroughForm();
		fireEvent.click(
			within(modal).getByRole("button", { name: "agents.kbOnboardingSkip" }),
		);

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/agents/agt_new/dashboard");
		});
		expect(mockedApi.bindAgentKnowledgeBase).not.toHaveBeenCalled();
		expect(mockedApi.createKnowledgeBase).not.toHaveBeenCalled();
		expect(mockedApi.kbStatus).not.toHaveBeenCalled();
		expect(mockedApi.setSelectedAgentId).toHaveBeenCalledWith("agt_new");
	});
});

describe("Agents lifecycle actions", () => {
	it("hides open actions for deactivated agents", async () => {
		renderAgents();

		await screen.findByText("Active Agent");
		await screen.findByText("Deleted Agent");

		// R4 made the row itself the way in, so the header no longer keeps an
		// "open current agent" shortcut at all: the row name (a link) and the
		// whole row navigate, and the row-level open also lives in the menu.
		expect(
			screen.queryByRole("button", { name: "agents.openCurrent" }),
		).not.toBeInTheDocument();

		fireEvent.click(screen.getByTestId("agent-actions-agt_active"));
		expect(
			within(screen.getByTestId("agent-menu-agt_active")).getAllByRole(
				"menuitem",
				{ name: "agents.open" },
			),
		).toHaveLength(1);
		expect(
			within(screen.getByTestId("agent-menu-agt_active")).queryByRole(
				"menuitem",
				{ name: "agents.restore" },
			),
		).not.toBeInTheDocument();

		// The deactivated agent offers restore and no open action.
		fireEvent.click(screen.getByTestId("agent-actions-agt_deleted"));
		const deletedMenu = screen.getByTestId("agent-menu-agt_deleted");
		expect(
			within(deletedMenu).getAllByRole("menuitem", { name: "agents.restore" }),
		).toHaveLength(1);
		expect(
			within(deletedMenu).queryByRole("menuitem", { name: "agents.open" }),
		).not.toBeInTheDocument();
	});

	it("restores an agent and stores it as the selected agent so opening works", async () => {
		mockedApi.listAgents
			.mockResolvedValueOnce({
				agents: [activeAgent, deletedAgent],
				total: 2,
			})
			.mockResolvedValueOnce({
				agents: [activeAgent, restoredAgent],
				total: 2,
			});

		renderAgents();
		await screen.findByText("Deleted Agent");

		fireEvent.click(screen.getByTestId("agent-actions-agt_deleted"));
		fireEvent.click(screen.getByTestId("agent-restore-agt_deleted"));

		await waitFor(() => {
			expect(mockedApi.restoreAgent).toHaveBeenCalledWith("agt_deleted");
			expect(mockedApi.setSelectedAgentId).toHaveBeenCalledWith("agt_deleted");
		});
	});

	it("does not show top-level or row open buttons for inactive agents", async () => {
		const inactiveAgent: Agent = {
			...activeAgent,
			id: "agt_inactive",
			name: "Inactive Agent",
			description: "Stopped",
			is_active: false,
			purge_after: null,
		};

		renderAgents([inactiveAgent]);

		await screen.findByText("Inactive Agent");

		expect(
			screen.queryByRole("button", { name: "agents.openCurrent" }),
		).not.toBeInTheDocument();
		fireEvent.click(screen.getByTestId("agent-actions-agt_inactive"));
		expect(
			within(screen.getByTestId("agent-menu-agt_inactive")).queryByRole(
				"menuitem",
				{ name: "agents.open" },
			),
		).not.toBeInTheDocument();
	});

	it("limits created agent names to twelve display units", async () => {
		renderAgents([activeAgent]);
		await screen.findByText("Active Agent");

		await openCreateSheet();
		const input = screen.getByPlaceholderText("agents.namePlaceholder");
		fireEvent.change(input, { target: { value: "客服助手一二三" } });

		expect(input).toHaveValue("客服助手一二");
	});

	it("submits a twelve ASCII character agent name", async () => {
		renderAgents([activeAgent]);
		await screen.findByText("Active Agent");

		await openCreateSheet();
		fireEvent.change(screen.getByPlaceholderText("agents.namePlaceholder"), {
			target: { value: "AgentName123" },
		});
		fireEvent.click(screen.getByRole("button", { name: "agents.create" }));

		await waitFor(() => {
			expect(mockedApi.createAgent).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "AgentName123",
					widget_title: "AgentName123",
				}),
			);
		});
	});
});
