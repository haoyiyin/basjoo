// @vitest-environment jsdom
/**
 * Follow-up to #72 — the lead inbox is an agent-scoped surface.
 *
 * `/agents/:agentId/leads` lives inside agent scope, so an `admin` member
 * reaches it like any other agent route (`RequireAuth` only gates ROOT paths),
 * while `support` keeps its sessions-only policy and is bounced to that
 * agent's `/sessions`. Both are pinned here because the membership check itself
 * is the backend's — the shell's job is only to not get in the way (and to not
 * open a door support never had).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequireAuth } from "../../src/components/RequireAuth";

const authState = vi.hoisted(() => ({
	token: "token" as string | null,
	admin: null as { role: string } | null,
	isLoading: false,
}));

const locationState = vi.hoisted(() => ({ pathname: "/agents/agt_1/leads" }));

const navigateCalls = vi.hoisted((): string[] => []);

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		token: authState.token,
		admin: authState.admin,
		isLoading: authState.isLoading,
	}),
}));

vi.mock("react-router-dom", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-router-dom")>();
	return {
		...actual,
		Navigate: ({ to }: { to: string }) => {
			navigateCalls.push(to);
			return React.createElement("div", null, `navigate:${to}`);
		},
		useLocation: () => ({
			pathname: locationState.pathname,
			search: "",
			state: null,
			key: "default",
			hash: "",
		}),
	};
});

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
	navigateCalls.length = 0;
	authState.token = "token";
	authState.isLoading = false;
	authState.admin = { role: "admin" };
	locationState.pathname = "/agents/agt_1/leads";
});

describe("RequireAuth — agent-scoped lead inbox", () => {
	it("renders the inbox for an agent-scoped admin at /agents/:id/leads", () => {
		render(
			<RequireAuth>
				<div>lead inbox</div>
			</RequireAuth>,
		);

		expect(screen.getByText("lead inbox")).toBeInTheDocument();
		expect(navigateCalls).toEqual([]);
	});

	it("redirects support from /agents/:id/leads to that agent's sessions (sessions-only policy)", () => {
		authState.admin = { role: "support" };

		render(
			<RequireAuth>
				<div>lead inbox</div>
			</RequireAuth>,
		);

		expect(screen.queryByText("lead inbox")).not.toBeInTheDocument();
		// `setMounted` re-renders once, so the redirect is observed twice; what
		// matters is that every navigation goes to that agent's sessions.
		expect(navigateCalls.length).toBeGreaterThan(0);
		expect(navigateCalls.every((to) => to === "/agents/agt_1/sessions")).toBe(
			true,
		);
	});
});
