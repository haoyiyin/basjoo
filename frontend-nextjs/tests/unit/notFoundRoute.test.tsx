// @vitest-environment jsdom
/**
 * QA sweep 2026-10-29 / C2 — unknown URLs must not render a blank page.
 *
 * `/this-route-does-not-exist` used to mount nothing at all: no title, no nav,
 * no way back. The route table now ends with a `path="*"` catch-all in both
 * layout groups, and the assertion below pins the two things the user needs:
 * a title that says the page is missing, and a link back to `/`.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/App";

// Signed in as a workspace super admin: `RequireAuth` then passes the catch-all
// straight through instead of bouncing to /login.
vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		admin: {
			id: 1,
			name: "Owner",
			email: "owner@example.com",
			role: "super_admin",
		},
		token: "test-token",
		isLoading: false,
		logout: vi.fn(),
		login: vi.fn(),
		register: vi.fn(),
	}),
}));

function renderAt(path: string): void {
	render(
		<MemoryRouter initialEntries={[path]}>
			<App />
		</MemoryRouter>,
	);
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("catch-all route", () => {
	it.each(["/this-route-does-not-exist", "/agents/agt_1/nope"])(
		"%s renders the not-found page with a way back home",
		(path: string) => {
			renderAt(path);

			// react-i18next is not initialised in the unit suite, so `t` echoes
			// the key: the title is the `notFound.title` string, never prose
			// baked into the view.
			const title = screen.getByRole("heading", { level: 1 });
			expect(title).toHaveClass("page-title");
			expect(title).toHaveTextContent("notFound.title");

			expect(screen.getByTestId("not-found-page")).toBeInTheDocument();
			expect(screen.getByText("notFound.body")).toBeInTheDocument();

			const home = screen.getByRole("link", { name: "notFound.back" });
			expect(home).toHaveAttribute("href", "/");
			expect(home).toHaveClass("btn", "btn-primary");
		},
	);
});
