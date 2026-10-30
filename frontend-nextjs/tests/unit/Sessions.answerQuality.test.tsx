// @vitest-environment jsdom
/**
 * #42 — answer-quality signals in the session centre and the dashboard.
 *
 * Three seams are pinned here, all on the real rendered surface:
 *
 *  1. the low-confidence badge (percentage in `mono`) appears on a weak
 *     assistant message and nowhere else;
 *  2. "Add to Q&A" on an unanswered message calls the *existing*
 *     `POST /admin/qa/from-message/{id}` and echoes the created pair;
 *  3. the "未答问题 / Unanswered" chip drives the `unanswered=true` query param.
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

const mockedApi = vi.mocked(api);

const session = {
	id: "sess_1",
	session_id: "sess_1",
	status: "active",
	message_count: 4,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:10:00Z",
	last_message: "我不知道。",
};

const messages = [
	{
		id: 1,
		role: "user",
		content: "你们的退款窗口是多长时间？可以开专票吗？",
		created_at: "2026-01-01T00:00:00Z",
	},
	{
		id: 2,
		role: "assistant",
		content: "我不知道。",
		confidence: 0.21,
		is_unanswered: true,
		created_at: "2026-01-01T00:00:05Z",
	},
	{
		id: 3,
		role: "user",
		content: "你们支持哪些付款方式？",
		created_at: "2026-01-01T00:01:00Z",
	},
	{
		id: 4,
		role: "assistant",
		content: "支持微信、支付宝和银行转账。",
		confidence: 0.88,
		is_unanswered: false,
		created_at: "2026-01-01T00:01:05Z",
	},
];

const fetchedUrls: string[] = [];

beforeEach(() => {
	vi.clearAllMocks();
	fetchedUrls.length = 0;
	mockedApi.dismissUnanswered.mockResolvedValue({ dismissed: true });
	mockedApi.addQaFromMessage.mockResolvedValue({
		qa_item: {
			id: "qa_9",
			kb_id: "kb_1",
			question: "你们的退款窗口是多长时间？可以开专票吗？",
			answer: "我不知道。",
			enabled: true,
			hits: 0,
			last_hit_at: null,
			source: "unanswered",
			source_message_id: 2,
		},
	});

	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			fetchedUrls.push(url);
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

describe("Sessions — answer quality (#42)", () => {
	it("badges only the weak answer, with the percentage in the mono face", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openTranscript(user);

		const badge = await screen.findByTestId("message-confidence-2");
		expect(badge).toHaveClass("badge");
		expect(badge).toHaveClass("badge-warning");
		expect(badge.querySelector(".mono")?.textContent).toBe("21%");

		// The strong answer (0.88) carries no badge at all.
		expect(screen.queryByTestId("message-confidence-4")).toBeNull();
	});

	it("adds an unanswered message to the Q&A index through the existing endpoint", async () => {
		const user = userEvent.setup();
		renderSessions();
		await openTranscript(user);

		// Only the unanswered assistant message offers the action.
		const addToQa = await screen.findByTestId("add-to-qa-2");
		expect(addToQa).toHaveTextContent("unanswered.addToQa");
		expect(screen.queryByTestId("add-to-qa-4")).toBeNull();

		await user.click(addToQa);

		await waitFor(() =>
			expect(mockedApi.addQaFromMessage).toHaveBeenCalledWith(2),
		);
		const toast = await screen.findByTestId("add-to-qa-result");
		expect(toast).toHaveTextContent("unanswered.addedToQa");
		// The created pair is echoed inline, with the question the backend
		// derived from the preceding user message.
		expect(toast).toHaveTextContent("你们的退款窗口是多长时间？可以开专票吗？");

		// Adding the pair is the triage decision: the row leaves the queue and
		// the action disappears, but the message itself is untouched.
		await waitFor(() =>
			expect(mockedApi.dismissUnanswered).toHaveBeenCalledWith(2),
		);
		await waitFor(() =>
			expect(screen.queryByTestId("add-to-qa-2")).toBeNull(),
		);
		expect(screen.getAllByText("我不知道。").length).toBeGreaterThan(0);
	});

	it("surfaces a failed write-back without clearing the message", async () => {
		const user = userEvent.setup();
		mockedApi.addQaFromMessage.mockRejectedValueOnce(new Error("no KB bound"));
		renderSessions();
		await openTranscript(user);

		await user.click(await screen.findByTestId("add-to-qa-2"));

		const toast = await screen.findByTestId("add-to-qa-result");
		expect(toast).toHaveTextContent("no KB bound");
		expect(screen.getByTestId("add-to-qa-2")).toBeInTheDocument();
	});

	it("wires the Unanswered chip to the unanswered query param", async () => {
		const user = userEvent.setup();
		renderSessions();

		const chip = await screen.findByTestId("sessions-filter-unanswered");
		expect(chip).toHaveAttribute("aria-pressed", "false");
		expect(chip).toHaveTextContent("unanswered.filter");

		await user.click(chip);

		await waitFor(() => expect(chip).toHaveAttribute("aria-pressed", "true"));
		await waitFor(() =>
			expect(
				fetchedUrls.some((url) => url.includes("unanswered=true")),
			).toBe(true),
		);
	});

	it("opens already filtered when the dashboard tile links with ?unanswered=1", async () => {
		renderSessions("/agents/agt_1/sessions?unanswered=1");

		const chip = await screen.findByTestId("sessions-filter-unanswered");
		expect(chip).toHaveAttribute("aria-pressed", "true");
		await waitFor(() =>
			expect(
				fetchedUrls.some((url) => url.includes("unanswered=true")),
			).toBe(true),
		);
	});
});
