// @vitest-environment jsdom
/**
 * Spec §13 (lane SHELL) — shell + navigation contract.
 *
 * react-i18next is not initialised in the unit suites, so `t` echoes the key:
 * every label assertion therefore pins the i18n key, never prose.
 *
 * Covered:
 *   1. workspace (super_admin, root) nav = 首页 / 智能体 / 知识库 / 设置, in order,
 *      and no 会话 / 用户 entry (both routes were deleted from App.tsx);
 *   2. agent scope gains 知识库 at `/agents/:id/knowledge` and keeps the rest;
 *   3. `support` in agent scope still sees only that agent's sessions entry;
 *   4. `KnowledgeBaseSetup`: unbound `/knowledge` is an inline bind PROMPT (not a
 *      redirect), `/urls` + `/files` keep the plain redirect, and a bound agent
 *      forwards to `/knowledge-bases/:kbId`.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminLayout from "../../src/components/AdminLayout";
import KnowledgeBaseSetup from "../../src/views/KnowledgeBaseSetup";
import { api } from "../../src/services/api";
import type { KbStatusPayload } from "../../src/services/api";

/* ------------------------------------------------------------------ mocks */

type Role = "super_admin" | "support" | "admin";

const authState = vi.hoisted(() => ({ role: "super_admin" as string }));

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		admin: {
			id: 1,
			name: "Owner",
			email: "owner@example.com",
			role: authState.role,
		},
		logout: vi.fn(),
	}),
}));

vi.mock("../../src/hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
	useIsTablet: () => false,
	useIsDesktop: () => true,
	useMediaQuery: () => false,
}));

vi.mock("../../src/services/api", () => ({
	api: { getAgent: vi.fn(), kbStatus: vi.fn() },
}));

// Keys verbatim: assertions target i18n keys, not prose.
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

const mockedApi = vi.mocked(api);

const unboundStatus: KbStatusPayload = {
	agent_id: "agt_1",
	kb_id: null,
	kb_setup_completed: false,
	kb: null,
};

const boundStatus: KbStatusPayload = {
	agent_id: "agt_1",
	kb_id: "kb_1",
	kb_setup_completed: true,
	kb: {
		id: "kb_1",
		name: "Product Docs",
		embedding_provider: "jina",
		embedding_model: "jina-embeddings-v3",
		status: "active",
	},
};

beforeEach(() => {
	vi.clearAllMocks();
	authState.role = "super_admin";
	mockedApi.getAgent.mockResolvedValue({ id: "agt_1", name: "官网客服" } as never);
	mockedApi.kbStatus.mockResolvedValue(unboundStatus);
});

afterEach(() => {
	cleanup();
});

/* ---------------------------------------------------------------- helpers */

function setRole(role: Role) {
	authState.role = role;
}

/** Renders the real AdminLayout at `path` (rest path is the shell's host page). */
function renderShell(path: string) {
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
			{
				path: "/agents/:agentId/dashboard",
				element: (
					<AdminLayout>
						<div>Body</div>
					</AdminLayout>
				),
			},
			{
				path: "/agents/:agentId/knowledge",
				element: (
					<AdminLayout>
						<div>Body</div>
					</AdminLayout>
				),
			},
		],
		{ initialEntries: [path] },
	);
	render(<RouterProvider router={router} />);
	return router;
}

/** The sidebar nav links, in DOM order (icons carry no text). */
function navLinks(): HTMLAnchorElement[] {
	const nav = screen.getByRole("navigation", { name: "navigation.mainNav" });
	return within(nav).getAllByRole("link") as HTMLAnchorElement[];
}

function navHrefs(): string[] {
	return navLinks().map((link) => link.getAttribute("href") ?? "");
}

function navLabels(): string[] {
	return navLinks().map((link) => (link.textContent ?? "").trim());
}

function renderKnowledgeSetup(path: string) {
	const router = createMemoryRouter(
		[
			{ path: "/agents/:agentId/knowledge", element: <KnowledgeBaseSetup /> },
			{ path: "/agents/:agentId/urls", element: <KnowledgeBaseSetup /> },
			{ path: "/agents/:agentId/files", element: <KnowledgeBaseSetup /> },
			{ path: "/knowledge-bases", element: <div>kb-list</div> },
			{ path: "/knowledge-bases/:kbId", element: <div>kb-detail</div> },
		],
		{ initialEntries: [path] },
	);
	render(<RouterProvider router={router} />);
	return router;
}

/* ------------------------------------------------------- workspace (root) */

describe("§13 workspace nav (super_admin)", () => {
	it("shows exactly the four entries, in order: 首页, 智能体, 知识库, 设置", () => {
		setRole("super_admin");
		renderShell("/");

		expect(navHrefs()).toEqual([
			"/",
			"/agents",
			"/knowledge-bases",
			"/settings/account",
		]);
		// The first root entry is Home (`navigation.home` already exists in both
		// locales); the old `navigation.dashboard` label belongs to the agent
		// dashboard only.
		expect(navLabels()).toEqual([
			"navigation.home",
			"navigation.agents",
			"navigation.knowledgeBases",
			"navigation.accountSettings",
		]);
	});

	it("has no 会话/用户 entry: `/sessions` and `/users` are gone from the nav", () => {
		setRole("super_admin");
		renderShell("/");

		const hrefs = navHrefs();
		expect(hrefs).not.toContain("/sessions");
		expect(hrefs).not.toContain("/users");
		// Neither label is rendered anywhere in the shell (drawer included).
		expect(screen.queryByText("navigation.sessions")).not.toBeInTheDocument();
		expect(screen.queryByText("navigation.users")).not.toBeInTheDocument();
		expect(
			screen.queryAllByRole("link").map((link) => link.getAttribute("href")),
		).not.toContain("/users");
	});

	it("marks the current row with aria-current=page and leaves the siblings unmarked", () => {
		setRole("super_admin");
		renderShell("/");

		const home = screen.getByRole("link", { name: "navigation.home" });
		expect(home).toHaveAttribute("aria-current", "page");
		expect(
			screen.getByRole("link", { name: "navigation.agents" }),
		).not.toHaveAttribute("aria-current");
	});
});

/* ------------------------------------------------------------ agent scope */

describe("§13 agent-scoped nav", () => {
	it("a super_admin in an agent workspace sees 知识库 at /agents/<id>/knowledge", () => {
		setRole("super_admin");
		renderShell("/agents/agt_1/dashboard");

		expect(navHrefs()).toEqual([
			"/agents/agt_1/dashboard",
			"/agents/agt_1/knowledge",
			"/agents/agt_1/playground",
			"/agents/agt_1/sessions",
			"/agents/agt_1/settings/agent",
		]);
		const knowledge = screen.getByRole("link", {
			name: "navigation.knowledge",
		});
		expect(knowledge).toHaveAttribute("href", "/agents/agt_1/knowledge");
		expect(within(knowledge).getByText("navigation.knowledge")).toBeInTheDocument();
	});

	it("support in an agent workspace still sees only that agent's sessions entry", () => {
		setRole("support");
		renderShell("/agents/agt_1/dashboard");

		expect(navHrefs()).toEqual(["/agents/agt_1/sessions"]);
		expect(navLabels()).toEqual(["navigation.sessions"]);
	});
});

/* --------------------------------------- KnowledgeBaseSetup: prompt/redirect */

describe("§13 agent knowledge route (KnowledgeBaseSetup)", () => {
	it("renders an inline bind PROMPT — not a redirect — for an unbound agent", async () => {
		mockedApi.kbStatus.mockResolvedValue(unboundStatus);
		const router = renderKnowledgeSetup("/agents/agt_1/knowledge");

		const prompt = await screen.findByTestId("kb-bind-prompt");
		expect(prompt).toHaveClass("empty");
		// Title + one line of explanation + exactly one primary action.
		expect(
			within(prompt).getByText("kb.bindPromptTitle"),
		).toBeInTheDocument();
		expect(
			within(prompt).getByText("kb.bindPromptDescription"),
		).toBeInTheDocument();
		const actions = within(prompt).getAllByRole("link");
		expect(actions).toHaveLength(1);
		expect(actions[0]).toHaveClass("btn", "btn-primary");
		expect(actions[0]).toHaveAttribute(
			"href",
			"/knowledge-bases?bindAgent=agt_1",
		);
		// The operator stays on the route: the prompt is the destination.
		expect(router.state.location.pathname).toBe("/agents/agt_1/knowledge");
	});

	it("legacy /urls and /files keep the plain redirect to the bind sheet", async () => {
		mockedApi.kbStatus.mockResolvedValue(unboundStatus);

		for (const legacyPath of ["/agents/agt_1/urls", "/agents/agt_1/files"]) {
			const router = renderKnowledgeSetup(legacyPath);
			await waitFor(() => {
				expect(router.state.location.pathname).toBe("/knowledge-bases");
			});
			expect(router.state.location.search).toBe("?bindAgent=agt_1");
			expect(screen.getByText("kb-list")).toBeInTheDocument();
			cleanup();
		}
	});

	it("forwards a bound agent to its knowledge base, on every knowledge route", async () => {
		mockedApi.kbStatus.mockResolvedValue(boundStatus);

		for (const path of [
			"/agents/agt_1/knowledge",
			"/agents/agt_1/urls",
			"/agents/agt_1/files",
		]) {
			const router = renderKnowledgeSetup(path);
			await waitFor(() => {
				expect(router.state.location.pathname).toBe("/knowledge-bases/kb_1");
			});
			expect(screen.getByText("kb-detail")).toBeInTheDocument();
			expect(mockedApi.kbStatus).toHaveBeenCalledWith("agt_1");
			cleanup();
		}
	});
});

/* =============================================================================
 * Polish rework R3 — `退出登录` was a sibling of the user card, touching it with
 * no divider, so the two read as one undifferentiated block. The logout action
 * is now a ghost button INSIDE the user card, below a hairline separator.
 * ============================================================================= */
describe("polish R3 — logout is grouped inside the user card", () => {
	it("renders the account row and the logout action inside ONE card, split by a hairline", () => {
		mockedApi.getAgent.mockResolvedValue({ id: "agt_1", name: "官网客服" } as never);
		renderShell("/");

		const logout = screen.getByRole("button", { name: "buttons.logout" });
		expect(logout).toHaveClass("btn");
		expect(logout).toHaveClass("btn-ghost");
		expect(logout).toHaveClass("sidebar-user-logout");

		// It lives inside the user card, not beside it as a sibling...
		const card = logout.closest(".sidebar-user-card");
		expect(card, "the logout action must be inside the user card").not.toBeNull();

		// ...and the account row (avatar + name + email) is in that same card.
		const account = (card as HTMLElement).querySelector(".sidebar-user-account");
		expect(account).not.toBeNull();
		expect(within(account as HTMLElement).getByText("Owner")).toBeInTheDocument();
		expect(
			within(account as HTMLElement).getByText("owner@example.com"),
		).toBeInTheDocument();

		// The logout is a direct child of the card (a row of it), while the
		// account row is its sibling: not two separate cards touching.
		expect(logout.parentElement).toBe(card);
		expect((account as HTMLElement).parentElement).toBe(card);

		// The i18n key is unchanged, and the icon travels with it.
		expect(logout).toHaveTextContent("buttons.logout");
		expect(logout.querySelector("svg")).not.toBeNull();
	});

	it("the separator is a hairline in the subtle border token, full width", () => {
		// The card owns the surface; the logout row owns the divider. The CSS must
		// say so, or the two rows merge into one block again.
		const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
		const rule = /\n\.sidebar-user-logout\s*\{([^}]*)\}/.exec(css);
		expect(rule, ".sidebar-user-logout must be styled").not.toBeNull();
		const declarations = (rule as RegExpExecArray)[1].replace(/\s+/g, " ");
		expect(declarations).toMatch(/width: 100%/);
		expect(
			declarations,
			"the hairline must use the subtle border token",
		).toMatch(/border-top: 1px solid var\(--color-border-subtle\)/);

		const cardRule = /[\s\S]*?\n\.sidebar-user-card\s*\{([^}]*)\}/g;
		// `.sidebar-user-card` may be declared more than once (elevation token
		// in the component layer, surface in the shell layer). The surface is
		// what this assertion is about, so collect every declaration block.
		const cardDeclarations = [...css.matchAll(cardRule)]
			.map((m) => m[1].replace(/\s+/g, " "))
			.join(" ");
		expect(cardDeclarations, ".sidebar-user-card must be styled").not.toBe("");
		expect(cardDeclarations).toMatch(/background: var\(--sidebar-user-bg\)/);
	});
});
