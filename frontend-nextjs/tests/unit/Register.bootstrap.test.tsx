// @ts-nocheck
// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Register } from "../../src/views/Register";

const registerMock = vi.fn();

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({ register: registerMock }),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
	vi.clearAllMocks();
	registerMock.mockResolvedValue(undefined);
	global.fetch = vi.fn().mockResolvedValue({
		ok: true,
		json: async () => ({ bootstrap_required: true }),
	}) as any;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Register bootstrap flow", () => {
	it("registers the first super admin and enters the agent panel route", async () => {
		const router = createMemoryRouter(
			[
				{ path: "/register", element: <Register /> },
				{ path: "/", element: <div>agents.panelTitle</div> },
				{ path: "/login", element: <div>login page</div> },
			],
			{ initialEntries: ["/register"] },
		);

		render(<RouterProvider router={router} />);

		await screen.findByText("initialSetup.name");
		fireEvent.change(
			screen.getByPlaceholderText("initialSetup.namePlaceholder"),
			{
				target: { value: "Owner" },
			},
		);
		fireEvent.change(
			screen.getByPlaceholderText("initialSetup.emailPlaceholder"),
			{
				target: { value: "owner@example.com" },
			},
		);
		fireEvent.change(
			screen.getByPlaceholderText("initialSetup.passwordPlaceholder"),
			{
				target: { value: "password123" },
			},
		);
		fireEvent.change(
			screen.getByPlaceholderText("initialSetup.confirmPasswordPlaceholder"),
			{
				target: { value: "password123" },
			},
		);

		fireEvent.click(
			screen.getByRole("button", { name: "initialSetup.registerButton" }),
		);

		await waitFor(() => {
			expect(registerMock).toHaveBeenCalledWith(
				"owner@example.com",
				"password123",
				"Owner",
			);
			expect(router.state.location.pathname).toBe("/");
		});
	});
});
