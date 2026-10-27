// @vitest-environment jsdom
/**
 * Wave 5 / spec §7 (#15) — admin SPA at 375px CSS width.
 *
 * jsdom has no layout engine, so "does it overflow" cannot be measured. This
 * file therefore asserts the *contract* the CSS/layout depends on:
 *
 *  1. `.admin-page` roots carry the mobile no-overflow class (overflow-x hidden)
 *     declared inside `@media (max-width: 768px)` in `src/index.css`.
 *  2. No element in the rendered tree declares an inline `width`/`minWidth`
 *     larger than 375px (a hard requirement: such a declaration forces
 *     horizontal overflow regardless of CSS).
 *  3. Every tap target is >= 44px tall, resolved as:
 *        declared inline `height`/`minHeight` >= 44px
 *          OR the element matches a selector from the mobile media block
 *             whose declaration sets `min-height` >= 44px.
 *     (Plain prose links are excluded — see `isTapTarget`.)
 *  4. The Playground renders one route with two tabs (R2): only the selected
 *     pane is mounted, and the mobile block makes the tab strip full width.
 *  5. The hamburger is inside `.mobile-header`, >= 44px, and opens the drawer.
 *
 * The CSS assertions read the real file with `fs` so the contract cannot rot
 * silently.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	render,
	screen,
	waitFor,
	fireEvent,
	within,
	cleanup,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom";
import type {
	Agent,
	FileItem,
	KbSourcesSummaryResponse,
	KnowledgeBaseDetail,
	Quota,
	URLSource,
} from "../../src/services/api";
import { api } from "../../src/services/api";

/* ------------------------------------------------------------------ mocks */

const mediaState = vi.hoisted(() => ({ isMobile: true, isTablet: false }));

vi.mock("../../src/hooks/useMediaQuery", () => ({
	useIsMobile: () => mediaState.isMobile,
	useIsTablet: () => mediaState.isTablet,
	useIsDesktop: () => false,
	useMediaQuery: () => mediaState.isMobile,
}));

vi.mock("../../src/services/api", () => ({
	api: {
		getAgent: vi.fn(),
		listAgents: vi.fn(),
		updateAgent: vi.fn(),
		createAgent: vi.fn(),
		deleteAgent: vi.fn(),
		restoreAgent: vi.fn(),
		setSelectedAgentId: vi.fn(),
		clearSelectedAgentId: vi.fn(),
		getSelectedAgentId: vi.fn(),
		listKnowledgeBases: vi.fn(),
		getKnowledgeBase: vi.fn(),
		createKnowledgeBase: vi.fn(),
		resetKnowledgeBase: vi.fn(),
		deleteKnowledgeBase: vi.fn(),
		bindAgentKnowledgeBase: vi.fn(),
		getKbSourcesSummary: vi.fn(),
		getQuota: vi.fn(),
		getSourcesSummary: vi.fn(),
		listKbUrls: vi.fn(),
		createKbUrls: vi.fn(),
		deleteKbUrl: vi.fn(),
		refetchKbUrls: vi.fn(),
		cancelKbUrlTasks: vi.fn(),
		crawlKbSite: vi.fn(),
		clearKbUrls: vi.fn(),
		getKbIndexStatus: vi.fn(),
		rebuildKbIndex: vi.fn(),
		listKbFiles: vi.fn(),
		uploadKbFiles: vi.fn(),
		deleteKbFile: vi.fn(),
		clearKbFiles: vi.fn(),
		streamChat: vi.fn(),
		testAIApi: vi.fn(),
		getDefaultAgent: vi.fn(),
	},
}));

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		admin: {
			id: 1,
			name: "Owner",
			email: "owner@example.com",
			role: "super_admin",
		},
		token: "test-token",
		logout: vi.fn(),
		login: vi.fn(),
		register: vi.fn(),
	}),
}));

// Keys verbatim: assertions target i18n keys, not prose.
const stableT = (key: string, options?: Record<string, unknown>) =>
	options ? `${key}|${JSON.stringify(options)}` : key;

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: stableT,
		i18n: { language: "en", changeLanguage: vi.fn() },
	}),
}));

// The settings form is exercised by its own suite; here only the pane ordering
// and width contracts matter.
vi.mock("../../src/components/AISettingsForm", () => ({
	__esModule: true,
	default: () => <div data-testid="ai-settings-form" />,
}));

vi.mock("../../src/components/HelpTooltip", () => ({
	__esModule: true,
	default: () => null,
}));

/* --------------------------------------------------------- CSS extraction */

// `import.meta.url` is http(s) under the jsdom environment, so resolve from
// the vitest root (frontend-nextjs/) instead of from the module URL.
const INDEX_CSS_PATH = resolve(process.cwd(), "src/index.css");

interface CssRule {
	selectors: string[];
	declarations: string;
}

/** Extract the body of the first `@media (max-width: 768px) { ... }` block. */
function mobileMediaBlock(css: string): string {
	const marker = "@media (max-width: 768px)";
	const at = css.indexOf(marker);
	expect(at, `src/index.css must contain "${marker}"`).toBeGreaterThanOrEqual(0);
	const open = css.indexOf("{", at);
	let depth = 0;
	for (let i = open; i < css.length; i += 1) {
		if (css[i] === "{") depth += 1;
		else if (css[i] === "}") {
			depth -= 1;
			if (depth === 0) return css.slice(open + 1, i);
		}
	}
	throw new Error("unbalanced @media (max-width: 768px) block in src/index.css");
}

/** Parse flat `selector { declarations }` rules out of a media-block body. */
function parseRules(block: string): CssRule[] {
	const withoutComments = block.replace(/\/\*[\s\S]*?\*\//g, "");
	const rules: CssRule[] = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let match = re.exec(withoutComments);
	while (match !== null) {
		const selectors = match[1]
			.split(",")
			.map((part) => part.trim())
			.filter((part) => part.length > 0);
		rules.push({ selectors, declarations: match[2] });
		match = re.exec(withoutComments);
	}
	return rules;
}

const CSS = readFileSync(INDEX_CSS_PATH, "utf-8");
const MOBILE_BLOCK = mobileMediaBlock(CSS);
const MOBILE_RULES = parseRules(MOBILE_BLOCK);

function rulesFor(selector: string): CssRule[] {
	return MOBILE_RULES.filter((rule) => rule.selectors.includes(selector));
}

/** Declared `min-height: Npx` values on rules matching `element`. */
function cssMinHeightsFor(element: Element): number[] {
	const values: number[] = [];
	for (const rule of MOBILE_RULES) {
		const match = /min-height:\s*(\d+)px/.exec(rule.declarations);
		if (!match) continue;
		for (const selector of rule.selectors) {
			let matches = false;
			try {
				matches = element.matches(selector);
			} catch {
				matches = false;
			}
			if (matches) values.push(Number(match[1]));
		}
	}
	return values;
}

/* ------------------------------------------------------------- fixtures */

const agentFixture: Agent = {
	id: "agt_1",
	name: "Support Bot",
	description: "Answers questions",
	system_prompt: "prompt",
	model: "gpt-4o-mini",
	temperature: 0.7,
	max_tokens: 1024,
	api_key_set: true,
	kb_id: "kb_1",
	kb_name: "Product Docs",
	kb_status: "active",
	top_k: 5,
	similarity_threshold: 0.01,
	enable_context: true,
	is_active: true,
	deleted_at: null,
	created_at: "2026-01-01T00:00:00Z",
	url_count: 3,
	file_count: 2,
	active_session_count: 1,
	last_error_code: null,
};

const kbFixture: KnowledgeBaseDetail = {
	id: "kb_1",
	name: "Product Docs",
	embedding_provider: "jina",
	embedding_model: "jina-embeddings-v3",
	embedding_base_url: null,
	embedding_batch_size: 4,
	embedding_dimension: 1024,
	chunk_size: 512,
	chunk_overlap: 64,
	status: "active",
	is_locked: false,
	error_message: null,
	document_count: 3,
	ready_document_count: 2,
	total_chunks: 11,
	bound_agent: { id: "agt_1", name: "Support Bot" },
	created_at: "2026-01-01T00:00:00Z",
};

const quotaFixture: Quota = {
	max_agents: 5,
	max_urls: 100,
	max_files: 100,
	max_messages_per_day: 500,
	max_total_text_mb: 50,
	used_agents: 1,
	used_urls: 3,
	used_files: 2,
	used_messages_today: 7,
	used_total_text_mb: 1,
	remaining_urls: 97,
	remaining_files: 98,
	remaining_messages_today: 493,
};

const urlFixture: URLSource = {
	id: 1,
	url: "https://example.com/docs",
	normalized_url: "https://example.com/docs",
	status: "success",
	is_indexed: true,
	created_at: "2026-01-01T00:00:00Z",
};

const fileFixture: FileItem = {
	id: "file_1",
	filename: "manual.pdf",
	file_type: "pdf",
	file_size: 1024,
	status: "ready",
	created_at: "2026-01-01T00:00:00Z",
};

const kbSummaryFixture: KbSourcesSummaryResponse = {
	urls: { total: 1, indexed: 1, pending: 0, total_size_kb: 1 },
	files: { total: 1, ready: 1, processing: 0, total_size_kb: 1 },
	has_pending: false,
};

const mockedApi = vi.mocked(api);

beforeEach(() => {
	vi.clearAllMocks();
	mediaState.isMobile = true;
	mediaState.isTablet = false;
	mockedApi.getAgent.mockResolvedValue(agentFixture);
	mockedApi.listAgents.mockResolvedValue({ agents: [agentFixture], total: 1 });
	mockedApi.listKnowledgeBases.mockResolvedValue({
		knowledge_bases: [kbFixture],
		total: 1,
	});
	mockedApi.getKnowledgeBase.mockResolvedValue(kbFixture);
	mockedApi.getKbSourcesSummary.mockResolvedValue(kbSummaryFixture);
	mockedApi.getQuota.mockResolvedValue(quotaFixture);
	mockedApi.getSourcesSummary.mockResolvedValue({
		urls: { total: 1, indexed: 1, pending: 0, total_size_kb: 1 },
		files: { total: 1, ready: 1, processing: 0, total_size_kb: 1 },
		has_pending: false,
	});
	mockedApi.listKbUrls.mockResolvedValue({
		urls: [urlFixture],
		total: 1,
		quota: { used: 1, max: 100 },
		is_indexed: true,
		created_at: "2026-01-01T00:00:00Z",
	});
	mockedApi.listKbFiles.mockResolvedValue({
		files: [fileFixture],
		total: 1,
		quota: { used: 1, max: 100 },
	});
	mockedApi.getKbIndexStatus.mockResolvedValue({
		kb_id: "kb_1",
		status: "ready",
	});
	mockedApi.streamChat.mockResolvedValue(undefined);
	// jsdom has no layout: ChatPanel scrolls its message list on every update.
	Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
	cleanup();
});

/* ------------------------------------------------------------- helpers */

/** The admin SPA's fixed reference viewport width for #15. */
const VIEWPORT_PX = 375;

function renderAt375(node: React.ReactElement) {
	return render(
		<div data-testid="viewport-375" style={{ width: VIEWPORT_PX }}>
			{node}
		</div>,
	);
}

/** Every element must be reachable inside a 375px column. */
function assertNoInlineWidthOverflow(root: HTMLElement) {
	const offenders: string[] = [];
	for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
		for (const prop of ["width", "minWidth"] as const) {
			const raw = el.style[prop];
			if (!raw) continue;
			const px = /^(\d+(?:\.\d+)?)px$/.exec(raw.trim());
			if (!px) continue; // %, em, rem, vw, auto ... cannot pin >viewport.
			if (Number(px[1]) > VIEWPORT_PX) {
				offenders.push(
					`<${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""}> ${prop}: ${raw}`,
				);
			}
		}
	}
	expect(
		offenders,
		`inline width declarations wider than ${VIEWPORT_PX}px force horizontal overflow`,
	).toEqual([]);
}

/**
 * Tap targets are `button`, `[role=button]`, and links styled as buttons.
 * Plain prose links (e.g. the KB name cell, footer links) are intentionally
 * excluded: they are inline text, not 44px touch affordances.
 */
function isTapTarget(el: Element): boolean {
	if (el.tagName === "BUTTON") return true;
	if (el.getAttribute("role") === "button") return true;
	if (el.tagName === "A") {
		const cls = el.getAttribute("class") ?? "";
		if (/(^|\s)btn-(primary|secondary|ghost|danger)(\s|$)/.test(cls)) {
			return true;
		}
		return Boolean(el.closest(".mobile-sidebar, .mobile-header"));
	}
	return false;
}

function tapTargetViolations(root: HTMLElement): string[] {
	const violations: string[] = [];
	const candidates = Array.from(
		root.querySelectorAll<HTMLElement>(
			'button, [role="button"], a.btn-primary, a.btn-secondary, a.btn-ghost, a.btn-danger, .mobile-sidebar a, .mobile-header a',
		),
	);
	for (const el of candidates) {
		if (!isTapTarget(el)) continue;
		const inlineHeights = [el.style.height, el.style.minHeight]
			.map((value) => /^(\d+(?:\.\d+)?)px$/.exec(value.trim()))
			.map((match) => (match ? Number(match[1]) : 0));
		const bestInline = Math.max(0, ...inlineHeights);
		const bestCss = Math.max(0, ...cssMinHeightsFor(el));
		const resolved = Math.max(bestInline, bestCss);
		if (resolved < 44) {
			violations.push(
				`<${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""}> "${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? ""}" resolves to ${resolved}px`,
			);
		}
	}
	return violations;
}

function assertTapTargets(root: HTMLElement) {
	expect(
		tapTargetViolations(root),
		"every tap target must resolve to a >= 44px height",
	).toEqual([]);
}

function assertPageRootContract(view: HTMLElement, testId: string) {
	const root = within(view).getByTestId(testId);
	expect(root).toHaveClass("admin-page");
	// ...and the class carries the real rule inside the mobile media block.
	const adminPageMinHeightRules = rulesFor(".admin-page").map(
		(rule) => rule.declarations,
	);
	expect(
		adminPageMinHeightRules.some((decl) => /overflow-x:\s*hidden/.test(decl)),
		'.admin-page must declare overflow-x: hidden inside @media (max-width: 768px)',
	).toBe(true);
}

/* --------------------------------------------------- CSS contract probes */

describe("mobile CSS contract (src/index.css)", () => {
	it("declares the playground tab rules inside the mobile media block", () => {
		const shell = rulesFor(".playground-shell");
		expect(shell.length).toBeGreaterThan(0);
		expect(
			shell.some((rule) => /flex-direction:\s*column/.test(rule.declarations)),
		).toBe(true);
		expect(
			shell.some((rule) => /overflow-x:\s*hidden/.test(rule.declarations)),
		).toBe(true);

		const tabs = rulesFor(".playground-tabs");
		expect(tabs.length).toBeGreaterThan(0);
		expect(tabs.map((rule) => rule.declarations).join(" ")).toMatch(
			/width:\s*100%/,
		);

		const tab = rulesFor(".playground-tab");
		expect(tab.length).toBeGreaterThan(0);
		expect(tab.map((rule) => rule.declarations).join(" ")).toMatch(
			/min-height:\s*44px/,
		);
	});

	it("keeps the stacked rules out of the desktop media block", () => {
		const desktopAt = CSS.indexOf("@media (min-width: 1025px)");
		expect(desktopAt).toBeGreaterThan(0);
		const desktopBlock = CSS.slice(desktopAt);
		expect(desktopBlock).not.toMatch(/\.playground-shell/);
		expect(desktopBlock).not.toMatch(/\.playground-pane-settings/);
		expect(desktopBlock).not.toMatch(/\.hamburger-btn/);
	});

	it("declares the 44px hamburger and 44px tap-target rules in the mobile block", () => {
		const hamburger = rulesFor(".hamburger-btn");
		expect(hamburger.length).toBeGreaterThan(0);
		const decls = hamburger.map((rule) => rule.declarations).join(" ");
		expect(decls).toMatch(/width:\s*44px/);
		expect(decls).toMatch(/height:\s*44px/);
		expect(decls).toMatch(/min-height:\s*44px/);
		// The button must paint above the scrolling content.
		expect(decls).toMatch(/z-index:\s*45/);

		const tapTargetRule = MOBILE_RULES.find((rule) =>
			rule.selectors.includes(".admin-page button"),
		);
		expect(tapTargetRule).toBeDefined();
		expect(tapTargetRule?.declarations).toMatch(/min-height:\s*44px/);
	});

	it("declares the KB table scroll wrapper and the mobile-main overflow guard", () => {
		const scroll = rulesFor(".kb-table-scroll").map((r) => r.declarations);
		expect(scroll.some((decl) => /overflow-x:\s*auto/.test(decl))).toBe(true);

		const main = rulesFor(".mobile-main").map((r) => r.declarations).join(" ");
		expect(main).toMatch(/overflow-x:\s*hidden/);
	});
});

/* ------------------------------------------------------- 375px page roots */

const { default: KnowledgeBases } = await import("../../src/views/KnowledgeBases");
const { default: KnowledgeBaseDetailView } = await import(
	"../../src/views/KnowledgeBaseDetail"
);
const { default: Agents } = await import("../../src/views/Agents");
const { default: Dashboard } = await import("../../src/views/Dashboard");
const { default: Home } = await import("../../src/views/Home");
const { default: Playground } = await import("../../src/views/Playground");
const { default: AdminLayout } = await import("../../src/components/AdminLayout");
const { Login } = await import("../../src/views/Login");
const { Register } = await import("../../src/views/Register");

describe("375px width: no horizontal overflow", () => {
	it("KnowledgeBases list", async () => {
		const { container } = renderAt375(
			<MemoryRouter initialEntries={["/knowledge-bases"]}>
				<Routes>
					<Route path="/knowledge-bases" element={<KnowledgeBases />} />
				</Routes>
			</MemoryRouter>,
		);

		await screen.findByTestId("kb-row-kb_1");
		const view = container.querySelector<HTMLElement>(
			'[data-testid="viewport-375"]',
		);
		expect(view).not.toBeNull();
		assertPageRootContract(view as HTMLElement, "kb-list-page");
		assertNoInlineWidthOverflow(view as HTMLElement);
		assertTapTargets(view as HTMLElement);

		// §16: the 7-column table is gone. The KB list is now the shared
		// `list`/`list-row` primitive, same system as /agents.
		const list = screen.getByTestId("kb-list");
		expect(list.tagName).toBe("UL");
		expect(list).toHaveClass("list");
		const rows = within(list).getAllByRole("listitem");
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			expect(row).toHaveClass("list-row");
		}
		expect(screen.getByTestId("kb-row-kb_1")).toBeInTheDocument();
	});

	it("KnowledgeBaseDetail composition (URL + file panels)", async () => {
		const { container } = renderAt375(
			<MemoryRouter initialEntries={["/knowledge-bases/kb_1"]}>
				<Routes>
					<Route
						path="/knowledge-bases/:kbId"
						element={<KnowledgeBaseDetailView />}
					/>
				</Routes>
			</MemoryRouter>,
		);

		await screen.findByTestId("kb-detail-title");
		await screen.findByTestId("kb-url-panel");
		await screen.findByTestId("kb-file-panel");

		const view = container.querySelector<HTMLElement>(
			'[data-testid="viewport-375"]',
		);
		expect(view).not.toBeNull();
		assertPageRootContract(view as HTMLElement, "kb-detail-page");
		assertNoInlineWidthOverflow(view as HTMLElement);
		assertTapTargets(view as HTMLElement);
	});

	it("Agents", async () => {
		const { container } = renderAt375(
			<MemoryRouter initialEntries={["/agents"]}>
				<Routes>
					<Route path="/agents" element={<Agents />} />
				</Routes>
			</MemoryRouter>,
		);

		await screen.findByTestId("agents-page");
		const view = container.querySelector<HTMLElement>(
			'[data-testid="viewport-375"]',
		);
		assertPageRootContract(view as HTMLElement, "agents-page");
		assertNoInlineWidthOverflow(view as HTMLElement);
		assertTapTargets(view as HTMLElement);
	});

	it("Dashboard", async () => {
		const { container } = renderAt375(
			<MemoryRouter initialEntries={["/agents/agt_1/dashboard"]}>
				<Routes>
					<Route path="/agents/:agentId/dashboard" element={<Dashboard />} />
				</Routes>
			</MemoryRouter>,
		);

		await screen.findByTestId("dashboard-page");
		const view = container.querySelector<HTMLElement>(
			'[data-testid="viewport-375"]',
		);
		assertPageRootContract(view as HTMLElement, "dashboard-page");
		assertNoInlineWidthOverflow(view as HTMLElement);
		assertTapTargets(view as HTMLElement);
	});

	it("Home", async () => {
		const { container } = renderAt375(
			<MemoryRouter initialEntries={["/"]}>
				<Routes>
					<Route path="/" element={<Home />} />
				</Routes>
			</MemoryRouter>,
		);

		await screen.findByTestId("home-page");
		const view = container.querySelector<HTMLElement>(
			'[data-testid="viewport-375"]',
		);
		assertPageRootContract(view as HTMLElement, "home-page");
		assertNoInlineWidthOverflow(view as HTMLElement);
		assertTapTargets(view as HTMLElement);
	});

	it("Playground", async () => {
		const { container } = renderAt375(
			<MemoryRouter initialEntries={["/agents/agt_1/playground"]}>
				<Routes>
					<Route path="/agents/:agentId/playground" element={<Playground />} />
				</Routes>
			</MemoryRouter>,
		);

		await screen.findByTestId("playground-shell");
		const view = container.querySelector<HTMLElement>(
			'[data-testid="viewport-375"]',
		);
		assertNoInlineWidthOverflow(view as HTMLElement);
		assertTapTargets(view as HTMLElement);
	});

	it("Login and Register auth pages", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({ bootstrap_required: true }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const login = renderAt375(
			<MemoryRouter initialEntries={["/login"]}>
				<Routes>
					<Route path="/login" element={<Login />} />
				</Routes>
			</MemoryRouter>,
		);
		const loginView = login.container.querySelector<HTMLElement>(
			'[data-testid="viewport-375"]',
		);
		expect(loginView).not.toBeNull();
		expect(screen.getByTestId("login-page")).toHaveClass("auth-page");
		assertNoInlineWidthOverflow(loginView as HTMLElement);
		login.unmount();

		const register = renderAt375(
			<MemoryRouter initialEntries={["/register"]}>
				<Routes>
					<Route path="/register" element={<Register />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByTestId("register-page")).toBeInTheDocument();
		});
		const registerView = register.container.querySelector<HTMLElement>(
			'[data-testid="viewport-375"]',
		);
		assertNoInlineWidthOverflow(registerView as HTMLElement);

		vi.unstubAllGlobals();
	});
});

/* ------------------------------------------------------ playground tabs */

describe("Playground tabs at mobile width", () => {
	it("mounts only the chat pane by default", async () => {
		renderAt375(
			<MemoryRouter initialEntries={["/agents/agt_1/playground"]}>
				<Routes>
					<Route path="/agents/:agentId/playground" element={<Playground />} />
				</Routes>
			</MemoryRouter>,
		);

		const shell = await screen.findByTestId("playground-shell");
		expect(shell).toHaveClass("playground-shell");
		expect(shell).toHaveClass("admin-page");

		const chatPane = screen.getByTestId("playground-pane-chat");
		expect(chatPane).toHaveClass("playground-pane-chat");
		expect(chatPane.parentElement).toBe(shell);
		expect(screen.getByTestId("chat-message-input")).toBeInTheDocument();
		expect(screen.queryByTestId("ai-settings-form")).not.toBeInTheDocument();

		// The tab strip is the single page-level control and is keyboard driven.
		expect(screen.getByRole("tablist")).toBeInTheDocument();
		expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(
			"playground.tabChat",
		);
	});

	it("mounts the settings pane when ?tab=settings is on the URL", async () => {
		renderAt375(
			<MemoryRouter initialEntries={["/agents/agt_1/playground?tab=settings"]}>
				<Routes>
					<Route path="/agents/:agentId/playground" element={<Playground />} />
				</Routes>
			</MemoryRouter>,
		);

		const settingsPane = await screen.findByTestId("playground-pane-settings");
		expect(settingsPane).toHaveClass("playground-pane-settings");
		expect(screen.getByTestId("ai-settings-form")).toBeInTheDocument();
		expect(screen.queryByTestId("chat-message-input")).not.toBeInTheDocument();
	});

	it("keeps the no-API-key banner and the disabled send control", async () => {
		mockedApi.getAgent.mockResolvedValue({
			...agentFixture,
			api_key_set: false,
		});
		renderAt375(
			<MemoryRouter initialEntries={["/agents/agt_1/playground"]}>
				<Routes>
					<Route path="/agents/:agentId/playground" element={<Playground />} />
				</Routes>
			</MemoryRouter>,
		);

		expect(
			await screen.findByText("labels.pleaseConfigureApiKey"),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "buttons.send" }),
		).toBeDisabled();
	});

	it("caps the settings column in CSS instead of an inline side-rail width", async () => {
		renderAt375(
			<MemoryRouter initialEntries={["/agents/agt_1/playground?tab=settings"]}>
				<Routes>
					<Route path="/agents/:agentId/playground" element={<Playground />} />
				</Routes>
			</MemoryRouter>,
		);

		const settingsPane = await screen.findByTestId("playground-pane-settings");
		expect(settingsPane.style.width).toBe("");
		expect(settingsPane.style.minWidth).toBe("");

		// The readable column max-width lives in index.css, not in the markup.
		expect(CSS).toMatch(/\.playground-settings-column\s*\{[^}]*max-width:\s*760px/);
	});
});

/* -------------------------------------------------------------- hamburger */

describe("mobile hamburger", () => {
	function renderLayout() {
		return renderAt375(
			<MemoryRouter initialEntries={["/"]}>
				<Routes>
					<Route
						path="/"
						element={
							<AdminLayout>
								<div data-testid="layout-body">Body</div>
							</AdminLayout>
						}
					/>
				</Routes>
			</MemoryRouter>,
		);
	}

	it("renders a >= 44px menu button inside the mobile header", async () => {
		const { container } = renderLayout();

		const button = await screen.findByRole("button", { name: "Open menu" });
		expect(button).toBeInTheDocument();
		expect(button).toHaveClass("hamburger-btn");
		expect(button.closest(".mobile-header")).not.toBeNull();
		expect(button).toHaveStyle({ width: "44px", height: "44px" });

		// ...and the resolution rule agrees (inline or CSS min-height >= 44px).
		expect(tapTargetViolations(container)).toEqual([]);
	});

	it("opens the mobile sidebar when clicked", async () => {
		renderLayout();

		const button = await screen.findByRole("button", { name: "Open menu" });
		const sidebar = screen.getByTestId("mobile-sidebar");
		expect(sidebar).not.toHaveClass("open");
		expect(sidebar).toHaveAttribute("data-open", "false");
		expect(button).toHaveAttribute("aria-expanded", "false");

		fireEvent.click(button);

		await waitFor(() => {
			expect(screen.getByTestId("mobile-sidebar")).toHaveClass("open");
		});
		expect(screen.getByTestId("mobile-sidebar")).toHaveAttribute(
			"data-open",
			"true",
		);
		expect(button).toHaveAttribute("aria-expanded", "true");
		// The overlay is the accessible dismiss affordance.
		expect(
			document.querySelector(".sidebar-overlay.open"),
		).not.toBeNull();
	});

	it("keeps the menu button reachable above the scrolling content", async () => {
		renderLayout();
		const button = await screen.findByRole("button", { name: "Open menu" });
		const header = button.closest(".mobile-header");
		expect(header).not.toBeNull();
		// The button is the header's first child and the header is fixed at top.
		expect(header?.firstElementChild).toBe(button);

		const main = screen.getByTestId("admin-main");
		expect(main).toHaveClass("mobile-main");
		// Content scrolls under the header; the header (z-index 30) and the
		// button (z-index 45) both paint above <main>.
		expect(main.style.overflowX).toBe("hidden");
	});
});
