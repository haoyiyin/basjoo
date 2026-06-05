// @vitest-environment jsdom
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
				"labels.agentName": "Agent 名称",
				"labels.presetPersona": "预设人设",
				"labels.aiProvider": "AI 服务商",
				"labels.modelName": "模型名称",
			};
			return translations[key] || key;
		},
	}),
}));

const mockedApi = vi.mocked(api);

const agent = {
	id: "agt_1",
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
	restricted_reply: "restricted",
	persona_type: "custom",
};

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.getAgent.mockResolvedValue(agent as any);
	mockedApi.getDefaultAgent.mockResolvedValue(agent as any);
	mockedApi.updateAgent.mockResolvedValue(agent as any);
	mockedApi.testAIApi.mockResolvedValue({
		success: true,
		message: "ok",
	} as any);
});

describe("AISettingsForm Playground fields", () => {
	it("does not render the Agent Name field in 调试区 AI settings", async () => {
		render(<AISettingsForm agentId="agt_1" compact />);

		await screen.findByDisplayValue("You are helpful.");

		expect(screen.queryByText("labels.agentName")).not.toBeInTheDocument();
		expect(screen.queryByText("Agent 名称")).not.toBeInTheDocument();
		expect(screen.queryByDisplayValue("官网客服")).not.toBeInTheDocument();
	});

	it("does not send name in auto-save payload", async () => {
		render(<AISettingsForm agentId="agt_1" compact />);

		const prompt = await screen.findByDisplayValue("You are helpful.");
		fireEvent.change(prompt, { target: { value: "Updated prompt" } });

		await waitFor(
			() => {
				expect(mockedApi.updateAgent).toHaveBeenCalled();
			},
			{ timeout: 2000 },
		);

		expect(mockedApi.updateAgent.mock.calls[0][1]).not.toHaveProperty("name");
	});
});

describe("AISettingsForm DeepSeek defaults", () => {
	it("defaults to deepseek provider when agent data omits provider_type", async () => {
		const agentWithoutProvider = {
			...agent,
			provider_type: undefined,
			model: undefined,
		};
		mockedApi.getAgent.mockResolvedValue(agentWithoutProvider as any);

		render(<AISettingsForm agentId="agt_1" compact />);

		// Wait for the form to load
		await screen.findByDisplayValue("You are helpful.");

		// Check that the provider select has deepseek selected
		const providerSelect = screen.getAllByRole("combobox")[1];
		expect(providerSelect).toHaveValue("deepseek");
	});

	it("defaults to deepseek-v4-flash model when agent data omits model", async () => {
		const agentWithoutModel = {
			...agent,
			provider_type: "deepseek",
			model: undefined,
		};
		mockedApi.getAgent.mockResolvedValue(agentWithoutModel as any);

		render(<AISettingsForm agentId="agt_1" compact />);

		// Wait for the form to load
		await screen.findByDisplayValue("You are helpful.");

		// Check that the model input has deepseek-v4-flash placeholder
		const modelInput = screen.getByPlaceholderText("deepseek-v4-flash");
		expect(modelInput).toBeInTheDocument();
	});

	it("sets model to deepseek-v4-flash when user changes provider to DeepSeek", async () => {
		const openaiAgent = {
			...agent,
			provider_type: "openai_native",
			model: "gpt-4o",
		};
		mockedApi.getAgent.mockResolvedValue(openaiAgent as any);

		render(<AISettingsForm agentId="agt_1" compact />);

		// Wait for the form to load with OpenAI values
		await screen.findByDisplayValue("You are helpful.");

		// Change provider to DeepSeek (second combobox is the provider select)
		const providerSelect = screen.getAllByRole("combobox")[1];
		fireEvent.change(providerSelect, { target: { value: "deepseek" } });

		// Check that the model input now has deepseek-v4-flash as placeholder
		await waitFor(() => {
			const modelInput = screen.getByPlaceholderText("deepseek-v4-flash");
			expect(modelInput).toBeInTheDocument();
		});
	});

	it("preserves saved non-DeepSeek provider and model values", async () => {
		const anthropicAgent = {
			...agent,
			provider_type: "anthropic",
			model: "claude-3-opus",
		};
		mockedApi.getAgent.mockResolvedValue(anthropicAgent as any);

		render(<AISettingsForm agentId="agt_1" compact />);

		// Wait for the form to load
		await screen.findByDisplayValue("You are helpful.");

		// Check that the provider select has anthropic selected
		const providerSelect = screen.getAllByRole("combobox")[1];
		expect(providerSelect).toHaveValue("anthropic");

		// Check that the model input shows the saved model
		const modelInput = screen.getByDisplayValue("claude-3-opus");
		expect(modelInput).toBeInTheDocument();
	});
});
