// @vitest-environment jsdom
/**
 * #43 — human handoff in the session centre.
 *
 * The four explicit actions are pinned on the rendered surface:
 *
 *  1. Reply posts `/reply` with the composer text and does NOT mute the bot by
 *     itself (the route, not this component, decides `status`);
 *  2. Take over and Release to AI post their own routes;
 *  3. Mark resolved posts `/resolve`, and the resolved row offers Reopen;
 *  4. a `resolved` row is distinguishable from a timeout `closed` row and is
 *     reachable through its own filter.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import Sessions from "../../src/views/Sessions";
import { api } from "../../src/services/api";

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({ token: "test-token", admin: { id: 1 }, logout: vi.fn() }),
}));

vi.mock("../../src/hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
}));

vi.mock("../../src/services/api", () => ({
	api: {
		addQaFromMessage: vi.fn(),
		dismissUnanswered: vi.fn(),
		reviseAnswer: vi.fn(),
		listAgents: vi.fn(async () => ({ agents: [], total: 0 })),
		getAgent: vi.fn(async () => null),
		getDefaultAgent: vi.fn(async () => null),
		getSelectedAgentId: vi.fn(() => null),
		setSelectedAgentId: vi.fn(),
		clearSelectedAgentId: vi.fn(),
		checkHealth: vi.fn(async () => ({ status: "healthy" })),
	},
}));

function stableT(key: string, params?: Record<string, unknown>) {
	if (params && Object.keys(params).length > 0) {
		return `${key}|${JSON.stringify(params)}`;
	}
	return key;
}

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: stableT }),
}));

const activeSession = {
	id: "sess_1",
	session_id: "sess_1",
	status: "active",
	mode: "ai",
	message_count: 2,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:10:00Z",
	last_message: "你们几点下班？",
};

const humanSession = {
	id: "sess_2",
	session_id: "sess_2",
	status: "taken_over",
	mode: "human",
	human_replied_at: "2026-01-01T00:20:00Z",
	message_count: 3,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:20:00Z",
	last_message: "人工回复",
};

const resolvedSession = {
	id: "sess_3",
	session_id: "sess_3",
	status: "resolved",
	mode: "human",
	message_count: 5,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:30:00Z",
	last_message: "已解决",
};

const closedSession = {
	id: "sess_4",
	session_id: "sess_4",
	status: "closed",
	mode: "ai",
	message_count: 1,
	created_at: "2025-12-01T00:00:00Z",
	updated_at: "2025-12-01T00:05:00Z",
	last_message: "超时关闭",
};

const messages = [
	{
		id: 1,
		role: "user",
		content: "你们几点下班？",
		created_at: "2026-01-01T00:00:00Z",
	},
	{
		id: 2,
		role: "assistant",
		content: "我们的营业时间请见官网。",
		created_at: "2026-01-01T00:00:05Z",
	},
];

type Post = { url: string; body: unknown };

let posts: Post[] = [];
let sessions: unknown[] = [];

function jsonResponse(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	posts = [];
	// Clone: the mock mutates rows to mirror the backend, so the module-level
	// fixtures must never be shared across tests.
	sessions = [activeSession, humanSession, resolvedSession, closedSession].map(
		(row) => ({ ...row }),
	);

	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? "GET";

			if (method === "POST") {
				const body = init?.body ? JSON.parse(String(init.body)) : null;
				posts.push({ url, body });

				// Mirror the backend: every action route echoes the session.
				const match = url.match(/\/admin\/sessions\/([^/]+)\/(\w+)$/);
				const target = sessions.find(
					(item) => (item as { id: string }).id === match?.[1],
				) as Record<string, unknown> | undefined;
				const action = match?.[2];
				const next = { ...(target ?? {}) };
				if (action === "takeover") {
					next.status = "taken_over";
					next.mode = "human";
				} else if (action === "reply") {
					next.mode = "human";
					next.human_replied_at = "2026-01-01T00:40:00Z";
				} else if (action === "release") {
					next.mode = "ai";
					next.status = "active";
				} else if (action === "resolve") {
					next.status = "resolved";
				} else if (action === "reopen") {
					next.status = "active";
					next.mode = "ai";
				}
				if (target) Object.assign(target, next);
				return jsonResponse({ success: true, message_id: 99, session: next });
			}

			if (url.includes("/messages")) return jsonResponse(messages);

			// Honour the `status=` filter so the list behaves like the real one.
			const statusParam = new URL(url, "http://localhost").searchParams.get("status");
			const items = statusParam
				? sessions.filter(
						(row) => (row as { status: string }).status === statusParam,
					)
				: sessions;
			return jsonResponse({ items, total: items.length });
		}),
	);
	Element.prototype.scrollIntoView = vi.fn();
	vi.stubGlobal(
		"WebSocket",
		class {
			onopen: (() => void) | null = null;
			onmessage: (() => void) | null = null;
			onerror: (() => void) | null = null;
			onclose: (() => void) | null = null;
			close() {}
		},
	);
});

function renderSessions() {
	return render(
		<MemoryRouter initialEntries={["/agents/agt_1/sessions"]}>
			<Routes>
				<Route path="/agents/:agentId/sessions" element={<Sessions />} />
			</Routes>
		</MemoryRouter>,
	);
}

async function openSession(
	user: ReturnType<typeof userEvent.setup>,
	id: string,
) {
	const row = await screen.findByTestId(`session-row-${id}`);
	await user.click(within(row).getByRole("button"));
	await waitFor(() =>
		expect(screen.getByTestId("session-action-reply")).toBeInTheDocument(),
	);
}

function postedTo(suffix: string) {
	return posts.filter((post) => post.url.endsWith(suffix));
}

describe("Sessions — human handoff (#43)", () => {
	it("replies through /reply without touching status", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openSession(user, "sess_1");

		await user.click(screen.getByTestId("session-action-reply"));
		const composer = await screen.findByTestId("session-reply-composer");
		await user.type(
			within(composer).getByLabelText("handoff.replyPlaceholder"),
			"我们 18:00 下班。",
		);
		await user.click(screen.getByTestId("session-reply-send"));

		await waitFor(() => expect(postedTo("/sess_1/reply")).toHaveLength(1));
		expect(postedTo("/sess_1/reply")[0].body).toEqual({
			message: "我们 18:00 下班。",
		});

		// Reply alone never sends a takeover request.
		expect(postedTo("/sess_1/takeover")).toHaveLength(0);
		// The composer closes once the reply lands.
		await waitFor(() =>
			expect(screen.queryByTestId("session-reply-composer")).toBeNull(),
		);
	});

	it("takes over and releases to AI through their own routes", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openSession(user, "sess_1");

		await user.click(screen.getByTestId("session-action-takeover"));
		await waitFor(() => expect(postedTo("/sess_1/takeover")).toHaveLength(1));

		// Once mode is human the row swaps Take over for Release to AI.
		const release = await screen.findByTestId("session-action-release");
		await user.click(release);
		await waitFor(() => expect(postedTo("/sess_1/release")).toHaveLength(1));
	});

	it("marks a session resolved and then offers Reopen", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openSession(user, "sess_1");

		await user.click(screen.getByTestId("session-action-resolve"));
		await waitFor(() => expect(postedTo("/sess_1/resolve")).toHaveLength(1));

		const reopen = await screen.findByTestId("session-action-reopen");
		expect(screen.queryByTestId("session-action-resolve")).toBeNull();
		await user.click(reopen);
		await waitFor(() => expect(postedTo("/sess_1/reopen")).toHaveLength(1));
	});

	it("renders resolved distinctly from a timeout closed row", async () => {
		const user = userEvent.setup();
		renderSessions();

		const resolvedRow = await screen.findByTestId("session-row-sess_3");
		const closedRow = await screen.findByTestId("session-row-sess_4");

		const resolvedBadge = within(resolvedRow).getByText("status.resolved");
		const closedBadge = within(closedRow).getByText("status.ended");

		expect(resolvedBadge).toHaveClass("badge");
		// Different design-system variants, not colour literals.
		expect(resolvedBadge.className).not.toBe(closedBadge.className);

		// Both rows stay listed — a legacy `closed` row never breaks the list.
		expect(screen.getByTestId("sessions-list")).toBeInTheDocument();

		// The resolved filter selects only the resolved row.
		const resolvedFilter = screen.getByRole("button", {
			name: "status.resolved",
		});
		await user.click(resolvedFilter);
		await waitFor(() =>
			expect(screen.queryByTestId("session-row-sess_4")).toBeNull(),
		);
		expect(screen.getByTestId("session-row-sess_3")).toBeInTheDocument();
	});
});
