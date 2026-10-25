// @vitest-environment jsdom
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAgentKbStatus } from "../../src/hooks/useAgentKbStatus";
import { api } from "../../src/services/api";
import type { KbStatusPayload } from "../../src/services/api";

vi.mock("../../src/services/api", () => ({
	api: {
		kbStatus: vi.fn(),
	},
}));

const mockedApi = vi.mocked(api);

const unbound: KbStatusPayload = {
	agent_id: "agt_1",
	kb_id: null,
	kb_setup_completed: false,
	kb: null,
};

const bound: KbStatusPayload = {
	agent_id: "agt_1",
	kb_id: "kb_1",
	kb_setup_completed: true,
	kb: {
		id: "kb_1",
		name: "Product Docs",
		embedding_provider: "jina",
		embedding_model: "jina-embeddings-v3",
		status: "active",
	},
};

describe("useAgentKbStatus", () => {
	beforeEach(() => {
		mockedApi.kbStatus.mockReset();
	});

	it("returns loading=true initially and resolves an unbound agent", async () => {
		mockedApi.kbStatus.mockResolvedValueOnce(unbound);

		const { result } = renderHook(() => useAgentKbStatus("agt_1"));
		expect(result.current.loading).toBe(true);
		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(mockedApi.kbStatus).toHaveBeenCalledWith("agt_1");
		expect(result.current.kbSetupCompleted).toBe(false);
		expect(result.current.error).toBeNull();
		expect(result.current.raw).toEqual(unbound);
	});

	it("exposes the bound KB from the new payload shape", async () => {
		mockedApi.kbStatus.mockResolvedValueOnce(bound);

		const { result } = renderHook(() => useAgentKbStatus("agt_1"));
		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(result.current.kbSetupCompleted).toBe(true);
		expect(result.current.raw?.kb_id).toBe("kb_1");
		expect(result.current.raw?.kb?.name).toBe("Product Docs");
		expect(result.current.raw?.kb?.embedding_model).toBe(
			"jina-embeddings-v3",
		);
	});

	it("rechecks when recheck() is called", async () => {
		mockedApi.kbStatus.mockResolvedValue(unbound);
		const { result } = renderHook(() => useAgentKbStatus("agt_1"));
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.kbSetupCompleted).toBe(false);

		mockedApi.kbStatus.mockResolvedValueOnce(bound);
		await act(() => result.current.recheck());

		expect(result.current.kbSetupCompleted).toBe(true);
		expect(result.current.raw?.kb_id).toBe("kb_1");
	});

	it("keeps kbSetupCompleted=false and surfaces the error when the call fails", async () => {
		mockedApi.kbStatus.mockRejectedValueOnce(new Error("network down"));

		const { result } = renderHook(() => useAgentKbStatus("agt_1"));
		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(result.current.kbSetupCompleted).toBe(false);
		expect(result.current.error).toBe("network down");
	});

	it("does not call the API without an agent id", async () => {
		const { result } = renderHook(() => useAgentKbStatus(null));
		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(mockedApi.kbStatus).not.toHaveBeenCalled();
		expect(result.current.kbSetupCompleted).toBe(false);
	});
});
