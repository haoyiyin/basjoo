// @vitest-environment jsdom
/**
 * #45 — the dashboard says what to do next, and every number says what it is
 * compared against.
 *
 * The assertions here are the console half of the issue's three boxes:
 *
 *  1. **Every tile shows a delta and its comparison window.** Each tile is
 *     checked for the window's words, not just for a percentage, and the two
 *     zero-previous cases are checked separately: `0 -> 0` reads "no change"
 *     and `0 -> n` reads "new" — neither may render `NaN` or `Infinity`.
 *  2. **The export carries the active filter.** Clicking export must send the
 *     same `range` and `agent_id` the tiles were computed with, and changing the
 *     range must change both, so the file can never describe another period.
 *  3. **The outcome split and the top-unanswered list are rendered** — the
 *     latter as a link into #42's queue rather than a second triage UI.
 *
 * Loading, empty and failure states are covered too: the dashboard has to say
 * something true when there is nothing to show, and a failed analytics query
 * must not blank the page or redirect.
 */
import React from "react";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "../../src/views/Dashboard";
import { api } from "../../src/services/api";
import type { AnalyticsOverview } from "../../src/services/api";
import zhCN from "../../src/locales/zh-CN/common.json";
import enUS from "../../src/locales/en-US/common.json";

vi.mock("../../src/components/AdminLayout", () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
}));

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		admin: { id: 1, name: "Owner", email: "owner@example.com", role: "super_admin" },
	}),
}));

vi.mock("../../src/services/api", () => ({
	api: {
		getAgent: vi.fn(),
		getQuota: vi.fn(),
		getSourcesSummary: vi.fn(),
		getUnanswered: vi.fn(),
		getAnalyticsOverview: vi.fn(),
		exportStatsCsv: vi.fn(),
	},
}));

// Stable `t`, and it echoes the interpolation so a window label that forgot to
// interpolate its day count is visible in the assertion rather than invisible.
const stableT = (key: string, options?: Record<string, unknown>) =>
	options && Object.keys(options).length > 0
		? `${key}|${JSON.stringify(options)}`
		: key;

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

const WINDOW_LABEL = "vs previous 7 days";

function tile(
	value: number,
	previous: number,
	kind: "none" | "new" | "pct",
	pct: number | null,
): AnalyticsOverview["tiles"]["messages"] {
	return {
		value,
		previous,
		delta: value - previous,
		delta_pct: pct,
		delta_kind: kind,
		window_label: WINDOW_LABEL,
	};
}

/** A full payload: every tile has a delta and the same window in words. */
function overviewFixture(): AnalyticsOverview {
	return {
		range: "7d",
		window: {
			from: "2026-03-04T00:00:00+00:00",
			to: "2026-03-11T00:00:00+00:00",
			previous_from: "2026-02-25T00:00:00+00:00",
			previous_to: "2026-03-04T00:00:00+00:00",
			days: 7,
			label: WINDOW_LABEL,
		},
		tiles: {
			sessions: tile(20, 10, "pct", 100),
			messages: tile(40, 50, "pct", -20),
			ai_replies: tile(30, 25, "pct", 20),
			visitors: tile(12, 3, "pct", 300),
			leads: tile(2, 0, "new", null),
			handoffs: tile(0, 0, "none", null),
			unanswered: tile(6, 4, "pct", 50),
			degraded: tile(1, 2, "pct", -50),
			negative_feedback: tile(3, 1, "pct", 200),
			positive_feedback_rate: tile(0.75, 0.5, "pct", 50),
		},
		funnel: {
			opens: 20,
			conversations: 18,
			leads: 2,
			conversation_rate: 0.9,
			lead_rate: 0.1111,
		},
		outcome_split: {
			resolved: 8,
			abandoned: 2,
			escalated: 1,
			"no-answer": 3,
			total: 14,
			classified: 14,
			unclassified: 0,
		},
		top_unanswered: [
			{
				question: "可以开专票吗？",
				occurrences: 4,
				message_id: 91,
				last_seen: "2026-03-09T10:00:00+00:00",
			},
			{
				question: "支持哪些付款方式？",
				occurrences: 2,
				message_id: 77,
				last_seen: "2026-03-08T10:00:00+00:00",
			},
		],
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.getAgent.mockResolvedValue(agentFixture);
	mockedApi.getQuota.mockResolvedValue(quotaFixture);
	mockedApi.getUnanswered.mockResolvedValue({
		items: [],
		total: 0,
	} as unknown as Awaited<ReturnType<typeof api.getUnanswered>>);
	mockedApi.getAnalyticsOverview.mockResolvedValue(
		overviewFixture() as unknown as Awaited<
			ReturnType<typeof api.getAnalyticsOverview>
		>,
	);
	mockedApi.exportStatsCsv.mockResolvedValue({
		blob: new Blob(["date,sessions"], { type: "text/csv" }),
		filename: "basjoo-stats-2026-03-04_2026-03-11.csv",
	} as unknown as Awaited<ReturnType<typeof api.exportStatsCsv>>);
});

function renderDashboard() {
	const router = createMemoryRouter(
		[{ path: "/agents/:agentId/dashboard", element: <Dashboard /> }],
		{ initialEntries: ["/agents/agt_1/dashboard"] },
	);
	return render(<RouterProvider router={router} />);
}

/** Every element the console renders as a tile's delta line. */
function deltaLines(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(".stat-delta"));
}

describe("#45 every tile states its delta and its comparison window", () => {
	it("labels every tile with the window in words, in both locales", () => {
		// The payload owns the wording (server-side, per request locale), and the
		// dashboard renders it verbatim — so a tile can never lose it.
		// The fallback reads as the tail of a delta line ("— vs the previous 7
		// days"), which is where it appears before the payload has loaded.
		expect(zhCN.analytics.windowFallback).toBe("vs 前 {{days}} 天");
		expect(enUS.analytics.windowFallback).toBe("vs the previous {{days}} days");
		// One day is singular: 24h must not read "vs the previous 1 days".
		expect(enUS.analytics.windowFallbackOne).toBe("vs the previous 1 day");
		expect(zhCN.analytics.windowFallbackOne).toBe("vs 前 1 天");
		// The keys the console reads exist in both catalogs with the same shape.
		const shape = (catalog: typeof zhCN) =>
			JSON.stringify(catalog.analytics, (_key, value) =>
				typeof value === "string" ? "str" : value,
			);
		expect(shape(zhCN)).toEqual(shape(enUS));
	});

	it("renders a delta and the window label on every tile", async () => {
		const { container } = renderDashboard();
		await screen.findByTestId("dashboard-metrics");

		const lines = deltaLines(container);
		expect(lines.length).toBeGreaterThanOrEqual(8);
		for (const line of lines) {
			// The window, in words, on every single tile.
			expect(line.textContent).toContain(WINDOW_LABEL);
			// And never a broken number.
			expect(line.textContent).not.toMatch(/NaN|Infinity|undefined/);
		}

		// The three primary tiles carry deltas too, not just the metric grid.
		for (const testId of [
			"dashboard-stat-user-delta",
			"dashboard-stat-session-delta",
			"dashboard-stat-unanswered-delta",
		]) {
			const delta = screen.getByTestId(testId);
			expect(delta).toHaveClass("stat-delta");
			expect(delta.textContent).toContain(WINDOW_LABEL);
		}
		// The page states the comparison window once, above the tiles.
		expect(screen.getByTestId("dashboard-window").textContent).toContain(
			WINDOW_LABEL,
		);
	});

	it("says 'no change' for 0 -> 0 and 'new' for 0 -> n, never a percentage", async () => {
		const { container } = renderDashboard();
		await screen.findByTestId("dashboard-metrics");

		// handoffs is the 0 -> 0 tile: "no change", not "+0%" and not NaN.
		const flat = screen.getByTestId("dashboard-metric-handoffs");
		const flatDelta = flat.querySelector(".stat-delta");
		expect(flatDelta?.textContent).toContain("analytics.deltaNone");
		expect(flatDelta?.textContent).toContain(WINDOW_LABEL);
		expect(flatDelta?.className).toContain("is-flat");
		expect(flatDelta?.textContent).not.toContain("%");

		// leads is the 0 -> 2 tile: "new", never "+Infinity%".
		const fresh = screen.getByTestId("dashboard-metric-leads");
		const freshDelta = fresh.querySelector(".stat-delta");
		expect(freshDelta?.textContent).toContain("analytics.deltaNew");
		expect(freshDelta?.textContent).not.toContain("%");
		expect(freshDelta?.textContent).not.toMatch(/Infinity|NaN/);

		// A normal percentage still prints as one, with its sign.
		const messages = screen.getByTestId("dashboard-metric-messages");
		expect(messages.querySelector(".stat-delta")?.textContent).toContain(
			"analytics.deltaDown",
		);
		expect(container.textContent).not.toMatch(/NaN|Infinity/);
	});

	it("colours the delta by the metric's meaning, not by its sign", async () => {
		renderDashboard();
		await screen.findByTestId("dashboard-metrics");

		// Unanswered rose 50% — that is worse, even though the arrow points up.
		expect(
			screen.getByTestId("dashboard-stat-unanswered-delta").className,
		).toContain("is-worse");
		// Sessions rose 100% — that is better.
		expect(
			screen.getByTestId("dashboard-stat-session-delta").className,
		).toContain("is-better");
		// Negative feedback rose 200% — worse.
		expect(
			screen
				.getByTestId("dashboard-metric-negative_feedback")
				.querySelector(".stat-delta")?.className,
		).toContain("is-worse");
	});

	it("shows the outcome split with counts and shares", async () => {
		renderDashboard();
		const list = await screen.findByTestId("dashboard-outcomes");

		const resolved = within(list).getByTestId("dashboard-outcome-resolved");
		expect(resolved.textContent).toContain("8");
		expect(resolved.textContent).toContain("57%"); // 8/14
		expect(
			within(list).getByTestId("dashboard-outcome-no-answer").textContent,
		).toContain("3");
		expect(
			within(list).getByTestId("dashboard-outcome-escalated").textContent,
		).toContain("1");
		// Nothing is unclassified in this fixture, so no extra row appears.
		expect(within(list).queryByTestId("dashboard-outcome-unclassified")).toBeNull();
	});

	it("links the top unanswered questions into #42's queue", async () => {
		renderDashboard();
		const list = await screen.findByTestId("dashboard-top-unanswered");

		expect(list.textContent).toContain("可以开专票吗？");
		expect(list.textContent).toContain("支持哪些付款方式？");
		// Grouped counts, from the queue's own normaliser.
		expect(within(list).getByTestId("dashboard-top-unanswered-0").textContent).toContain(
			"4",
		);

		// The list is a pointer: one link into the filtered session list.
		const link = screen.getByTestId("dashboard-top-unanswered-link");
		expect(link.tagName).toBe("A");
		expect(link.getAttribute("href")).toBe("/agents/agt_1/sessions?unanswered=1");
	});
});

describe("#45 the export carries the active filter", () => {
	it("exports with the range and agent the tiles were computed for", async () => {
		renderDashboard();
		await screen.findByTestId("dashboard-metrics");

		// The tile query was made with the visible filter.
		expect(mockedApi.getAnalyticsOverview).toHaveBeenCalledWith({
			agent_id: "agt_1",
			range: "7d",
		});

		fireEvent.click(screen.getByTestId("dashboard-export"));

		await waitFor(() => {
			expect(mockedApi.exportStatsCsv).toHaveBeenCalledWith({
				agent_id: "agt_1",
				range: "7d",
			});
		});
	});

	it("changing the range re-queries the tiles and moves the export with them", async () => {
		renderDashboard();
		await screen.findByTestId("dashboard-metrics");

		fireEvent.change(screen.getByTestId("dashboard-range"), {
			target: { value: "30d" },
		});

		// The tiles follow the filter...
		await waitFor(() => {
			expect(mockedApi.getAnalyticsOverview).toHaveBeenLastCalledWith({
				agent_id: "agt_1",
				range: "30d",
			});
		});
		// ...and so does the export: no stale default window can slip through.
		fireEvent.click(screen.getByTestId("dashboard-export"));
		await waitFor(() => {
			expect(mockedApi.exportStatsCsv).toHaveBeenCalledWith({
				agent_id: "agt_1",
				range: "30d",
			});
		});
	});

	it("offers all four ranges the backend accepts", async () => {
		renderDashboard();
		const select = await screen.findByTestId("dashboard-range");

		const values = Array.from(select.querySelectorAll("option")).map(
			(option) => option.getAttribute("value"),
		);
		expect(values).toEqual(["24h", "7d", "30d", "90d"]);
	});
});

describe("#45 empty, loading and failure states", () => {
	it("says the outcome split is still coming instead of printing zeros", async () => {
		mockedApi.getAnalyticsOverview.mockResolvedValue({
			...overviewFixture(),
			outcome_split: {
				resolved: 0,
				abandoned: 0,
				escalated: 0,
				"no-answer": 0,
				total: 0,
				classified: 0,
				unclassified: 0,
			},
			top_unanswered: [],
		} as unknown as Awaited<ReturnType<typeof api.getAnalyticsOverview>>);

		renderDashboard();

		const empty = await screen.findByTestId("dashboard-outcomes-empty");
		expect(empty.textContent).toContain("analytics.outcomesEmptyTitle");
		expect(screen.queryByTestId("dashboard-outcomes")).toBeNull();

		const topEmpty = await screen.findByTestId("dashboard-top-unanswered-empty");
		expect(topEmpty.textContent).toContain("analytics.topUnansweredEmptyTitle");
		expect(screen.queryByTestId("dashboard-top-unanswered")).toBeNull();
		// No dead "open the queue" action when there is nothing to open.
		expect(screen.queryByTestId("dashboard-top-unanswered-link")).toBeNull();
	});

	it("keeps the rest of the dashboard when the analytics query fails", async () => {
		mockedApi.getAnalyticsOverview.mockRejectedValueOnce(new Error("boom"));

		renderDashboard();

		const error = await screen.findByTestId("dashboard-analytics-error");
		expect(error.textContent).toBe("analytics.loadError");
		// The identity block and the agent's own payload still render.
		expect(await screen.findByTestId("dashboard-identity")).toBeInTheDocument();
		expect(screen.getByTestId("dashboard-agent-id").textContent).toBe("agt_1");
		// And the tiles fall back to — rather than a fabricated 0.
		expect(screen.queryByTestId("dashboard-metrics")).toBeNull();
		expect(
			screen.getByTestId("dashboard-stat-user").querySelector(".stat-value")
				?.textContent,
		).toBe("7");
	});
});
