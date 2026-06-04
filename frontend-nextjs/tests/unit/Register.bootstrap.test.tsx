// @ts-nocheck
// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuthProvider } from "../../src/context/AuthContext";
import { Register } from "../../src/views/Register";

// Provide a fake localStorage for jsdom
const fakeLocalStorage = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			store = {};
		},
		get length() {
			return Object.keys(store).length;
		},
		key: (index: number) => Object.keys(store)[index] ?? null,
	};
})();

Object.defineProperty(globalThis, "localStorage", {
	value: fakeLocalStorage,
	writable: true,
	configurable: true,
});

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

// A realistic JWT token expiring ~24h from test execution so setTimeout works
// without 32-bit overflow and the fixture does not go stale over time.
function base64UrlEncode(value: object): string {
	return btoa(JSON.stringify(value))
		.replace(/=/g, "")
		.replace(/\+/g, "-")
		.replace(/\//g, "_");
}

const TEST_TOKEN = [
	base64UrlEncode({ alg: "HS256", typ: "JWT" }),
	base64UrlEncode({
		exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
		sub: "1",
	}),
	"fakesignature",
].join(".");
const TEST_ADMIN = {
	id: 1,
	email: "owner@example.com",
	name: "Owner",
	role: "super_admin",
};

interface FetchEntry {
	url: string;
	method: string;
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.clear();
});

describe("Register bootstrap flow (real AuthProvider)", () => {
	it("registers a super admin and persists the session in localStorage without calling /login", async () => {
		const fetchCalls: FetchEntry[] = [];

		global.fetch = vi
			.fn()
			.mockImplementation((url: string, options?: RequestInit) => {
				fetchCalls.push({ url, method: options?.method || "GET" });

				// Order matters: check the longer path first to avoid partial matches
				if (url.includes("/api/admin/registration-settings")) {
					return Promise.resolve({
						ok: true,
						json: async () => ({ bootstrap_required: true }),
					});
				}

				if (url.includes("/api/admin/register")) {
					return Promise.resolve({
						ok: true,
						json: async () => ({
							access_token: TEST_TOKEN,
							admin: TEST_ADMIN,
						}),
					});
				}

				if (url.includes("/api/admin/me")) {
					return Promise.resolve({
						ok: true,
						json: async () => TEST_ADMIN,
					});
				}

				return Promise.resolve({
					ok: false,
					status: 404,
					json: async () => ({ detail: "Not found" }),
				});
			}) as any;

		const router = createMemoryRouter(
			[
				{ path: "/register", element: <Register /> },
				{ path: "/", element: <div>Home page</div> },
			],
			{ initialEntries: ["/register"] },
		);

		render(
			<AuthProvider>
				<RouterProvider router={router} />
			</AuthProvider>,
		);

		// Wait for registration-settings check to complete and form to render
		await screen.findByText("initialSetup.name");
		expect(
			fetchCalls.some((f) => f.url.includes("registration-settings")),
		).toBe(true);

		// Fill the form
		fireEvent.change(
			screen.getByPlaceholderText("initialSetup.namePlaceholder"),
			{ target: { value: "Owner" } },
		);
		fireEvent.change(
			screen.getByPlaceholderText("initialSetup.emailPlaceholder"),
			{ target: { value: "owner@example.com" } },
		);
		fireEvent.change(
			screen.getByPlaceholderText("initialSetup.passwordPlaceholder"),
			{ target: { value: "password123" } },
		);
		fireEvent.change(
			screen.getByPlaceholderText("initialSetup.confirmPasswordPlaceholder"),
			{ target: { value: "password123" } },
		);

		// Submit the form
		fireEvent.click(
			screen.getByRole("button", { name: "initialSetup.registerButton" }),
		);

		// Wait for navigation to / and the home page to render
		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/");
		});
		// Wait for the home page content to be rendered after navigation
		await waitFor(() => {
			expect(screen.queryByText("Home page")).toBeInTheDocument();
		});

		// Verify localStorage has the persisted session
		expect(localStorage.getItem("token")).toBe(TEST_TOKEN);
		expect(JSON.parse(localStorage.getItem("admin") || "{}")).toEqual(
			TEST_ADMIN,
		);

		// Verify no call was made to /api/admin/login
		const loginCalls = fetchCalls.filter((f) =>
			f.url.includes("/api/admin/login"),
		);
		expect(loginCalls).toHaveLength(0);
	});
});
