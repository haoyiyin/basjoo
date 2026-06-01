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
});

describe("Agents onboarding and lifecycle actions", () => {
	it("opens a two-button KB modal after creating an agent and skip enters that agent dashboard", async () => {
		const router = renderAgents([activeAgent]);
		await screen.findByText("Active Agent");

		fireEvent.change(screen.getByPlaceholderText("agents.namePlaceholder"), {
			target: { value: "New Agent" },
		});
		fireEvent.click(screen.getByText("agents.create"));

		const modal = await screen.findByTestId("kb-onboarding-modal");
		expect(within(modal).queryByTestId("kb-wizard")).not.toBeInTheDocument();
		expect(
			within(modal).getByRole("button", { name: "agents.kbOnboardingSkip" }),
		).toBeInTheDocument();
		expect(
			within(modal).getByRole("button", {
				name: "agents.kbOnboardingContinue",
			}),
		).toBeInTheDocument();

		fireEvent.click(
			within(modal).getByRole("button", { name: "agents.kbOnboardingSkip" }),
		);

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/agents/agt_new/dashboard");
		});
	});

	it("initializing knowledge base from the two-button modal enters the created agent knowledge page", async () => {
		const router = renderAgents([activeAgent]);
		await screen.findByText("Active Agent");

		fireEvent.change(screen.getByPlaceholderText("agents.namePlaceholder"), {
			target: { value: "New Agent" },
		});
		fireEvent.click(screen.getByText("agents.create"));

		const modal = await screen.findByTestId("kb-onboarding-modal");
		fireEvent.click(
			within(modal).getByRole("button", {
				name: "agents.kbOnboardingContinue",
			}),
		);

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/agents/agt_new/knowledge");
		});
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

		expect(screen.queryByRole("button", { name: "agents.open" })).not.toBeInTheDocument();
	});
});
