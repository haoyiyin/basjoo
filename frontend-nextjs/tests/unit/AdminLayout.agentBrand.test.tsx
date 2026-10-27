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

	it("drops the agent sidebar 知识库 group so no 网站管理/文件上传 entry remains", async () => {
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

		await screen.findByRole("heading", { name: "官网客服" });

		// The group parent and both children used to render these i18n keys. §13
		// removes the 网站管理/文件上传 children but adds a single agent-scoped
		// 知识库 entry pointing at `/agents/:id/knowledge`.
		expect(
			screen.getByRole("link", { name: "navigation.knowledge" }),
		).toHaveAttribute("href", "/agents/agt_1/knowledge");
		expect(
			screen.queryByText("navigation.urlKnowledge"),
		).not.toBeInTheDocument();
		expect(
			screen.queryByText("navigation.fileManagement"),
		).not.toBeInTheDocument();
		// No anchor may point at the removed agent-scoped source routes.
		const hrefs = screen
			.queryAllByRole("link")
			.map((link) => link.getAttribute("href") ?? "");
		expect(hrefs.filter((href) => /\/urls|\/files$/.test(href))).toEqual([]);
	});

	it("keeps the workspace 知识库列表 entry", async () => {
		const router = createMemoryRouter(
			[
				{
					path: "/",
					element: (
						<AdminLayout>
							<div>Body</div>
						</AdminLayout>
					),
				},
			],
			{ initialEntries: ["/"] },
		);

		render(<RouterProvider router={router} />);

		await waitFor(() => {
			expect(
				screen.getByText("navigation.knowledgeBases"),
			).toBeInTheDocument();
		});
	});
});
