// @vitest-environment jsdom
/**
 * R3: the agent's knowledge base is a first-class fact on the dashboard.
 * Bound -> name as a link to the KB source page + one change action.
 * Unbound -> the not-bound copy + both CTAs.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import Dashboard from "../../src/views/Dashboard";
import { api } from "../../src/services/api";

vi.mock("../../src/components/AdminLayout", () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		admin: {
			id: 1,
			name: "Owner",
			email: "owner@example.com",
			role: "super_admin",
		},
	}),
}));

vi.mock("../../src/services/api", () => ({
	api: {
		getAgent: vi.fn(),
		getQuota: vi.fn(),
		listKnowledgeBases: vi.fn(),
		createKnowledgeBase: vi.fn(),
		bindAgentKnowledgeBase: vi.fn(),
	},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

const mockedApi = vi.mocked(api);

const quotaFixture = {
	used_urls: 0,
	max_urls: 100,
	used_files: 0,
	max_files: 100,
	used_messages_today: 0,
	max_messages_per_day: 100,
} as unknown as Awaited<ReturnType<typeof api.getQuota>>;

const boundAgent = {
	id: "agt_1",
	name: "Support Bot",
	kb_id: "kb_1",
	kb_name: "Product Docs",
	api_key_set: true,
	active_session_count: 0,
	visitor_count: 0,
} as unknown as Awaited<ReturnType<typeof api.getAgent>>;

const unboundAgent = {
	...boundAgent,
	kb_id: null,
	kb_name: null,
} as unknown as Awaited<ReturnType<typeof api.getAgent>>;

function renderDashboard(agent = boundAgent) {
	mockedApi.getAgent.mockResolvedValue(agent);
	const router = createMemoryRouter(
		[
			{ path: "/agents/:agentId/dashboard", element: <Dashboard /> },
			{ path: "/knowledge-bases", element: <div>KB list</div> },
			{ path: "/knowledge-bases/:kbId", element: <div>KB detail</div> },
		],
		{ initialEntries: [`/agents/${agent.id}/dashboard`] },
	);
	render(<RouterProvider router={router} />);
	return router;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.getQuota.mockResolvedValue(quotaFixture);
	mockedApi.listKnowledgeBases.mockResolvedValue({
		knowledge_bases: [],
		total: 0,
	});
});

describe("Dashboard knowledge-base row (R3)", () => {
	it("links a bound agent to its KB by name and offers no rebind action (#30)", async () => {
		renderDashboard();

		const row = await screen.findByTestId("dashboard-kb-row");
		expect(
			within(row).getByText("dashboard.boundKnowledgeBase"),
		).toBeInTheDocument();
		const link = within(row).getByTestId("dashboard-kb-link");
		expect(link).toHaveTextContent("Product Docs");
		expect(link).toHaveAttribute("href", "/knowledge-bases/kb_1");
		// #30: the swap icon is gone; rebinding happens from the lists.
		expect(within(row).queryByTestId("dashboard-kb-change")).toBeNull();

		// The bound state never shows the bind/create CTAs.
		expect(within(row).queryByTestId("dashboard-kb-bind")).toBeNull();
		expect(within(row).queryByTestId("dashboard-kb-create")).toBeNull();
	});

	it("shows the not-bound copy and both CTAs for an unbound agent", async () => {
		renderDashboard(unboundAgent);

		const row = await screen.findByTestId("dashboard-kb-row");
		expect(
			within(row).getByText("dashboard.unboundKnowledgeBase"),
		).toBeInTheDocument();

		// #65: the bind action is an icon button, so the accessible name — not
		// the glyph — carries the label it used to print.
		const bind = within(row).getByTestId("dashboard-kb-bind");
		expect(bind).toHaveAttribute("aria-label", "dashboard.bindExisting");
		expect(bind).toHaveAttribute("title", "dashboard.bindExisting");
		expect(bind).toHaveClass("btn-icon");
		const create = within(row).getByTestId("dashboard-kb-create");
		expect(create).toHaveTextContent("dashboard.createKnowledgeBase");
		expect(create).toHaveAttribute(
			"href",
			"/knowledge-bases?bindAgent=agt_1",
		);
		expect(within(row).queryByTestId("dashboard-kb-link")).toBeNull();
	});

	it("opens the shared chooser sheet from the bind action", async () => {
		renderDashboard(unboundAgent);

		const row = await screen.findByTestId("dashboard-kb-row");
		fireEvent.click(within(row).getByTestId("dashboard-kb-bind"));

		const sheet = await screen.findByTestId("kb-onboarding-modal");
		expect(
			within(sheet).getByRole("button", { name: "agents.kbBindExisting" }),
		).toBeInTheDocument();
		expect(
			within(sheet).getByRole("button", { name: "agents.kbCreateNew" }),
		).toBeInTheDocument();
	});
});
