// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequireAuth } from "../../src/components/RequireAuth";

type MockAdmin = { role: string } | null;

const authState = vi.hoisted(() => ({
	token: String(1) as string | null,
	admin: null as MockAdmin,
	isLoading: false,
}));

const navigateCalls = vi.hoisted((): string[] => []);

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		token: authState.token,
		admin: authState.admin,
		isLoading: authState.isLoading,
	}),
}));

vi.mock("../../src/router/react-router-dom", async () => {
	const React = await import("react");
	return {
		Navigate: ({ to }: { to: string }) => {
			navigateCalls.push(to);
			return React.createElement("div", null, `navigate:${to}`);
		},
		useLocation: () => ({ pathname: "/", search: "" }),
	};
});

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
	navigateCalls.length = 0;
	authState.token = String(1);
	authState.admin = null;
	authState.isLoading = false;
});

describe("RequireAuth pending admin state", () => {
	it("does not redirect when a token exists while admin state is still hydrating", () => {
		render(
			<RequireAuth>
				<div>dashboard home</div>
			</RequireAuth>,
		);

		expect(screen.getByText("status.loading")).toBeInTheDocument();
		expect(screen.queryByText("navigate:/login")).not.toBeInTheDocument();
		expect(navigateCalls).toEqual([]);
	});

	it("renders dashboard content once the super admin object is available", () => {
		authState.admin = { role: "super_admin" };

		render(
			<RequireAuth>
				<div>dashboard home</div>
			</RequireAuth>,
		);

		expect(screen.getByText("dashboard home")).toBeInTheDocument();
		expect(navigateCalls).toEqual([]);
	});
});
