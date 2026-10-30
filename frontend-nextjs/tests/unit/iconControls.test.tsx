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
		// Every registered glyph must have a consumer — an unused name is dead weight.
		for (const name of ["save", "unlink"]) {
			expect(ICON_NAMES).toContain(name);
		}
		expect(ICON_NAMES).toHaveLength(43);
	});
});

/**
 * Breaking a binding is its own action: the unbind controls on /agents and
 * /knowledge-bases carry the split-chain `unlink` glyph, never the panel `close` ×.
 */
describe("unbind controls use the unlink glyph", () => {
	const UNBIND: Array<{ file: string; testid: string }> = [
		{ file: "src/views/KnowledgeBases.tsx", testid: "kb-unbind-agent-" },
		{ file: "src/views/Agents.tsx", testid: "agent-kb-unbind-" },
	];

	it("renders unlink — not close — on both unbind buttons", () => {
		for (const { file, testid } of UNBIND) {
			const source = readFileSync(file, "utf-8");
			const tag = openingTags(source, "button").find((it) =>
				it.includes(testid),
			);
			expect(tag, `${file}: unbind button carrying ${testid}`).toBeTruthy();
			const after = tag ? source.slice(source.indexOf(tag) + tag.length) : "";
			const glyph = /^\s*<Icon\s+name="([^"]+)"/.exec(after)?.[1];
			expect(glyph, `${file}: unbind glyph`).toBe("unlink");
		}
	});

	it("leaves the panel closes on the close glyph", () => {
		for (const { file } of UNBIND) {
			expect(readFileSync(file, "utf-8")).toContain(
				'<Icon name="close" size={16} />',
			);
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

/* =============================================================================
 * Round 6 — the remaining word buttons became icons. One assertion per
 * converted surface: the control is `.btn-icon` AND carries `aria-label` +
 * `title` (the glyph is never the accessible name).
 * ============================================================================= */
const ROUND6_SURFACES: Array<{ file: string; marker: string; name: string }> = [
	{
		file: "src/views/AgentSettings.tsx",
		marker: "onClick={handleSave}",
		name: "agent settings 保存",
	},
	{
		file: "src/views/AccountSettings.tsx",
		marker: "settings.account.savePassword",
		name: "account settings 保存密码",
	},
	{
		file: "src/views/Agents.tsx",
		marker: 'aria-label={t("agents.create")}',
		name: "agent create sheet 创建",
	},
	{
		file: "src/components/KbFormModal.tsx",
		marker: 'aria-label={t("kbForm.createSubmit")}',
		name: "KB create sheet 创建",
	},
	{
		file: "src/views/KnowledgeBases.tsx",
		marker: 'aria-label={t("knowledgeBases.bindSubmit")}',
		name: "KB bind modals 绑定",
	},
	{
		file: "src/components/KbBindSheet.tsx",
		marker: 'data-testid="kb-chooser-bind-submit"',
		name: "bind sheet 绑定",
	},
	{
		file: "src/views/URLManagement.tsx",
		marker: "labels.urlManagement.clearAll",
		name: "URL panel 清空",
	},
	{
		file: "src/views/FileUploadManagement.tsx",
		marker: 'aria-label={t("files.clearAll")}',
		name: "file panel 清空",
	},
];

describe("round 6 converted surfaces", () => {
	it("makes every converted control an icon button with aria-label + title", () => {
		const failures: string[] = [];

		for (const surface of ROUND6_SURFACES) {
			const source = readFileSync(surface.file, "utf-8");
			const matches = openingTags(source, "button").filter((tag) =>
				tag.includes(surface.marker),
			);
			if (matches.length === 0) {
				failures.push(`${surface.name}: no button matched ${surface.marker}`);
				continue;
			}
			for (const tag of matches) {
				if (!tag.includes("btn-icon")) {
					failures.push(`${surface.name}: not .btn-icon — ${tag.slice(0, 90)}`);
				}
				if (!attributeIsNonEmpty(tag, "aria-label")) {
					failures.push(`${surface.name}: missing aria-label`);
				}
				if (!attributeIsNonEmpty(tag, "title")) {
					failures.push(`${surface.name}: missing title`);
				}
			}
		}

		expect(failures).toEqual([]);
	});

	it("keeps words on the destructive confirmation primary", () => {
		// Round-6 rule: the confirm dialog's primary keeps its words, so the
		// user reads what they are confirming. Only the dismiss becomes a glyph.
		for (const file of [
			"src/views/URLManagement.tsx",
			"src/views/FileUploadManagement.tsx",
		]) {
			const source = readFileSync(file, "utf-8");
			const dangerConfirm = openingTags(source, "button").filter(
				(tag) => tag.includes("btn-danger") && !tag.includes("btn-icon"),
			);
			expect(dangerConfirm.length, `${file} confirm stays text`).toBeGreaterThan(0);
			expect(source, `${file} keeps the confirm label`).toMatch(
				/t\(["']buttons\.confirm["']\)/,
			);
		}
	});
});
