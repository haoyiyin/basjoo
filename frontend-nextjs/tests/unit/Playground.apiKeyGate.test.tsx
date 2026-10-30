// @vitest-environment jsdom
/**
 * #66 — the Playground no longer walls a keyless agent.
 *
 * Before this wave a `!apiKeySet` check sat in `handleSendMessage` and
 * `sendDisabled={apiKeySet !== true}` sat on the composer, so an operator could
 * not exercise a keyword-only agent at all. The backend now serves the keyword
 * path for `preview: true`, so the gate is *inverted* into a banner:
 *
 * 1. the banner is persistent above the transcript and says what is answering;
 * 2. the stream opens anyway (`preview: true` still travels);
 * 3. the banner disappears as soon as `api_key_set` flips to true.
 *
 * The old assertions ("never opens the SSE stream", "send is disabled") are the
 * behaviours this issue deletes, so they are inverted here rather than dropped.
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
	deleted_at: null,
	created_at: "2026-01-01T00:00:00Z",
};

function renderPlayground() {
	const router = (
		<MemoryRouter initialEntries={["/agents/agt_1/playground"]}>
			<Routes>
				<Route path="/agents/:agentId/playground" element={<Playground />} />
			</Routes>
		</MemoryRouter>
	);
	render(router);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.streamChat.mockResolvedValue(undefined);
	// jsdom has no layout: ChatPanel scrolls the message list on every update.
	Element.prototype.scrollIntoView = vi.fn();
});

describe("Playground keyless agent (#66)", () => {
	it("shows the not-configured banner and still opens the SSE stream", async () => {
		mockedApi.getAgent.mockResolvedValue({ ...baseAgent, api_key_set: false });

		renderPlayground();

		// The banner is what replaces the gate: it names the real behaviour.
		const banner = await screen.findByTestId("playground-no-model-banner");
		expect(banner).toHaveTextContent("playground.noModelBanner");
		// The action is a real link to the model settings tab, not a dead button:
		// an operator can open it in a new tab, and its target is inspectable.
		const action = screen.getByTestId("playground-no-model-banner-action");
		expect(action).toHaveTextContent("playground.noModelBannerAction");
		expect(action).toHaveAttribute("href", "?tab=settings");

		const input = screen.getByTestId("chat-message-input");
		fireEvent.change(input, { target: { value: "hello there" } });
		fireEvent.click(screen.getByRole("button", { name: "buttons.send" }));

		// Inverted: the stream is allowed now, and it is still a preview turn.
		await waitFor(() => expect(mockedApi.streamChat).toHaveBeenCalled());
		const request = mockedApi.streamChat.mock.calls[0][0];
		expect(request.preview).toBe(true);
		expect(request.message).toBe("hello there");
	});

	it("keeps the send control enabled for a keyless agent", async () => {
		mockedApi.getAgent.mockResolvedValue({ ...baseAgent, api_key_set: false });

		renderPlayground();

		const input = await screen.findByTestId("chat-message-input");
		fireEvent.change(input, { target: { value: "hello there" } });

		expect(
			screen.getByRole("button", { name: "buttons.send" }),
		).toBeEnabled();
	});

	it("does not show the banner when the key is configured", async () => {
		mockedApi.getAgent.mockResolvedValue({ ...baseAgent, api_key_set: true });

		renderPlayground();

		await screen.findByTestId("chat-message-input");
		await waitFor(() => expect(mockedApi.getAgent).toHaveBeenCalled());
		expect(
			screen.queryByTestId("playground-no-model-banner"),
		).not.toBeInTheDocument();

		fireEvent.change(screen.getByTestId("chat-message-input"), {
			target: { value: "hello there" },
		});
		expect(
			screen.getByRole("button", { name: "buttons.send" }),
		).toBeEnabled();
	});

	it("drops the banner once a key is saved", async () => {
		// `apiKeySet` is read from `agent.api_key_set`, so the same mount with a
		// saved key must render without the banner. (The save path re-reads the
		// agent, which is what makes the banner vanish in the real UI.)
		mockedApi.getAgent.mockResolvedValue({ ...baseAgent, api_key_set: false });

		const first = render(
			<MemoryRouter initialEntries={["/agents/agt_1/playground"]}>
				<Routes>
					<Route path="/agents/:agentId/playground" element={<Playground />} />
				</Routes>
			</MemoryRouter>,
		);

		expect(
			await screen.findByTestId("playground-no-model-banner"),
		).toBeInTheDocument();
		first.unmount();

		mockedApi.getAgent.mockResolvedValue({ ...baseAgent, api_key_set: true });
		render(
			<MemoryRouter initialEntries={["/agents/agt_1/playground"]}>
				<Routes>
					<Route path="/agents/:agentId/playground" element={<Playground />} />
				</Routes>
			</MemoryRouter>,
		);

		await screen.findByTestId("chat-message-input");
		await waitFor(() =>
			expect(
				screen.queryByTestId("playground-no-model-banner"),
			).not.toBeInTheDocument(),
		);
	});
});
