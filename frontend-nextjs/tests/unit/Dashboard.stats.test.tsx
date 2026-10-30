// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

// `getSourcesSummary` stays in the mock surface on purpose: the point of the
// spec §17 change is that Dashboard no longer calls it.
vi.mock("../../src/services/api", () => ({
	api: {
		getAgent: vi.fn(),
		getQuota: vi.fn(),
		getSourcesSummary: vi.fn(),
		// #42 adds a third tile: unanswered answers in the last 7 days.
		getUnanswered: vi.fn(async () => ({ items: [], total: 0 })),
	},
}));

// `t` must be stable (Dashboard calls it inside the render body and callbacks)
// and returns the key so assertions target i18n keys rather than prose.
const stableT = (key: string) => key;

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: stableT }),
}));

const mockedApi = vi.mocked(api);

const agentFixture = {
	id: "agt_1",
	name: "官网客服",
	kb_id: "kb_bound",
	api_key_set: true,
	visitor_count: 7,
	active_session_count: 3,
} as unknown as Awaited<ReturnType<typeof api.getAgent>>;

const quotaFixture = {
	used_urls: 0,
	max_urls: 100,
	used_files: 0,
	max_files: 100,
	used_messages_today: 12,
	max_messages_per_day: 100,
} as unknown as Awaited<ReturnType<typeof api.getQuota>>;

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.getAgent.mockResolvedValue(agentFixture);
	mockedApi.getQuota.mockResolvedValue(quotaFixture);
});

function renderDashboard() {
	const router = createMemoryRouter(
		[{ path: "/agents/:agentId/dashboard", element: <Dashboard /> }],
		{ initialEntries: ["/agents/agt_1/dashboard"] },
	);
	return render(<RouterProvider router={router} />);
}

describe("Dashboard statistics", () => {
	it("renders the dashboard page root on the admin-page contract", async () => {
		renderDashboard();

		const root = await screen.findByTestId("dashboard-page");
		expect(root).toHaveClass("admin-page");
	});

	it("renders three counters: users, sessions and unanswered", async () => {
		renderDashboard();

		const grid = await screen.findByTestId("dashboard-stats");
		// #42 adds the unanswered tile; it is labelled from the `unanswered.*`
		// namespace, so only the two original tiles match `dashboard.*`.
		expect(within(grid).getAllByText(/^dashboard\./)).toHaveLength(2);
		expect(within(grid).getByText("unanswered.dashboardStat")).toBeInTheDocument();
		expect(grid.querySelectorAll(".stat")).toHaveLength(3);

		const users = screen.getByTestId("dashboard-stat-user");
		expect(within(users).getByText("dashboard.userCount")).toBeInTheDocument();
		expect(users.querySelector(".stat-value")?.textContent).toBe("7");

		const sessions = screen.getByTestId("dashboard-stat-session");
		expect(
			within(sessions).getByText("dashboard.sessionCount"),
		).toBeInTheDocument();
		expect(sessions.querySelector(".stat-value")?.textContent).toBe("3");

		// The counters are the whole stats surface: no identity card in there.
		expect(
			within(grid).queryByText("labels.apiStatus"),
		).toBeNull();
	});

	it("reports the six facts in the identity block", async () => {
		renderDashboard();

		const identity = await screen.findByTestId("dashboard-identity");

		// 1. platform API status, with the success dot
		expect(within(identity).getByText("labels.apiStatus")).toBeInTheDocument();
		const apiBadge = within(identity)
			.getByText("labels.normalOperation")
			.closest(".badge");
		expect(apiBadge).toHaveClass("badge-success");

		// 2. the agent's own API status
		expect(within(identity).getByText("labels.apiKey")).toBeInTheDocument();
		expect(within(identity).getByText("labels.configured")).toBeInTheDocument();

		// 3. agent name
		expect(within(identity).getByText("labels.agentName")).toBeInTheDocument();
		expect(within(identity).getByText("官网客服")).toBeInTheDocument();

		// 4. agent id, in the mono face
		const agentId = within(identity).getByTestId("dashboard-agent-id");
		expect(agentId.textContent).toBe("agt_1");
		expect(agentId.closest(".mono")).not.toBeNull();

		// 5 + 6 live in the counters row.
		expect(screen.getByTestId("dashboard-stat-user")).toBeInTheDocument();
		expect(screen.getByTestId("dashboard-stat-session")).toBeInTheDocument();
	});

	it("shows the unanswered tile from the 7-day queue and links to the filtered list", async () => {
		mockedApi.getUnanswered.mockResolvedValue({
			items: [],
			total: 7,
		} as unknown as Awaited<ReturnType<typeof api.getUnanswered>>);

		renderDashboard();

		const tile = await screen.findByTestId("dashboard-stat-unanswered");
		await waitFor(() => {
			expect(tile.querySelector(".stat-value")?.textContent).toBe("7");
		});
		expect(tile).toHaveTextContent("unanswered.dashboardStat");
		// The whole card is the link into the filtered session list.
		expect(tile.tagName).toBe("A");
		expect(tile.getAttribute("href")).toBe("/agents/agt_1/sessions?unanswered=1");
		// The window is the last 7 days, asked of the queue itself.
		expect(mockedApi.getUnanswered).toHaveBeenCalledWith(
			expect.objectContaining({ agent_id: "agt_1", limit: 1 }),
		);
	});

	it("renders an em dash for the unanswered tile when the call fails", async () => {
		mockedApi.getUnanswered.mockRejectedValueOnce(new Error("offline"));

		renderDashboard();

		const tile = await screen.findByTestId("dashboard-stat-unanswered");
		await waitFor(() => {
			expect(tile.querySelector(".stat-value")?.textContent).toBe("—");
		});
	});

	it("falls back to an em dash when visitor_count is absent", async () => {
		const { visitor_count: _omitted, ...withoutVisitorCount } = agentFixture;
		mockedApi.getAgent.mockResolvedValue(
			withoutVisitorCount as unknown as Awaited<ReturnType<typeof api.getAgent>>,
		);

		renderDashboard();

		const users = await screen.findByTestId("dashboard-stat-user");
		await waitFor(() => {
			expect(users.querySelector(".stat-value")?.textContent).toBe("—");
		});
	});

	it("renders the not-configured state when the agent has no API key", async () => {
		mockedApi.getAgent.mockResolvedValue({
			...agentFixture,
			api_key_set: false,
		} as unknown as Awaited<ReturnType<typeof api.getAgent>>);

		renderDashboard();

		const identity = await screen.findByTestId("dashboard-identity");
		await waitFor(() => {
			expect(
				within(identity).getByText("labels.notConfigured"),
			).toBeInTheDocument();
		});
		expect(within(identity).queryByText("labels.configured")).toBeNull();
	});

	it("offers no quick-start shortcuts and no greeting", async () => {
		renderDashboard();

		await screen.findByTestId("dashboard-identity");

		expect(screen.queryByText("labels.quickStart")).toBeNull();
		expect(screen.queryByText(/labels\.welcome/)).toBeNull();
		for (const shortcut of [
			"navigation.playground",
			"navigation.fileManagement",
			"navigation.urlKnowledge",
		]) {
			expect(screen.queryByText(shortcut)).toBeNull();
		}
		// The only button left is the agent-id copy control (#30 removed the KB
		// rebind icon); no quick-start shortcut came back.
		expect(
			screen.getByTestId("dashboard-agent-id-copy"),
		).toBeInTheDocument();
		expect(screen.queryByTestId("dashboard-kb-change")).toBeNull();
		expect(screen.getByTestId("dashboard-kb-link")).toBeInTheDocument();
		expect(screen.getAllByRole("button")).toHaveLength(1);
	});

	it("renders no knowledge-base parameter labels", async () => {
		renderDashboard();

		await screen.findByTestId("dashboard-identity");

		for (const kbLabel of [
			"labels.urlKnowledgeSource",
			"labels.fileItems",
			"labels.indexedDocBlocks",
			"labels.vectorIndex",
			"labels.indexInfo",
			"labels.indexedUrls",
			"labels.indexedFiles",
			"labels.docBlocks",
			"labels.indexStatus",
		]) {
			expect(screen.queryByText(kbLabel)).toBeNull();
		}
	});

	it("never fetches the knowledge-base source summary", async () => {
		renderDashboard();

		await waitFor(() => {
			expect(mockedApi.getAgent).toHaveBeenCalledWith("agt_1");
		});
		await waitFor(() => {
			expect(mockedApi.getQuota).toHaveBeenCalledWith("agt_1");
		});
		expect(mockedApi.getSourcesSummary).not.toHaveBeenCalled();
	});
});
