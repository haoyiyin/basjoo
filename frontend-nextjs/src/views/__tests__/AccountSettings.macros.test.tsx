// @vitest-environment jsdom
/**
 * #74 (console half) — the reply-macro CRUD on the account page.
 *
 * The workspace owns its macros, so create / edit / delete all live here against
 * `/api/v1/admin/macros*` (GET/POST/PATCH/DELETE). Pinned:
 *
 *  1. the list renders from `GET /api/v1/admin/macros`;
 *  2. create POSTs `{name, body}` and adds the returned row;
 *  3. edit PATCHes only the changed macro;
 *  4. delete DELETEs that id and removes the row;
 *  5. the caps the API enforces (name 200, body 2500) are printed, and an
 *     over-cap draft is refused client-side instead of eating a 422;
 *  6. an empty name or body is refused before any request.
 */
import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import AccountSettings from "../AccountSettings";
import type { Macro } from "../../services/api";

vi.mock("../../components/AdminLayout", () => ({
	default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
	useIsTablet: () => false,
	useIsDesktop: () => true,
	useMediaQuery: () => false,
}));

vi.mock("../../context/AuthContext", () => ({
	useAuth: () => ({
		admin: { id: 1, name: "Owner", email: "owner@example.com", role: "super_admin" },
		token: "jwt-test-token",
		logout: vi.fn(),
	}),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, unknown>) =>
			params && Object.keys(params).length > 0
				? `${key}|${JSON.stringify(params)}`
				: key,
		i18n: { language: "en-US", changeLanguage: vi.fn() },
	}),
}));

type Call = { method: string; path: string; body: unknown };
let calls: Call[] = [];
let macros: Macro[] = [];

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	calls = [];
	macros = [
		{ id: "mac_1", name: "Greeting", body: "Hello {{visitor.name}}." },
		{ id: "mac_2", name: "Goodbye", body: "Thanks, bye." },
	];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(String(input));
			const method = init?.method ?? "GET";
			const body = init?.body ? JSON.parse(String(init.body)) : null;
			calls.push({ method, path: url.pathname, body });

			if (method === "POST") {
				const created: Macro = {
					id: "mac_new",
					name: String((body as { name: string }).name),
					body: String((body as { body: string }).body),
				};
				macros = [...macros, created];
				return jsonResponse(created, 201);
			}
			if (method === "PATCH") {
				const id = url.pathname.split("/").pop() ?? "";
				const index = macros.findIndex((macro) => macro.id === id);
				const updated = { ...macros[index], ...(body as Partial<Macro>) };
				macros = macros.map((macro) => (macro.id === id ? updated : macro));
				return jsonResponse(updated);
			}
			if (method === "DELETE") {
				const id = url.pathname.split("/").pop() ?? "";
				macros = macros.filter((macro) => macro.id !== id);
				return jsonResponse({ success: true, deleted: true, id });
			}
			return jsonResponse({ items: macros, total: macros.length });
		}),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function renderAccountSettings() {
	return render(
		<MemoryRouter initialEntries={["/settings/account"]}>
			<AccountSettings />
		</MemoryRouter>,
	);
}

describe("#74 macro list", () => {
	it("renders the workspace's macros from GET /api/v1/admin/macros", async () => {
		renderAccountSettings();

		const row = await screen.findByTestId("macro-row-mac_1");
		expect(within(row).getByText("Greeting")).toBeInTheDocument();
		expect(within(row).getByText("Hello {{visitor.name}}.")).toBeInTheDocument();
		expect(screen.getByTestId("macro-row-mac_2")).toBeInTheDocument();

		const listCall = calls.find((call) => call.method === "GET");
		expect(listCall?.path).toBe("/api/v1/admin/macros");
	});

	it("creates a macro with POST and shows it in the list", async () => {
		const user = userEvent.setup();
		renderAccountSettings();

		await screen.findByTestId("macro-row-mac_1");
		await user.click(screen.getByTestId("macro-create-open"));
		await user.type(screen.getByTestId("macro-name-input"), "Refund window");
		await user.type(
			screen.getByTestId("macro-body-input"),
			"Refunds take 30 days.",
		);
		await user.click(screen.getByTestId("macro-editor-save"));

		await waitFor(() => {
			const post = calls.find((call) => call.method === "POST");
			expect(post).toBeDefined();
			expect(post?.path).toBe("/api/v1/admin/macros");
			expect(post?.body).toEqual({
				name: "Refund window",
				body: "Refunds take 30 days.",
			});
		});
		expect(await screen.findByTestId("macro-row-mac_new")).toBeInTheDocument();
	});

	it("edits a macro with PATCH on that id only", async () => {
		const user = userEvent.setup();
		renderAccountSettings();

		await screen.findByTestId("macro-row-mac_1");
		await user.click(screen.getByTestId("macro-edit-mac_1"));
		const nameField = screen.getByTestId("macro-name-input");
		await user.clear(nameField);
		await user.type(nameField, "Greeting (v2)");
		await user.click(screen.getByTestId("macro-editor-save"));

		await waitFor(() => {
			const patch = calls.find((call) => call.method === "PATCH");
			expect(patch).toBeDefined();
			expect(patch?.path).toBe("/api/v1/admin/macros/mac_1");
			expect(patch?.body).toEqual({
				name: "Greeting (v2)",
				body: "Hello {{visitor.name}}.",
			});
		});
		expect(await screen.findByText("Greeting (v2)")).toBeInTheDocument();
	});

	it("deletes a macro with DELETE and drops the row", async () => {
		const user = userEvent.setup();
		renderAccountSettings();

		await screen.findByTestId("macro-row-mac_2");
		await user.click(screen.getByTestId("macro-delete-mac_2"));

		await waitFor(() => {
			const del = calls.find((call) => call.method === "DELETE");
			expect(del).toBeDefined();
			expect(del?.path).toBe("/api/v1/admin/macros/mac_2");
		});
		await waitFor(() =>
			expect(screen.queryByTestId("macro-row-mac_2")).toBeNull(),
		);
		expect(screen.getByTestId("macro-row-mac_1")).toBeInTheDocument();
	});
});

describe("#74 macro caps", () => {
	it("prints the API caps next to both inputs", async () => {
		const user = userEvent.setup();
		renderAccountSettings();

		await screen.findByTestId("macro-row-mac_1");
		await user.click(screen.getByTestId("macro-create-open"));
		await user.type(screen.getByTestId("macro-name-input"), "abc");

		const caps = screen.getByTestId("macro-editor").textContent ?? "";
		expect(caps).toContain('"count":3');
		expect(caps).toContain('"max":200');
		expect(caps).toContain('"max":2500');
		// The inputs themselves stop at the cap.
		expect(screen.getByTestId("macro-name-input")).toHaveAttribute(
			"maxLength",
			"200",
		);
		expect(screen.getByTestId("macro-body-input")).toHaveAttribute(
			"maxLength",
			"2500",
		);
	});

	it("refuses an empty name or body without a request", async () => {
		const user = userEvent.setup();
		renderAccountSettings();

		await screen.findByTestId("macro-row-mac_1");
		await user.click(screen.getByTestId("macro-create-open"));
		await user.type(screen.getByTestId("macro-body-input"), "body only");
		await user.click(screen.getByTestId("macro-editor-save"));

		expect(await screen.findByTestId("macro-error")).toHaveTextContent(
			"macros.errors.required",
		);
		expect(calls.some((call) => call.method === "POST")).toBe(false);
	});
});
