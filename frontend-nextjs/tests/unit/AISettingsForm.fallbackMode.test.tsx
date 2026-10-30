// @vitest-environment jsdom
/**
 * #60 — the operator switch for `agent.fallback_mode`.
 *
 * Before this lane nothing in the admin UI ever set `fallback_mode`, so an
 * operator could curate Q&A keywords and still get 429s forever: the backend
 * honours the column, the form never wrote it. These assertions are on what
 * the operator sees and on the exact PUT body the form produces:
 *
 * 1. a saved `keyword` agent hydrates the select with `keyword`;
 * 2. changing it to `llm_then_keyword` auto-saves within the existing
 *    debounce, and the payload carries `fallback_mode: "llm_then_keyword"`;
 * 3. the miss-hint line appears only for the two keyword-armed modes, because
 *    those are the only ones that answer an unmatched message from the
 *    configured `restricted_reply` instead of a 429.
 *
 * Helpers mirror `AISettingsForm.playground.test.tsx` (same api mock, same
 * i18n mock returning keys, same `agent` fixture shape).
 */
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AISettingsForm from "../../src/components/AISettingsForm";
import { api } from "../../src/services/api";

vi.mock("../../src/components/HelpTooltip", () => ({
	__esModule: true,
	default: () => null,
}));

vi.mock("../../src/services/api", () => ({
	api: {
		getAgent: vi.fn(),
		getDefaultAgent: vi.fn(),
		updateAgent: vi.fn(),
		testAIApi: vi.fn(),
	},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"labels.fallbackMode": "额度用尽后的回答方式",
				"labels.fallbackModeDesc": "fallback-mode-description",
				"labels.fallbackModeOff": "关闭（保持现状）",
				"labels.fallbackModeLlm": "仅备用模型",
				"labels.fallbackModeKeyword": "仅关键词问答",
				"labels.fallbackModeLlmThenKeyword": "备用模型 → 关键词",
				"labels.fallbackModeMissHint": "fallback-mode-miss-hint",
			};
			return translations[key] || key;
		},
	}),
}));

const mockedApi = vi.mocked(api);

const baseAgent = {
	id: "agt_fallback",
	name: "官网客服",
	system_prompt: "You are helpful.",
	model: "deepseek-chat",
	temperature: 0.7,
	max_tokens: 1024,
	api_key_set: true,
	api_base: "https://api.deepseek.com/v1",
	provider_type: "openai",
	api_format: "openai",
	top_k: 8,
	similarity_threshold: 0.01,
	enable_context: false,
	rate_limit_per_minute: 20,
	restricted_reply: "抱歉，当前服务受限，请稍后再试。",
	fallback_model: "deepseek-chat-mini",
	fallback_mode: "keyword",
	persona_type: "custom",
};

/** The fallback-mode select is the only one carrying this test id. */
function modeSelect(): HTMLSelectElement {
	const select = screen.getByTestId("fallback-mode-select");
	expect(select.tagName).toBe("SELECT");
	return select as HTMLSelectElement;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.getAgent.mockResolvedValue({ ...baseAgent } as never);
	mockedApi.getDefaultAgent.mockResolvedValue({ ...baseAgent } as never);
	mockedApi.updateAgent.mockResolvedValue({ ...baseAgent } as never);
	mockedApi.testAIApi.mockResolvedValue({
		success: true,
		message: "ok",
	} as never);
});

describe("AISettingsForm fallback mode (#60)", () => {
	it("hydrates the select from agent.fallback_mode", async () => {
		render(<AISettingsForm agentId="agt_fallback" compact />);

		await screen.findByDisplayValue("You are helpful.");

		// The value the backend persists for this agent must be the value the
		// operator sees; `keyword` here is the whole point of the issue.
		expect(modeSelect()).toHaveValue("keyword");
		expect(modeSelect()).toHaveDisplayValue("仅关键词问答");
	});

	it("offers all four modes in the operator's language", async () => {
		render(<AISettingsForm agentId="agt_fallback" compact />);

		await screen.findByDisplayValue("You are helpful.");

		expect(
			Array.from(modeSelect().options).map((option) => option.value),
		).toEqual(["off", "llm", "keyword", "llm_then_keyword"]);
		expect(
			Array.from(modeSelect().options).map((option) => option.textContent),
		).toEqual([
			"关闭（保持现状）",
			"仅备用模型",
			"仅关键词问答",
			"备用模型 → 关键词",
		]);
	});

	it("defaults to off when the agent payload omits fallback_mode", async () => {
		const { fallback_mode: _omitted, ...withoutMode } = baseAgent;
		mockedApi.getAgent.mockResolvedValue(withoutMode as never);

		render(<AISettingsForm agentId="agt_fallback" compact />);

		await screen.findByDisplayValue("You are helpful.");

		expect(modeSelect()).toHaveValue("off");
	});

	it("saves llm_then_keyword in the PATCH/PUT payload after the mode changes", async () => {
		render(<AISettingsForm agentId="agt_fallback" compact />);

		await screen.findByDisplayValue("You are helpful.");
		expect(modeSelect()).toHaveValue("keyword");

		fireEvent.change(modeSelect(), { target: { value: "llm_then_keyword" } });

		await waitFor(
			() => {
				expect(mockedApi.updateAgent).toHaveBeenCalled();
			},
			{ timeout: 2000 },
		);

		const [agentId, payload] = mockedApi.updateAgent.mock.calls[0];
		expect(agentId).toBe("agt_fallback");
		expect(payload).toMatchObject({
			fallback_mode: "llm_then_keyword",
		});
		// The #44 block must not be collateral damage of the new control.
		expect(payload.fallback_model).toBe("deepseek-chat-mini");
	});

	it("shows the miss hint for the keyword-armed modes only", async () => {
		render(<AISettingsForm agentId="agt_fallback" compact />);

		await screen.findByDisplayValue("You are helpful.");

		// `keyword` is armed → the auto-reply miss copy is announced.
		expect(screen.getByText("fallback-mode-miss-hint")).toBeInTheDocument();

		fireEvent.change(modeSelect(), { target: { value: "llm" } });

		await waitFor(() => {
			expect(
				screen.queryByText("fallback-mode-miss-hint"),
			).not.toBeInTheDocument();
		});

		fireEvent.change(modeSelect(), { target: { value: "llm_then_keyword" } });

		await waitFor(() => {
			expect(
				screen.getByText("fallback-mode-miss-hint"),
			).toBeInTheDocument();
		});
	});
});
