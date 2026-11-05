// @vitest-environment jsdom
/**
 * #72 — the lead inbox.
 *
 * Pinned on the real rendered surface, against the real `api` service and a
 * stubbed `fetch`, so the request the view actually makes (URL + method + body)
 * is what is asserted — not a mock call shape.
 *
 *  1. the list renders one row per lead from `GET /api/v1/admin/leads`;
 *  2. the header carries the server's `uncontacted` queue count;
 *  3. the contacted toggle PATCHes `/api/v1/admin/leads/{id}` with
 *     `{contacted: bool}` — the exact contract `leads_endpoints.py` reads;
 *  4. the source filter narrows the rows client-side;
 *  5. a row with `session_id` links to that agent's session centre, and a row
 *     without one renders no dead link.
 */
import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import Leads from "../Leads";
import type { Lead } from "../../services/api";

vi.mock("../../components/AdminLayout", () => ({
	default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
	useIsTablet: () => false,
	useIsDesktop: () => true,
	useMediaQuery: () => false,
}));

/** Keys verbatim plus their params: the counts are part of the contract. */
function stableT(key: string, params?: Record<string, unknown>) {
	if (params && Object.keys(params).length > 0) {
		return `${key}|${JSON.stringify(params)}`;
	}
	return key;
}

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: stableT }),
}));

type Request_ = { url: string; method: string; body: unknown };
let requests: Request_[] = [];

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const chatLead: Lead = {
	id: "lead_1",
	agent_id: "agt_1",
	session_id: "sess_public_1",
	name: "Dana Visitor",
	email: "dana@example.com",
	phone: null,
	message: "Please call me back",
	source: "prechat",
	page_url: "https://example.com/pricing",
	contacted: false,
	created_at: "2026-01-02T03:04:05Z",
};

const formLead: Lead = {
	id: "lead_2",
	agent_id: "agt_1",
	session_id: null,
	name: "Offline Sam",
	email: "sam@example.com",
	phone: "+1 555 0100",
	message: null,
	source: "offline-form",
	page_url: null,
	contacted: true,
	created_at: "2026-01-01T09:00:00Z",
};

let leads: Lead[] = [];

beforeEach(() => {
	requests = [];
	leads = [{ ...chatLead }, { ...formLead }];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? "GET";
			requests.push({
				url,
				method,
				body: init?.body ? JSON.parse(String(init.body)) : null,
			});

			if (method === "PATCH") {
				const id = url.split("/").pop()?.split("?")[0] ?? "";
				const target = leads.find((lead) => lead.id === id);
				const contacted = Boolean(
					(JSON.parse(String(init?.body)) as { contacted: boolean }).contacted,
				);
				if (target) target.contacted = contacted;
				return jsonResponse({ ...(target ?? {}), contacted });
			}

			return jsonResponse({
				items: leads,
				total: leads.length,
				uncontacted: leads.filter((lead) => !lead.contacted).length,
			});
		}),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function renderLeads() {
	return render(
		<MemoryRouter initialEntries={["/leads"]}>
			<Leads />
		</MemoryRouter>,
	);
}

describe("#72 lead inbox", () => {
	it("renders one row per lead from GET /api/v1/admin/leads", async () => {
		renderLeads();

		const row = await screen.findByTestId("lead-row-lead_1");
		expect(within(row).getByText("Dana Visitor")).toBeInTheDocument();
		expect(within(row).getByText("dana@example.com")).toBeInTheDocument();
		expect(within(row).getByText("leads.sources.prechat")).toBeInTheDocument();
		expect(
			within(row).getByText("https://example.com/pricing"),
		).toBeInTheDocument();

		expect(screen.getByTestId("lead-row-lead_2")).toBeInTheDocument();
		expect(requests[0].method).toBe("GET");
		expect(requests[0].url).toContain("/api/v1/admin/leads");
	});

	it("shows the uncontacted queue count in the header", async () => {
		renderLeads();

		const header = await screen.findByTestId("leads-uncontacted-count");
		// One of the two fixture leads is still uncontacted.
		expect(header.textContent).toContain('"count":1');
		expect(header.textContent).toContain('"count":2');
	});

	it("PATCHes /api/v1/admin/leads/{id} with {contacted: bool} on the toggle", async () => {
		const user = userEvent.setup();
		renderLeads();

		const toggle = await screen.findByTestId("lead-contacted-lead_1");
		expect(toggle).not.toBeChecked();

		await user.click(toggle);

		await waitFor(() => {
			const patch = requests.find((request) => request.method === "PATCH");
			expect(patch).toBeDefined();
			// The service builds an absolute URL (window.location.origin), so the
			// assertion is on the pathname — the contract is the path, not the host.
			expect(new URL(String(patch?.url)).pathname).toBe(
				"/api/v1/admin/leads/lead_1",
			);
			expect(patch?.body).toEqual({ contacted: true });
		});

		// The row re-renders from the response.
		await waitFor(() =>
			expect(screen.getByTestId("lead-contacted-lead_1")).toBeChecked(),
		);
	});

	it("sends contacted: false when un-checking an already contacted lead", async () => {
		const user = userEvent.setup();
		renderLeads();

		// Both directions matter: a hardcoded `{contacted: true}` would pass the
		// forward case above and silently make "un-contact" impossible.
		const toggle = await screen.findByTestId("lead-contacted-lead_2");
		expect(toggle).toBeChecked();

		await user.click(toggle);

		await waitFor(() => {
			const patch = requests.find((request) => request.method === "PATCH");
			expect(patch).toBeDefined();
			expect(new URL(String(patch?.url)).pathname).toBe(
				"/api/v1/admin/leads/lead_2",
			);
			expect(patch?.body).toEqual({ contacted: false });
		});
	});

	it("narrows the rows with the source filter", async () => {
		const user = userEvent.setup();
		renderLeads();

		await screen.findByTestId("lead-row-lead_1");
		await user.selectOptions(screen.getByLabelText("leads.filterLabel"), "offline-form");

		await waitFor(() =>
			expect(screen.queryByTestId("lead-row-lead_1")).toBeNull(),
		);
		expect(screen.getByTestId("lead-row-lead_2")).toBeInTheDocument();
	});

	it("links a chat-captured lead to its agent's session centre, and only then", async () => {
		const user = userEvent.setup();
		renderLeads();

		// The offline-form lead has no session: opening it shows no session link.
		await user.click(await screen.findByTestId("lead-row-lead_2"));
		expect(await screen.findByTestId("lead-detail")).toBeInTheDocument();
		expect(screen.queryByTestId("lead-session-link")).toBeNull();

		// The prechat lead was captured in a conversation: the link points at
		// that agent's sessions route with the public session id shown.
		await user.click(screen.getByTestId("lead-row-lead_1"));
		const link = await screen.findByTestId("lead-session-link");
		expect(link).toHaveAttribute("href", "/agents/agt_1/sessions");
		expect(link.textContent).toContain("sess_public_1");
	});
});
