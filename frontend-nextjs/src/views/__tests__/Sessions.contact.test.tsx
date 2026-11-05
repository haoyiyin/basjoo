// @vitest-environment jsdom
/**
 * #72/#73 (console half) — the transcript header names the visitor when the
 * session payload carries a captured contact.
 *
 * `chat_sessions.contact_name` / `.contact_email` are the columns the prechat
 * and offline forms write (see `backend/services/lead_service.py`). The view
 * renders both when they arrive and **nothing** when they do not — it never
 * invents a value.
 *
 * NOTE (deviation recorded in the Lane C report): the admin session LIST
 * payload (`SessionListItem` in `backend/api/v1/schemas.py`) does not echo those
 * two columns yet, so against today's backend this block renders nothing. The
 * assertion below is written against the payload contract the columns already
 * have, not against an invented field.
 */
import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import Sessions from "../Sessions";

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

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, unknown>) =>
			params && Object.keys(params).length > 0
				? `${key}|${JSON.stringify(params)}`
				: key,
	}),
}));

const messages = [
	{
		id: 1,
		role: "user",
		content: "你们几点下班？",
		created_at: "2026-01-01T00:00:00Z",
	},
];

let sessions: Array<Record<string, unknown>> = [];

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	sessions = [
		{
			id: "sess_1",
			session_id: "pub_sess_1",
			visitor_id: "vis_1",
			contact_name: "Dana Visitor",
			contact_email: "dana@example.com",
			status: "active",
			mode: "ai",
			message_count: 1,
			created_at: "2026-01-01T00:00:00Z",
			updated_at: "2026-01-01T00:10:00Z",
			last_message: "你们几点下班？",
		},
	];

	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("/messages")) return jsonResponse(messages);
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

describe("transcript header contact details", () => {
	it("renders the captured name and e-mail when the session carries them", async () => {
		const user = userEvent.setup();
		renderSessions();

		const row = await screen.findByTestId("session-row-sess_1");
		await user.click(within(row).getByRole("button"));

		expect(await screen.findByTestId("session-contact-name")).toHaveTextContent(
			"Dana Visitor",
		);
		expect(screen.getByTestId("session-contact-email")).toHaveTextContent(
			"dana@example.com",
		);
	});

	it("renders neither block when the session carries no contact", async () => {
		sessions = [
			{
				id: "sess_1",
				session_id: "pub_sess_1",
				visitor_id: "vis_1",
				status: "active",
				mode: "ai",
				message_count: 1,
				created_at: "2026-01-01T00:00:00Z",
				updated_at: "2026-01-01T00:10:00Z",
				last_message: "你们几点下班？",
			},
		];

		const user = userEvent.setup();
		renderSessions();

		const row = await screen.findByTestId("session-row-sess_1");
		await user.click(within(row).getByRole("button"));
		await screen.findByTestId("session-action-reply");

		await waitFor(() =>
			expect(screen.queryByTestId("session-contact-name")).toBeNull(),
		);
		expect(screen.queryByTestId("session-contact-email")).toBeNull();
	});
});
