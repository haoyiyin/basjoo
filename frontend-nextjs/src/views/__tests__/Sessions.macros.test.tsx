// @vitest-environment jsdom
/**
 * #74 (console half) — the reply-macro picker inside the session reply
 * composer, and the client-side variable substitution it performs at insert
 * time.
 *
 * The route that backs the picker (`GET /api/v1/admin/macros`) is mocked with a
 * stubbed `fetch` here: the view calls the real `api` service, so the request
 * this test intercepts is the one the shipped console makes.
 *
 * Pinned:
 *  1. inserting a macro fills `{{visitor.name}}`, `{{visitor.email}}` and
 *     `{{session.id}}` from the selected session;
 *  2. `{{operator.name}}` is filled from the signed-in admin;
 *  3. a missing value with `{{x | fallback}}` renders the fallback;
 *  4. a missing value with NO fallback stays the literal `{{x}}`;
 *  5. a macro deleted through the API is gone from the picker on the next open;
 *  6. the picker is searchable (name or body).
 */
import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import Sessions from "../Sessions";
import { api } from "../../services/api";
import type { Macro } from "../../services/api";

vi.mock("../../context/AuthContext", () => ({
	useAuth: () => ({
		token: "test-token",
		admin: { id: 1, name: "Olive Operator" },
		logout: vi.fn(),
	}),
}));

vi.mock("../../hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
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

/**
 * The session carries the captured contact. `contact_name` / `contact_email`
 * are real `chat_sessions` columns; the view renders them only when the payload
 * has them (see Lane C's deviation note about `SessionListItem`).
 */
const session = {
	id: "sess_1",
	session_id: "pub_sess_1",
	visitor_id: "vis_1",
	contact_name: "Dana Visitor",
	contact_email: "dana@example.com",
	status: "active",
	mode: "ai",
	message_count: 2,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:10:00Z",
	last_message: "你们几点下班？",
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

let macros: Macro[] = [];
let deletedIds: string[] = [];

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	deletedIds = [];
	macros = [
		{
			id: "mac_1",
			name: "Greeting",
			body:
				"Hi {{visitor.name}} ({{visitor.email}}), thanks for reaching out. " +
				"Session {{session.id}}, handled by {{operator.name}}.",
		},
		{
			id: "mac_2",
			name: "Phone fallback",
			body: "Call {{visitor.phone | 400-800-1234}} any time.",
		},
		{
			id: "mac_3",
			name: "Literal",
			body: "Unsigned: {{visitor.company}}",
		},
	];

	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? "GET";

			if (url.includes("/admin/macros")) {
				if (method === "DELETE") {
					const id = url.split("/").pop()?.split("?")[0] ?? "";
					deletedIds.push(id);
					macros = macros.filter((macro) => macro.id !== id);
					return jsonResponse({ success: true, deleted: true, id });
				}
				return jsonResponse({ items: macros, total: macros.length });
			}

			if (url.includes("/messages")) return jsonResponse(messages);

			return jsonResponse({ items: [session], total: 1 });
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
	cleanup();
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

/** Open the session, then the reply composer, then the macro picker. */
async function openPicker(user: ReturnType<typeof userEvent.setup>) {
	const row = await screen.findByTestId("session-row-sess_1");
	await user.click(within(row).getByRole("button"));
	await waitFor(() =>
		expect(screen.getByTestId("session-action-reply")).toBeInTheDocument(),
	);
	await user.click(screen.getByTestId("session-action-reply"));
	await screen.findByTestId("session-reply-composer");
	await user.click(screen.getByTestId("session-macro-picker-toggle"));
	await screen.findByTestId("session-macro-picker");
}

describe("#74 reply-macro picker", () => {
	it("inserts a macro with every known variable filled in", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openPicker(user);

		await user.click(await screen.findByTestId("session-macro-mac_1"));

		const composer = screen.getByTestId("session-reply-composer");
		const draft = within(composer).getByLabelText("handoff.replyPlaceholder");
		expect(draft).toHaveValue(
			"Hi Dana Visitor (dana@example.com), thanks for reaching out. " +
				"Session pub_sess_1, handled by Olive Operator.",
		);
		// The insertion closed the picker: it is a one-shot pick.
		expect(screen.queryByTestId("session-macro-picker")).toBeNull();
	});

	it("inserts the macro at the caret, not at the end of the draft", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openPicker(user);

		const composer = screen.getByTestId("session-reply-composer");
		const draft = within(composer).getByLabelText(
			"handoff.replyPlaceholder",
		) as HTMLTextAreaElement;
		await user.type(draft, "HEAD|TAIL");

		// Put the caret between the two words, then insert a macro.
		draft.setSelectionRange(4, 4);
		await user.click(await screen.findByTestId("session-macro-mac_2"));

		await waitFor(() =>
			expect(draft).toHaveValue("HEADCall 400-800-1234 any time.|TAIL"),
		);
	});

	it("renders the {{x | fallback}} value when the variable is missing", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openPicker(user);

		await user.click(await screen.findByTestId("session-macro-mac_2"));

		const draft = within(screen.getByTestId("session-reply-composer")).getByLabelText(
			"handoff.replyPlaceholder",
		);
		expect(draft).toHaveValue("Call 400-800-1234 any time.");
	});

	it("keeps an unresolved variable literal", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openPicker(user);

		await user.click(await screen.findByTestId("session-macro-mac_3"));

		const draft = within(screen.getByTestId("session-reply-composer")).getByLabelText(
			"handoff.replyPlaceholder",
		);
		expect(draft).toHaveValue("Unsigned: {{visitor.company}}");
	});

	it("drops a deleted macro out of the picker", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openPicker(user);

		// Delete through the SAME service the account page uses; the stubbed
		// fetch drops the row server-side. Re-opening the picker (which refetches)
		// must not show it again.
		await api.deleteMacro("mac_2");
		expect(deletedIds).toEqual(["mac_2"]);

		await user.click(screen.getByTestId("session-macro-picker-toggle"));
		await user.click(screen.getByTestId("session-macro-picker-toggle"));

		await waitFor(() =>
			expect(screen.queryByTestId("session-macro-mac_2")).toBeNull(),
		);
		expect(screen.getByTestId("session-macro-mac_1")).toBeInTheDocument();
	});

	it("narrows the list with the search box", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openPicker(user);

		await screen.findByTestId("session-macro-mac_1");
		await user.type(
			screen.getByLabelText("macros.searchPlaceholder"),
			"fallback",
		);

		await waitFor(() =>
			expect(screen.queryByTestId("session-macro-mac_1")).toBeNull(),
		);
		expect(screen.getByTestId("session-macro-mac_2")).toBeInTheDocument();
	});
});
