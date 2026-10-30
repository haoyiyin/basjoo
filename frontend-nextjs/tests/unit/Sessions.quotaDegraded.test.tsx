// @vitest-environment jsdom
/**
 * #44 — a degraded answer is visible in the operator's transcript.
 *
 * The SSE `done` event carries `degraded`, and the admin message list echoes it
 * per message, so the transcript shows WHY an answer may be weaker: the primary
 * allowance was spent and the fallback model answered.
 *
 * Pinned here on the real rendered surface (not a helper): the note appears on
 * the degraded assistant message only, and never on a visitor message or on a
 * normal assistant answer.
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
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

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, unknown>) =>
			params && Object.keys(params).length > 0
				? `${key}|${JSON.stringify(params)}`
				: key,
	}),
}));

const session = {
	id: "sess_1",
	session_id: "sess_1",
	status: "active",
	message_count: 4,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:10:00Z",
	last_message: "额度用尽后的回答。",
};

const messages = [
	{
		id: 1,
		role: "user",
		content: "你们的退款窗口是多长时间？",
		created_at: "2026-01-01T00:00:00Z",
	},
	{
		id: 2,
		role: "assistant",
		content: "退款窗口为收货后 30 天。",
		created_at: "2026-01-01T00:00:05Z",
	},
	{
		id: 3,
		role: "user",
		content: "还能开发票吗？",
		created_at: "2026-01-01T00:01:00Z",
	},
	{
		id: 4,
		role: "assistant",
		content: "额度用尽后的回答。",
		// #44: the fallback model answered this one.
		degraded: true,
		model: "cheap-fallback-model",
		created_at: "2026-01-01T00:01:05Z",
	},
];

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("/messages")) {
				return new Response(JSON.stringify(messages), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response(JSON.stringify({ items: [session], total: 1 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
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

function renderSessions(initialEntry = "/agents/agt_1/sessions") {
	return render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<Routes>
				<Route path="/agents/:agentId/sessions" element={<Sessions />} />
			</Routes>
		</MemoryRouter>,
	);
}

async function openTranscript(user: ReturnType<typeof userEvent.setup>) {
	const row = await screen.findByTestId("session-row-sess_1");
	await user.click(within(row).getByRole("button"));
	await screen.findByTestId("revise-answer-4");
}

describe("Sessions — degraded answer notice (#44)", () => {
	it("shows the notice on the degraded answer, and nowhere else", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openTranscript(user);

		const notice = await screen.findByTestId("message-degraded-4");
		expect(notice).toHaveTextContent("chat.degradedNotice");
		// The model that actually answered is named.
		expect(notice).toHaveTextContent("cheap-fallback-model");

		// A normal assistant answer and every visitor message carry no notice.
		expect(screen.queryByTestId("message-degraded-2")).toBeNull();
		expect(screen.queryByTestId("message-degraded-1")).toBeNull();
		expect(screen.queryByTestId("message-degraded-3")).toBeNull();
	});

	it("keeps the transcript intact around the notice", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openTranscript(user);

		// Both answers are still rendered (the Markdown renderer owns the exact
		// node), and only one of them carries the notice.
		const container = await screen.findByTestId("chat-messages").catch(() => null);
		const transcript = container ?? document.body;
		expect(transcript.textContent).toContain("退款窗口为收货后 30 天。");
		expect(transcript.textContent).toContain("额度用尽后的回答。");

		const notices = screen.getAllByTestId(/^message-degraded-/);
		expect(notices).toHaveLength(1);
	});
});
