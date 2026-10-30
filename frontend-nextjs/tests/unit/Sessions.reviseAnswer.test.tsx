// @vitest-environment jsdom
/**
 * #39 issue item 4 — "Revise answer" in the session transcript.
 *
 * The action sits on assistant messages only. It opens a sheet prefilled with
 * the current answer and posts `/admin/sessions/{id}/revise-answer`; the
 * correction becomes a curated pair on the agent's KB, so the confirmation has
 * to say so. These checks pin the wiring, not the prose.
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
		reviseAnswer: vi.fn(),
		// AdminLayout's agent switcher reads the agent list.
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

const mockedApi = vi.mocked(api);

const session = {
	id: "sess_1",
	session_id: "sess_1",
	status: "active",
	message_count: 2,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:10:00Z",
	last_message: "Refunds take 30 days.",
};

const messages = [
	{
		id: 1,
		role: "user",
		content: "How long is your refund window?",
		created_at: "2026-01-01T00:00:00Z",
	},
	{
		id: 2,
		role: "assistant",
		content: "Refunds take 30 days.",
		created_at: "2026-01-01T00:00:05Z",
	},
];

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.reviseAnswer.mockResolvedValue({
		qa_item: {
			id: "qa_1",
			kb_id: "kb_1",
			question: "How long is your refund window?",
			answer: "Refunds are accepted within 14 days of delivery.",
			enabled: true,
			hits: 0,
			last_hit_at: null,
			source: "revise",
			source_message_id: 1,
		},
		replaced: false,
	});

	// The view talks to the admin API with raw fetch; only the session list and
	// the transcript matter here.
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
			return new Response(
				JSON.stringify({ items: [session], total: 1 }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}),
	);
	// jsdom has no layout: the transcript scrolls itself on every message update.
	Element.prototype.scrollIntoView = vi.fn();
	// jsdom has no WebSocket server; the view tolerates the failure.
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

describe("Sessions — revise answer", () => {
	it("offers the action on the assistant message only", async () => {
		const user = userEvent.setup();
		renderSessions();

		const row = await screen.findByTestId("session-row-sess_1");
		await user.click(within(row).getByRole("button"));

		await waitFor(() =>
			expect(document.body.textContent).toContain("How long is your refund"),
		);
		const revise = await screen.findByTestId("revise-answer-2");
		expect(revise).toHaveTextContent("reviseAnswer.action");
		expect(screen.queryByTestId("revise-answer-1")).toBeNull();
	});

	it("opens a sheet prefilled with the answer and posts the correction", async () => {
		const user = userEvent.setup();
		renderSessions();

		const row = await screen.findByTestId("session-row-sess_1");
		await user.click(within(row).getByRole("button"));
		await user.click(await screen.findByTestId("revise-answer-2"));

		const sheet = await screen.findByTestId("revise-answer-sheet");
		const textarea = within(sheet).getByLabelText("reviseAnswer.label");
		expect(textarea).toHaveValue("Refunds take 30 days.");

		await user.clear(textarea);
		await user.type(
			textarea,
			"Refunds are accepted within 14 days of delivery.",
		);
		await user.click(
			within(sheet).getByRole("button", { name: "reviseAnswer.submit" }),
		);

		await waitFor(() =>
			expect(mockedApi.reviseAnswer).toHaveBeenCalledWith(
				"sess_1",
				"Refunds are accepted within 14 days of delivery.",
			),
		);
		expect(
			await screen.findByTestId("revise-answer-saved"),
		).toHaveTextContent("reviseAnswer.saved");
		expect(screen.queryByTestId("revise-answer-sheet")).toBeNull();
	});

	it("blocks an empty correction without calling the API", async () => {
		const user = userEvent.setup();
		renderSessions();

		const row = await screen.findByTestId("session-row-sess_1");
		await user.click(within(row).getByRole("button"));
		await user.click(await screen.findByTestId("revise-answer-2"));

		const sheet = await screen.findByTestId("revise-answer-sheet");
		await user.clear(within(sheet).getByLabelText("reviseAnswer.label"));
		await user.click(
			within(sheet).getByRole("button", { name: "reviseAnswer.submit" }),
		);

		expect(
			await within(sheet).findByText("reviseAnswer.answerRequired"),
		).toBeInTheDocument();
		expect(mockedApi.reviseAnswer).not.toHaveBeenCalled();
	});
});
