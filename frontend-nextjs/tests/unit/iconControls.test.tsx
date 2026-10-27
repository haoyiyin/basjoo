// @vitest-environment jsdom
/**
 * R3 — icon-first controls.
 *
 * There is no icon dependency: every glyph comes from `src/components/Icon.tsx`.
 * These checks are source-level on purpose, so a new view cannot introduce an
 * unlabelled icon button or a registry name typo without failing here.
 *
 *  1. every `<Icon name="…">` used in source exists in `ICON_NAMES`;
 *  2. every `.btn-icon` button declares both `aria-label` and `title`;
 *  3. no text glyph (`⋮`, `⋯`, `×`) is used as an icon;
 *  4. at render time, every button with no text content has an accessible name.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom";
import { ICON_NAMES } from "../../src/components/Icon";
import ChatPanel from "../../src/components/ChatPanel";
import type { Agent } from "../../src/components/ChatPanel";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "en" },
	}),
}));

const SOURCE_DIRS = ["src/views", "src/components"];

function sourceFiles(): string[] {
	return SOURCE_DIRS.flatMap((dir) =>
		readdirSync(dir)
			.filter((name) => name.endsWith(".tsx"))
			.map((name) => join(dir, name)),
	);
}

/** The opening `<tag …>` of every occurrence, brace- and quote-aware. */
function openingTags(source: string, tagName: string): string[] {
	const out: string[] = [];
	let i = 0;
	while ((i = source.indexOf(`<${tagName}`, i)) !== -1) {
		let depth = 0;
		let quote: string | null = null;
		let j = i + tagName.length + 1;
		for (; j < source.length; j += 1) {
			const ch = source[j];
			if (quote) {
				if (ch === quote) quote = null;
				continue;
			}
			if (ch === '"' || ch === "'" || ch === "`") {
				quote = ch;
			} else if (ch === "{") {
				depth += 1;
			} else if (ch === "}") {
				depth -= 1;
			} else if (ch === ">" && depth === 0) {
				break;
			}
		}
		out.push(source.slice(i, j + 1));
		i = j + 1;
	}
	return out;
}

function attributeIsNonEmpty(tag: string, name: string): boolean {
	const literal = new RegExp(`${name}="([^"]*)"`).exec(tag);
	if (literal) return literal[1].trim().length > 0;
	const expression = new RegExp(`${name}=\\{([^}]*)\\}`).exec(tag);
	if (expression) {
		const value = expression[1].trim();
		return value.length > 0 && value !== '""' && value !== "''";
	}
	return false;
}

describe("Icon registry (R3)", () => {
	it("only uses registry names in source", () => {
		const names = new Set<string>(ICON_NAMES);
		const used = new Set<string>();
		for (const file of sourceFiles()) {
			const source = readFileSync(file, "utf-8");
			for (const match of source.matchAll(/<Icon\s+name="([^"]+)"/g)) {
				used.add(match[1]);
			}
		}

		expect(used.size, "no view consumes the registry").toBeGreaterThan(0);
		const unknown = [...used].filter((name) => !names.has(name));
		expect(unknown, "every <Icon name> must exist in ICON_NAMES").toEqual([]);
	});

	it("keeps the registry names unique and every name reachable", () => {
		expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
		// The nav is the original consumer: all seven entries must survive.
		for (const name of [
			"home",
			"agents",
			"knowledge",
			"settings",
			"dashboard",
			"playground",
			"sessions",
		]) {
			expect(ICON_NAMES).toContain(name);
		}
	});
});

describe("icon-only buttons carry a label (R3)", () => {
	it("gives every .btn-icon button an aria-label and a title", () => {
		const failures: string[] = [];
		for (const file of sourceFiles()) {
			const source = readFileSync(file, "utf-8");
			for (const tag of openingTags(source, "button")) {
				if (!tag.includes("btn-icon")) continue;
				if (!attributeIsNonEmpty(tag, "aria-label")) {
					failures.push(`${file}: missing aria-label — ${tag.slice(0, 80)}`);
				}
				if (!attributeIsNonEmpty(tag, "title")) {
					failures.push(`${file}: missing title — ${tag.slice(0, 80)}`);
				}
			}
		}
		expect(failures).toEqual([]);
	});

	it("never uses a text glyph as an icon", () => {
		for (const file of sourceFiles()) {
			const source = readFileSync(file, "utf-8");
			expect(source, `${file} uses a banned text glyph`).not.toMatch(
				/>\s*[⋮⋯×+]\s*</,
			);
		}
	});

	it("labels every textless button in the rendered chat composer", () => {
		const agent: Agent = {
			id: "test-agent-123",
			name: "Test Agent",
			model: "gpt-4",
			temperature: 0.7,
			max_tokens: 1024,
			system_prompt: "You are a helpful assistant.",
		};
		const { container } = render(
			<ChatPanel
				messages={[]}
				input="hello"
				isLoading={false}
				isSettingsSaving={false}
				agent={agent}
				onInputChange={() => {}}
				onSendMessage={() => {}}
				onClearChat={() => {}}
			/>,
		);

		const textless = [...container.querySelectorAll("button")].filter(
			(button) => (button.textContent ?? "").trim().length === 0,
		);
		expect(textless.length).toBeGreaterThan(0);
		for (const button of textless) {
			expect(
				button.getAttribute("aria-label")?.trim(),
				`${button.outerHTML.slice(0, 120)} needs an aria-label`,
			).toBeTruthy();
			expect(button.getAttribute("title")?.trim()).toBeTruthy();
		}

		// The composer's send control is the converted primary icon button.
		expect(screen.getByRole("button", { name: "buttons.send" })).toHaveClass(
			"btn-icon",
		);
	});
});
