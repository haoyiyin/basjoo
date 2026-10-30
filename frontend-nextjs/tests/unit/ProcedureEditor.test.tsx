// @vitest-environment jsdom
/**
 * #39 — the procedure editor in `AgentSettings`.
 *
 * A procedure is an ordered script the runtime walks one step per turn, so the
 * editor's contract is narrow and testable: it lists the agent's procedures, it
 * sends the step list in order with `requires_action` normalised (`""` → null,
 * which is what the runtime reads), and it never sends a blank step.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import ProcedureEditor from "../../src/components/ProcedureEditor";
import { api } from "../../src/services/api";
import type { Procedure } from "../../src/services/api";

vi.mock("../../src/services/api", () => ({
	api: {
		listProcedures: vi.fn(),
		createProcedure: vi.fn(),
		updateProcedure: vi.fn(),
		deleteProcedure: vi.fn(),
	},
}));

function stableT(key: string, params?: Record<string, unknown>) {
	if (params && Object.keys(params).length > 0) {
		return `${key}|${JSON.stringify(params)}`;
	}
	return key;
}

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: stableT }),
}));

const mockedApi = vi.mocked(api);

const procedure: Procedure = {
	id: "proc_1",
	agent_id: "agt_1",
	name: "Refund handling",
	steps: [
		{ text: "Ask whether they want a refund or an exchange.", requires_action: null },
		{ text: "Send the refund form.", requires_action: "form" },
	],
	enabled: true,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.listProcedures.mockResolvedValue({ items: [procedure], total: 1 });
	mockedApi.createProcedure.mockResolvedValue(procedure);
	mockedApi.updateProcedure.mockResolvedValue(procedure);
	mockedApi.deleteProcedure.mockResolvedValue({ deleted: true, id: "proc_1" });
});

describe("ProcedureEditor", () => {
	it("lists the agent's procedures with their step count", async () => {
		render(<ProcedureEditor agentId="agt_1" />);

		await waitFor(() =>
			expect(mockedApi.listProcedures).toHaveBeenCalledWith("agt_1"),
		);
		const row = await screen.findByTestId("procedure-row-proc_1");
		expect(within(row).getByText("Refund handling")).toBeInTheDocument();
		expect(
			within(row).getByText('procedures.stepCount|{"count":2}'),
		).toBeInTheDocument();
	});

	it("creates a procedure with ordered steps and a null action for 'none'", async () => {
		const user = userEvent.setup();
		render(<ProcedureEditor agentId="agt_1" />);

		await screen.findByTestId("procedure-row-proc_1");
		await user.click(screen.getByRole("button", { name: "procedures.add" }));

		await user.type(screen.getByLabelText("procedures.name"), "Onboarding");
		await user.type(
			screen.getByLabelText("procedures.step|" + JSON.stringify({ index: 1 })),
			"Greet the visitor by name.",
		);
		await user.click(screen.getByRole("button", { name: "procedures.addStep" }));
		await user.type(
			screen.getByLabelText("procedures.step|" + JSON.stringify({ index: 2 })),
			"Send the pricing link.",
		);
		await user.selectOptions(
			screen.getByLabelText(
				"procedures.stepActionFor|" + JSON.stringify({ index: 2 }),
			),
			"link",
		);

		await user.click(screen.getByRole("button", { name: "procedures.createSubmit" }));

		await waitFor(() =>
			expect(mockedApi.createProcedure).toHaveBeenCalledWith("agt_1", {
				name: "Onboarding",
				enabled: true,
				steps: [
					{ text: "Greet the visitor by name.", requires_action: null },
					{ text: "Send the pricing link.", requires_action: "link" },
				],
			}),
		);
	});

	it("refuses a procedure with no name and calls no endpoint", async () => {
		const user = userEvent.setup();
		render(<ProcedureEditor agentId="agt_1" />);

		await screen.findByTestId("procedure-row-proc_1");
		await user.click(screen.getByRole("button", { name: "procedures.add" }));
		await user.click(screen.getByRole("button", { name: "procedures.createSubmit" }));

		expect(await screen.findByText("procedures.nameRequired")).toBeInTheDocument();
		expect(mockedApi.createProcedure).not.toHaveBeenCalled();
	});

	it("refuses a procedure whose steps are all blank", async () => {
		const user = userEvent.setup();
		render(<ProcedureEditor agentId="agt_1" />);

		await screen.findByTestId("procedure-row-proc_1");
		await user.click(screen.getByRole("button", { name: "procedures.add" }));
		await user.type(screen.getByLabelText("procedures.name"), "Empty");
		await user.click(screen.getByRole("button", { name: "procedures.createSubmit" }));

		expect(
			await screen.findByText("procedures.stepRequired"),
		).toBeInTheDocument();
		expect(mockedApi.createProcedure).not.toHaveBeenCalled();
	});

	it("sends an enable toggle as a partial update", async () => {
		const user = userEvent.setup();
		render(<ProcedureEditor agentId="agt_1" />);

		const row = await screen.findByTestId("procedure-row-proc_1");
		await user.click(
			within(row).getByRole("checkbox", {
				name: `procedures.enableLabel|${JSON.stringify({ name: "Refund handling" })}`,
			}),
		);

		await waitFor(() =>
			expect(mockedApi.updateProcedure).toHaveBeenCalledWith("agt_1", "proc_1", {
				enabled: false,
			}),
		);
	});
});
