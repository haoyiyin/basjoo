// @vitest-environment jsdom
/**
 * #44 — the Playground's turns are previews.
 *
 * `ChatRequest.preview` is defaulted to `false` in the schema so every existing
 * caller (the public widget above all) is unchanged; the Playground is the one
 * surface that opts in, because it is the operator's own test conversation and
 * must not eat the daily allowance.
 *
 * The flag is a *request*: the backend honours it only for a valid admin bearer
 * token, so sending it from the console is safe by construction.
 *
 * #62 removed the daily allowance and `degraded`, so the flag no longer means
 * "do not bill me" — it now means "serve the keyword path for a keyless agent
 * regardless of `fallback_mode`" (#66 / D2, D3). The request assertion is the
 * same; the degraded-notice assertion at the bottom is inverted, because the
 * notice and the `degraded`/`model` fields on the `done` event are gone.
 */
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import Playground from "../../src/views/Playground";
import { api } from "../../src/services/api";
import type { Agent } from "../../src/services/api";

vi.mock("../../src/services/api", () => ({
	api: {
		getAgent: vi.fn(),
		streamChat: vi.fn(),
	},
}));

vi.mock("../../src/hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
	useMediaQuery: () => false,
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "en" },
	}),
}));

vi.mock("../../src/components/AdminLayout", () => ({
	default: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="admin-layout">{children}</div>
	),
}));

vi.mock("../../src/components/AISettingsForm", () => ({
	default: () => <div data-testid="ai-settings-form" />,
}));

const mockedApi = vi.mocked(api);

const baseAgent: Agent = {
	id: "agt_1",
	name: "Support Bot",
	system_prompt: "prompt",
	model: "gpt-4o-mini",
	temperature: 0.7,
	max_tokens: 1024,
	top_k: 5,
	similarity_threshold: 0.01,
	enable_context: true,
	is_active: true,
	api_key_set: true,
	deleted_at: null,
	created_at: "2026-01-01T00:00:00Z",
};

function renderPlayground() {
	render(
		<MemoryRouter initialEntries={["/agents/agt_1/playground"]}>
			<Routes>
				<Route path="/agents/:agentId/playground" element={<Playground />} />
			</Routes>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.getAgent.mockResolvedValue(baseAgent);
	// Resolve `onDone` immediately so the stream finalises.
	mockedApi.streamChat.mockImplementation(async (_request, callbacks) => {
		callbacks.onSources([]);
		callbacks.onContent("preview answer");
		callbacks.onDone({
			message_id: 1,
			session_id: "sess_1",
			usage: null,
			taken_over: false,
		});
	});
	Element.prototype.scrollIntoView = vi.fn();
});

describe("Playground previews (#44, #62, #66)", () => {
	it("sends preview: true on every streamed turn", async () => {
		renderPlayground();

		const input = await screen.findByTestId("chat-message-input");
		fireEvent.change(input, { target: { value: "does the playground bill me?" } });
		fireEvent.click(screen.getByRole("button", { name: "buttons.send" }));

		await waitFor(() => expect(mockedApi.streamChat).toHaveBeenCalled());
		const request = mockedApi.streamChat.mock.calls[0][0];
		expect(request.preview).toBe(true);
		expect(request.agent_id).toBe("agt_1");
		expect(request.message).toBe("does the playground bill me?");
	});

	it("renders no degraded notice — the fallback model is gone (#62)", async () => {
		// Inverted from the #44 assertion. A `done` event may not carry
		// `degraded`/`model` any more, so a turn that used the keyword path is
		// an ordinary answer with no annotation above it.
		mockedApi.streamChat.mockImplementation(async (_request, callbacks) => {
			callbacks.onSources([]);
			callbacks.onContent("keyword answer");
			callbacks.onDone({
				message_id: 2,
				session_id: "sess_1",
				usage: null,
				taken_over: false,
			});
		});

		renderPlayground();

		const input = await screen.findByTestId("chat-message-input");
		fireEvent.change(input, { target: { value: "after the limit?" } });
		fireEvent.click(screen.getByRole("button", { name: "buttons.send" }));

		await waitFor(() =>
			expect(screen.getByText("keyword answer")).toBeInTheDocument(),
		);
		expect(screen.queryByText(/chat\.degradedNotice/)).not.toBeInTheDocument();
	});
});
