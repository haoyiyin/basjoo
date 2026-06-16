import { describe, it, expect } from "vitest";
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
