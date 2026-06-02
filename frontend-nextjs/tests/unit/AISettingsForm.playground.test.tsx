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
