// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "../../src/services/api";

describe("api.kbStatus", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue("en"),
			setItem: vi.fn(),
			removeItem: vi.fn(),
			clear: vi.fn(),
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns kb status payload", async () => {
		const payload = { kb_setup_completed: false };
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(JSON.stringify(payload), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
		const result = await api.kbStatus("agt_test");
		expect(result).toEqual(payload);
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("/api/v1/agent:kb-status?agent_id=agt_test"),
			expect.objectContaining({ headers: expect.any(Object) }),
		);
		spy.mockRestore();
	});
});
