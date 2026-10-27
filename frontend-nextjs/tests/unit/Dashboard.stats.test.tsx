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
	active_session_count: 7,
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

	it("renders the four statistics with tabular stat primitives", async () => {
		renderDashboard();

		const grid = await screen.findByTestId("dashboard-stats");

		expect(within(grid).getByText("labels.apiStatus")).toBeInTheDocument();
		expect(within(grid).getByText("labels.agentName")).toBeInTheDocument();
		expect(within(grid).getByText("dashboard.userCount")).toBeInTheDocument();
		expect(
			within(grid).getByText("dashboard.sessionCount"),
		).toBeInTheDocument();

		// Agent name and the agent's active session count are the live values.
		expect(
			within(screen.getByTestId("dashboard-stat-agent")).getByText("官网客服"),
		).toBeInTheDocument();
		expect(
			within(screen.getByTestId("dashboard-stat-sessions")).getByText("7"),
		).toBeInTheDocument();

		// Values are rendered through the DS primitives, tabular numerals.
		const apiValue = screen
			.getByTestId("dashboard-stat-api")
			.querySelector(".stat-value");
		expect(apiValue).not.toBeNull();
		expect(apiValue?.textContent).toBe("labels.normalOperation");
		expect(
			screen.getByTestId("dashboard-stat-api").querySelector(".stat-label")
				?.textContent,
		).toBe("labels.apiStatus");
	});

	it("renders one status region and no knowledge-base parameter labels", async () => {
		renderDashboard();

		await screen.findByTestId("dashboard-status");

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
