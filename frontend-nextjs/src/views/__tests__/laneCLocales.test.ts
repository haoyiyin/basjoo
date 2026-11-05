// @vitest-environment jsdom
/**
 * Lane C (#72 + #74 UI) — locale parity for every new string.
 *
 * Hard rule: no hardcoded English in JSX, and every new key must exist in BOTH
 * catalogs. The structural half below compares the shape of the new sections
 * (so a key added to one catalog only is a red test), the copy half pins that
 * the Chinese catalog is actually translated rather than copied.
 */
import { describe, expect, it } from "vitest";
import enUS from "../../locales/en-US/common.json";
import zhCN from "../../locales/zh-CN/common.json";

/** Every leaf path of an object, sorted. */
function leafPaths(value: unknown, prefix = ""): string[] {
	if (value === null || typeof value !== "object") return [prefix];
	return Object.entries(value as Record<string, unknown>)
		.flatMap(([key, child]) =>
			leafPaths(child, prefix ? `${prefix}.${key}` : key),
		)
		.sort();
}

describe("lane C locale parity (#72 + #74)", () => {
	it("navigation.leads exists in both catalogs", () => {
		expect(enUS.navigation.leads).toBe("Leads");
		expect(zhCN.navigation.leads).toBe("留资线索");
	});

	it("the leads section has the same keys in both catalogs", () => {
		expect(leafPaths(enUS.leads)).toEqual(leafPaths(zhCN.leads));
		// ...and covers the whole surface the view renders.
		for (const key of [
			"title",
			"subtitle",
			"uncontactedCount",
			"totalCount",
			"filterLabel",
			"unknownName",
			"contacted",
			"notContacted",
			"contactedToggle",
			"message",
			"openSession",
			"closeDetail",
			"reload",
			"emptyTitle",
			"emptyDescription",
			"sources.all",
			"sources.offline-form",
			"sources.prechat",
			"sources.trigger",
			"sources.manual",
			"columns.name",
			"columns.email",
			"columns.phone",
			"columns.source",
			"columns.page",
			"columns.created",
			"columns.contacted",
			"errors.loadFailed",
			"errors.updateFailed",
		] as const) {
			const path = key.split(".");
			const read = (catalog: unknown): unknown =>
				path.reduce<unknown>(
					(acc, part) =>
						acc && typeof acc === "object"
							? (acc as Record<string, unknown>)[part]
							: undefined,
					catalog,
				);
			expect(typeof read(enUS.leads), `en-US leads.${key}`).toBe("string");
			expect(typeof read(zhCN.leads), `zh-CN leads.${key}`).toBe("string");
		}
	});

	it("the prechat section has the same keys in both catalogs", () => {
		expect(leafPaths(enUS.prechat)).toEqual(leafPaths(zhCN.prechat));
		// All three policies are named in both languages.
		for (const mode of ["off", "optional", "required"] as const) {
			expect(
				typeof (enUS.prechat.modes as Record<string, string>)[mode],
			).toBe("string");
			expect(
				typeof (zhCN.prechat.modes as Record<string, string>)[mode],
			).toBe("string");
			expect(
				typeof (enUS.prechat.modeHints as Record<string, string>)[mode],
			).toBe("string");
			expect(
				typeof (zhCN.prechat.modeHints as Record<string, string>)[mode],
			).toBe("string");
		}
	});

	it("the macros section has the same keys in both catalogs", () => {
		expect(leafPaths(enUS.macros)).toEqual(leafPaths(zhCN.macros));
		for (const key of [
			"title",
			"description",
			"variablesHint",
			"create",
			"save",
			"reload",
			"loadHintTitle",
			"emptyTitle",
			"emptyDescription",
			"nameLabel",
			"bodyLabel",
			"nameCap",
			"bodyCap",
			"editLabel",
			"deleteLabel",
			"pickerToggle",
			"searchPlaceholder",
			"insertLabel",
			"emptyPicker",
			"errors.loadFailed",
			"errors.saveFailed",
			"errors.deleteFailed",
			"errors.required",
			"errors.tooLong",
		] as const) {
			const path = key.split(".");
			const read = (catalog: unknown): unknown =>
				path.reduce<unknown>(
					(acc, part) =>
						acc && typeof acc === "object"
							? (acc as Record<string, unknown>)[part]
							: undefined,
					catalog,
				);
			expect(typeof read(enUS.macros), `en-US macros.${key}`).toBe("string");
			expect(typeof read(zhCN.macros), `zh-CN macros.${key}`).toBe("string");
		}
	});

	it("uses the word macro, never canned", () => {
		// The spec names the feature "macro" everywhere; "canned" is a leftover
		// from the competitor's copy and must not leak into either catalog.
		const text = JSON.stringify({ enUS: enUS.macros, zhCN: zhCN.macros });
		expect(text.toLowerCase()).not.toContain("canned");
	});

	it("actually translates the Chinese copy rather than copying English", () => {
		expect(zhCN.leads.title).not.toBe(enUS.leads.title);
		expect(zhCN.prechat.title).not.toBe(enUS.prechat.title);
		expect(zhCN.macros.title).not.toBe(enUS.macros.title);
		expect(zhCN.macros.emptyTitle).not.toBe(enUS.macros.emptyTitle);
		expect(zhCN.prechat.modeHints.off).not.toBe(enUS.prechat.modeHints.off);
	});
});
