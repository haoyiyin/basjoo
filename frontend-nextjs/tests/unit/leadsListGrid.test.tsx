// @vitest-environment jsdom
/**
 * Admin UI lane — the lead inbox's responsive + keyboard contract.
 *
 * Two defects lived here:
 *
 *  1. RESPONSIVE. The rows and the label row each carried an inline
 *     `grid-template-columns` with four fixed tracks (110/130/160px). At 375px
 *     the tracks summed past the `.admin-page` clip, so the last columns
 *     (page / created / contacted) were cut off. The rows now opt into the
 *     shared `.list-grid` primitive (`list-grid--leads`), whose mobile media
 *     block collapses every column grid to one full-width column.
 *
 *  2. KEYBOARD. A row opened its detail panel only on click, and the name was
 *     a passive `<span>`, so a keyboard user could not reach the panel at all.
 *     The name is now a real `<button>` that carries `aria-expanded` and opens
 *     the panel from the keyboard too.
 *
 * The service is mocked (this file pins the rendered DOM + the CSS contract, not
 * the wire shape — `Leads.test.tsx` already owns the request contract).
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "@testing-library/jest-dom";
import Leads from "../../src/views/Leads";

vi.mock("../../src/components/AdminLayout", () => ({
	default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../src/hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
	useIsTablet: () => false,
	useIsDesktop: () => true,
	useMediaQuery: () => false,
}));

// Resolves immediately: the row must be in the DOM on the first paint after the
// promise lands, with no fetch layer in the way.
vi.mock("../../src/services/api", () => ({
	api: {
		listLeads: vi.fn(async () => ({
			items: [
				{
					id: "lead_1",
					agent_id: "agt_1",
					session_id: null,
					name: "Dana Visitor",
					email: "dana@example.com",
					phone: null,
					message: null,
					source: "prechat",
					page_url: "https://example.com/pricing",
					contacted: false,
					created_at: "2026-01-02T03:04:05Z",
				},
			],
			total: 1,
			uncontacted: 1,
		})),
		setLeadContacted: vi.fn(),
	},
}));

afterEach(() => {
	cleanup();
});

/**
 * `userEvent.setup()` before `render` is what flushes React's first commit under
 * this jsdom + Vitest + React 18 setup, so a `findBy*` on the very first render
 * resolves instead of racing the mocked service's promise. Keep it in the
 * helper so no test depends on call order.
 */
function renderLeads() {
	const user = userEvent.setup();
	render(
		<MemoryRouter initialEntries={["/leads"]}>
			<Leads />
		</MemoryRouter>,
	);
	return user;
}

describe("lead inbox — responsive list grid", () => {
	it("renders the rows and the label row on the shared .list-grid primitive", async () => {
		renderLeads();
		const row = await screen.findByTestId("lead-row-lead_1");

		expect(row).toHaveClass("list-row", "list-grid", "list-grid--leads");
		expect(screen.getByTestId("leads-list-header")).toHaveClass(
			"list-grid",
			"list-grid--leads",
		);
	});

	it("no longer pins the column plan inline on the row", async () => {
		renderLeads();
		const row = await screen.findByTestId("lead-row-lead_1");

		// The inline `grid-template-columns` was the overflow bug: it beat the
		// mobile media block and kept seven fixed/flexible tracks at 375px.
		expect(row.style.gridTemplateColumns).toBe("");
		expect(row.getAttribute("style") ?? "").not.toContain("grid-template-columns");
	});
});

describe("lead inbox — keyboard access to the detail panel", () => {
	it("opens the detail panel from the name button with Enter", async () => {
		const user = renderLeads();

		const name = await screen.findByTestId("lead-name-button-lead_1");
		expect(name.tagName).toBe("BUTTON");
		expect(name).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByTestId("lead-detail")).toBeNull();

		name.focus();
		await user.keyboard("{Enter}");

		expect(await screen.findByTestId("lead-detail")).toBeInTheDocument();
		expect(name).toHaveAttribute("aria-expanded", "true");
	});

	it("opens the panel from the name button with Space", async () => {
		const user = renderLeads();

		const name = await screen.findByTestId("lead-name-button-lead_1");
		name.focus();
		await user.keyboard(" ");

		expect(await screen.findByTestId("lead-detail")).toBeInTheDocument();
	});
});

describe("lead inbox — CSS contract", () => {
	const CSS = readFileSync(resolve(process.cwd(), "src/index.css"), "utf-8");

	it("declares a .list-grid--leads flavour with the seven-column plan", () => {
		const match = CSS.match(/\.list-grid--leads\s*\{([^}]*)\}/);
		expect(match, "src/index.css must define .list-grid--leads").not.toBeNull();
		const block = match?.[1] ?? "";
		expect(block).toContain("--list-columns:");
		const template = block.match(/--list-columns:\s*([^;]+);/)?.[1] ?? "";
		// Seven tracks: count the top-level space-separated track functions/values.
		expect(template.split(/\s+(?![^(]*\))/).length).toBe(7);
	});

	it("collapses every column grid to one column in the 768px mobile block", () => {
		// The generic mobile rule is what makes `.list-grid--leads` safe at 375px.
		expect(CSS).toMatch(
			/\.list-grid\s*\{\s*grid-template-columns:\s*1fr\s*!important;/,
		);
	});
});
