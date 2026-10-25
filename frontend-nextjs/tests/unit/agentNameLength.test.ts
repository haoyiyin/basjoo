import { describe, expect, it } from "vitest";
import {
	AGENT_NAME_MAX_DISPLAY_WIDTH,
	getAgentNameDisplayWidth,
	trimToAgentNameMaxDisplayWidth,
} from "../../src/lib/agentNameLength";

describe("agent name display width", () => {
	it("caps names at 12 display units", () => {
		expect(AGENT_NAME_MAX_DISPLAY_WIDTH).toBe(12);
	});

	it("counts ASCII as one display unit", () => {
		expect(getAgentNameDisplayWidth("AgentName123")).toBe(12);
		expect(trimToAgentNameMaxDisplayWidth("AgentName1234")).toBe("AgentName123");
	});

	it("counts Chinese characters as two display units", () => {
		expect(getAgentNameDisplayWidth("客服助手一二")).toBe(12);
		expect(trimToAgentNameMaxDisplayWidth("客服助手一二三")).toBe("客服助手一二");
	});

	it("handles mixed ASCII and Chinese display width", () => {
		expect(getAgentNameDisplayWidth("abc中文defgh")).toBe(12);
		expect(trimToAgentNameMaxDisplayWidth("abc中文defghi")).toBe("abc中文defgh");
	});

	it("counts wide symbols consistently with backend East Asian width", () => {
		expect(getAgentNameDisplayWidth("⌚⌚⌚⌚⌚⌚")).toBe(12);
		expect(trimToAgentNameMaxDisplayWidth("⌚⌚⌚⌚⌚⌚⌚")).toBe("⌚⌚⌚⌚⌚⌚");
	});

	it("keeps the built-in example agent name intact", () => {
		// The seeded example agent is named "Basjoo 助手" (width 11); an admin must be
		// able to re-save it untouched, so the cap has to stay above it.
		expect(getAgentNameDisplayWidth("Basjoo 助手")).toBe(11);
		expect(trimToAgentNameMaxDisplayWidth("Basjoo 助手")).toBe("Basjoo 助手");
	});
});
