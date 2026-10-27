// @vitest-environment jsdom
/**
 * Spec §15 (lane AGENTS) — agent create moved out of the page body.
 *
 * The contract this file pins:
 *   a. nothing inline: no create form, no name field before the sheet opens;
 *   b. the `+` lives in `page-actions`, is labelled, and opens the sheet with
 *      the name field focused;
 *   c. Escape closes the sheet and focus returns to the `+`;
 *   d. a backdrop click closes the sheet (its own assertion);
 *   e. submitting still posts the same payload, `widget_title` included;
 *   f. the display-width clamp is unchanged inside the sheet;
 *   g. the 375px contract that jsdom can honestly defend: rows stack, nothing
 *      declares an inline width wider than the viewport, and every button
 *      resolves to a >= 44px tap target (inline or via the mobile media block).
 */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import Agents from "../../src/views/Agents";
import { api } from "../../src/services/api";
import type { Agent, KnowledgeBaseDetail } from "../../src/services/api";

const mediaState = vi.hoisted(() => ({ isMobile: false }));

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		admin: {
			id: 1,
			name: "Test Admin",
			email: "test@example.com",
			role: "super_admin",
		},
		token: "test-token",
		logout: vi.fn(),
	}),
}));

vi.mock("../../src/services/api", () => ({
	api: {
		listAgents: vi.fn(),
		createAgent: vi.fn(),
		deleteAgent: vi.fn(),
		restoreAgent: vi.fn(),
		pauseAgent: vi.fn(),
		resumeAgent: vi.fn(),
		setSelectedAgentId: vi.fn(),
		clearSelectedAgentId: vi.fn(),
		getSelectedAgentId: vi.fn(),
		kbStatus: vi.fn(),
		listKnowledgeBases: vi.fn(),
		createKnowledgeBase: vi.fn(),
		bindAgentKnowledgeBase: vi.fn(),
		testEmbeddingConfig: vi.fn(),
	},
}));

vi.mock("../../src/hooks/useMediaQuery", () => ({
	useIsMobile: () => mediaState.isMobile,
}));

// Keys are returned verbatim so assertions target i18n keys, not prose.
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

vi.mock("../../src/components/AdminLayout", () => ({
	default: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="admin-layout">{children}</div>
	),
}));

const mockedApi = vi.mocked(api);

const activeAgent: Agent = {
	id: "agt_active",
	name: "Active Agent",
	description: "Answers questions",
	system_prompt: "prompt",
	model: "gpt-4o-mini",
	temperature: 0.7,
	max_tokens: 1024,
	top_k: 5,
	similarity_threshold: 0.01,
	enable_context: true,
	is_active: true,
	deleted_at: null,
	created_at: "2026-01-01T00:00:00Z",
};

const deletedAgent: Agent = {
	...activeAgent,
	id: "agt_deleted",
	name: "Deleted Agent",
	is_active: false,
	deleted_at: "2026-06-01T00:00:00Z",
	purge_after: "2026-06-08T00:00:00Z",
};

const pausedAgent: Agent = {
	...activeAgent,
	id: "agt_paused",
	name: "Paused Agent",
	is_active: false,
	deleted_at: null,
};

const createdAgent: Agent = {
	...activeAgent,
	id: "agt_created",
	name: "Support Bot",
};

const unboundKb: KnowledgeBaseDetail = {
	id: "kb_free",
	name: "Unbound KB",
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
	document_count: 0,
	ready_document_count: 0,
	total_chunks: 0,
	bound_agent: null,
};

function renderAgents(agents: Agent[] = [activeAgent]) {
	mockedApi.listAgents.mockResolvedValue({
		agents,
		total: agents.length,
	});
	const router = createMemoryRouter(
		[
			{ path: "/agents", element: <Agents /> },
			{ path: "/agents/:agentId/dashboard", element: <div>Dashboard</div> },
		],
		{ initialEntries: ["/agents"] },
	);
	const view = render(<RouterProvider router={router} />);
	return { router, ...view };
}

/** The `+` in `page-actions`. */
function createTrigger() {
	return screen.getByTestId("agent-create-open");
}

function openCreateSheet() {
	fireEvent.click(createTrigger());
	return screen.findByTestId("agent-create-sheet");
}

beforeEach(() => {
	vi.clearAllMocks();
	mediaState.isMobile = false;
	mockedApi.createAgent.mockResolvedValue(createdAgent);
	mockedApi.deleteAgent.mockResolvedValue({ success: true });
	mockedApi.restoreAgent.mockResolvedValue(activeAgent);
	mockedApi.pauseAgent.mockResolvedValue({ ...activeAgent, is_active: false });
	mockedApi.resumeAgent.mockResolvedValue(activeAgent);
	mockedApi.listKnowledgeBases.mockResolvedValue({
		knowledge_bases: [unboundKb],
		total: 1,
	});
});

describe("Agents create sheet (§15)", () => {
	it("renders no create form and no name field in the page body before opening", async () => {
		const { container } = renderAgents();
		await screen.findByText("Active Agent");

		// Nothing inline: no form element, no name field, no sheet.
		expect(container.querySelector("form")).toBeNull();
		expect(
			screen.queryByPlaceholderText("agents.namePlaceholder"),
		).not.toBeInTheDocument();
		expect(screen.queryByTestId("agent-create-sheet")).not.toBeInTheDocument();
		expect(screen.queryByTestId("agent-create-backdrop")).not.toBeInTheDocument();
		// The old inline create card is gone as well.
		expect(container.querySelector(".liquid-glass-card")).toBeNull();
	});

	it("keeps the title row with the agent count on a page-header", async () => {
		renderAgents([activeAgent, deletedAgent]);
		await screen.findByText("Active Agent");

		const header = screen.getByTestId("agents-page").querySelector(".page-header");
		expect(header).not.toBeNull();
		expect(within(header as HTMLElement).getByText("agents.title")).toHaveClass(
			"page-title",
		);
		expect(within(header as HTMLElement).getByText("agents.subtitle")).toHaveClass(
			"page-subtitle",
		);
		// §15: the title row keeps the count.
		expect(screen.getByTestId("agents-count")).toHaveTextContent(
			"agents.allAgents · 2",
		);
	});

	it("puts the `+` in page-actions and opens the sheet with the name field focused", async () => {
		renderAgents();
		await screen.findByText("Active Agent");

		const trigger = createTrigger();
		expect(trigger.closest(".page-actions")).not.toBeNull();
		expect(trigger).toHaveAccessibleName("agents.createTitle");

		fireEvent.click(trigger);

		const sheet = await screen.findByTestId("agent-create-sheet");
		expect(sheet).toHaveAttribute("role", "dialog");
		expect(sheet).toHaveAttribute("aria-modal", "true");
		expect(screen.getByRole("dialog", { name: "agents.createTitle" })).toBe(
			sheet,
		);
		const input = within(sheet).getByPlaceholderText("agents.namePlaceholder");
		expect(input).toHaveFocus();
		// Round 6: the submit is the `check` icon; its accessible name is still
		// the `agents.create` label, so the glyph is never the name.
		const submit = within(sheet).getByRole("button", { name: "agents.create" });
		expect(submit).toHaveClass("btn-icon");
		expect(submit).toHaveAttribute("title", "agents.create");
	});

	it("closes the sheet on Escape and returns focus to the `+`", async () => {
		renderAgents();
		await screen.findByText("Active Agent");

		const trigger = createTrigger();
		fireEvent.click(trigger);
		const sheet = await screen.findByTestId("agent-create-sheet");
		expect(within(sheet).getByPlaceholderText("agents.namePlaceholder")).toHaveFocus();

		fireEvent.keyDown(document, { key: "Escape" });

		expect(screen.queryByTestId("agent-create-sheet")).not.toBeInTheDocument();
		expect(screen.queryByTestId("agent-create-backdrop")).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
	});

	it("closes the sheet on a backdrop click", async () => {
		renderAgents();
		await screen.findByText("Active Agent");

		await openCreateSheet();
		expect(screen.getByTestId("agent-create-backdrop")).toBeInTheDocument();

		fireEvent.click(screen.getByTestId("agent-create-backdrop"));

		expect(screen.queryByTestId("agent-create-sheet")).not.toBeInTheDocument();
		expect(
			screen.queryByPlaceholderText("agents.namePlaceholder"),
		).not.toBeInTheDocument();
	});

	it("posts exactly the trimmed payload, widget_title included", async () => {
		renderAgents();
		await screen.findByText("Active Agent");

		const sheet = await openCreateSheet();
		// Trailing whitespace only: the display-width clamp runs before the
		// trim, so leading spaces would legitimately eat into the 12 units.
		fireEvent.change(within(sheet).getByPlaceholderText("agents.namePlaceholder"), {
			target: { value: "Support Bot " },
		});
		fireEvent.change(within(sheet).getByLabelText("labels.description"), {
			target: { value: "  Handles support  " },
		});
		fireEvent.click(within(sheet).getByRole("button", { name: "agents.create" }));

		await waitFor(() => {
			expect(mockedApi.createAgent).toHaveBeenCalledTimes(1);
		});
		const [payload] = mockedApi.createAgent.mock.calls[0];
		expect(payload).toEqual({
			name: "Support Bot",
			description: "Handles support",
			widget_title: "Support Bot",
		});
		// No extra keys ride along (the spread of the raw form adds none).
		expect(Object.keys(payload).sort()).toEqual([
			"description",
			"name",
			"widget_title",
		]);
	});

	it("posts description undefined when the description is blank", async () => {
		renderAgents();
		await screen.findByText("Active Agent");

		const sheet = await openCreateSheet();
		fireEvent.change(within(sheet).getByPlaceholderText("agents.namePlaceholder"), {
			target: { value: "Support Bot" },
		});
		fireEvent.change(within(sheet).getByLabelText("labels.description"), {
			target: { value: "   " },
		});
		fireEvent.click(within(sheet).getByRole("button", { name: "agents.create" }));

		await waitFor(() => {
			expect(mockedApi.createAgent).toHaveBeenCalledTimes(1);
		});
		const [payload] = mockedApi.createAgent.mock.calls[0];
		expect(payload).toEqual({
			name: "Support Bot",
			description: undefined,
			widget_title: "Support Bot",
		});
		expect(payload.description).toBeUndefined();
	});

	it("still clamps the name to twelve display units inside the sheet", async () => {
		renderAgents();
		await screen.findByText("Active Agent");

		const sheet = await openCreateSheet();
		const input = within(sheet).getByPlaceholderText("agents.namePlaceholder");
		fireEvent.change(input, { target: { value: "客服助手一二三" } });
		expect(input).toHaveValue("客服助手一二");

		fireEvent.click(within(sheet).getByRole("button", { name: "agents.create" }));
		await waitFor(() => {
			expect(mockedApi.createAgent).toHaveBeenCalledTimes(1);
		});
		expect(mockedApi.createAgent.mock.calls[0][0].name).toBe("客服助手一二");
	});

	it("keeps every row action in the overflow menu: pause, delete, restore", async () => {
		renderAgents([activeAgent, pausedAgent, deletedAgent]);
		await screen.findByText("Active Agent");
		await screen.findByText("Paused Agent");
		await screen.findByText("Deleted Agent");

		// Nothing row-scoped is inline; each row exposes one overflow trigger.
		expect(
			screen.queryByRole("button", { name: "agents.delete" }),
		).not.toBeInTheDocument();
		const triggers = screen.getAllByRole("button", {
			name: /^agents\.rowActions$/,
		});
		expect(triggers).toHaveLength(3);

		// An active agent: pause + delete, and never `open` — the row itself is
		// the way in (the row navigates, the name is a link).
		fireEvent.click(screen.getByTestId("agent-actions-agt_active"));
		const activeMenu = screen.getByTestId("agent-menu-agt_active");
		expect(
			within(activeMenu).getByTestId("agent-pause-agt_active"),
		).toHaveTextContent("agents.pause");
		expect(
			within(activeMenu).getByTestId("agent-delete-agt_active"),
		).toHaveTextContent("agents.delete");
		expect(
			within(activeMenu).queryByRole("menuitem", { name: "agents.open" }),
		).not.toBeInTheDocument();
		expect(
			within(activeMenu).queryByRole("menuitem", { name: "agents.restore" }),
		).not.toBeInTheDocument();
		// R3: knowledge-base binding is no longer a blind row-menu toggle.
		expect(
			within(activeMenu).queryByRole("menuitem", {
				name: /knowledgeBases\.actions\.(bind|unbind)/,
			}),
		).not.toBeInTheDocument();

		// A paused agent: resume + delete (it can still be deleted).
		fireEvent.click(screen.getByTestId("agent-actions-agt_paused"));
		const pausedMenu = screen.getByTestId("agent-menu-agt_paused");
		expect(
			within(pausedMenu).getByTestId("agent-resume-agt_paused"),
		).toHaveTextContent("agents.resume");
		expect(
			within(pausedMenu).getByTestId("agent-delete-agt_paused"),
		).toHaveTextContent("agents.delete");
		expect(
			within(pausedMenu).queryByTestId("agent-pause-agt_paused"),
		).not.toBeInTheDocument();
		expect(
			within(pausedMenu).queryByRole("menuitem", { name: "agents.open" }),
		).not.toBeInTheDocument();

		// A soft-deleted agent: restore only.
		fireEvent.click(screen.getByTestId("agent-actions-agt_deleted"));
		const deletedMenu = screen.getByTestId("agent-menu-agt_deleted");
		expect(
			within(deletedMenu).getByRole("menuitem", { name: "agents.restore" }),
		).toBeInTheDocument();
		expect(
			within(deletedMenu).queryByTestId("agent-delete-agt_deleted"),
		).not.toBeInTheDocument();
		expect(
			within(deletedMenu).queryByTestId("agent-pause-agt_deleted"),
		).not.toBeInTheDocument();
		// The soft-deleted row keeps its purge countdown visible.
		expect(
			within(
				screen.getByTestId("agent-row-agt_deleted"),
			).getByText(/^agents\.autoDeleteCountdown$/),
		).toBeInTheDocument();
	});

	it("asks for confirmation before the soft delete and does nothing when declined", async () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
		renderAgents();
		await screen.findByText("Active Agent");

		fireEvent.click(screen.getByTestId("agent-actions-agt_active"));
		fireEvent.click(screen.getByTestId("agent-delete-agt_active"));

		expect(confirmSpy).toHaveBeenCalledTimes(1);
		expect(mockedApi.deleteAgent).not.toHaveBeenCalled();

		confirmSpy.mockReturnValue(true);
		fireEvent.click(screen.getByTestId("agent-actions-agt_active"));
		fireEvent.click(screen.getByTestId("agent-delete-agt_active"));

		await waitFor(() => {
			expect(mockedApi.deleteAgent).toHaveBeenCalledWith("agt_active");
		});
		confirmSpy.mockRestore();
	});

	it("keeps the 375px contract: rows stack, no inline width overflow, 44px targets", async () => {
		mediaState.isMobile = true;
		const { container } = renderAgents();
		await screen.findByText("Active Agent");

		const page = screen.getByTestId("agents-page");

		// 1. Rows stack at mobile width instead of forcing two columns.
		const row = screen.getByTestId("agent-row-agt_active");
		expect(row.style.flexDirection).toBe("column");

		// 2. Nothing declares an inline width wider than the 375px viewport.
		const offenders: string[] = [];
		for (const element of Array.from(
			container.querySelectorAll<HTMLElement>("*"),
		)) {
			for (const property of ["width", "minWidth"] as const) {
				const raw = element.style[property];
				const pixels = /^(\d+(?:\.\d+)?)px$/.exec(raw.trim());
				if (pixels && Number(pixels[1]) > 375) {
					offenders.push(`${element.tagName.toLowerCase()} ${property}:${raw}`);
				}
			}
		}
		expect(offenders).toEqual([]);

		// 3. Every button in the page resolves to a >= 44px tap target, either
		//    declared inline or by a `min-height: 44px` rule in the mobile media
		//    block of src/index.css (the same resolution mobileLayout.test.tsx
		//    uses; jsdom cannot measure, so this is the promised contract).
		// R4 removed the row's aria-pressed name button, so the page now holds
		// the `+` and one overflow trigger per row. Keep the scan non-empty.
		const buttons = Array.from(page.querySelectorAll<HTMLElement>("button"));
		expect(buttons.length).toBeGreaterThan(1);
		const short = buttons
			.map((button) => ({
				button,
				height: resolvedMinHeight(button),
			}))
			.filter((entry) => entry.height < 44)
			.map(
				(entry) =>
					`${entry.button.getAttribute("aria-label") ?? entry.button.textContent?.trim()} -> ${entry.height}px`,
			);
		expect(short).toEqual([]);

		// 4. The overflow trigger does not rely on the stylesheet alone: it
		//    declares its own 44x44 hit target inline at mobile width, so the
		//    row action stays tappable even before the sheet/popover layer paints.
		const rowTrigger = screen.getByTestId("agent-actions-agt_active");
		expect(rowTrigger.style.minHeight).toBe("44px");
		expect(rowTrigger.style.minWidth).toBe("44px");

		// 5. The sheet opened from the page header is a bottom drawer at 375px and
		//    must not pin a desktop width either: re-run the width scan with the
		//    sheet in the DOM.
		await openCreateSheet();
		const sheet = screen.getByTestId("agent-create-sheet");
		const sheetOffenders = [sheet, ...Array.from(sheet.querySelectorAll<HTMLElement>("*"))]
			.flatMap((element) =>
				(["width", "minWidth"] as const).map((property) => ({
					element,
					property,
					raw: element.style[property],
				})),
			)
			.filter(({ raw }) => {
				const pixels = /^(\d+(?:\.\d+)?)px$/.exec(raw.trim());
				return Boolean(pixels) && Number(pixels?.[1]) > 375;
			})
			.map(({ element, property, raw }) => `${element.tagName} ${property}:${raw}`);
		expect(sheetOffenders).toEqual([]);
	});
});

/* ------------------------------------------------- 375px contract helpers */

/**
 * `src/index.css` belongs to the design-system lane, so the path is
 * overridable (default: the real file) purely so a mutation replay can point
 * this contract at a doctored copy instead of editing a file this lane does
 * not own.
 */
const INDEX_CSS_PATH =
	process.env.AGENTS_INDEX_CSS ?? resolve(process.cwd(), "src/index.css");
const INDEX_CSS = readFileSync(INDEX_CSS_PATH, "utf-8");

interface MobileRule {
	selectors: string[];
	declarations: string;
}

/** Rules inside the first `@media (max-width: 768px)` block of index.css. */
function mobileRules(): MobileRule[] {
	const marker = "@media (max-width: 768px)";
	const at = INDEX_CSS.indexOf(marker);
	if (at < 0) throw new Error('src/index.css must contain "@media (max-width: 768px)"');
	const open = INDEX_CSS.indexOf("{", at);
	let depth = 0;
	let close = -1;
	for (let index = open; index < INDEX_CSS.length; index += 1) {
		if (INDEX_CSS[index] === "{") depth += 1;
		else if (INDEX_CSS[index] === "}") {
			depth -= 1;
			if (depth === 0) {
				close = index;
				break;
			}
		}
	}
	if (close < 0) throw new Error("unbalanced mobile media block in index.css");
	const body = INDEX_CSS.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, "");

	const rules: MobileRule[] = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let match = re.exec(body);
	while (match !== null) {
		rules.push({
			selectors: match[1]
				.split(",")
				.map((selector) => selector.trim())
				.filter((selector) => selector.length > 0),
			declarations: match[2],
		});
		match = re.exec(body);
	}
	return rules;
}

/**
 * Declared height of a tap target: the larger of its inline `height` /
 * `minHeight` and any `min-height: Npx` declared in the mobile media block for
 * a selector it matches. jsdom has no layout engine, so this is the contract
 * the CSS promises, not a measurement.
 */
function resolvedMinHeight(element: HTMLElement): number {
	const inline = [element.style.height, element.style.minHeight]
		.map((value) => /^(\d+(?:\.\d+)?)px$/.exec(value.trim()))
		.map((match) => (match ? Number(match[1]) : 0));
	const fromCss = mobileRules().flatMap((rule) => {
		const declared = /min-height:\s*(\d+)px/.exec(rule.declarations);
		if (!declared) return [];
		const matches = rule.selectors.some((selector) => {
			try {
				return element.matches(selector);
			} catch {
				return false;
			}
		});
		return matches ? [Number(declared[1])] : [];
	});
	return Math.max(0, ...inline, ...fromCss);
}
