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
});
