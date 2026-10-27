// @vitest-environment jsdom
/**
 * Polish wave A / spec §2 + §4 (lane LIST) — scannable status badges and a
 * list that teaches you what it is.
 *
 * The contract this file pins:
 *   1. both lists carry a desktop column-header row that sits OUTSIDE the
 *      <ul class="list"> (so it never becomes a third listitem at 375px) and
 *      disappears with the list;
 *   2. both empty states teach: title + one-line description + create action;
 *   3. the NAME is the affordance, not the row: the KB name stays a link with
 *      a chevron, the agent name stays inside its aria-pressed selection
 *      button with a chevron, and neither row becomes an anchor or a
 *      row-level click target;
 *   4. a state badge carries a 6px dot on `::before`, and the pulse RING moved
 *      to `::after` so the two pseudo-elements never collide.
 *
 * The CSS half reads src/index.css from disk, the way
 * tests/unit/mobileLayout.test.tsx does, so the visual contract cannot rot
 * silently behind a green DOM test.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import KnowledgeBases from "../../src/views/KnowledgeBases";
import Agents from "../../src/views/Agents";
import { api } from "../../src/services/api";
import type { Agent, KnowledgeBaseDetail } from "../../src/services/api";

const authState: { role: string } = { role: "super_admin" };

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		admin: {
			id: 1,
			name: "Owner",
			email: "owner@example.com",
			role: authState.role,
		},
		token: "test-token",
		logout: vi.fn(),
	}),
}));

vi.mock("../../src/services/api", () => ({
	api: {
		listKnowledgeBases: vi.fn(),
		listAgents: vi.fn(),
		createKnowledgeBase: vi.fn(),
		resetKnowledgeBase: vi.fn(),
		deleteKnowledgeBase: vi.fn(),
		bindAgentKnowledgeBase: vi.fn(),
		testEmbeddingConfig: vi.fn(),
		getKnowledgeBase: vi.fn(),
		getKbSourcesSummary: vi.fn(),
		createAgent: vi.fn(),
		deleteAgent: vi.fn(),
		restoreAgent: vi.fn(),
		setSelectedAgentId: vi.fn(),
		clearSelectedAgentId: vi.fn(),
		getSelectedAgentId: vi.fn(),
		kbStatus: vi.fn(),
	},
}));

vi.mock("../../src/hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
	useIsTablet: () => false,
	useIsDesktop: () => true,
	useMediaQuery: () => false,
}));

/** Keys are returned verbatim so assertions target i18n keys directly. */
function stableT(key: string, params?: Record<string, unknown>) {
	return params ? `${key}|${JSON.stringify(params)}` : key;
}

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: stableT }),
}));

vi.mock("../../src/components/AdminLayout", () => ({
	default: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="admin-layout">{children}</div>
	),
}));

const mockedApi = vi.mocked(api);

/* ---------------------------------------------------------------- fixtures */

const boundKb: KnowledgeBaseDetail = {
	id: "kb_bound",
	name: "Bound KB",
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
};

const unboundKb: KnowledgeBaseDetail = {
	...boundKb,
	id: "kb_free",
	name: "Unbound KB",
	bound_agent: null,
};

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
	kb_id: "kb_bound",
	kb_name: "Bound KB",
};

const inactiveAgent: Agent = {
	...activeAgent,
	id: "agt_inactive",
	name: "Inactive Agent",
	is_active: false,
};

/* ------------------------------------------------------------------ render */

function LocationProbe() {
	const location = useLocation();
	return (
		<div data-testid="location">{`${location.pathname}${location.search}`}</div>
	);
}

function renderKnowledgeBases(kbs: KnowledgeBaseDetail[]) {
	mockedApi.listKnowledgeBases.mockResolvedValue({
		knowledge_bases: kbs,
		total: kbs.length,
	});
	return render(
		<MemoryRouter initialEntries={["/knowledge-bases"]}>
			<Routes>
				<Route path="/knowledge-bases" element={<KnowledgeBases />} />
				<Route
					path="/knowledge-bases/:kbId"
					element={<div>route:KnowledgeBaseDetail</div>}
				/>
			</Routes>
			<LocationProbe />
		</MemoryRouter>,
	);
}

function renderAgents(agents: Agent[]) {
	mockedApi.listAgents.mockResolvedValue({ agents, total: agents.length });
	return render(
		<MemoryRouter initialEntries={["/agents"]}>
			<Routes>
				<Route path="/agents" element={<Agents />} />
				<Route path="/agents/:agentId/dashboard" element={<div>dash</div>} />
			</Routes>
			<LocationProbe />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	authState.role = "super_admin";
	mockedApi.listKnowledgeBases.mockResolvedValue({
		knowledge_bases: [boundKb, unboundKb],
		total: 2,
	});
	mockedApi.listAgents.mockResolvedValue({
		agents: [activeAgent, inactiveAgent],
		total: 2,
	});
	vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
});

/* ------------------------------- 1. KB column header row (§4 header row) */

describe("spec §4 — desktop column header row", () => {
	it("KB list header row lists every column, sits outside the <ul>, and is absent when the list is empty", async () => {
		const { unmount } = renderKnowledgeBases([boundKb, unboundKb]);

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);

		const header = screen.getByTestId("kb-list-header");
		expect(header).toHaveClass("list-header");

		const list = screen.getByTestId("kb-list");
		expect(list.tagName).toBe("UL");
		// The header must NOT be a listitem: the 375px contract pins the <ul> to
		// exactly one <li class="list-row"> per KB.
		expect(list.contains(header)).toBe(false);
		expect(within(list).getAllByRole("listitem")).toHaveLength(2);

		const labels = Array.from(
			header.querySelectorAll(".list-header-cell"),
		).map((cell) => cell.textContent);
		expect(labels).toEqual([
			"knowledgeBases.columns.name",
			"knowledgeBases.columns.documents",
			"knowledgeBases.columns.chunks",
			"knowledgeBases.columns.boundAgent",
			"knowledgeBases.columns.status",
			"knowledgeBases.columns.actions",
		]);

		unmount();

		renderKnowledgeBases([]);
		expect(await screen.findByTestId("kb-list-empty")).toBeInTheDocument();
		expect(screen.queryByTestId("kb-list-header")).not.toBeInTheDocument();
	});

	it("hides the descriptor row at 375px from inside the mobile media block", () => {
		// The row repeats the list's horizontal padding and gap on desktop; at
		// mobile width there are no columns, so the ONE rule that hides it lives
		// in the existing @media (max-width: 768px) block.
		const headerRules = declarationsForSelector(".list-header");
		expect(headerRules.length).toBeGreaterThan(0);
		const desktop = RULES.filter((rule) =>
			rule.selectors.includes(".list-header") && rule.atMedia.length === 0,
		)
			.map((rule) => rule.declarations)
			.join(" ");
		expect(desktop).toMatch(/padding: var\(--space-2\) var\(--space-4\)/);
		expect(desktop).toMatch(/gap: var\(--space-4\)/);

		const hidden = RULES.filter(
			(rule) =>
				rule.selectors.includes(".list-header") &&
				rule.atMedia.some((at) => at === "@media (max-width: 768px)"),
		).map((rule) => rule.declarations);
		expect(
			hidden.some((decl) => /display: none/.test(decl)),
			".list-header must be hidden inside @media (max-width: 768px)",
		).toBe(true);
	});

	it("binds the header and the data row to ONE shared column template (R1)", () => {
		const base = (selector: string) =>
			RULES.filter(
				(rule) =>
					rule.selectors.includes(selector) && rule.atMedia.length === 0,
			)
				.map((rule) => rule.declarations)
				.join(" ");

		// Both rules read the SAME custom property, so the two column templates
		// cannot drift apart. A literal template in either rule would fail here.
		for (const selector of [".list-grid", ".list-header"]) {
			expect(
				base(selector),
				`${selector} must use the shared column template`,
			).toMatch(/grid-template-columns: var\(--list-columns\)/);
			expect(base(selector), `${selector} must be a grid`).toMatch(
				/display: grid/,
			);
		}

		// Each list flavour declares the ONE template the rows and the header
		// share. It must be a concrete track list, and the trailing tracks must
		// be fixed widths rather than `auto`: an `auto` track sizes to its own
		// content, so the header's short label and the row's value/button would
		// resolve to different widths and every later column would drift.
		for (const flavour of [".list-grid--kb", ".list-grid--agents"]) {
			const declarations = base(flavour);
			expect(
				declarations,
				`${flavour} must declare its own --list-columns template`,
			).toMatch(/--list-columns:\s*minmax\(0,\s*1fr\)/);
			expect(
				declarations,
				`${flavour} must not use content-sized tracks`,
			).not.toMatch(/--list-columns:[^;]*\bauto\b/);
		}

		// R2: rows centre their cells on one line.
		expect(base(".list-grid"), "rows share one centre line").toMatch(
			/align-items: center/,
		);

		// R2: the description is capped at one line with an ellipsis.
		const description = base(".list-row-description");
		expect(description).toMatch(/text-overflow: ellipsis/);
		expect(description).toMatch(/white-space: nowrap/);
		expect(description).toMatch(/overflow: hidden/);

		// Mobile: the grid collapses to one column and the header is hidden, so
		// the stacked block layout is the mobile contract, not a two-column row.
		const mobileGrid = RULES.filter(
			(rule) =>
				rule.selectors.includes(".list-grid") &&
				rule.atMedia.some((at) => at === "@media (max-width: 768px)"),
		).map((rule) => rule.declarations);
		expect(
			mobileGrid.some((decl) =>
				/grid-template-columns:\s*1fr\s*!important/.test(decl),
			),
			".list-grid must collapse to a single 1fr column at 768px",
		).toBe(true);
	});

	it("Agents list header row lists name / meta / status / actions and is absent when the list is empty", async () => {
		const { unmount } = renderAgents([activeAgent, inactiveAgent]);

		await waitFor(() =>
			expect(screen.getByTestId("agent-row-agt_active")).toBeInTheDocument(),
		);

		const header = screen.getByTestId("agents-list-header");
		expect(header).toHaveClass("list-header");

		const list = screen.getByTestId("agents-list");
		expect(list.tagName).toBe("UL");
		expect(list.contains(header)).toBe(false);
		expect(within(list).getAllByRole("listitem")).toHaveLength(2);

		const labels = Array.from(
			header.querySelectorAll(".list-header-cell"),
		).map((cell) => cell.textContent);
		expect(labels).toEqual([
			"agents.columns.name",
			"agents.columns.knowledgeBase",
			"agents.columns.updated",
			"agents.columns.status",
			"agents.columns.actions",
		]);

		unmount();

		renderAgents([]);
		expect(await screen.findByTestId("agents-empty")).toBeInTheDocument();
		expect(screen.queryByTestId("agents-list-header")).not.toBeInTheDocument();
	});
});

/* ------------------------------------ 2. teaching empty states (§4 empty) */

describe("spec §4 — the empty state teaches", () => {
	it("KB empty state has a title, a description and a primary create action, and no header row", async () => {
		renderKnowledgeBases([]);

		const empty = await screen.findByTestId("kb-list-empty");
		expect(empty).toHaveClass("empty");

		const title = empty.querySelector(".empty-title");
		expect(title).toHaveTextContent("knowledgeBases.empty");

		const description = empty.querySelector(".empty-description");
		expect(description).not.toBeNull();
		expect(description).toHaveTextContent("knowledgeBases.emptyHint");

		const action = within(empty).getByRole("button", {
			name: "knowledgeBases.newKnowledgeBase",
		});
		expect(action).toHaveClass("btn");
		expect(action).toHaveClass("btn-primary");
		expect(action.closest(".empty-actions")).not.toBeNull();

		expect(screen.queryByTestId("kb-list-header")).not.toBeInTheDocument();
	});

	it("Agents empty state has a title, a one-line description and a primary create action", async () => {
		renderAgents([]);

		const empty = await screen.findByTestId("agents-empty");
		expect(empty).toHaveClass("empty");

		expect(empty.querySelector(".empty-title")).toHaveTextContent(
			"agents.empty",
		);

		const description = empty.querySelector(".empty-description");
		expect(description).not.toBeNull();
		expect(description).toHaveTextContent("agents.emptyHint");

		const action = within(empty).getByRole("button", {
			name: "agents.createTitle",
		});
		expect(action).toHaveClass("btn");
		expect(action).toHaveClass("btn-primary");
		expect(action.closest(".empty-actions")).not.toBeNull();
	});
});

/* ----------------------------- 3. the name is the affordance, not the row */

describe("spec §4 — the name carries the affordance", () => {
	it("KB: the name links to /knowledge-bases/:kbId with the affordance class and a chevron, and the row itself is not a link or a click target", async () => {
		renderKnowledgeBases([boundKb, unboundKb]);

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);

		const name = screen.getByTestId("kb-name-kb_bound");
		expect(name.tagName).toBe("A");
		expect(name).toHaveAttribute("href", "/knowledge-bases/kb_bound");
		expect(name).toHaveClass("list-row-title");
		expect(name).toHaveClass("list-row-affordance");

		// The chevron travels with the name: it lives in the name cluster inside
		// .list-row-main, not at the far end of the row.
		const cluster = name.closest(".list-row-name");
		expect(cluster).not.toBeNull();
		const chevron = (cluster as HTMLElement).querySelector(".list-row-chevron");
		expect(chevron).not.toBeNull();
		expect(chevron).toHaveAttribute("aria-hidden", "true");
		expect(chevron).toHaveAttribute("stroke", "currentColor");
		expect(
			(name.closest(".list-row-main") as HTMLElement).contains(chevron),
		).toBe(true);

		// No giant row link: the row is an <li>, and the only anchor in it is the
		// name. A row-level click must not navigate.
		const row = screen.getByTestId("kb-row-kb_bound");
		expect(row.tagName).toBe("LI");
		expect(row.querySelectorAll("a")).toHaveLength(1);

		expect(screen.getByTestId("location")).toHaveTextContent(
			"/knowledge-bases",
		);
		fireEvent.click(row);
		expect(screen.getByTestId("location")).toHaveTextContent(
			"/knowledge-bases",
		);

		// ...but the name still does.
		fireEvent.click(name);
		await waitFor(() =>
			expect(screen.getByTestId("location")).toHaveTextContent(
				"/knowledge-bases/kb_bound",
			),
		);
	});

	it("Agents: the selection control stays an aria-pressed button holding the affordance name and a chevron, and the row is not an anchor", async () => {
		renderAgents([activeAgent, inactiveAgent]);

		await waitFor(() =>
			expect(screen.getByTestId("agent-row-agt_active")).toBeInTheDocument(),
		);

		const row = screen.getByTestId("agent-row-agt_active");
		expect(row.tagName).toBe("LI");
		expect(row.querySelectorAll("a")).toHaveLength(0);

		const control = row.querySelector(".list-row-main");
		expect(control).not.toBeNull();
		expect((control as HTMLElement).tagName).toBe("BUTTON");
		// The first row is the auto-selected agent.
		expect(control).toHaveAttribute("aria-pressed", "true");

		const name = (control as HTMLElement).querySelector(".list-row-title");
		expect(name).not.toBeNull();
		expect(name).toHaveClass("list-row-affordance");
		expect(name).toHaveTextContent("Active Agent");

		const chevron = (control as HTMLElement).querySelector(".list-row-chevron");
		expect(chevron).not.toBeNull();
		expect(chevron).toHaveAttribute("aria-hidden", "true");
		expect(chevron).toHaveAttribute("stroke", "currentColor");

		// The KB meta is now its OWN column cell (R1), no longer nested inside the
		// selection control: the control carries the name (+ chevron) and the
		// description under it, and the knowledge-base value lives one column to
		// the right. Both still belong to the same row.
		expect(control?.querySelector(`[data-testid="agent-kb-agt_active"]`)).toBe(
			null,
		);
		expect(
			within(row).getByTestId("agent-kb-agt_active"),
		).toHaveTextContent("Bound KB");

		// Selecting still goes through the button; clicking the row body does not.
		const other = screen.getByTestId("agent-row-agt_inactive").querySelector(
			".list-row-main",
		);
		expect(other).toHaveAttribute("aria-pressed", "false");
		fireEvent.click(other as Element);
		await waitFor(() =>
			expect(other).toHaveAttribute("aria-pressed", "true"),
		);
		expect(
			screen
				.getByTestId("agent-row-agt_active")
				.querySelector(".list-row-main"),
		).toHaveAttribute("aria-pressed", "false");
	});
});

/* =============================================================================
 * Polish rework R1 + R2 + R5 — the header row is a real column grid, the row's
 * meta line no longer repeats the columns, and the kebab is a labelled
 * `btn-icon`.
 *
 * jsdom has no layout engine, so "the header sits above its value" cannot be
 * measured in pixels. What CAN be pinned — and what actually broke — is that
 * the header and the data row share one column contract: the same number of
 * cells, in the same order, and each header cell occupying the same column
 * index as the data cell that carries the matching `data-testid`. That is the
 * structural property a flex row with two merged clusters does not have.
 * ============================================================================= */

/**
 * The direct children of a grid container, in DOM order. jsdom applies no UA
 * stylesheet for `display: grid`, so `children` IS the track order: cell N of
 * the header and cell N of the row are in column N.
 */
function gridCells(el: HTMLElement): HTMLElement[] {
	return Array.from(el.children) as HTMLElement[];
}

/**
 * Asserts the shared column contract for one list: equal cell counts, and one
 * header cell per named data cell, at the same column index.
 *
 * `columns` maps a human column name to the `data-testid` of the data cell that
 * renders it, in header order.
 */
function assertColumnContract(
	header: HTMLElement,
	row: HTMLElement,
	columns: Array<{ name: string; testId: string }>,
) {
	const headerCells = gridCells(header);
	const rowCells = gridCells(row);

	expect(
		headerCells.length,
		`header cells (${headerCells.length}) must equal data cells (${rowCells.length})`,
	).toBe(rowCells.length);

	columns.forEach((column, index) => {
		expect(
			headerCells[index],
			`column ${index} (${column.name}) must be a .list-header-cell`,
		).toHaveClass("list-header-cell");

		const valueCell = rowCells[index];
		expect(
			valueCell,
			`column ${index} (${column.name}) must exist in the data row`,
		).toBeDefined();

		// The data cell (or the element inside it, for the cell that wraps a
		// control) carries the testid this column is about...
		const carrier = row.querySelector(`[data-testid="${column.testId}"]`);
		expect(
			carrier,
			`${column.testId} must render in the data row`,
		).not.toBeNull();
		// ...and it must be the cell at this column index, not some other cell.
		expect(
			valueCell.contains(carrier) || valueCell === carrier,
			`${column.testId} must sit in column ${index}, the column whose header is "${column.name}"`,
		).toBe(true);
	});
}

describe("polish R1 — the header row and the data row share one column grid", () => {
	it("KB list: header and row have the same cell count and matching column indexes", async () => {
		renderKnowledgeBases([boundKb, unboundKb]);

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);

		const header = screen.getByTestId("kb-list-header");
		const row = screen.getByTestId("kb-row-kb_bound");

		// Both the header and the row opt into the same grid contract: the shared
		// `.list-grid` plus the KB flavour. Without the flavour the two
		// `grid-template-columns` values could drift apart.
		expect(header).toHaveClass("list-grid");
		expect(header).toHaveClass("list-grid--kb");
		expect(row).toHaveClass("list-grid");
		expect(row).toHaveClass("list-grid--kb");

		assertColumnContract(header, row, [
			{ name: "knowledgeBases.columns.name", testId: "kb-name-kb_bound" },
			{
				name: "knowledgeBases.columns.documents",
				testId: "kb-documents-kb_bound",
			},
			{ name: "knowledgeBases.columns.chunks", testId: "kb-chunks-kb_bound" },
			{
				name: "knowledgeBases.columns.boundAgent",
				testId: "kb-bound-agent-kb_bound",
			},
			{ name: "knowledgeBases.columns.status", testId: "kb-status-kb_bound" },
			{
				name: "knowledgeBases.columns.actions",
				testId: "kb-actions-cell-kb_bound",
			},
		]);

		// Six columns, one cell each — no merged cluster standing in for two.
		expect(gridCells(row)).toHaveLength(6);

		// The skeleton rows are not part of the column contract; every real row
		// must have the same shape as the one asserted above.
		const second = screen.getByTestId("kb-row-kb_free");
		expect(gridCells(second)).toHaveLength(6);
	});

	it("Agents list: header and row have the same cell count and matching column indexes", async () => {
		renderAgents([activeAgent, inactiveAgent]);

		await waitFor(() =>
			expect(screen.getByTestId("agent-row-agt_active")).toBeInTheDocument(),
		);

		const header = screen.getByTestId("agents-list-header");
		const row = screen.getByTestId("agent-row-agt_active");

		expect(header).toHaveClass("list-grid");
		expect(header).toHaveClass("list-grid--agents");
		expect(row).toHaveClass("list-grid");
		expect(row).toHaveClass("list-grid--agents");

		assertColumnContract(header, row, [
			{ name: "agents.columns.name", testId: "agent-chevron-agt_active" },
			{
				name: "agents.columns.knowledgeBase",
				testId: "agent-kb-agt_active",
			},
			{
				name: "agents.columns.updated",
				testId: "agent-updated-agt_active",
			},
			{ name: "agents.columns.status", testId: "agent-status-agt_active" },
			{
				name: "agents.columns.actions",
				testId: "agent-actions-cell-agt_active",
			},
		]);

		expect(gridCells(row)).toHaveLength(5);
		expect(gridCells(screen.getByTestId("agent-row-agt_inactive"))).toHaveLength(
			5,
		);
	});
});

describe("polish R2 — the row stops repeating the columns", () => {
	it("KB row: the name cell holds only the name + chevron + description (no 文档/分块 text)", async () => {
		renderKnowledgeBases([boundKb, unboundKb]);

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);

		const nameCell = screen
			.getByTestId("kb-name-kb_bound")
			.closest(".list-cell") as HTMLElement;
		expect(nameCell).not.toBeNull();

		// The duplicated labels are gone: the header names the column, the cell
		// carries the value. `2/3` and `11` now live in their own cells.
		expect(nameCell).not.toHaveTextContent("knowledgeBases.columns.documents");
		expect(nameCell).not.toHaveTextContent("knowledgeBases.columns.chunks");
		expect(nameCell).toHaveTextContent("Bound KB");

		// The description is still here, under the name, in the same cell.
		expect(
			nameCell.querySelector(".list-row-description"),
		).not.toBeNull();

		// ...and each value now sits in its own cell, value-only.
		expect(screen.getByTestId("kb-documents-kb_bound")).toHaveTextContent(
			"2/3",
		);
		expect(screen.getByTestId("kb-chunks-kb_bound")).toHaveTextContent("11");
	});

	it("Agents row: the knowledge-base value has its own cell and no inline 知识库 label", async () => {
		renderAgents([activeAgent, inactiveAgent]);

		await waitFor(() =>
			expect(screen.getByTestId("agent-row-agt_active")).toBeInTheDocument(),
		);

		const kbCell = screen.getByTestId("agent-kb-agt_active");
		expect(kbCell).toHaveTextContent("Bound KB");
		// The column header now names it: repeating `agents.kbColumn` inside the
		// cell was the R2 duplication.
		expect(kbCell).not.toHaveTextContent("agents.kbColumn");

		// The name cell still holds the description under the name.
		const nameCell = screen
			.getByTestId("agent-chevron-agt_active")
			.closest(".list-cell") as HTMLElement;
		expect(
			nameCell.querySelector(".list-row-description"),
		).toHaveTextContent("Answers questions");
	});
});

describe("polish R5 — the row menu is a labelled icon button", () => {
	/** Every row-level overflow trigger: `btn-icon` + an accessible name. */
	function assertMenuButtons(rows: HTMLElement[], rowLabelKey: string) {
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			const buttons = Array.from(
				row.querySelectorAll<HTMLElement>('[aria-haspopup="menu"]'),
			);
			expect(
				buttons,
				"each row exposes exactly one overflow menu trigger",
			).toHaveLength(1);
			const trigger = buttons[0];
			// The 36px hit area comes from the primitive, not from a bare glyph.
			expect(trigger).toHaveClass("btn-icon");
			expect(trigger).toHaveClass("btn");
			// The accessible name comes from i18n (the mock echoes the key plus its
			// params), so it names the row it belongs to.
			const label = trigger.getAttribute("aria-label") ?? "";
			expect(
				label.startsWith(`${rowLabelKey}|`),
				`the menu button must be named by ${rowLabelKey}, got "${label}"`,
			).toBe(true);
		}
	}

	it("KB rows: every kebab carries the btn-icon class and an i18n aria-label", async () => {
		renderKnowledgeBases([boundKb, unboundKb]);

		await waitFor(() =>
			expect(screen.getByTestId("kb-row-kb_bound")).toBeInTheDocument(),
		);

		assertMenuButtons(
			[
				screen.getByTestId("kb-row-kb_bound"),
				screen.getByTestId("kb-row-kb_free"),
			],
			"knowledgeBases.rowActions",
		);

		// The `btn-icon` primitive is a real 36px square in the stylesheet.
		const icon = declarationsForSelector(".btn-icon").join(" ");
		expect(icon).toMatch(/min-width: 36px/);
		expect(icon).toMatch(/min-height: 36px/);
	});

	it("Agents rows: every kebab carries the btn-icon class and an i18n aria-label", async () => {
		renderAgents([activeAgent, inactiveAgent]);

		await waitFor(() =>
			expect(screen.getByTestId("agent-row-agt_active")).toBeInTheDocument(),
		);

		assertMenuButtons(
			[
				screen.getByTestId("agent-row-agt_active"),
				screen.getByTestId("agent-row-agt_inactive"),
			],
			"agents.rowActions",
		);
	});
});

/* ---------------------------- 4. the badge dot, parsed from src/index.css */

interface CssRule {
	selectors: string[];
	declarations: string;
	atMedia: string[];
}

const INDEX_CSS_PATH = resolve(process.cwd(), "src/index.css");
const CSS = readFileSync(INDEX_CSS_PATH, "utf-8").replace(/\/\*[\s\S]*?\*\//g, " ");

function parseRules(src: string, atMedia: string[] = []): CssRule[] {
	const rules: CssRule[] = [];
	let buffer = "";
	let index = 0;
	while (index < src.length) {
		const char = src[index];
		if (char === "{") {
			const selectorText = buffer.trim();
			buffer = "";
			let depth = 1;
			let cursor = index + 1;
			while (cursor < src.length && depth > 0) {
				if (src[cursor] === "{") depth += 1;
				else if (src[cursor] === "}") depth -= 1;
				cursor += 1;
			}
			const body = src.slice(index + 1, cursor - 1);
			index = cursor;
			if (selectorText.startsWith("@media") || selectorText.startsWith("@supports")) {
				rules.push(...parseRules(body, [...atMedia, selectorText.replace(/\s+/g, " ")]));
				continue;
			}
			if (selectorText.startsWith("@")) continue;
			rules.push({
				selectors: selectorText
					.split(",")
					.map((part) => part.trim())
					.filter((part) => part.length > 0),
				declarations: body.replace(/\s+/g, " "),
				atMedia,
			});
			continue;
		}
		if (char === ";" || char === "}") {
			buffer = "";
			index += 1;
			continue;
		}
		buffer += char;
		index += 1;
	}
	return rules;
}

const RULES = parseRules(CSS);

function declarationsForSelector(selector: string): string[] {
	return RULES.filter((rule) => rule.selectors.includes(selector)).map(
		(rule) => rule.declarations,
	);
}

/** All declarations targeting `pseudo` on `.badge-<state>`. */
function badgePseudo(state: string, pseudo: "::before" | "::after"): string {
	return RULES.filter((rule) =>
		rule.selectors.includes(`.badge-${state}${pseudo}`),
	)
		.map((rule) => rule.declarations)
		.join(" ");
}

describe("spec §2 — a state badge is a dot plus a label", () => {
	it("every state badge declares a 6px currentColor ::before dot with a full radius", () => {
		for (const state of ["success", "warning", "error", "info"]) {
			const dot = badgePseudo(state, "::before");
			expect(dot, `.badge-${state}::before must exist`).not.toBe("");
			expect(dot, `.badge-${state} dot must be 6px wide`).toMatch(
				/width: 6px/,
			);
			expect(dot, `.badge-${state} dot must be 6px tall`).toMatch(
				/height: 6px/,
			);
			expect(dot, `.badge-${state} dot must be round`).toContain(
				"border-radius: var(--radius-full)",
			);
			expect(dot, `.badge-${state} dot must paint with currentColor`).toContain(
				"background: currentColor",
			);
			expect(dot, `.badge-${state} dot must not shrink`).toContain(
				"flex-shrink: 0",
			);
			expect(dot, `.badge-${state} dot must have content`).toContain(
				"content: ''",
			);
		}
	});

	it("the pulse ring lives on ::after so it never collides with the dot on ::before", () => {
		// No standalone `.badge-pulse::before` rule may claim the ring any more.
		const beforeRules = RULES.filter((rule) =>
			rule.selectors.includes(".badge-pulse::before"),
		);
		expect(
			beforeRules.map((rule) => rule.declarations),
			".badge-pulse must not style ::before (the dot owns it)",
		).toEqual([]);

		const ring = badgePseudo("pulse", "::after");
		expect(ring, ".badge-pulse::after must carry the ring").toContain(
			"animation: pulse-ring",
		);
		expect(ring).toContain("border: 1px solid var(--color-success)");
		expect(ring).toContain("position: absolute");

		// Reduced motion must neutralise the ring on the same pseudo-element.
		const reduced = RULES.filter((rule) =>
			rule.atMedia.some((at) => at.includes("prefers-reduced-motion")),
		);
		const reducedSelectors = reduced.flatMap((rule) => rule.selectors);
		expect(
			reducedSelectors,
			"reduced motion must still kill the pulse ring",
		).toContain(".badge-pulse::after");
		expect(reducedSelectors).not.toContain(".badge-pulse::before");
	});

	it("the stronger tint is mixed over the existing tint token and no literal colour is introduced", () => {
		for (const state of ["success", "warning", "error", "info"]) {
			const base = declarationsForSelector(`.badge-${state}`).join(" ");
			expect(base, `.badge-${state} keeps its state text colour`).toContain(
				`color: var(--color-${state});`,
			);
			expect(base, `.badge-${state} keeps its state border`).toContain(
				`border-color: var(--color-${state})`,
			);
			// The pill is the tint token carried ~10% stronger, mixed in sRGB —
			// not the bare token, and never a literal colour.
			const background = String(
				new Map(
					[...base.matchAll(/([a-z-]+):\s*([^;]+)/g)].map((match) => [
						match[1],
						match[2].trim(),
					]),
				).get("background"),
			);
			expect(background, `.badge-${state} carries a stronger tint`).toMatch(
				/^color-mix\(/,
			);
			expect(
				background,
				`.badge-${state} tint is mixed over --color-${state}-bg`,
			).toContain(`var(--color-${state}-bg)`);
			expect(
				background,
				`.badge-${state} tint is mixed OVER the state colour`,
			).toMatch(new RegExp(`var\\(--color-${state}\\)\\s+\\d+%`));
			expect(
				/(?:^|\s)(?:#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\))/i.test(base),
				`.badge-${state} must not hard-code a colour`,
			).toBe(false);
		}
	});
});
