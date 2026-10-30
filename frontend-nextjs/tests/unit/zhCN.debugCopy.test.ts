import { describe, it, expect } from "vitest";
import enUS from "../../src/locales/en-US/common.json";
import zhCN from "../../src/locales/zh-CN/common.json";

function collectStrings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(collectStrings);
	if (value && typeof value === "object") {
		return Object.values(value as Record<string, unknown>).flatMap(
			collectStrings,
		);
	}
	return [];
}

describe("zh-CN debug area copy", () => {
	it("uses 调试区 instead of Playground in Chinese copy", () => {
		const allStrings = collectStrings(zhCN);

		expect(zhCN.navigation.playground).toBe("调试区");
		expect(allStrings.filter((text) => text.includes("Playground"))).toEqual(
			[],
		);
	});

	it("uses 仪表盘 for the Chinese dashboard navigation label", () => {
		expect(zhCN.navigation.dashboard).toBe("仪表盘");
	});

	it("uses 失败 for the failed status badge (not raw English Failed)", () => {
		expect(zhCN.status.failed).toBe("失败");
		// Verify no English "Failed" string leaks into zh-CN locale
		const allStrings = collectStrings(zhCN);
		expect(allStrings.filter((text) => text === "Failed")).toEqual([]);
	});

	it("provides a Chinese friendly fallback for unprocessable files", () => {
		expect(zhCN.files.processingFailedFallback).toBe(
			"无法处理此文件。请上传有效的、可读的 PDF、TXT、MD、HTML、DOCX 或 XLSX 文档。",
		);
		// Ensure the fallback is not identical to the English version
		expect(zhCN.files.processingFailedFallback).not.toContain(
			"couldn't process",
		);
		expect(zhCN.files.processingFailedFallback).not.toContain("We couldn't");
	});
});

describe("#47 webhook and ingestion-error copy", () => {
	it("translates the webhook settings card in both locales", () => {
		// Both catalogs must carry the card the settings page renders.
		for (const catalog of [zhCN, enUS]) {
			expect(Object.keys(catalog.webhooks).sort()).toEqual(
				[
					"description",
					"secretHint",
					"secretLabel",
					"secretMasked",
					"secretPlaceholder",
					"secretSetHint",
					"title",
					"urlHint",
					"urlLabel",
					"urlPlaceholder",
				].sort(),
			);
		}
		// The Chinese copy is a translation, not the English string.
		expect(zhCN.webhooks.title).not.toBe(enUS.webhooks.title);
		expect(zhCN.webhooks.urlHint).not.toBe(enUS.webhooks.urlHint);
		// Event names are wire format and stay untranslated in both.
		for (const event of [
			"session.created",
			"message.created",
			"handoff.requested",
			"lead.created",
			"document.indexed",
		]) {
			expect(zhCN.webhooks.urlHint).toContain(event);
			expect(enUS.webhooks.urlHint).toContain(event);
		}
	});
});
