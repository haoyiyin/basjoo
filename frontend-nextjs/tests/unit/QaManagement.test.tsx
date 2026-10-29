// @vitest-environment jsdom
/**
 * #39 — the curated Q&A panel on `/knowledge-bases/:kbId`.
 *
 * The panel is the only place an operator manages pairs, so these checks cover
 * the four things the feature promises: pairs are listed with their hit stats,
 * a new pair is posted to the KB route (never to an agent), a toggle goes out as
 * a partial update, and the bulk-import box turns blank-line blocks into pairs
 * instead of failing the whole paste.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import QaManagement, { parseImportPairs } from "../../src/components/QaManagement";
import { api } from "../../src/services/api";
import type { QaItem } from "../../src/services/api";

vi.mock("../../src/services/api", () => ({
	api: {
		listQaItems: vi.fn(),
		createQaItem: vi.fn(),
		updateQaItem: vi.fn(),
		deleteQaItem: vi.fn(),
		importQaItems: vi.fn(),
	},
}));

// Keys verbatim: assertions target i18n keys, not prose.
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

const pair: QaItem = {
	id: "qa_1",
	kb_id: "kb_1",
	question: "How long is your refund window?",
	answer: "Refunds are accepted within 30 days of delivery.",
	enabled: true,
	hits: 7,
	last_hit_at: "2026-02-03T04:05:06Z",
	source: "manual",
	source_message_id: null,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
};

function renderPanel() {
	return render(
		<MemoryRouter initialEntries={["/knowledge-bases/kb_1"]}>
			<Routes>
				<Route path="/knowledge-bases/:kbId" element={<QaManagement />} />
			</Routes>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.listQaItems.mockResolvedValue({ items: [pair], total: 1 });
	mockedApi.createQaItem.mockResolvedValue(pair);
	mockedApi.updateQaItem.mockResolvedValue({ ...pair, enabled: false });
	mockedApi.deleteQaItem.mockResolvedValue(undefined);
	mockedApi.importQaItems.mockResolvedValue({ created: 2, skipped: 0 });
});

describe("QaManagement", () => {
	it("lists the KB's pairs with hit stats and asks the KB route", async () => {
		renderPanel();

		await waitFor(() =>
			expect(mockedApi.listQaItems).toHaveBeenCalledWith("kb_1"),
		);
		const row = await screen.findByTestId("qa-row-qa_1");
		expect(within(row).getByText(pair.question)).toBeInTheDocument();
		expect(within(row).getByText(pair.answer)).toBeInTheDocument();
		expect(
			within(row).getByText('qa.hits|{"count":7}'),
		).toBeInTheDocument();
		expect(within(row).getByText("qa.sources.manual")).toBeInTheDocument();
	});

	it("creates a pair through the KB-scoped endpoint", async () => {
		const user = userEvent.setup();
		renderPanel();

		await screen.findByTestId("qa-row-qa_1");
		await user.click(screen.getByRole("button", { name: "qa.addPair" }));

		await user.type(
			screen.getByLabelText("qa.question"),
			"What payment methods do you accept?",
		);
		await user.type(screen.getByLabelText("qa.answer"), "WeChat Pay and Alipay.");
		await user.click(screen.getByRole("button", { name: "qa.createSubmit" }));

		await waitFor(() =>
			expect(mockedApi.createQaItem).toHaveBeenCalledWith("kb_1", {
				question: "What payment methods do you accept?",
				answer: "WeChat Pay and Alipay.",
			}),
		);
	});

	it("rejects a question shorter than 15 characters before calling the API", async () => {
		const user = userEvent.setup();
		renderPanel();

		await screen.findByTestId("qa-row-qa_1");
		await user.click(screen.getByRole("button", { name: "qa.addPair" }));
		await user.type(screen.getByLabelText("qa.question"), "too short");
		await user.type(screen.getByLabelText("qa.answer"), "an answer");
		await user.click(screen.getByRole("button", { name: "qa.createSubmit" }));

		expect(await screen.findByText("qa.questionTooShort")).toBeInTheDocument();
		expect(mockedApi.createQaItem).not.toHaveBeenCalled();
	});

	it("sends an enabled toggle as a partial update", async () => {
		const user = userEvent.setup();
		renderPanel();

		const row = await screen.findByTestId("qa-row-qa_1");
		await user.click(
			within(row).getByRole("checkbox", {
				name: `qa.toggleLabel|${JSON.stringify({ question: pair.question })}`,
			}),
		);

		await waitFor(() =>
			expect(mockedApi.updateQaItem).toHaveBeenCalledWith("kb_1", "qa_1", {
				enabled: false,
			}),
		);
	});

	it("posts parsed pairs from the import box and reports the counts", async () => {
		const user = userEvent.setup();
		renderPanel();

		await screen.findByTestId("qa-row-qa_1");
		await user.click(screen.getByRole("button", { name: "qa.import" }));
		await user.type(
			screen.getByLabelText("qa.importTitle"),
			"How long is shipping?{enter}Takes 3-5 days.{enter}{enter}Do you ship abroad?{enter}Not yet.",
		);
		await user.click(screen.getByRole("button", { name: "qa.importSubmit" }));

		await waitFor(() =>
			expect(mockedApi.importQaItems).toHaveBeenCalledWith("kb_1", [
				{ question: "How long is shipping?", answer: "Takes 3-5 days." },
				{ question: "Do you ship abroad?", answer: "Not yet." },
			]),
		);
		expect(
			await screen.findByTestId("qa-import-result"),
		).toHaveTextContent('qa.importResult|{"created":2,"skipped":0}');
	});
});

describe("parseImportPairs", () => {
	it("splits blank-line blocks and drops incomplete rows", () => {
		const raw = [
			"How long is shipping?",
			"Takes 3-5 days.",
			"",
			"Only a question with no answer",
			"",
			"Do you ship abroad?",
			"Not yet.",
			"Still the same answer.",
		].join("\n");

		expect(parseImportPairs(raw)).toEqual([
			{ question: "How long is shipping?", answer: "Takes 3-5 days." },
			{ question: "Do you ship abroad?", answer: "Not yet.\nStill the same answer." },
		]);
	});

	it("returns nothing for blank input", () => {
		expect(parseImportPairs("   \n\n  \n")).toEqual([]);
	});
});
