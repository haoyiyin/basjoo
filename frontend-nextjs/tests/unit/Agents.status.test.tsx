// @vitest-environment jsdom
/**
 * #29 — the agents list has three lifecycle states, not two.
 *
 *   active            -> badge-success  + status.active      (进行中)
 *   paused  (is_active === false, deleted_at === null)
 *                     -> badge-warning  + agents.statusPaused   (已停用)
 *   deleted (deleted_at set)
 *                     -> badge-error    + agents.statusDeleted  (已删除)
 *
 * Before this fix both the paused and the deleted row rendered
 * `agents.statusInactive`, so a pause and a 7-day-pending deletion were
 * indistinguishable, and the word used ("已停用") means "paused".
 */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import Agents from "../../src/views/Agents";
import { api } from "../../src/services/api";
import type { Agent } from "../../src/services/api";

vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		admin: {
			id: 1,
			name: "Test Admin",
			email: "test@example.com",
			role: "super_admin",
		},
		token: "test-token",
		logout: vi.fn(),
	}),
}));

vi.mock("../../src/services/api", () => ({
	api: {
		listAgents: vi.fn(),
		createAgent: vi.fn(),
		deleteAgent: vi.fn(),
		restoreAgent: vi.fn(),
		pauseAgent: vi.fn(),
		resumeAgent: vi.fn(),
		setSelectedAgentId: vi.fn(),
		clearSelectedAgentId: vi.fn(),
		getSelectedAgentId: vi.fn(),
		kbStatus: vi.fn(),
		listKnowledgeBases: vi.fn(),
		bindAgentKnowledgeBase: vi.fn(),
	},
}));

vi.mock("../../src/hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
	useMediaQuery: () => false,
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

vi.mock("../../src/components/AdminLayout", () => ({
	default: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="admin-layout">{children}</div>
	),
}));

const mockedApi = vi.mocked(api);

const baseAgent: Agent = {
	id: "agt_active",
	name: "Running",
	system_prompt: "prompt",
	model: "gpt-4o-mini",
	temperature: 0.7,
	max_tokens: 1024,
	top_k: 5,
	similarity_threshold: 0.01,
	enable_context: true,
	is_active: true,
	deleted_at: null,
	created_at: "2026-01-01T00:00:00Z",
	api_key_set: true,
};

const pausedAgent: Agent = {
	...baseAgent,
	id: "agt_paused",
	name: "Paused",
	is_active: false,
	deleted_at: null,
};

const deletedAgent: Agent = {
	...baseAgent,
	id: "agt_deleted",
	name: "Deleted",
	is_active: false,
	deleted_at: "2026-01-02T00:00:00Z",
	purge_after: "2099-01-09T00:00:00Z",
};

function renderAgents() {
	return render(
		<MemoryRouter initialEntries={["/agents"]}>
			<Routes>
				<Route path="/agents" element={<Agents />} />
			</Routes>
		</MemoryRouter>,
	);
}

function statusCell(agentId: string) {
	return screen.getByTestId(`agent-status-${agentId}`);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.listAgents.mockResolvedValue({
		agents: [baseAgent, pausedAgent, deletedAgent],
		total: 3,
	});
});

describe("Agents list status column (#29)", () => {
	it("labels a paused row with the paused key and the warning badge", async () => {
		renderAgents();

		await screen.findByTestId("agent-status-agt_paused");
		const badge = within(statusCell("agt_paused")).getByText("agents.statusPaused");
		expect(badge).toHaveClass("badge", "badge-warning");
	});

	it("labels a soft-deleted row with the deleted key and the error badge", async () => {
		renderAgents();

		await screen.findByTestId("agent-status-agt_deleted");
		const badge = within(statusCell("agt_deleted")).getByText(
			"agents.statusDeleted",
		);
		expect(badge).toHaveClass("badge", "badge-error");
	});

	it("keeps the active row on the success badge", async () => {
		renderAgents();

		await screen.findByTestId("agent-status-agt_active");
		expect(
			within(statusCell("agt_active")).getByText("status.active"),
		).toHaveClass("badge", "badge-success");
	});

	it("renders two different strings for paused and deleted", async () => {
		renderAgents();

		await screen.findByTestId("agent-status-agt_deleted");
		const pausedText = statusCell("agt_paused").textContent?.trim();
		const deletedText = statusCell("agt_deleted").textContent?.trim();

		expect(pausedText).toBe("agents.statusPaused");
		expect(deletedText).toBe("agents.statusDeleted");
		expect(pausedText).not.toBe(deletedText);
		// The old shared key is gone: it meant two things at once.
		expect(pausedText).not.toBe("agents.statusInactive");
		expect(deletedText).not.toBe("agents.statusInactive");
	});

	it("keeps the purge countdown and the restore action on a deleted row", async () => {
		renderAgents();

		await screen.findByTestId("agent-status-agt_deleted");
		const row = screen.getByTestId("agent-row-agt_deleted");
		expect(row.textContent).toContain("agents.autoDeleteCountdown");
		// The restore item lives in the row menu; the trigger proves the menu is
		// still there (its items render on open).
		expect(screen.getByTestId("agent-actions-agt_deleted")).toBeInTheDocument();
	});
});

/** The i18n mock returns keys, so the real strings are asserted from the files. */
function localeAgents(locale: string): Record<string, string> {
	const path = resolve(process.cwd(), "src/locales", locale, "common.json");
	const json = JSON.parse(readFileSync(path, "utf-8")) as {
		agents: Record<string, string>;
	};
	return json.agents;
}

describe("agents status locale strings (#29)", () => {
	const expected: Array<[string, string, string]> = [
		["zh-CN", "已停用", "已删除"],
		["en-US", "Paused", "Deleted"],
	];

	for (const [locale, paused, deleted] of expected) {
		it(`${locale}: paused and deleted read differently`, () => {
			const agents = localeAgents(locale);
			expect(agents.statusPaused).toBe(paused);
			expect(agents.statusDeleted).toBe(deleted);
			expect(paused).not.toBe(deleted);
			// The shared key had two meanings, so it has no reader and is gone.
			expect(agents.statusInactive).toBeUndefined();
		});
	}
});
