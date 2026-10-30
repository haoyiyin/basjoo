// @vitest-environment jsdom
/**
 * #62 — the operator switch for `agent.fallback_mode`, after the fallback model
 * was removed.
 *
 * #44 deleted the "备用模型 / 备用 key" pair and retired two of the four modes
 * with it (D4): `llm` and `llm_then_keyword` no longer exist and an agent that
 * still stores one reads as `off`. These assertions pin the *smaller* surface:
 *
 * 1. the select offers exactly two options, `off` and `keyword`;
 * 2. a stored `keyword` hydrates as `keyword`, a stored retired value hydrates
 *    as `off` (not as itself, and not as `keyword`);
 * 3. changing the mode auto-saves within the existing debounce and the payload
 *    no longer carries `fallback_model` / `fallback_api_key`;
 * 4. the 备用模型 and 备用 API key fields are gone from the form.
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
				"labels.fallbackMode": "模型无法回答时",
				"labels.fallbackModeDesc": "fallback-mode-description",
				"labels.fallbackModeOff": "关闭 — 直接发自动回复",
				"labels.fallbackModeKeyword": "先关键词问答，再自动回复",
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

describe("AISettingsForm fallback mode (#60 / #62)", () => {
	it("hydrates the select from agent.fallback_mode", async () => {
		render(<AISettingsForm agentId="agt_fallback" compact />);

		await screen.findByDisplayValue("You are helpful.");

		// The value the backend persists for this agent must be the value the
		// operator sees; `keyword` here is the whole point of the issue.
		expect(modeSelect()).toHaveValue("keyword");
		expect(modeSelect()).toHaveDisplayValue("先关键词问答，再自动回复");
	});

	it("offers exactly two modes — the fallback-model modes are retired", async () => {
		render(<AISettingsForm agentId="agt_fallback" compact />);

		await screen.findByDisplayValue("You are helpful.");

		// D4: `llm` and `llm_then_keyword` died with the #44 fallback model.
		expect(
			Array.from(modeSelect().options).map((option) => option.value),
		).toEqual(["off", "keyword"]);
		expect(
			Array.from(modeSelect().options).map((option) => option.textContent),
		).toEqual(["关闭 — 直接发自动回复", "先关键词问答，再自动回复"]);
	});

	it("defaults to off when the agent payload omits fallback_mode", async () => {
		const { fallback_mode: _omitted, ...withoutMode } = baseAgent;
		mockedApi.getAgent.mockResolvedValue(withoutMode as never);

		render(<AISettingsForm agentId="agt_fallback" compact />);

		await screen.findByDisplayValue("You are helpful.");

		expect(modeSelect()).toHaveValue("off");
	});

	it("reads a retired llm / llm_then_keyword value as off", async () => {
		for (const retired of ["llm", "llm_then_keyword"]) {
			// A row that still holds one of the retired values: the migration
			// rewrites it to `off`, and this form must not echo the stale
			// string into a select that no longer has that option.
			mockedApi.getAgent.mockResolvedValue({
				...baseAgent,
				fallback_mode: retired,
			} as never);

			const { unmount } = render(
				<AISettingsForm agentId="agt_fallback" compact />,
			);
			await screen.findByDisplayValue("You are helpful.");
			expect(modeSelect()).toHaveValue("off");
			unmount();
		}
	});

	it("saves fallback_mode without any fallback-model payload field", async () => {
		render(<AISettingsForm agentId="agt_fallback" compact />);

		await screen.findByDisplayValue("You are helpful.");
		expect(modeSelect()).toHaveValue("keyword");

		fireEvent.change(modeSelect(), { target: { value: "off" } });

		await waitFor(
			() => {
				expect(mockedApi.updateAgent).toHaveBeenCalled();
			},
			{ timeout: 2000 },
		);

		const [agentId, payload] = mockedApi.updateAgent.mock.calls[0];
		expect(agentId).toBe("agt_fallback");
		expect(payload).toMatchObject({ fallback_mode: "off" });
		// #62: the #44 pair is gone from the wire, not merely hidden.
		expect(payload).not.toHaveProperty("fallback_model");
		expect(payload).not.toHaveProperty("fallback_api_key");
	});

	it("renders no 备用模型 or 备用 API key field", async () => {
		render(<AISettingsForm agentId="agt_fallback" compact />);

		await screen.findByDisplayValue("You are helpful.");

		expect(
			screen.queryByLabelText("labels.fallbackModel"),
		).not.toBeInTheDocument();
		expect(
			screen.queryByLabelText("labels.fallbackApiKey"),
		).not.toBeInTheDocument();
		expect(
			screen.queryByPlaceholderText("labels.fallbackModelDesc"),
		).not.toBeInTheDocument();
	});

	it("shows the miss hint for the keyword mode only", async () => {
		render(<AISettingsForm agentId="agt_fallback" compact />);

		await screen.findByDisplayValue("You are helpful.");

		// `keyword` is armed → the auto-reply miss copy is announced.
		expect(screen.getByText("fallback-mode-miss-hint")).toBeInTheDocument();

		fireEvent.change(modeSelect(), { target: { value: "off" } });

		await waitFor(() => {
			expect(
				screen.queryByText("fallback-mode-miss-hint"),
			).not.toBeInTheDocument();
		});
	});
});
