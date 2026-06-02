import { describe, expect, it } from "vitest";
import {
	getAgentNameDisplayWidth,
	trimToAgentNameMaxDisplayWidth,
} from "../../src/lib/agentNameLength";

describe("agent name display width", () => {
	it("counts ASCII as one display unit", () => {
		expect(getAgentNameDisplayWidth("AgentName1")).toBe(10);
		expect(trimToAgentNameMaxDisplayWidth("AgentName12")).toBe("AgentName1");
	});

	it("counts Chinese characters as two display units", () => {
		expect(getAgentNameDisplayWidth("客服助手一")).toBe(10);
		expect(trimToAgentNameMaxDisplayWidth("客服助手一二")).toBe("客服助手一");
	});

	it("handles mixed ASCII and Chinese display width", () => {
		expect(getAgentNameDisplayWidth("abc中文def")).toBe(10);
		expect(trimToAgentNameMaxDisplayWidth("abc中文defg")).toBe("abc中文def");
	});

	it("counts wide symbols consistently with backend East Asian width", () => {
		expect(getAgentNameDisplayWidth("⌚⌚⌚⌚⌚")).toBe(10);
		expect(trimToAgentNameMaxDisplayWidth("⌚⌚⌚⌚⌚⌚")).toBe("⌚⌚⌚⌚⌚");
	});
});
