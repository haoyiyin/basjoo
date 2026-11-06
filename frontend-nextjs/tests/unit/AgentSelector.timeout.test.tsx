// @vitest-environment jsdom
/**
 * Admin UI lane — the agent selector's loading-timeout copy.
 *
 * The view is in the `common` namespace and called `t('common.loadingTimeout')`,
 * a path that does not exist in the catalog: the copy lives at
 * `status.loadingTimeout` (`locales/{en-US,zh-CN}/common.json`). After ten
 * seconds without agents the operator therefore saw the literal key
 * `common.loadingTimeout` instead of readable text. This pins the resolved key
 * so the wrong path cannot come back.
 */
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import AgentSelector from "../../src/views/AgentSelector";

vi.mock("../../src/components/AdminLayout", () => ({
	default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		admin: { id: 1, name: "Operator", email: "op@example.com", role: "admin" },
		token: "test-token",
		isLoading: false,
		logout: vi.fn(),
		login: vi.fn(),
		register: vi.fn(),
	}),
}));

// A request that never settles: the 10s timeout is the only way out of the
// loading state, which is exactly the branch under test.
vi.mock("../../src/services/api", () => ({
	api: { listAgents: () => new Promise(() => {}) },
}));

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("AgentSelector loading timeout", () => {
	it("shows the status.loadingTimeout copy, not the raw common.* key", async () => {
		render(
			<MemoryRouter>
				<AgentSelector />
			</MemoryRouter>,
		);

		// The unit suite leaves react-i18next uninitialised, so `t` echoes the key
		// verbatim: the assertion is on the key the view asks for.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});

		const alert = screen.getByRole("alert");
		expect(alert).toHaveTextContent("status.loadingTimeout");
		expect(alert.textContent ?? "").not.toContain("common.loadingTimeout");
	});
});
