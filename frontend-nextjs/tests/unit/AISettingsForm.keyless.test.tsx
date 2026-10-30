// @vitest-environment jsdom
/**
 * #66 — a keyless agent is an explicit state, not an empty field.
 *
 * Before this wave AISettingsForm rendered the API-key input plus a "please
 * configure an API key first" warning, which read as "the form is broken" and
 * as "nothing works until you paste a key". Neither is true any more: the
 * keyword path answers, so the form names the state and explains what is
 * answering instead. The assertions are inverted from the old ones rather than
 * dropped.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
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
		t: (key: string) => key,
	}),
}));

const mockedApi = vi.mocked(api);

const agent = {
	id: "agt_keyless",
	name: "官网客服",
	system_prompt: "You are helpful.",
	model: "deepseek-chat",
	temperature: 0.7,
	max_tokens: 1024,
	api_key_set: false,
	api_base: "https://api.deepseek.com/v1",
	provider_type: "openai",
	api_format: "openai",
	top_k: 8,
	similarity_threshold: 0.01,
	enable_context: false,
	rate_limit_per_minute: 20,
	restricted_reply: "restricted",
	persona_type: "custom",
};

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.getAgent.mockResolvedValue(agent as never);
	mockedApi.getDefaultAgent.mockResolvedValue(agent as never);
	mockedApi.updateAgent.mockResolvedValue(agent as never);
	mockedApi.testAIApi.mockResolvedValue({
		success: true,
		message: "ok",
	} as never);
});

describe("AISettingsForm keyless agent (#66)", () => {
	it("shows an explicit 未配置模型 state beside the key field", async () => {
		render(<AISettingsForm agentId="agt_keyless" compact />);

		await screen.findByDisplayValue("You are helpful.");

		expect(screen.getByTestId("ai-key-missing")).toHaveTextContent(
			"labels.modelNotConfigured",
		);
		expect(screen.getByTestId("ai-key-missing-hint")).toHaveTextContent(
			"labels.modelNotConfiguredHint",
		);
	});

	it("drops the old 'configure a key first' warning", async () => {
		render(<AISettingsForm agentId="agt_keyless" compact />);

		await screen.findByDisplayValue("You are helpful.");

		// The key itself was retired with #62/#66; the warning it served is gone
		// too, replaced by the state above.
		expect(
			screen.queryByText("labels.pleaseConfigureApiKey"),
		).not.toBeInTheDocument();
	});

	it("keeps the key input editable so a key can still be saved", async () => {
		render(<AISettingsForm agentId="agt_keyless" compact />);

		await screen.findByDisplayValue("You are helpful.");

		const input = screen.getByLabelText("labels.apiKey");
		expect(input).toHaveValue("");
		expect(input).not.toBeDisabled();
	});

	it("does not show the missing state once a key is set", async () => {
		mockedApi.getAgent.mockResolvedValue({
			...agent,
			api_key_set: true,
		} as never);

		render(<AISettingsForm agentId="agt_keyless" compact />);

		await screen.findByDisplayValue("You are helpful.");

		expect(screen.queryByTestId("ai-key-missing")).not.toBeInTheDocument();
		expect(screen.queryByTestId("ai-key-missing-hint")).not.toBeInTheDocument();
	});
});
