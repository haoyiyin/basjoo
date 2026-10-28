// @vitest-environment jsdom
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

describe("Playground API key gate (#19)", () => {
	it("shows the configure-API-key banner and never opens the SSE stream without a key", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		mockedApi.getAgent.mockResolvedValue({ ...baseAgent, api_key_set: false });

		renderPlayground();

		// Desktop two-pane layout: the settings rail owns the missing-key alert,
		// so the chat pane must NOT repeat it. (The narrow, tabbed layout mounts
		// only the chat pane and does show it there — covered by
		// mobileLayout.test.tsx "keeps the no-API-key banner".)
		await waitFor(() =>
			expect(mockedApi.getAgent).toHaveBeenCalled(),
		);
		expect(
			screen.queryByText("labels.pleaseConfigureApiKey"),
		).not.toBeInTheDocument();

		const input = screen.getByTestId("chat-message-input");
		fireEvent.change(input, { target: { value: "hello there" } });
		// Both activation paths: the (disabled) send button and Enter in the box.
		fireEvent.click(screen.getByRole("button", { name: "buttons.send" }));
		fireEvent.keyDown(input, { key: "Enter" });

		// Give any stray async send a tick to start before asserting.
		await waitFor(() => {
			expect(mockedApi.streamChat).not.toHaveBeenCalled();
		});
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(input).toHaveValue("hello there");
		fetchSpy.mockRestore();
	});

	it("disables the send control when the agent has no API key", async () => {
		mockedApi.getAgent.mockResolvedValue({ ...baseAgent, api_key_set: false });

		renderPlayground();

		const input = await screen.findByTestId("chat-message-input");
		fireEvent.change(input, { target: { value: "hello there" } });

		expect(screen.getByRole("button", { name: "buttons.send" })).toBeDisabled();
	});

	it("disables the send control while the agent is still loading (apiKeySet === null)", async () => {
		// Never resolves: the agent stays `undefined` and apiKeySet stays null.
		mockedApi.getAgent.mockReturnValue(new Promise<Agent>(() => {}));

		renderPlayground();

		const input = await screen.findByTestId("chat-message-input");
		// Non-empty input, so the only thing that can disable send is the gate.
		fireEvent.change(input, { target: { value: "hello there" } });

		expect(screen.getByRole("button", { name: "buttons.send" })).toBeDisabled();
	});

	it("does not show the banner and keeps send enabled when the key is configured", async () => {
		mockedApi.getAgent.mockResolvedValue({ ...baseAgent, api_key_set: true });

		renderPlayground();

		const input = await screen.findByTestId("chat-message-input");
		await waitFor(() => {
			expect(
				screen.queryByText("labels.pleaseConfigureApiKey"),
			).not.toBeInTheDocument();
		});
		fireEvent.change(input, { target: { value: "hello there" } });
		expect(screen.getByRole("button", { name: "buttons.send" })).toBeEnabled();
	});
});
