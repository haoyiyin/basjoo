// @vitest-environment jsdom
/**
 * #60 — a scripted (keyword-matched FAQ) answer is visible in the operator's
 * transcript.
 *
 * The SSE `done` event carries `mode: "scripted"` and `matched_by: "keyword"`,
 * and `/api/v1/admin/sessions/{id}/messages` echoes `mode` per assistant row, so
 * the transcript can say WHY the visitor got an answer while no model was
 * called.
 *
 * Pinned here on the real rendered surface (not a helper): the note appears on
 * the scripted assistant message only — never on a normal `ai` answer, never on
 * a visitor message, and never stacked on top of the #44 degraded note.
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import Sessions from "../../src/views/Sessions";

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
	last_message: "由常见问题自动回答的一句话。",
};

/** 1: visitor, 2: a normal `ai` answer, 3: visitor, 4: a scripted answer. */
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
		mode: "ai",
		created_at: "2026-01-01T00:00:05Z",
	},
	{
		id: 3,
		role: "user",
		content: "那发票怎么开？",
		created_at: "2026-01-01T00:01:00Z",
	},
	{
		id: 4,
		role: "assistant",
		content: "由常见问题自动回答的一句话。",
		// #60: a keyword-matched FAQ pair answered, with no model call.
		mode: "scripted",
		matched_by: "keyword",
		created_at: "2026-01-01T00:01:05Z",
	},
];

/**
 * A row that still carries the retired #44 `degraded` / `model` pair. The
 * backend no longer writes it (#62), and the transcript must ignore it.
 */
const messagesWithLegacyDegradedFlag = [
	...messages,
	{
		id: 5,
		role: "user",
		content: "还有别的吗？",
		created_at: "2026-01-01T00:02:00Z",
	},
	{
		id: 6,
		role: "assistant",
		content: "额度用尽后的回答。",
		mode: "ai",
		degraded: true,
		model: "cheap-fallback-model",
		created_at: "2026-01-01T00:02:05Z",
	},
];

function stubFetch(messageRows: unknown[]) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("/messages")) {
				return new Response(JSON.stringify(messageRows), {
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
}

beforeEach(() => {
	vi.clearAllMocks();
	stubFetch(messages);
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

describe("Sessions — scripted answer notice (#60)", () => {
	it("shows the notice on the scripted answer, and nowhere else", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openTranscript(user);

		const notice = await screen.findByTestId("message-scripted-4");
		expect(notice).toHaveTextContent("chat.scriptedNotice");

		// A normal `ai` answer and every visitor message carry no notice.
		expect(screen.queryByTestId("message-scripted-2")).toBeNull();
		expect(screen.queryByTestId("message-scripted-1")).toBeNull();
		expect(screen.queryByTestId("message-scripted-3")).toBeNull();

		const notices = screen.getAllByTestId(/^message-scripted-/);
		expect(notices).toHaveLength(1);
	});

	it("does not show the notice for an `ai` answer", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openTranscript(user);

		// Message 2 is a plain `ai` turn, rendered and visible, with no note.
		const transcript = document.body;
		expect(transcript.textContent).toContain("退款窗口为收货后 30 天。");
		expect(screen.queryByTestId("message-scripted-2")).toBeNull();
		expect(screen.queryByText("chat.scriptedNotice")).not.toBeNull();
		// Exactly the scripted turn (4) carries it.
		expect(screen.getAllByTestId(/^message-scripted-/)).toHaveLength(1);
	});

	it("never renders the retired #44 degraded marker (#62)", async () => {
		// #62 inverted the old assertion: the backend has no `degraded` field
		// left, so the transcript renders no degraded note at all — not even on
		// a legacy row that still carries the flag.
		const user = userEvent.setup();
		stubFetch(messagesWithLegacyDegradedFlag);
		renderSessions();
		await openTranscript(user);

		// The scripted turn keeps its own note (#60 stays).
		const scripted = await screen.findByTestId("message-scripted-4");
		expect(scripted).toHaveTextContent("chat.scriptedNotice");

		// The legacy degraded row renders as a plain answer: no note, and the
		// retired copy is nowhere on the page.
		expect(screen.queryByTestId("message-degraded-6")).toBeNull();
		expect(screen.queryByTestId("message-degraded-4")).toBeNull();
		expect(screen.queryAllByTestId(/^message-degraded-/)).toHaveLength(0);
		expect(screen.queryByText("chat.degradedNotice")).toBeNull();
		expect(screen.queryByText("chat.fallbackModelNote")).toBeNull();
		// It also never picks up the FAQ label: only `matched_by` may do that.
		expect(screen.queryByTestId("message-scripted-6")).toBeNull();
		expect(screen.getAllByTestId(/^message-scripted-/)).toHaveLength(1);
	});

	it("does not show the notice on a scripted MISS (matched_by: null)", async () => {
		// #60 defect: a miss is `mode: "scripted"` too, but its text is the
		// operator's apology — `由常见问题自动回答` would be false on it. The
		// note is keyed off `matched_by`, so a hit and a miss share `mode` and
		// still render differently.
		const user = userEvent.setup();
		stubFetch([
			messages[0],
			{
				id: 2,
				role: "assistant",
				content: "这个问题我先帮您转给人工同事。",
				mode: "scripted",
				matched_by: null,
				created_at: "2026-01-01T00:00:05Z",
			},
			messages[2],
			messages[3],
		]);
		renderSessions();
		const row = await screen.findByTestId("session-row-sess_1");
		await user.click(within(row).getByRole("button"));
		await screen.findByTestId("revise-answer-4");

		// The apology rendered, with no FAQ note attached to it.
		expect(document.body.textContent).toContain("这个问题我先帮您转给人工同事。");
		expect(screen.queryByTestId("message-scripted-2")).toBeNull();
		expect(screen.getAllByTestId(/^message-scripted-/)).toHaveLength(1);
		expect(screen.getByTestId("message-scripted-4")).toHaveTextContent(
			"chat.scriptedNotice",
		);
	});

	it("keeps the FAQ note and drops the retired degraded flag on one row", async () => {
		// A row carrying both the #60 marker and the retired #44 flag renders
		// exactly one note: `matched_by` still decides the FAQ label, and the
		// degraded marker no longer exists (#62).
		const user = userEvent.setup();
		stubFetch([
			messages[0],
			{
				id: 2,
				role: "assistant",
				content: "同时带两个标记的回答。",
				mode: "scripted",
				matched_by: "keyword",
				degraded: true,
				model: "cheap-fallback-model",
				created_at: "2026-01-01T00:00:05Z",
			},
		]);
		renderSessions();
		const row = await screen.findByTestId("session-row-sess_1");
		await user.click(within(row).getByRole("button"));
		await screen.findByTestId("revise-answer-2");

		expect(screen.getByTestId("message-scripted-2")).toHaveTextContent(
			"chat.scriptedNotice",
		);
		expect(screen.queryByTestId("message-degraded-2")).toBeNull();
	});
});
