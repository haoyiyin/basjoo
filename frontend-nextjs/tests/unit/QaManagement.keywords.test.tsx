// @vitest-environment jsdom
/**
 * #60 — the operator side of the keyword fallback in the Q&A panel.
 *
 * Three promises, each asserted on what the operator actually sees or sends:
 *
 * 1. the create form sends the typed trigger words (comma/space separated) on
 *    the KB-scoped `createQaItem` call;
 * 2. a pair's stored keywords render as chips in the row meta;
 * 3. the "试试这句话匹配哪条" box calls `testQaMatch` and renders the winning
 *    pair (question, answer, score, matched keywords) or the no-match copy —
 *    and a backend validation error surfaces on screen instead of vanishing.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import QaManagement, { parseKeywords } from "../../src/components/QaManagement";
import { api } from "../../src/services/api";
import type { QaItem } from "../../src/services/api";

vi.mock("../../src/services/api", () => ({
	api: {
		listQaItems: vi.fn(),
		createQaItem: vi.fn(),
		updateQaItem: vi.fn(),
		deleteQaItem: vi.fn(),
		importQaItems: vi.fn(),
		testQaMatch: vi.fn(),
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
	keywords: ["refund", "退款"],
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
	mockedApi.testQaMatch.mockResolvedValue({
		matched: pair,
		score: 1,
		matched_keywords: ["refund"],
	});
});

describe("QaManagement keywords (#60)", () => {
	it("sends the typed keywords on create", async () => {
		const user = userEvent.setup();
		renderPanel();

		await screen.findByTestId("qa-row-qa_1");
		await user.click(screen.getByRole("button", { name: "qa.addPair" }));

		await user.type(
			screen.getByLabelText("qa.question"),
			"What payment methods do you accept?",
		);
		await user.type(screen.getByLabelText("qa.answer"), "WeChat Pay and Alipay.");
		await user.type(screen.getByLabelText("qa.keywords"), "pay, wechat alipay");
		await user.click(screen.getByRole("button", { name: "qa.createSubmit" }));

		await waitFor(() =>
			expect(mockedApi.createQaItem).toHaveBeenCalledWith("kb_1", {
				question: "What payment methods do you accept?",
				answer: "WeChat Pay and Alipay.",
				keywords: ["pay", "wechat", "alipay"],
			}),
		);
	});

	it("omits the field when no keyword was typed, leaving the pair as it was", async () => {
		const user = userEvent.setup();
		renderPanel();

		await screen.findByTestId("qa-row-qa_1");
		await user.click(screen.getByRole("button", { name: "qa.addPair" }));
		await user.type(
			screen.getByLabelText("qa.question"),
			"Do you ship to warehouses?",
		);
		await user.type(screen.getByLabelText("qa.answer"), "Yes, on request.");
		await user.click(screen.getByRole("button", { name: "qa.createSubmit" }));

		await waitFor(() =>
			expect(mockedApi.createQaItem).toHaveBeenCalledWith("kb_1", {
				question: "Do you ship to warehouses?",
				answer: "Yes, on request.",
			}),
		);
	});

	it("renders the pair's keywords as chips in the row meta", async () => {
		renderPanel();

		const row = await screen.findByTestId("qa-row-qa_1");
		expect(
			within(row).getByTestId("qa-keyword-qa_1-refund"),
		).toHaveTextContent("refund");
		expect(
			within(row).getByTestId("qa-keyword-qa_1-退款"),
		).toHaveTextContent("退款");
		expect(
			within(row).queryByTestId("qa-keywords-empty-qa_1"),
		).not.toBeInTheDocument();
	});

	it("prefills the keyword field when editing an existing pair", async () => {
		const user = userEvent.setup();
		renderPanel();

		const row = await screen.findByTestId("qa-row-qa_1");
		await user.click(
			within(row).getByRole("button", {
				name: `qa.editLabel|${JSON.stringify({ question: pair.question })}`,
			}),
		);

		expect(screen.getByLabelText("qa.keywords")).toHaveValue("refund, 退款");
	});

	it("renders the winning pair from the tester", async () => {
		const user = userEvent.setup();
		renderPanel();

		await screen.findByTestId("qa-row-qa_1");
		await user.type(
			screen.getByLabelText("qa.testerTitle"),
			"I would like a refund please",
		);
		await user.click(screen.getByRole("button", { name: "qa.testerSubmit" }));

		await waitFor(() =>
			expect(mockedApi.testQaMatch).toHaveBeenCalledWith(
				"kb_1",
				"I would like a refund please",
			),
		);

		const hit = await screen.findByTestId("qa-tester-hit");
		expect(within(hit).getByText(/How long is your refund window\?/)).toBeInTheDocument();
		expect(
			within(hit).getByText(/Refunds are accepted within 30 days of delivery\./),
		).toBeInTheDocument();
		expect(
			within(hit).getByText('qa.testerScore|{"score":"1.00"}'),
		).toBeInTheDocument();
		expect(
			within(hit).getByText('qa.testerMatchedKeywords|{"keywords":"refund"}'),
		).toBeInTheDocument();
		expect(screen.queryByTestId("qa-tester-miss")).not.toBeInTheDocument();
	});

	it("renders the no-match state when nothing is matched", async () => {
		mockedApi.testQaMatch.mockResolvedValue({
			matched: null,
			score: null,
			matched_keywords: [],
		});
		const user = userEvent.setup();
		renderPanel();

		await screen.findByTestId("qa-row-qa_1");
		await user.type(screen.getByLabelText("qa.testerTitle"), "hello there");
		await user.click(screen.getByRole("button", { name: "qa.testerSubmit" }));

		const miss = await screen.findByTestId("qa-tester-miss");
		expect(miss).toHaveTextContent("qa.testerMiss");
		expect(screen.queryByTestId("qa-tester-hit")).not.toBeInTheDocument();
	});

	it("surfaces a backend keyword validation error on screen", async () => {
		mockedApi.createQaItem.mockRejectedValue(
			new Error("keyword_too_short: a"),
		);
		const user = userEvent.setup();
		renderPanel();

		await screen.findByTestId("qa-row-qa_1");
		await user.click(screen.getByRole("button", { name: "qa.addPair" }));
		await user.type(
			screen.getByLabelText("qa.question"),
			"Which courier do you use for deliveries?",
		);
		await user.type(screen.getByLabelText("qa.answer"), "SF Express.");
		// A one-character keyword is accepted by the field and rejected by the API;
		// the panel must show the API's own machine-readable detail verbatim.
		await user.type(screen.getByLabelText("qa.keywords"), "a");
		await user.click(screen.getByRole("button", { name: "qa.createSubmit" }));

		expect(
			await screen.findByText("keyword_too_short: a"),
		).toBeInTheDocument();
		// The form stays open so the operator can fix the field in place.
		expect(screen.getByTestId("qa-form")).toBeInTheDocument();
	});

	it("surfaces a tester failure instead of a silent empty result", async () => {
		mockedApi.testQaMatch.mockRejectedValue(new Error("boom"));
		const user = userEvent.setup();
		renderPanel();

		await screen.findByTestId("qa-row-qa_1");
		await user.type(screen.getByLabelText("qa.testerTitle"), "hello");
		await user.click(screen.getByRole("button", { name: "qa.testerSubmit" }));

		expect(await screen.findByTestId("qa-tester-error")).toHaveTextContent(
			"boom",
		);
	});
});

describe("parseKeywords", () => {
	it("splits on commas, full-width punctuation and whitespace", () => {
		expect(parseKeywords("refund, 退款，退货   money back")).toEqual([
			"refund",
			"退款",
			"退货",
			"money",
			"back",
		]);
	});

	it("drops blanks and a trailing separator", () => {
		expect(parseKeywords("  refund , , ")).toEqual(["refund"]);
		expect(parseKeywords("")).toEqual([]);
	});
});
