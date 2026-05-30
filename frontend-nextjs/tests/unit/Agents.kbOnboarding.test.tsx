// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Agents from "../../src/views/Agents";
import { api } from "../../src/services/api";

vi.mock("../../src/services/api", () => ({
	api: {
		listAgents: vi.fn(),
		createAgent: vi.fn(),
		kbStatus: vi.fn(),
		deleteAgent: vi.fn(),
		restoreAgent: vi.fn(),
	},
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../src/components/KBSetupWizard", () => ({
	__esModule: true,
	default: ({ onSetupComplete }: { onSetupComplete: () => void }) => (
		<div data-testid="kb-wizard">
			<button onClick={onSetupComplete}>complete</button>
		</div>
	),
}));

const mockedApi = vi.mocked(api);

const existingAgent = {
	id: "agt_old",
	name: "Old Agent",
	description: "",
	deleted_at: null,
};
const newAgent = {
	id: "agt_new",
	name: "New Agent",
	description: "",
	deleted_at: null,
};

beforeEach(() => {
	mockedApi.listAgents.mockResolvedValue({ agents: [existingAgent] } as any);
	mockedApi.createAgent.mockResolvedValue(newAgent as any);
	mockedApi.kbStatus.mockResolvedValue({ kb_setup_completed: false } as any);
	mockedApi.deleteAgent.mockResolvedValue(undefined as any);
	mockedApi.restoreAgent.mockResolvedValue(newAgent as any);
});

describe("Agents onboarding", () => {
	it("opens KB modal after creating agent and navigates on completion", async () => {
		const router = createMemoryRouter(
			[
				{
					path: "/agents",
					element: <Agents />,
				},
				{
					path: "/agents/:agentId/dashboard",
					element: <div>Dashboard</div>,
				},
			],
			{
				initialEntries: ["/agents"],
			},
		);

		render(<RouterProvider router={router} />);
		await screen.findByText("Old Agent");

		fireEvent.change(screen.getByPlaceholderText("agents.namePlaceholder"), {
			target: { value: "New Agent" },
		});
		fireEvent.click(screen.getByText("agents.create"));

		await waitFor(() =>
			expect(screen.getByTestId("kb-wizard")).toBeInTheDocument(),
		);
		fireEvent.click(screen.getByText("complete"));

		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/agents/agt_new/dashboard"),
		);
	});
});
