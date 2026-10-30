// @ts-nocheck
// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Dashboard from "../../src/views/Dashboard";
import { api } from "../../src/services/api";

vi.mock("../../src/components/AdminLayout", () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
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
		getSourcesSummary: vi.fn(),
		// #42's unanswered tile reads the triage queue's own total.
		getUnanswered: vi.fn(async () => ({ items: [], total: 0 })),
	},
}));

// `t` must be stable: Dashboard renders it inside callbacks.
const stableT = (key: string, options?: Record<string, unknown>) => {
	if (key === "labels.welcome")
		return `欢迎回到 ${options?.agentName} 控制台`;
	return key;
};

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: stableT }),
}));

const mockedApi = vi.mocked(api);

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.getAgent.mockResolvedValue({
		id: "agt_1",
		name: "官网客服",
		kb_id: "kb_bound",
	} as any);
	mockedApi.getQuota.mockResolvedValue({
		used_urls: 0,
		max_urls: 100,
		used_files: 0,
		max_files: 100,
		used_messages_today: 0,
		max_messages_per_day: 100,
	} as any);
	mockedApi.getSourcesSummary.mockResolvedValue({
		urls: { total: 0, indexed: 0, pending: 0 },
		files: { total: 0, ready: 0, processing: 0 },
		has_pending: false,
	} as any);
});

describe("Dashboard agent scope", () => {
	it("drops the greeting but still names the active agent", async () => {
		const router = createMemoryRouter(
			[{ path: "/agents/:agentId/dashboard", element: <Dashboard /> }],
			{ initialEntries: ["/agents/agt_1/dashboard"] },
		);

		render(<RouterProvider router={router} />);

		// The greeting line is gone for good: no `labels.welcome` render at all.
		await screen.findByTestId("dashboard-identity");
		expect(screen.queryByText(/欢迎回到/)).toBeNull();
		expect(screen.queryByText(/labels\.welcome/)).toBeNull();

		// The agent name still identifies whose dashboard this is.
		const identity = screen.getByTestId("dashboard-identity");
		expect(within(identity).getByText("官网客服")).toBeInTheDocument();
	});

	it("offers no quick-start shortcuts to leave the agent workspace", async () => {
		const router = createMemoryRouter(
			[
				{ path: "/agents/:agentId/dashboard", element: <Dashboard /> },
				{
					path: "/agents/:agentId/playground",
					element: <div>Scoped Playground</div>,
				},
				{
					path: "/knowledge-bases/:kbId",
					element: <div>KB Detail Page</div>,
				},
				{ path: "/knowledge-bases", element: <div>KB List Page</div> },
			],
			{ initialEntries: ["/agents/agt_1/dashboard"] },
		);

		const { container } = render(<RouterProvider router={router} />);

		await screen.findByTestId("dashboard-identity");

		for (const shortcut of [
			"navigation.playground",
			"navigation.fileManagement",
			"navigation.urlKnowledge",
		]) {
			expect(screen.queryByText(shortcut)).toBeNull();
		}
		// Two links: the bound knowledge base's name (R3) and #42's unanswered
		// stat tile, which opens the filtered session list. No playground, file
		// or URL shortcut came back.
		const links = Array.from(container.querySelectorAll("a"));
		expect(links).toHaveLength(2);
		const hrefs = links.map((link) => link.getAttribute("href"));
		expect(hrefs).toContain("/knowledge-bases/kb_bound");
		expect(hrefs).toContain("/agents/agt_1/sessions?unanswered=1");
		expect(router.state.location.pathname).toBe("/agents/agt_1/dashboard");
	});
});
