// @ts-nocheck
// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Dashboard from "../../src/views/Dashboard";
import { api } from "../../src/services/api";

vi.mock("../../src/components/AdminLayout", () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
}));

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		admin: {
			id: 1,
			name: "Owner",
			email: "owner@example.com",
			role: "super_admin",
		},
	}),
}));

vi.mock("../../src/services/api", () => ({
	api: {
		getAgent: vi.fn(),
		getQuota: vi.fn(),
		getSourcesSummary: vi.fn(),
	},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => {
			if (key === "labels.welcome")
				return `欢迎回到 ${options?.agentName} 控制台`;
			return key;
		},
	}),
}));

const mockedApi = vi.mocked(api);

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.getAgent.mockResolvedValue({
		id: "agt_1",
		name: "官网客服",
	} as any);
	mockedApi.getQuota.mockResolvedValue({
		used_urls: 0,
		max_urls: 100,
		used_files: 0,
		max_files: 100,
		used_messages_today: 0,
		max_messages_per_day: 100,
	} as any);
	mockedApi.getSourcesSummary.mockResolvedValue({
		urls: { total: 0, indexed: 0, pending: 0 },
		files: { total: 0, ready: 0, processing: 0 },
		has_pending: false,
	} as any);
});

describe("Dashboard agent scoped navigation", () => {
	it("uses the current agent name in the welcome copy", async () => {
		const router = createMemoryRouter(
			[{ path: "/agents/:agentId/dashboard", element: <Dashboard /> }],
			{ initialEntries: ["/agents/agt_1/dashboard"] },
		);

		render(<RouterProvider router={router} />);

		await waitFor(() => {
			expect(screen.getByText("欢迎回到 官网客服 控制台")).toBeInTheDocument();
		});
	});

	it("routes quick start actions inside the active agent workspace", async () => {
		const router = createMemoryRouter(
			[
				{ path: "/agents/:agentId/dashboard", element: <Dashboard /> },
				{
					path: "/agents/:agentId/playground",
					element: <div>Scoped Playground</div>,
				},
			],
			{ initialEntries: ["/agents/agt_1/dashboard"] },
		);

		render(<RouterProvider router={router} />);

		fireEvent.click(await screen.findByText("navigation.playground"));

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/agents/agt_1/playground");
		});
	});
});
