// @vitest-environment jsdom
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAgentKbStatus } from "../../src/hooks/useAgentKbStatus";
import { api } from "../../src/services/api";

vi.mock("../../src/services/api", () => ({
	api: {
		kbStatus: vi.fn(),
	},
}));

const mockedApi = vi.mocked(api);

describe("useAgentKbStatus", () => {
	beforeEach(() => {
		mockedApi.kbStatus.mockReset();
	});

	it("returns loading=true initially and resolves data", async () => {
		mockedApi.kbStatus.mockResolvedValueOnce({
			kb_setup_completed: false,
		} as any);
		const { result } = renderHook(() => useAgentKbStatus("agt_1"));
		expect(result.current.loading).toBe(true);
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.kbSetupCompleted).toBe(false);
	});

	it("rechecks when recheck() is called", async () => {
		mockedApi.kbStatus.mockResolvedValue({ kb_setup_completed: false } as any);
		const { result } = renderHook(() => useAgentKbStatus("agt_1"));
		await waitFor(() => expect(result.current.loading).toBe(false));
		mockedApi.kbStatus.mockResolvedValueOnce({
			kb_setup_completed: true,
		} as any);
		await act(() => result.current.recheck());
		expect(result.current.kbSetupCompleted).toBe(true);
	});
});
