// @vitest-environment jsdom
/**
 * #62 — the #44 degraded marker is gone from the operator's transcript.
 *
 * The old test pinned the opposite: a `degraded: true` assistant row rendered
 * `message-degraded-<id>` with the fallback model's name. #62 deleted the
 * `chat_messages.degraded` column, the wire field and the #44 fallback model,
 * so this file now pins the ABSENCE:
 *
 *   1. the message type carries no `degraded` / `model` fields (source-level,
 *      so a field cannot creep back in unnoticed);
 *   2. a legacy row that still carries both flags renders no marker at all —
 *      the marker hookups, the testid prefix and the retired copy are absent;
 *   3. the transcript around it is untouched (both answers still render).
 *
 * The #60 scripted note is covered by `Sessions.scripted.test.tsx` and stays.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

/** A legacy payload: row 4 still carries the retired `degraded` fields. */
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
		// #44: the wire used to carry this. #62 removed it end to end.
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

describe("Sessions — the degraded marker is gone (#62)", () => {
	it("keeps no `degraded` / `model` field on the transcript message type", () => {
		const source = readFileSync(
			resolve(process.cwd(), "src/views/Sessions.tsx"),
			"utf-8",
		);
		// The marker's hookups, its testid prefix and the retired copy all die
		// with the field; a re-introduction has to fail here first.
		expect(source).not.toMatch(/message-degraded-/);
		expect(source).not.toMatch(/chat\.degradedNotice/);
		expect(source).not.toMatch(/chat\.fallbackModelNote/);
		expect(source).not.toMatch(/^\s*degraded\?:/m);
		// #60's scripted note is a different feature and stays.
		expect(source).toMatch(/message-scripted-/);
		expect(source).toMatch(/chat\.scriptedNotice/);
	});

	it("renders no marker, even on a legacy row carrying `degraded: true`", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openTranscript(user);

		// The tolerance case: the field arrives, nothing is rendered for it.
		expect(screen.queryByTestId("message-degraded-4")).toBeNull();
		expect(screen.queryAllByTestId(/^message-degraded-/)).toHaveLength(0);
		expect(screen.queryByText("chat.degradedNotice")).toBeNull();
		expect(screen.queryByText("chat.fallbackModelNote")).toBeNull();
		// The model name the old marker printed is nowhere either.
		expect(document.body.textContent).not.toContain("cheap-fallback-model");
	});

	it("keeps the transcript intact around the removed marker", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openTranscript(user);

		// Both answers still render (the Markdown renderer owns the exact node).
		expect(document.body.textContent).toContain("退款窗口为收货后 30 天。");
		expect(document.body.textContent).toContain("额度用尽后的回答。");
		// And there is no degraded marker anywhere on the page.
		expect(screen.queryAllByTestId(/^message-degraded-/)).toHaveLength(0);
	});
});
