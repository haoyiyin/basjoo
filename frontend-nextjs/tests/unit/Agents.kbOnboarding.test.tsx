// @ts-nocheck
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
import KBSetupWizard from "../../src/components/KBSetupWizard";
import { api } from "../../src/services/api";

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
		kbSetup: vi.fn(),
		testJinaApi: vi.fn(),
		testEmbeddingApi: vi.fn(),
	},
}));

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		admin: {
			id: 1,
			name: "Test Admin",
			email: "test@example.com",
			role: "super_admin",
		},
		token: "test-token",
		logout: vi.fn(),
	}),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

const mockedApi = vi.mocked(api);

const activeAgent = {
	id: "agt_active",
	name: "Active Agent",
	description: "",
	is_active: true,
	deleted_at: null,
};

const deletedAgent = {
	id: "agt_deleted",
	name: "Deleted Agent",
	description: "",
	is_active: false,
	deleted_at: "2026-06-01T00:00:00Z",
	purge_after: "2026-06-08T00:00:00Z",
};

const restoredAgent = {
	...deletedAgent,
	is_active: true,
	deleted_at: null,
	purge_after: null,
};

const newAgent = {
	id: "agt_new",
	name: "New Agent",
	description: "",
	is_active: true,
	deleted_at: null,
};

function renderAgents(initialAgents = [activeAgent, deletedAgent]) {
	mockedApi.listAgents.mockResolvedValue({
		agents: initialAgents,
		total: initialAgents.length,
	} as any);

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

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.createAgent.mockResolvedValue(newAgent as any);
	mockedApi.deleteAgent.mockResolvedValue({ success: true } as any);
	mockedApi.restoreAgent.mockResolvedValue(restoredAgent as any);
	mockedApi.kbStatus.mockResolvedValue({
		agent_id: "agt_new",
		kb_setup_completed: false,
		embedding_provider: "jina",
		embedding_model: "jina-embeddings-v3",
		embedding_api_base: null,
		embedding_batch_size: null,
		embedding_api_key_set: false,
	} as any);
	mockedApi.kbSetup.mockResolvedValue(newAgent as any);
	mockedApi.testJinaApi.mockResolvedValue({
		success: true,
		message: "ok",
	} as any);
	mockedApi.testEmbeddingApi.mockResolvedValue({
		success: true,
		message: "ok",
	} as any);
});

describe("KBSetupWizard diagnostics and race handling", () => {
	it("shows error when setup returns but status check reports incomplete", async () => {
		const mockOnSetupComplete = vi.fn();
		const { container } = render(
			<KBSetupWizard
				agentId="agt_test"
				onSetupComplete={mockOnSetupComplete}
				containerTestId="kb-wizard-test"
			/>,
		);

		// Enter API key
		const apiKeyInput = screen.getByPlaceholderText("jina_...");
		fireEvent.change(apiKeyInput, { target: { value: "jina_test_key" } });

		// Mock setup to return an agent with kb_setup_completed: false
		mockedApi.kbSetup.mockResolvedValueOnce({
			id: "agt_test",
			kb_setup_completed: false,
		} as any);

		// Mock kbStatus to also report incomplete
		mockedApi.kbStatus.mockResolvedValueOnce({
			agent_id: "agt_test",
			kb_setup_completed: false,
			embedding_provider: "jina",
			embedding_model: "jina-embeddings-v3",
			embedding_api_base: null,
			embedding_batch_size: null,
			embedding_api_key_set: true,
		} as any);

		// Click setup button
		fireEvent.click(screen.getByRole("button", { name: "kb.initButton" }));

		// Should show incomplete error message
		await waitFor(() => {
			expect(screen.getByText("kb.setupIncompleteError")).toBeInTheDocument();
		});

		// Should NOT call onSetupComplete
		expect(mockOnSetupComplete).not.toHaveBeenCalled();

		// Button should be re-enabled after error
		expect(
			screen.getByRole("button", { name: "kb.initButton" }),
		).not.toBeDisabled();
	});

	it("disables setup button while testing API key to prevent race", async () => {
		const mockOnSetupComplete = vi.fn();
		render(
			<KBSetupWizard
				agentId="agt_test"
				onSetupComplete={mockOnSetupComplete}
				containerTestId="kb-wizard-test"
			/>,
		);

		// Delay the test API response
		mockedApi.testJinaApi.mockImplementation(
			() =>
				new Promise((resolve) =>
					setTimeout(() => resolve({ success: true, message: "ok" }), 100),
				),
		);

		// Enter API key and blur to trigger test
		const apiKeyInput = screen.getByPlaceholderText("jina_...");
		fireEvent.change(apiKeyInput, { target: { value: "jina_test_key" } });

		// Blur should trigger test
		fireEvent.blur(apiKeyInput);

		// Setup button should be disabled while testing
		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "kb.initButton" }),
			).toBeDisabled();
		});

		// Wait for test to complete
		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "kb.initButton" }),
			).not.toBeDisabled();
		});
	});

	it("prevents concurrent setup requests when clicked multiple times", async () => {
		const mockOnSetupComplete = vi.fn();
		mockedApi.kbSetup.mockImplementation(
			() =>
				new Promise((resolve) =>
					setTimeout(
						() =>
							resolve({
								id: "agt_test",
								kb_setup_completed: true,
							} as any),
						100,
					),
				),
		);

		render(
			<KBSetupWizard
				agentId="agt_test"
				onSetupComplete={mockOnSetupComplete}
				containerTestId="kb-wizard-test"
			/>,
		);

		// Enter API key
		const apiKeyInput = screen.getByPlaceholderText("jina_...");
		fireEvent.change(apiKeyInput, { target: { value: "jina_test_key" } });

		// Click setup button multiple times rapidly
		const setupButton = screen.getByRole("button", { name: "kb.initButton" });
		fireEvent.click(setupButton);
		fireEvent.click(setupButton);
		fireEvent.click(setupButton);

		// Should only call kbSetup once
		await waitFor(() => {
			expect(mockedApi.kbSetup).toHaveBeenCalledTimes(1);
		});

		// Wait for completion
		await waitFor(() => {
			expect(mockOnSetupComplete).toHaveBeenCalledTimes(1);
		});
	});

	it("completes successfully when setup returns completed status", async () => {
		const mockOnSetupComplete = vi.fn();

		// Mock setup to return completed agent
		mockedApi.kbSetup.mockResolvedValueOnce({
			id: "agt_test",
			kb_setup_completed: true,
		} as any);

		render(
			<KBSetupWizard
				agentId="agt_test"
				onSetupComplete={mockOnSetupComplete}
				containerTestId="kb-wizard-test"
			/>,
		);

		// Enter API key
		const apiKeyInput = screen.getByPlaceholderText("jina_...");
		fireEvent.change(apiKeyInput, { target: { value: "jina_test_key" } });

		// Click setup button
		fireEvent.click(screen.getByRole("button", { name: "kb.initButton" }));

		// Should call onSetupComplete
		await waitFor(() => {
			expect(mockOnSetupComplete).toHaveBeenCalledTimes(1);
		});

		// Should not show error
		expect(
			screen.queryByText("kb.setupIncompleteError"),
		).not.toBeInTheDocument();
	});
});

describe("Agents onboarding and lifecycle actions", () => {
	it("opens the full KB setup wizard after creating an agent and skip enters that agent dashboard", async () => {
		const router = renderAgents([activeAgent]);
		await screen.findByText("Active Agent");

		fireEvent.change(screen.getByPlaceholderText("agents.namePlaceholder"), {
			target: { value: "New Agent" },
		});
		fireEvent.click(screen.getByText("agents.create"));

		const modal = await screen.findByTestId("kb-onboarding-modal");
		expect(within(modal).getByTestId("kb-wizard")).toBeInTheDocument();
		expect(
			within(modal).getByRole("button", { name: "agents.kbOnboardingSkip" }),
		).toBeInTheDocument();
		expect(
			within(modal).getByRole("button", { name: "kb.initButton" }),
		).toBeDisabled();
		expect(
			within(modal).queryByRole("button", {
				name: "agents.kbOnboardingContinue",
			}),
		).not.toBeInTheDocument();
		expect(
			within(modal).queryByRole("button", { name: "buttons.cancel" }),
		).not.toBeInTheDocument();

		fireEvent.click(
			within(modal).getByRole("button", { name: "agents.kbOnboardingSkip" }),
		);

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/agents/agt_new/dashboard");
		});
		expect(mockedApi.setSelectedAgentId).toHaveBeenCalledWith("agt_new");
		expect(mockedApi.kbSetup).not.toHaveBeenCalled();
	});

	it("initializes the knowledge base inside the onboarding modal and enters the created agent dashboard", async () => {
		const router = renderAgents([activeAgent]);
		await screen.findByText("Active Agent");

		fireEvent.change(screen.getByPlaceholderText("agents.namePlaceholder"), {
			target: { value: "New Agent" },
		});
		fireEvent.click(screen.getByText("agents.create"));

		const modal = await screen.findByTestId("kb-onboarding-modal");
		fireEvent.change(within(modal).getByPlaceholderText("jina_..."), {
			target: { value: "jina_test_key" },
		});
		fireEvent.click(
			within(modal).getByRole("button", { name: "kb.initButton" }),
		);

		await waitFor(() => {
			expect(mockedApi.kbSetup).toHaveBeenCalledWith(
				"agt_new",
				expect.objectContaining({
					embedding_provider: "jina",
					embedding_model: "jina-embeddings-v3",
					jina_api_key: "jina_test_key",
				}),
			);
		});
		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/agents/agt_new/dashboard");
		});
		expect(mockedApi.setSelectedAgentId).toHaveBeenCalledWith("agt_new");
		expect(
			mockedApi.kbStatus.mock.calls.some((call) => call[0] === "agt_new"),
		).toBe(true);
	});

	it("hides open actions for deactivated agents", async () => {
		renderAgents();

		// Wait for agents to load
		await screen.findByText("Active Agent");
		await screen.findByText("Deleted Agent");

		// Two open buttons: one top-level (for selected activeAgent), one row-level for activeAgent
		const openButtons = screen.getAllByRole("button", { name: "agents.open" });
		expect(openButtons).toHaveLength(2);

		// Deleted agent should have restore but no open button
		const restoreButtons = screen.getAllByRole("button", {
			name: "agents.restore",
		});
		expect(restoreButtons).toHaveLength(1);
	});

	it("restores an agent and stores it as the selected agent so opening works", async () => {
		mockedApi.listAgents
			.mockResolvedValueOnce({
				agents: [activeAgent, deletedAgent],
				total: 2,
			} as any)
			.mockResolvedValueOnce({
				agents: [activeAgent, restoredAgent],
				total: 2,
			} as any);

		const router = renderAgents();
		await screen.findByText("Deleted Agent");

		fireEvent.click(screen.getByRole("button", { name: "agents.restore" }));

		await waitFor(() => {
			expect(mockedApi.restoreAgent).toHaveBeenCalledWith("agt_deleted");
			expect(mockedApi.setSelectedAgentId).toHaveBeenCalledWith("agt_deleted");
		});
	});

	it("does not show top-level or row open buttons for inactive agents", async () => {
		const inactiveAgent = {
			id: "agt_inactive",
			name: "Inactive Agent",
			description: "Stopped",
			is_active: false,
			deleted_at: null,
			purge_after: null,
		};

		renderAgents([inactiveAgent]);

		await screen.findByText("Inactive Agent");

		expect(
			screen.queryByRole("button", { name: "agents.open" }),
		).not.toBeInTheDocument();
	});

	it("limits created agent names to ten display units", async () => {
		renderAgents([activeAgent]);
		await screen.findByText("Active Agent");

		const input = screen.getByPlaceholderText("agents.namePlaceholder");
		fireEvent.change(input, { target: { value: "客服助手一二" } });

		expect(input).toHaveValue("客服助手一");
		// count text depends on i18n mock; input value verifies the trim limit
	});

	it("submits a ten ASCII character agent name", async () => {
		renderAgents([activeAgent]);
		await screen.findByText("Active Agent");

		fireEvent.change(screen.getByPlaceholderText("agents.namePlaceholder"), {
			target: { value: "AgentName1" },
		});
		fireEvent.click(screen.getByText("agents.create"));

		await waitFor(() => {
			expect(mockedApi.createAgent).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "AgentName1",
					widget_title: "AgentName1",
				}),
			);
		});
	});
});
