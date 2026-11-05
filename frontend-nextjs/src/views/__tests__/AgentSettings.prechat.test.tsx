// @vitest-environment jsdom
/**
 * #73 (console half) — the prechat form policy and the AI disclosure are
 * editable from the agent settings page.
 *
 * Both fields already round-trip in the API (`AgentConfig.prechat_mode` /
 * `.ai_disclosure` and the same pair on `AgentUpdateRequest`), so the only
 * missing surface was the console. Pinned here:
 *
 *  1. both controls render, with the stored values;
 *  2. `optional` / `required` are selectable, and the hint follows the choice;
 *  3. saving sends `prechat_mode` + `ai_disclosure` through `api.updateAgent`
 *     (there is no dedicated sub-route for them, unlike fixed facts);
 *  4. an empty disclosure box clears the line (`null`), it does not send `''`.
 */
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import AgentSettings from "../AgentSettings";
import { api } from "../../services/api";
import type { Agent } from "../../services/api";

vi.mock("../../context/AuthContext", () => ({
	useAuth: () => ({
		admin: { id: 1, name: "Owner", email: "owner@example.com", role: "super_admin" },
		logout: vi.fn(),
	}),
}));

vi.mock("../../hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
	useIsTablet: () => false,
	useIsDesktop: () => true,
	useMediaQuery: () => false,
}));

vi.mock("../../services/api", () => ({
	api: {
		getAgent: vi.fn(),
		getDefaultAgent: vi.fn(),
		updateAgent: vi.fn(),
		updateFixedFacts: vi.fn(),
		listProcedures: vi.fn(),
		createProcedure: vi.fn(),
		updateProcedure: vi.fn(),
		deleteProcedure: vi.fn(),
		getPublicOrigin: vi.fn(),
	},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, unknown>) =>
			params && Object.keys(params).length > 0
				? `${key}|${JSON.stringify(params)}`
				: key,
	}),
}));

const mockedApi = vi.mocked(api);

const baseAgent: Agent = {
	id: "agt_1",
	name: "Support Bot",
	system_prompt: "prompt",
	model: "deepseek-chat",
	temperature: 0.7,
	max_tokens: 1024,
	top_k: 8,
	similarity_threshold: 0.01,
	enable_context: true,
	is_active: true,
	created_at: "2026-01-01T00:00:00Z",
	widget_title: "Helpdesk",
	widget_color: "#00aaff",
	welcome_message: "Hello there",
	history_days: 30,
	allowed_widget_origins: ["https://example.com"],
	rate_limit_per_minute: 10,
	restricted_reply: "",
	fixed_facts: "",
	business_hours: null,
	away_message: null,
	display_mode: "bubble",
	inline_container: null,
	excluded_paths: [],
	traffic_percentage: 100,
	starters: [],
	widget_cards: [],
	webhook_url: null,
	webhook_secret_set: false,
	prechat_mode: "optional",
	ai_disclosure: "You are chatting with an AI assistant.",
};

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.getAgent.mockResolvedValue({ ...baseAgent });
	mockedApi.listProcedures.mockResolvedValue({ items: [], total: 0 } as never);
	mockedApi.getPublicOrigin.mockResolvedValue("https://example.com" as never);
});

afterEach(() => {
	cleanup();
});

function renderAgentSettings() {
	const router = createMemoryRouter(
		[{ path: "/agents/:agentId/settings/agent", element: <AgentSettings /> }],
		{ initialEntries: ["/agents/agt_1/settings/agent"] },
	);
	return render(<RouterProvider router={router} />);
}

describe("#73 agent settings — prechat form and AI disclosure", () => {
	it("renders both controls from the stored agent payload", async () => {
		renderAgentSettings();

		const mode = await screen.findByTestId("prechat-mode");
		expect(mode).toHaveValue("optional");

		const disclosure = screen.getByTestId("agent-ai-disclosure");
		expect(disclosure).toHaveValue("You are chatting with an AI assistant.");

		// All three policies are offered — off is not the only way out.
		const options = Array.from(
			(mode as HTMLSelectElement).options,
		).map((option) => option.value);
		expect(options).toEqual(["off", "optional", "required"]);
	});

	it("saves prechat_mode and ai_disclosure through the agent update", async () => {
		const user = userEvent.setup();
		mockedApi.updateAgent.mockResolvedValue({
			...baseAgent,
			prechat_mode: "required",
			ai_disclosure: "This is an AI. A human can step in.",
		});

		renderAgentSettings();

		const mode = await screen.findByTestId("prechat-mode");
		await user.selectOptions(mode, "required");

		const disclosure = screen.getByTestId("agent-ai-disclosure");
		await user.clear(disclosure);
		await user.type(disclosure, "This is an AI. A human can step in.");

		await user.click(screen.getByTestId("prechat-save"));

		await waitFor(() =>
			expect(mockedApi.updateAgent).toHaveBeenCalledWith(
				"agt_1",
				expect.objectContaining({
					prechat_mode: "required",
					ai_disclosure: "This is an AI. A human can step in.",
				}),
			),
		);
	});

	it("clears the disclosure with null, not an empty string", async () => {
		const user = userEvent.setup();
		mockedApi.updateAgent.mockResolvedValue({
			...baseAgent,
			prechat_mode: "off",
			ai_disclosure: null,
		});

		renderAgentSettings();

		const disclosure = await screen.findByTestId("agent-ai-disclosure");
		await user.clear(disclosure);
		await user.click(screen.getByTestId("prechat-save"));

		await waitFor(() =>
			expect(mockedApi.updateAgent).toHaveBeenCalledWith(
				"agt_1",
				expect.objectContaining({ ai_disclosure: null }),
			),
		);
	});
});
