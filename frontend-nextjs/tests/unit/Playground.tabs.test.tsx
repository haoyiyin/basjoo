// @vitest-environment jsdom
/**
 * R2 — the playground is one route with two tabs.
 *
 * The behavioural contract: exactly one pane is mounted (not hidden with CSS),
 * the tab lives in `?tab=settings|chat` (default chat) and survives a reload,
 * switching writes it back to the URL, and the tab strip is arrow-key driven.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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

const agent: Agent = {
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
	api_key_set: true,
};

function LocationProbe() {
	const location = useLocation();
	return <div data-testid="location-search">{location.search}</div>;
}

function renderPlayground(entry = "/agents/agt_1/playground") {
	render(
		<MemoryRouter initialEntries={[entry]}>
			<Routes>
				<Route
					path="/agents/:agentId/playground"
					element={
						<>
							<Playground />
							<LocationProbe />
						</>
					}
				/>
			</Routes>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.getAgent.mockResolvedValue(agent);
	Element.prototype.scrollIntoView = vi.fn();
});

describe("Playground tabs (R2)", () => {
	it("defaults to the chat tab with the settings form absent from the DOM", async () => {
		renderPlayground();

		await screen.findByTestId("playground-pane-chat");
		expect(screen.getByTestId("chat-message-input")).toBeInTheDocument();
		expect(screen.queryByTestId("playground-pane-settings")).not.toBeInTheDocument();
		expect(screen.queryByTestId("ai-settings-form")).not.toBeInTheDocument();
		expect(screen.getByRole("tab", { selected: true })).toHaveAttribute(
			"id",
			"playground-tab-chat",
		);
	});

	it("honours ?tab=settings on load", async () => {
		renderPlayground("/agents/agt_1/playground?tab=settings");

		await screen.findByTestId("playground-pane-settings");
		expect(screen.getByTestId("ai-settings-form")).toBeInTheDocument();
		expect(screen.queryByTestId("playground-pane-chat")).not.toBeInTheDocument();
		expect(screen.queryByTestId("chat-message-input")).not.toBeInTheDocument();
		expect(screen.getByTestId("location-search")).toHaveTextContent(
			"?tab=settings",
		);
	});

	it("treats an unknown ?tab= value as the chat default", async () => {
		renderPlayground("/agents/agt_1/playground?tab=bogus");

		await screen.findByTestId("playground-pane-chat");
		expect(screen.getByRole("tab", { selected: true })).toHaveAttribute(
			"id",
			"playground-tab-chat",
		);
	});

	it("swaps the mounted pane and writes the tab to the URL", async () => {
		renderPlayground();

		await screen.findByTestId("playground-pane-chat");
		fireEvent.click(screen.getByRole("tab", { name: "playground.tabSettings" }));

		await waitFor(() => {
			expect(screen.getByTestId("playground-pane-settings")).toBeInTheDocument();
		});
		// The chat pane is unmounted, not merely hidden.
		expect(screen.queryByTestId("playground-pane-chat")).not.toBeInTheDocument();
		expect(screen.queryByTestId("chat-message-input")).not.toBeInTheDocument();
		expect(screen.getByTestId("location-search")).toHaveTextContent(
			"?tab=settings",
		);

		fireEvent.click(screen.getByRole("tab", { name: "playground.tabChat" }));

		await waitFor(() => {
			expect(screen.getByTestId("playground-pane-chat")).toBeInTheDocument();
		});
		expect(screen.queryByTestId("ai-settings-form")).not.toBeInTheDocument();
		expect(screen.getByTestId("location-search")).toHaveTextContent("?tab=chat");
	});

	it("moves between tabs with the arrow keys", async () => {
		renderPlayground("/agents/agt_1/playground?tab=settings");

		const settingsTab = await screen.findByRole("tab", {
			name: "playground.tabSettings",
		});
		settingsTab.focus();
		fireEvent.keyDown(settingsTab, { key: "ArrowRight" });

		await waitFor(() => {
			expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(
				"playground.tabChat",
			);
		});
		expect(screen.getByRole("tab", { selected: true })).toHaveFocus();

		fireEvent.keyDown(screen.getByRole("tab", { name: "playground.tabChat" }), {
			key: "ArrowLeft",
		});
		await waitFor(() => {
			expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(
				"playground.tabSettings",
			);
		});
	});
});
