// @vitest-environment jsdom
/**
 * UI round 3 / R3 — the row menu must escape the list's clipping context.
 *
 * Measured root cause: `.list` and `.list-frame` both carry `overflow: hidden`
 * (they need it to keep the row hairlines inside the rounded corner), and the
 * menu was absolutely positioned inside a row. A 200×150 panel at y=500 sat
 * against a `ul.list` ending at y=508, so only 8px survived — invisible on
 * every screen size, not only on mobile.
 *
 * jsdom cannot measure overflow, so the honest stand-in is ANCESTRY: the open
 * panel must be a child of `document.body` and must NOT be a descendant of the
 * list or its frame. That assertion fails on the old inline implementation and
 * passes only with a portal. The geometry half is pinned separately on the pure
 * `computeMenuPosition` helper (jsdom has no layout engine, so pixel placement
 * can only be tested as math).
 */
import React, { useState } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom";
import RowMenu, { computeMenuPosition } from "../../src/components/RowMenu";

/** The list the menu is rendered from — the clip that used to eat the panel. */
function Harness({ align = "end" as "start" | "end" }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="list-frame">
			<ul className="list">
				<li className="list-row">
					<RowMenu
						label="row menu"
						triggerLabel="row actions"
						open={open}
						onOpenChange={setOpen}
						align={align}
						triggerTestId="rm-trigger"
						menuTestId="rm-menu"
					>
						<button type="button" role="menuitem" className="row-menu-item">
							Edit
						</button>
					</RowMenu>
				</li>
			</ul>
		</div>
	);
}

describe("R3 — the row menu lives outside the list", () => {
	it("portals the open panel into document.body, not into .list / .list-frame", () => {
		const { container } = render(<Harness />);

		fireEvent.click(screen.getByTestId("rm-trigger"));

		const menu = screen.getByTestId("rm-menu");
		expect(menu).toBeInTheDocument();
		expect(menu).toHaveAttribute("role", "menu");

		// The panel is a direct child of the body…
		expect(menu.parentElement).toBe(document.body);
		// …and belongs to NEITHER clipping container. This is the assertion that
		// goes red if anyone renders the menu inline again.
		expect(menu.closest(".list")).toBeNull();
		expect(menu.closest(".list-frame")).toBeNull();
		expect(container.contains(menu)).toBe(false);

		// The trigger itself stays in the row, where it belongs.
		const list = container.querySelector(".list") as HTMLElement;
		expect(list.contains(screen.getByTestId("rm-trigger"))).toBe(true);

		// It carries the panel class whose rule is `position: fixed`, which is
		// what removes it from the clipping ancestor's coordinate space.
		expect(menu.className).toContain("row-menu");
	});

	it("lays the items out as role=menuitem controls", () => {
		render(<Harness />);
		fireEvent.click(screen.getByTestId("rm-trigger"));

		const item = screen.getByRole("menuitem", { name: "Edit" });
		expect(item).toHaveClass("row-menu-item");
		expect(screen.getByTestId("rm-menu").contains(item)).toBe(true);
	});
});

describe("R3 — closing the menu", () => {
	it("closes on Escape and returns focus to the trigger", () => {
		render(<Harness />);
		const trigger = screen.getByTestId("rm-trigger");

		fireEvent.click(trigger);
		expect(trigger).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByTestId("rm-menu")).toBeInTheDocument();

		fireEvent.keyDown(document, { key: "Escape" });

		expect(screen.queryByTestId("rm-menu")).toBeNull();
		expect(trigger).toHaveAttribute("aria-expanded", "false");
		expect(document.activeElement).toBe(trigger);
	});

	it("closes when a menu item is chosen and hands focus back to the trigger", () => {
		render(<Harness />);
		const trigger = screen.getByTestId("rm-trigger");

		fireEvent.click(trigger);
		fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));

		expect(screen.queryByTestId("rm-menu")).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("closes on a click outside, but not on a click on its own trigger", () => {
		render(
			<div>
				<button type="button" data-testid="elsewhere">
					elsewhere
				</button>
				<Harness />
			</div>,
		);
		const trigger = screen.getByTestId("rm-trigger");

		fireEvent.click(trigger);
		// The trigger owns its toggle: a mousedown on it must not close first, or
		// the click would immediately reopen the panel.
		fireEvent.mouseDown(trigger);
		expect(screen.getByTestId("rm-menu")).toBeInTheDocument();

		fireEvent.mouseDown(screen.getByTestId("elsewhere"));
		expect(screen.queryByTestId("rm-menu")).toBeNull();
	});
});

describe("R3 — computeMenuPosition", () => {
	const viewport = { width: 1024, height: 768 };
	const menu = { width: 200, height: 150 };

	it("prefers below the trigger and right-aligns on `end`", () => {
		const position = computeMenuPosition(
			{ top: 100, bottom: 132, left: 500, right: 536 },
			menu,
			viewport,
			"end",
		);
		expect(position).toEqual({ top: 136, left: 336 });
	});

	it("left-aligns on `start`", () => {
		const position = computeMenuPosition(
			{ top: 100, bottom: 132, left: 500, right: 536 },
			menu,
			viewport,
			"start",
		);
		expect(position).toEqual({ top: 136, left: 500 });
	});

	it("flips above the trigger at the bottom edge", () => {
		// 736 + 150 = 886 > 768, and 700 - 150 - 4 = 546 is on screen.
		const position = computeMenuPosition(
			{ top: 700, bottom: 732, left: 500, right: 536 },
			menu,
			viewport,
			"end",
		);
		expect(position).toEqual({ top: 546, left: 336 });
	});

	it("clamps instead of flipping when there is no room above either", () => {
		const position = computeMenuPosition(
			{ top: 100, bottom: 132, left: 500, right: 536 },
			{ width: 200, height: 900 },
			viewport,
			"end",
		);
		expect(position.top).toBe(0);
	});

	it("shifts left at the right edge", () => {
		// Left-aligned, the panel would end at 1100 > 1024.
		const position = computeMenuPosition(
			{ top: 100, bottom: 132, left: 900, right: 936 },
			menu,
			viewport,
			"start",
		);
		expect(position).toEqual({ top: 136, left: 824 });
	});

	it("clamps into the viewport origin from both edges", () => {
		const position = computeMenuPosition(
			{ top: 4, bottom: 36, left: -120, right: -84 },
			menu,
			{ width: 375, height: 667 },
			"end",
		);
		expect(position).toEqual({ top: 40, left: 0 });
	});
});

describe("R3 — the .row-menu stylesheet block", () => {
	const CSS = readFileSync(resolve(process.cwd(), "src/index.css"), "utf-8");

	function block(selector: string): string {
		const start = CSS.indexOf(`${selector} {`);
		expect(start, `${selector} must exist in src/index.css`).toBeGreaterThan(-1);
		return CSS.slice(start, CSS.indexOf("}", start));
	}

	it("is a fixed, elevated panel one step above the page chrome", () => {
		const rule = block(".row-menu");
		expect(rule).toMatch(/position: fixed/);
		expect(rule).toMatch(/z-index: 60/);
		expect(rule).toMatch(/min-width: 200px/);
		expect(rule).toMatch(/border-radius: var\(--radius-lg\)/);
		expect(rule).toMatch(/box-shadow: var\(--shadow-lg\)/);
		expect(rule).toMatch(/background: var\(--color-bg-elevated\)/);
	});

	it("gives each item a 32px row and a hover surface, with no motion when reduced", () => {
		const rule = block(".row-menu-item");
		expect(rule).toMatch(/min-height: 32px/);
		expect(rule).toMatch(/padding: 0 var\(--space-3\)/);
		expect(rule).toMatch(/border-radius: var\(--radius-sm\)/);
		expect(rule).toMatch(/justify-content: flex-start/);

		expect(block(".row-menu-item:hover")).toMatch(
			/background: var\(--surface-hover\)/,
		);

		const reduced = CSS.slice(
			CSS.indexOf(
				"@media (prefers-reduced-motion: reduce)",
				CSS.indexOf(".row-menu"),
			),
		);
		expect(reduced).toMatch(/\.row-menu-item \{\s*transition: none;/);
	});
});
