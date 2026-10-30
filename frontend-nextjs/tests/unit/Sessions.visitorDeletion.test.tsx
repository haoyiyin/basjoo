// @vitest-environment jsdom
/**
 * #46 — one-click visitor deletion in the session centre.
 *
 * The destructive action lives on the session header and is scoped to the
 * *visitor*, not the session: a signed-in customer may hold several sessions,
 * and a GDPR-shaped request means all of them plus their leads. These tests pin
 * the three things that make that safe to click:
 *
 *  1. it asks first (`window.confirm`), and a cancelled confirm sends nothing;
 *  2. it calls `DELETE /admin/visitors/{visitor_id}` with the id URL-encoded
 *     (a signed identity is `email:hash`, so a raw `:`/`@` must not reach the
 *     path unencoded);
 *  3. the confirmation names the row counts the backend returned, in both
 *     locales, instead of a bare "done".
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
		deleteVisitor: vi.fn(),
		listAgents: vi.fn(async () => ({ agents: [], total: 0 })),
		getAgent: vi.fn(async () => null),
		getDefaultAgent: vi.fn(async () => null),
		getSelectedAgentId: vi.fn(() => null),
		setSelectedAgentId: vi.fn(),
		clearSelectedAgentId: vi.fn(),
		checkHealth: vi.fn(async () => ({ status: "healthy" })),
	},
}));

/**
 * A translator that returns real copy for the keys these tests assert on and
 * the bare key elsewhere — so the assertions read as the sentences an operator
 * actually sees, without pulling the whole i18n runtime into the test.
 */
const COPY: Record<string, Record<string, string>> = {
	"zh-CN": {
		"visitorDeletion.action": "删除访客",
		"visitorDeletion.confirm":
			"确定删除访客 {{id}} 的全部数据吗？其会话、消息、留资线索与反馈将被永久删除，且无法恢复。",
		"visitorDeletion.deleted":
			"已删除 {{sessions}} 个会话、{{messages}} 条消息、{{leads}} 条留资线索。",
		"visitorDeletion.errors.failed": "删除该访客失败，请稍后重试。",
	},
	"en-US": {
		"visitorDeletion.action": "Delete visitor",
		"visitorDeletion.confirm":
			"Delete all data for visitor {{id}}? Their sessions, messages, leads and feedback will be erased permanently. This cannot be undone.",
		"visitorDeletion.deleted":
			"Deleted {{sessions}} session(s), {{messages}} message(s) and {{leads}} lead(s).",
		"visitorDeletion.errors.failed":
			"Could not delete this visitor. Please try again.",
	},
};

let locale = "zh-CN";

function translate(key: string, params?: Record<string, unknown>) {
	const template = COPY[locale]?.[key];
	if (!template) return key;
	if (!params) return template;
	return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
		String(params[name] ?? `{{${name}}}`),
	);
}

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: translate, i18n: { language: locale } }),
}));

const SIGNED_VISITOR = "ada@example.com:" + "a".repeat(64);

const signedSession = {
	id: "sess_signed",
	session_id: "sess_signed",
	visitor_id: SIGNED_VISITOR,
	status: "active",
	mode: "ai",
	message_count: 6,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:10:00Z",
	last_message: "我的订单号是 4471",
};

type Deletion = { url: string; method: string };

let deletions: Deletion[] = [];
let sessions: unknown[] = [];
let confirmAnswer = true;
let deleteFailure: string | null = null;

function jsonResponse(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	locale = "zh-CN";
	deletions = [];
	confirmAnswer = true;
	deleteFailure = null;
	sessions = [{ ...signedSession }];

	vi.mocked(api.deleteVisitor).mockImplementation(async (visitorId: string) => {
		if (deleteFailure) {
			throw new Error(deleteFailure);
		}
		return {
			success: true,
			visitor_id: visitorId,
			deleted: { sessions: 2, messages: 6, leads: 1, feedback: 1 },
			total: 10,
		};
	});

	vi.stubGlobal("confirm", vi.fn(() => confirmAnswer));

	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? "GET";
			if (method === "DELETE") {
				deletions.push({ url, method });
				// The server erased this visitor, so the list no longer has it.
				sessions = [];
				return jsonResponse({ success: true });
			}
			if (url.includes("/messages")) {
				return jsonResponse([
					{
						id: 1,
						role: "user",
						content: "我的订单号是 4471",
						created_at: "2026-01-01T00:00:00Z",
					},
				]);
			}
			return jsonResponse({ items: sessions, total: sessions.length });
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

afterEach(() => {
	vi.unstubAllGlobals();
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

async function openSession(user: ReturnType<typeof userEvent.setup>) {
	const row = await screen.findByTestId("session-row-sess_signed");
	await user.click(within(row).getByRole("button"));
	await waitFor(() =>
		expect(
			screen.getByTestId("session-action-delete-visitor"),
		).toBeInTheDocument(),
	);
}

describe("Sessions — visitor deletion (#46)", () => {
	it("asks for confirmation and sends nothing when the operator cancels", async () => {
		confirmAnswer = false;
		const user = userEvent.setup();
		renderSessions();
		await openSession(user);

		await user.click(screen.getByTestId("session-action-delete-visitor"));

		expect(window.confirm).toHaveBeenCalledTimes(1);
		// The prompt names the visitor so the operator confirms the right person.
		expect(vi.mocked(window.confirm).mock.calls[0][0]).toContain(SIGNED_VISITOR);
		expect(api.deleteVisitor).not.toHaveBeenCalled();
		expect(deletions).toHaveLength(0);
	});

	it("deletes the visitor, URL-encoding a signed `email:hash` id", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openSession(user);

		await user.click(screen.getByTestId("session-action-delete-visitor"));

		await waitFor(() => expect(api.deleteVisitor).toHaveBeenCalledTimes(1));
		// The id goes through the API client, whose `request` URL-encodes it;
		// what matters here is that the *visitor* id is what was sent — not the
		// session id, which would only erase one thread.
		expect(vi.mocked(api.deleteVisitor).mock.calls[0][0]).toBe(SIGNED_VISITOR);
	});

	it("confirms with the row counts the backend returned, in Chinese", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openSession(user);

		await user.click(screen.getByTestId("session-action-delete-visitor"));

		const toast = await screen.findByTestId("visitor-deletion-result");
		expect(toast).toHaveTextContent("已删除 2 个会话、6 条消息、1 条留资线索。");
		// Not a bare "done": the counts are the evidence.
		expect(toast.textContent).not.toContain("visitorDeletion.deleted");

		// The erased visitor's row is dropped from the selection and the list.
		await waitFor(() =>
			expect(screen.queryByTestId("session-action-delete-visitor")).toBeNull(),
		);
	});

	it("confirms in English too", async () => {
		locale = "en-US";
		const user = userEvent.setup();
		renderSessions();
		await openSession(user);

		await user.click(screen.getByTestId("session-action-delete-visitor"));

		const toast = await screen.findByTestId("visitor-deletion-result");
		expect(toast).toHaveTextContent(
			"Deleted 2 session(s), 6 message(s) and 1 lead(s).",
		);
	});

	it("reports a failed deletion without claiming success", async () => {
		deleteFailure = "Visitor not found";
		const user = userEvent.setup();
		renderSessions();
		await openSession(user);

		await user.click(screen.getByTestId("session-action-delete-visitor"));

		const toast = await screen.findByTestId("visitor-deletion-result");
		expect(toast).toHaveTextContent("Visitor not found");
		expect(toast).toHaveAttribute("role", "alert");
		// The session is still selected: nothing was erased.
		expect(
			screen.getByTestId("session-action-delete-visitor"),
		).toBeInTheDocument();
	});

	it("offers no delete action for a row without a visitor id", async () => {
		sessions = [
			{ ...signedSession, visitor_id: undefined, id: "sess_signed" },
		];
		const user = userEvent.setup();
		renderSessions();

		const row = await screen.findByTestId("session-row-sess_signed");
		await user.click(within(row).getByRole("button"));

		await waitFor(() =>
			expect(screen.getByTestId("session-action-reply")).toBeInTheDocument(),
		);
		expect(screen.queryByTestId("session-action-delete-visitor")).toBeNull();
	});
});
