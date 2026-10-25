// @ts-nocheck
// @vitest-environment jsdom
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KbFormModal from "../../src/components/KbFormModal";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key) => key }),
}));

vi.mock("../../src/services/api", () => ({
	api: { testEmbeddingConfig: vi.fn(async () => ({ success: true, dimension: 384, message: "ok" })) },
}));

describe("KbFormModal local provider", () => {
	beforeEach(() => vi.clearAllMocks());

	it("hides the API key, allows the connectivity test, submits without a key", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn(async () => {});
		render(<KbFormModal mode="create" onSubmit={onSubmit} onClose={() => {}} />);

		const modal = screen.getByTestId("kb-form-modal");
		await user.selectOptions(within(modal).getByLabelText("kbForm.provider"), "local");

		// API key input is hidden for the bundled local provider
		expect(within(modal).queryByLabelText("kbForm.apiKey")).not.toBeInTheDocument();
		// model prefilled from PROVIDER_DEFAULT_MODELS.local
		expect(
			within(modal).getByLabelText("kbForm.model"),
		).toHaveValue("ibm-granite/granite-embedding-97m-multilingual-r2");
		// base URL hidden (only custom requires it)
		expect(
			within(modal).queryByLabelText("kbForm.baseUrl"),
		).not.toBeInTheDocument();
		// test button is not key-dependent
		const testButton = within(modal).getByRole("button", {
			name: "kbForm.testConnection",
		});
		expect(testButton).toBeEnabled();

		await user.type(within(modal).getByLabelText("kbForm.name"), "Local KB");
		await user.click(within(modal).getByRole("button", { name: "kbForm.createSubmit" }));

		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Local KB",
				embedding_provider: "local",
				embedding_api_key: "",
				embedding_base_url: null,
			}),
		);
	});

	it("still requires an API key for custom providers", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn(async () => {});
		render(<KbFormModal mode="create" onSubmit={onSubmit} onClose={() => {}} />);

		const modal = screen.getByTestId("kb-form-modal");
		await user.selectOptions(within(modal).getByLabelText("kbForm.provider"), "custom");
		await user.type(within(modal).getByLabelText("kbForm.name"), "Custom KB");
		await user.type(
			within(modal).getByLabelText("kbForm.baseUrl"),
			"https://api.example.com/v1",
		);
		await user.click(within(modal).getByRole("button", { name: "kbForm.createSubmit" }));

		expect(onSubmit).not.toHaveBeenCalled();
		expect(screen.getByText("kbForm.apiKeyRequired")).toBeInTheDocument();
	});
});
