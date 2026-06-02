// @ts-nocheck
// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AdminLayout from "../../src/components/AdminLayout";
import { api } from "../../src/services/api";

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		admin: {
			id: 1,
			name: "Owner",
			email: "owner@example.com",
			role: "super_admin",
		},
		logout: vi.fn(),
	}),
}));

vi.mock("../../src/hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
}));

vi.mock("../../src/services/api", () => ({
	api: { getAgent: vi.fn() },
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

const mockedApi = vi.mocked(api);

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.getAgent.mockResolvedValue({
		id: "agt_1",
		name: "官网客服",
	} as any);
});

describe("AdminLayout agent brand", () => {
	it("shows the current agent name instead of Basjoo in agent workspaces", async () => {
		const router = createMemoryRouter(
			[
				{
					path: "/agents/:agentId/dashboard",
					element: (
						<AdminLayout>
							<div>Body</div>
						</AdminLayout>
					),
				},
			],
			{ initialEntries: ["/agents/agt_1/dashboard"] },
		);

		render(<RouterProvider router={router} />);

		await waitFor(() => {
			expect(
				screen.getByRole("heading", { name: "官网客服" }),
			).toBeInTheDocument();
		});
		expect(mockedApi.getAgent).toHaveBeenCalledWith("agt_1");
	});
});
