// @vitest-environment jsdom
/**
 * Playground layout contract, in two halves.
 *
 * Tabbed (<= 1024px, the two-column breakpoint in `src/index.css`): exactly one
 * pane is mounted (not hidden with CSS), the tab lives in `?tab=settings|chat`
 * (default chat) and survives a reload, switching writes it back to the URL, and
 * the strip is arrow-key driven.
 *
 * Desktop (>= 1025px): both panes are mounted at once — settings left, chat
 * right. The tab strip stays in the DOM (the tabbed contract) but is hidden, the
 * panes are `region`s labelled by their own heading (no `tabpanel`), and
 * `?tab=` hides nothing.
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

const mediaState = vi.hoisted(() => ({ isNarrow: false }));

vi.mock("../../src/hooks/useMediaQuery", () => ({
	// The playground reads its own `max-width: 1024px` query, not `useIsMobile`.
	useMediaQuery: () => mediaState.isNarrow,
	useIsMobile: () => mediaState.isNarrow,
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

describe("Playground panes (desktop, >= 1025px)", () => {
	beforeEach(() => {
		mediaState.isNarrow = false;
	});

	it("mounts both panes and hides the tab strip", async () => {
		renderPlayground();

		await screen.findByTestId("playground-pane-chat");
		expect(screen.getByTestId("playground-pane-settings")).toBeInTheDocument();
		expect(screen.getByTestId("ai-settings-form")).toBeInTheDocument();
		expect(screen.getByTestId("chat-message-input")).toBeInTheDocument();

		// Still in the DOM for the tabbed contract, hidden visually and from the
		// a11y tree (jsdom has no cascade, so the inline declaration is the proof).
		expect(screen.getByTestId("playground-tabs")).toHaveStyle({
			display: "none",
		});
	});

	it("renders the panes as regions labelled by their heading, never as tabpanels", async () => {
		renderPlayground();

		await screen.findByTestId("playground-pane-chat");
		expect(screen.queryAllByRole("tabpanel", { hidden: true })).toHaveLength(0);

		expect(
			screen.getByRole("region", { name: "navigation.aiSettings" }),
		).toBe(screen.getByTestId("playground-pane-settings"));
		expect(screen.getByRole("region", { name: "playground.tabChat" })).toBe(
			screen.getByTestId("playground-pane-chat"),
		);
	});

	it("ignores ?tab=settings — nothing is hidden", async () => {
		renderPlayground("/agents/agt_1/playground?tab=settings");

		await screen.findByTestId("playground-pane-settings");
		expect(screen.getByTestId("playground-pane-chat")).toBeInTheDocument();
		expect(screen.getByTestId("chat-message-input")).toBeInTheDocument();
	});

	it("ignores an unknown ?tab= value", async () => {
		renderPlayground("/agents/agt_1/playground?tab=bogus");

		await screen.findByTestId("playground-pane-chat");
		expect(screen.getByTestId("playground-pane-settings")).toBeInTheDocument();
	});
});

describe("Playground tabs (tabbed, <= 1024px)", () => {
	beforeEach(() => {
		mediaState.isNarrow = true;
	});

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
		expect(screen.getByTestId("playground-tabs")).not.toHaveStyle({
			display: "none",
		});
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
