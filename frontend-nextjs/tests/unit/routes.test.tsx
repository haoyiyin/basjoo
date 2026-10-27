// @vitest-environment jsdom
import type { ComponentType, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { api } from "../../src/services/api";
import zhCN from "../../src/locales/zh-CN/common.json";
import enUS from "../../src/locales/en-US/common.json";

// --- View mocks -------------------------------------------------------------
// Every view is replaced with a marker element so the route table can be
// asserted without dragging in auth, network, or i18n side effects.

vi.mock("../../src/views/Login", () => ({
	Login: () => <div>view:Login</div>,
}));
vi.mock("../../src/views/Register", () => ({
	Register: () => <div>view:Register</div>,
}));
vi.mock("../../src/views/AgentSelector", () => ({
	default: () => <div>view:AgentSelector</div>,
}));
vi.mock("../../src/views/Home", () => ({
	default: () => <div data-testid="home-view">view:Home</div>,
}));
vi.mock("../../src/views/Agents", () => ({
	default: () => <div>view:Agents</div>,
}));
vi.mock("../../src/views/Dashboard", () => ({
	default: () => <div>view:Dashboard</div>,
}));
vi.mock("../../src/views/FileUploadManagement", () => ({
	default: () => <div>view:FileUploadManagement</div>,
}));
vi.mock("../../src/views/KnowledgeBaseDetail", () => ({
	default: () => <div>view:KnowledgeBaseDetail</div>,
}));
vi.mock("../../src/views/KnowledgeBaseSetup", () => ({
	default: () => <div>view:KnowledgeBaseSetup</div>,
}));
vi.mock("../../src/views/KnowledgeBases", () => ({
	default: () => <div>view:KnowledgeBases</div>,
}));
vi.mock("../../src/views/Playground", () => ({
	default: () => <div>view:Playground</div>,
}));
vi.mock("../../src/views/Sessions", () => ({
	default: () => <div>view:Sessions</div>,
}));
vi.mock("../../src/views/AgentSettings", () => ({
	default: () => <div>view:AgentSettings</div>,
}));
vi.mock("../../src/views/AccountSettings", () => ({
	default: () => <div>view:AccountSettings</div>,
}));
vi.mock("../../src/views/URLManagement", () => ({
	default: () => <div>view:URLManagement</div>,
}));
vi.mock("../../src/views/Chat", () => ({
	default: () => <div>view:Chat</div>,
}));

// Layout dependencies: pass auth straight through, and mark the auth switcher.
vi.mock("../../src/components/RequireAuth", () => ({
	RequireAuth: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
// The shell is asserted by its own suite; here it must only pass children
// through so the real Home can be rendered without an AuthContext.
vi.mock("../../src/components/AdminLayout", () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../src/components/AuthLanguageSwitcher", () => ({
	AuthLanguageSwitcher: () => <div>layout:AuthLanguageSwitcher</div>,
}));

/** Exposes the router's current pathname so redirects can be asserted exactly. */
function LocationProbe() {
	const location = useLocation();
	return <div data-testid="location">{location.pathname}</div>;
}

function renderAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<App />
			<LocationProbe />
		</MemoryRouter>,
	);
}

function currentPath(): string {
	return screen.getByTestId("location").textContent ?? "";
}

// --- Real routes: exactly the 18 rendering entries of the route table --------
//
// The agent-scoped source routes (`/agents/:id/files|urls|knowledge`) now render
// the redirect-only KnowledgeBaseSetup view; source management itself lives on
// `/knowledge-bases/:kbId`.

const routes: Array<[path: string, view: string]> = [
	["/login", "view:Login"],
	["/register", "view:Register"],
	["/agent-selector", "view:AgentSelector"],
	["/", "view:Home"],
	["/agents", "view:Agents"],
	["/agents/some-id/dashboard", "view:Dashboard"],
	["/agents/some-id/files", "view:KnowledgeBaseSetup"],
	["/agents/some-id/knowledge", "view:KnowledgeBaseSetup"],
	["/agents/some-id/urls", "view:KnowledgeBaseSetup"],
	["/knowledge-bases", "view:KnowledgeBases"],
	["/knowledge-bases/kb_42", "view:KnowledgeBaseDetail"],
	["/agents/some-id/playground", "view:Playground"],
	["/agents/some-id/sessions", "view:Sessions"],
	["/agents/some-id/settings/agent", "view:AgentSettings"],
	["/chat/some-session", "view:Chat"],
	["/settings/agent", "view:AgentSettings"],
	["/settings/account", "view:AccountSettings"],
];

describe("route table", () => {
	it.each(routes)("%s renders %s", (path, view) => {
		renderAt(path);
		expect(screen.getByText(view)).toBeInTheDocument();
		expect(currentPath()).toBe(path);
	});

	// --- The 5 remaining redirect entries ------------------------------------
	//
	// §14/§13: `/sessions` and `/users` are no longer routes at all, so they are
	// asserted below as *unmounted* paths instead of as redirects.

	const redirects: Array<[from: string, to: string, view: string]> = [
		["/knowledge", "/knowledge-bases", "view:KnowledgeBases"],
		["/playground", "/", "view:Home"],
		["/urls", "/knowledge-bases", "view:KnowledgeBases"],
		["/files", "/knowledge-bases", "view:KnowledgeBases"],
		["/qa", "/knowledge-bases", "view:KnowledgeBases"],
	];

	it.each(redirects)("%s redirects to %s", (from, to, view) => {
		renderAt(from);
		expect(currentPath()).toBe(to);
		expect(screen.getByText(view)).toBeInTheDocument();
	});

	// --- Removed root routes (§13/§14) ---------------------------------------
	//
	// `/sessions` and `/users` used to be `Redirect` stubs to `/`. Both the nav
	// entries and the routes are gone, so navigating there must leave the
	// pathname untouched and mount no view at all.

	it.each(["/sessions", "/users"])(
		"%s is not a route any more: nothing mounts and the path stays",
		(path) => {
			renderAt(path);
			expect(currentPath()).toBe(path);
			// No view marker of any kind is rendered.
			expect(screen.queryByText(/^view:/)).not.toBeInTheDocument();
			// In particular, not the removed home destination either.
			expect(screen.queryByTestId("home-view")).not.toBeInTheDocument();
		},
	);

	// --- §14: `/` is the emptied Home page -----------------------------------
	//
	// The view mocks above replace Home with a marker. This block re-imports the
	// REAL Home (the module mock is disabled for this import only) so the actual
	// markup contract can be asserted: one page, one heading, no old dashboard.

	it("/ renders one heading plus the workspace overview", async () => {
		// Bypass the module mock: this contract is about the REAL view markup.
		const { default: HomeReal } =
			await vi.importActual<{ default: ComponentType }>(
				"../../src/views/Home",
			);

		const { container } = render(
			<MemoryRouter initialEntries={["/"]}>
				<HomeReal />
			</MemoryRouter>,
		);

		// Exactly one heading: the page title, and nothing else.
		expect(screen.getAllByRole("heading")).toHaveLength(1);
		const title = screen.getByRole("heading");
		expect(title).toHaveClass("page-title");
		// react-i18next is not initialised in this suite, so `t` echoes the key:
		// the title is the `home.title` string and nothing is hard-coded.
		expect(title.textContent).toBe("home.title");

		// Nothing from the removed dashboard / agent panel survives here.
		expect(screen.queryByTestId("dashboard-page")).toBeNull();
		expect(screen.queryByTestId("dashboard-stats")).toBeNull();
		expect(screen.queryByTestId("dashboard-status")).toBeNull();
		expect(screen.queryByTestId("agent-panel-page")).toBeNull();
		expect(screen.getByTestId("home-page")).toBeInTheDocument();

		// The overview is a signpost: two linked figures plus API status, and it
		// renders placeholders (never fabricated numbers) until the API answers.
		const overview = screen.getByTestId("home-overview");
		expect(overview.querySelectorAll("a")).toHaveLength(2);
		expect(screen.getByTestId("home-api-status")).toBeInTheDocument();
		expect(overview.querySelectorAll(".stat-value")).toHaveLength(3);

		// The page root is the admin page surface (same contract as every other
		// view, so the 375px suite can assert it).
		expect(container.querySelector(".admin-page")).not.toBeNull();
		expect(container.querySelector(".page-header")).not.toBeNull();
	});

	it("renders / as the Home marker and never the agent panel", () => {
		renderAt("/");
		expect(screen.getByTestId("home-view")).toBeInTheDocument();
		expect(screen.queryByText("view:AgentPanel")).not.toBeInTheDocument();
	});

	it("wraps the (auth) routes in the auth layout and not the dashboard layout", () => {
		renderAt("/login");
		expect(screen.getByText("layout:AuthLanguageSwitcher")).toBeInTheDocument();
	});

	it("does not render the auth layout switcher on dashboard routes", () => {
		renderAt("/");
		expect(screen.queryByText("layout:AuthLanguageSwitcher")).not.toBeInTheDocument();
	});

	it("gives the KB detail page its own route parameter", () => {
		renderAt("/knowledge-bases/kb_42");
		expect(screen.getByText("view:KnowledgeBaseDetail")).toBeInTheDocument();
		expect(currentPath()).toBe("/knowledge-bases/kb_42");
	});

	it.each(["/agents/some-id/files", "/agents/some-id/urls", "/agents/some-id/knowledge"])(
		"routes %s to the redirect-only KnowledgeBaseSetup view",
		(path) => {
			renderAt(path);
			// The redirect view is the only thing mounted; the old source panels
			// (URLManagement / FileUploadManagement) are no longer top-level routes.
			expect(screen.getByText("view:KnowledgeBaseSetup")).toBeInTheDocument();
			expect(screen.queryByText("view:URLManagement")).not.toBeInTheDocument();
			expect(
				screen.queryByText("view:FileUploadManagement"),
			).not.toBeInTheDocument();
		},
	);
});

// --- §14 i18n contract ------------------------------------------------------
//
// Home renders `t("home.title")`, so the key must exist in BOTH locales (shared
// hard rule), and the workspace nav label key `navigation.home` must exist too.

describe("home i18n keys", () => {
	it("defines home.title in both locales", () => {
		expect(zhCN.home.title).toBe("首页");
		expect(enUS.home.title).toBe("Home");
	});

	it("defines navigation.home in both locales", () => {
		expect(zhCN.navigation.home).toBe("首页");
		expect(enUS.navigation.home).toBe("Home");
	});
});

// --- api.ts kb-scoped source helpers -----------------------------------------
// §5 requires the client to call the *canonical* KB routes. `services/api` is not
// mocked in this file, so the real helpers are exercised against a stubbed
// `fetch`; the assertions pin the exact path, method and body shapes.

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function stubFetch(payload: unknown = {}) {
	return vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValueOnce(jsonResponse(payload));
}

function stubStorage() {
	vi.stubGlobal("localStorage", {
		getItem: vi.fn(() => null),
		setItem: vi.fn(),
		removeItem: vi.fn(),
		clear: vi.fn(),
	});
}

/** Called + captured in one step so the assertion stays one line per helper. */
async function callAndCapture(
	call: () => Promise<unknown>,
	payload: unknown = {},
): Promise<{ url: string; init: RequestInit }> {
	stubStorage();
	const spy = stubFetch(payload);
	await call();
	const [rawUrl, init] = spy.mock.calls[0];
	return { url: String(rawUrl), init: (init ?? {}) as RequestInit };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("api.ts kb-scoped source helpers", () => {
	it("listKbUrls GETs /knowledge-bases/{kb}/urls:list with no agent_id", async () => {
		const { url, init } = await callAndCapture(
			() => api.listKbUrls("kb_1"),
			{ urls: [], total: 0, quota: { used: 0, max: 100 } },
		);

		expect(url).toContain("/api/v1/knowledge-bases/kb_1/urls:list");
		expect(url).toContain("skip=0");
		expect(url).toContain("limit=100");
		expect(url).not.toContain("agent_id");
		expect(init.method).toBeUndefined();
	});

	it("createKbUrls POSTs {urls:[...]} to /knowledge-bases/{kb}/urls:create", async () => {
		const { url, init } = await callAndCapture(
			() => api.createKbUrls("kb_1", ["https://example.com"]),
			{ urls: [], total: 0, quota: { used: 0, max: 100 } },
		);

		expect(url).toContain("/api/v1/knowledge-bases/kb_1/urls:create");
		expect(url).not.toContain("agent_id");
		expect(init.method).toBe("POST");
		expect(JSON.parse(String(init.body))).toEqual({
			urls: ["https://example.com"],
		});
	});

	it("refetchKbUrls POSTs {url_ids, force} to /knowledge-bases/{kb}/urls:refetch", async () => {
		const { url, init } = await callAndCapture(
			() => api.refetchKbUrls("kb_1", [3, 4], true),
			{ job_id: "j1", status: "queued", message: "ok" },
		);

		expect(url).toContain("/api/v1/knowledge-bases/kb_1/urls:refetch");
		expect(init.method).toBe("POST");
		expect(JSON.parse(String(init.body))).toEqual({
			url_ids: [3, 4],
			force: true,
		});
	});

	it("deleteKbUrl DELETEs ?url_id= on /knowledge-bases/{kb}/urls:delete", async () => {
		const { url, init } = await callAndCapture(() =>
			api.deleteKbUrl("kb_1", 42),
		);

		expect(url).toContain("/api/v1/knowledge-bases/kb_1/urls:delete");
		expect(url).toContain("url_id=42");
		expect(init.method).toBe("DELETE");
	});

	it("listKbFiles GETs /knowledge-bases/{kb}/files:list with no agent_id", async () => {
		const { url } = await callAndCapture(
			() => api.listKbFiles("kb_1"),
			{ files: [], total: 0, quota: { used: 0, max: 100 } },
		);

		expect(url).toContain("/api/v1/knowledge-bases/kb_1/files:list");
		expect(url).not.toContain("agent_id");
	});

	it("deleteKbFile DELETEs ?file_id= on /knowledge-bases/{kb}/files:delete", async () => {
		const { url, init } = await callAndCapture(() =>
			api.deleteKbFile("kb_1", "doc_9"),
		);

		expect(url).toContain("/api/v1/knowledge-bases/kb_1/files:delete");
		expect(url).toContain("file_id=doc_9");
		expect(init.method).toBe("DELETE");
	});

	it("rebuildKbIndex POSTs {force} to /knowledge-bases/{kb}/index:rebuild", async () => {
		const { url, init } = await callAndCapture(
			() => api.rebuildKbIndex("kb_1", true),
			{ job_id: "j1", status: "queued", message: "ok" },
		);

		expect(url).toContain("/api/v1/knowledge-bases/kb_1/index:rebuild");
		expect(init.method).toBe("POST");
		expect(JSON.parse(String(init.body))).toEqual({ force: true });
	});

	it("getKbIndexStatus GETs /knowledge-bases/{kb}/index:status", async () => {
		const { url } = await callAndCapture(
			() => api.getKbIndexStatus("kb_1"),
			{ kb_id: "kb_1", status: "idle" },
		);

		expect(url).toContain("/api/v1/knowledge-bases/kb_1/index:status");
		expect(url).not.toContain("agent_id");
	});

	it("getKbSourcesSummary GETs /knowledge-bases/{kb}/sources:summary", async () => {
		const { url } = await callAndCapture(
			() => api.getKbSourcesSummary("kb_1"),
			{
				urls: { total: 0, indexed: 0, pending: 0, total_size_kb: 0 },
				files: { total: 0, ready: 0, processing: 0, total_size_kb: 0 },
				has_pending: false,
			},
		);

		expect(url).toContain("/api/v1/knowledge-bases/kb_1/sources:summary");
	});

	it("cancelKbUrlTasks POSTs /knowledge-bases/{kb}/urls:cancel", async () => {
		const { url, init } = await callAndCapture(
			() => api.cancelKbUrlTasks("kb_1"),
			{ cancelled: 0, task_ids: [], message: "no active tasks" },
		);

		expect(url).toContain("/api/v1/knowledge-bases/kb_1/urls:cancel");
		expect(init.method).toBe("POST");
	});
});
