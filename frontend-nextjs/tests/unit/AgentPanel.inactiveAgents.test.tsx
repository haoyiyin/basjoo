// @ts-nocheck
// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import AgentPanel from "../../src/views/AgentPanel";
import { api } from "../../src/services/api";

vi.mock("../../src/services/api", () => ({
	api: {
		listAgents: vi.fn(),
		getAgent: vi.fn(),
	},
}));

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		admin: {
			id: 1,
			name: "Owner",
			email: "owner@example.com",
			role: "super_admin",
		},
		token: "test-token",
		logout: vi.fn(),
	}),
}));

vi.mock("../../src/hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
}));

// `t` must be referentially stable: AgentPanel's load effect depends on it, so a
// fresh function per render would re-run the fetch (and re-set state) forever.
const stableT = (key: string) => key;

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: stableT }),
}));

const mockedApi = vi.mocked(api);

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.getAgent.mockResolvedValue({
		id: "agt_active",
		name: "Active Agent",
	} as any);
	mockedApi.listAgents.mockResolvedValue({
		agents: [
			{
				id: "agt_active",
				name: "Active Agent",
				description: "Available",
				kb_id: "kb_bound",
				kb_name: "Product Docs",
				kb_status: "active",
				is_active: true,
				deleted_at: null,
				last_error_code: null,
			},
			{
				id: "agt_unbound",
				name: "Unbound Agent",
				description: "No KB yet",
				kb_id: null,
				kb_name: null,
				kb_status: null,
				is_active: true,
				deleted_at: null,
				last_error_code: null,
			},
			{
				id: "agt_inactive",
				name: "Inactive Agent",
				description: "Stopped",
				kb_id: null,
				kb_name: null,
				kb_status: null,
				is_active: false,
				deleted_at: null,
				last_error_code: null,
			},
			{
				id: "agt_deleted",
				name: "Deleted Agent",
				description: "Soft deleted",
				kb_id: null,
				kb_name: null,
				kb_status: null,
				is_active: false,
				deleted_at: "2026-06-01T00:00:00Z",
				last_error_code: null,
			},
		],
		total: 4,
	} as any);
});

describe("AgentPanel inactive agent visibility", () => {
	it("only renders active non-deleted agents as openable workspace cards", async () => {
		const router = createMemoryRouter(
			[
				{ path: "/", element: <AgentPanel /> },
				{
					path: "/agents/:agentId/dashboard",
					element: <div>Scoped Dashboard</div>,
				},
			],
			{ initialEntries: ["/"] },
		);

		render(<RouterProvider router={router} />);

		await screen.findByText("Active Agent");

		expect(screen.queryByText("Inactive Agent")).not.toBeInTheDocument();
		expect(screen.queryByText("Deleted Agent")).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /Active Agent/ }),
		).toBeInTheDocument();
	});

	it("does not render agent type or channel labels on the workspace cards", async () => {
		const router = createMemoryRouter(
			[{ path: "/", element: <AgentPanel /> }],
			{ initialEntries: ["/"] },
		);

		render(<RouterProvider router={router} />);

		await screen.findByText("Active Agent");

		// §20 removed agent_type / channel_mode; the card must not show the
		// i18n keys that used to render them.
		expect(screen.queryByText(/agents\.types\./)).not.toBeInTheDocument();
		expect(screen.queryByText(/agents\.channels\./)).not.toBeInTheDocument();
		expect(screen.queryByText(/website_support/)).not.toBeInTheDocument();
		expect(screen.queryByText(/web_widget/)).not.toBeInTheDocument();
	});

	it("opens the bound knowledge base when a card with kb_id is clicked", async () => {
		const router = createMemoryRouter(
			[
				{ path: "/", element: <AgentPanel /> },
				{
					path: "/knowledge-bases/:kbId",
					element: <div>KB Detail Page</div>,
				},
			],
			{ initialEntries: ["/"] },
		);

		render(<RouterProvider router={router} />);

		fireEvent.click(await screen.findByRole("button", { name: /Active Agent/ }));

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/knowledge-bases/kb_bound");
		});
	});

	it("sends an agent without a knowledge base to the bind prompt", async () => {
		const router = createMemoryRouter(
			[
				{ path: "/", element: <AgentPanel /> },
				{ path: "/knowledge-bases", element: <div>KB List Page</div> },
			],
			{ initialEntries: ["/"] },
		);

		render(<RouterProvider router={router} />);

		fireEvent.click(
			await screen.findByRole("button", { name: /Unbound Agent/ }),
		);

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/knowledge-bases");
			expect(router.state.location.search).toBe("?bindAgent=agt_unbound");
		});
	});

	it("shows the bound KB name on a card and a placeholder when unbound", async () => {
		const router = createMemoryRouter(
			[{ path: "/", element: <AgentPanel /> }],
			{ initialEntries: ["/"] },
		);

		render(<RouterProvider router={router} />);

		await screen.findByText("Active Agent");

		expect(screen.getByTestId("agent-kb-agt_active")).toHaveTextContent(
			"Product Docs",
		);
		expect(screen.getByTestId("agent-kb-agt_unbound")).toHaveTextContent(
			"agents.panelNoKnowledgeBase",
		);
	});
});
