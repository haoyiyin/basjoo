// @vitest-environment jsdom
/**
 * #72 — the lead inbox has a real route.
 *
 * The nav entry (`navigation.leads` → `/leads`) is useless unless `App.tsx`
 * mounts the view inside the authed DashboardLayout block, so the route entry
 * itself is asserted here: `/leads` renders `Leads` and nothing else, and it is
 * NOT reachable from the signed-out group.
 *
 * Every other view is replaced with a marker so this suite is about the route
 * table only (same technique as tests/unit/routes.test.tsx).
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { App } from "../../App";

vi.mock("../../views/Login", () => ({ Login: () => <div>view:Login</div> }));
vi.mock("../../views/Register", () => ({ Register: () => <div>view:Register</div> }));
vi.mock("../../views/AgentSelector", () => ({
	default: () => <div>view:AgentSelector</div>,
}));
vi.mock("../../views/Home", () => ({ default: () => <div>view:Home</div> }));
vi.mock("../../views/Agents", () => ({ default: () => <div>view:Agents</div> }));
vi.mock("../../views/Dashboard", () => ({ default: () => <div>view:Dashboard</div> }));
vi.mock("../../views/KnowledgeBaseDetail", () => ({
	default: () => <div>view:KnowledgeBaseDetail</div>,
}));
vi.mock("../../views/KnowledgeBaseSetup", () => ({
	default: () => <div>view:KnowledgeBaseSetup</div>,
}));
vi.mock("../../views/KnowledgeBases", () => ({
	default: () => <div>view:KnowledgeBases</div>,
}));
vi.mock("../../views/Playground", () => ({
	default: () => <div>view:Playground</div>,
}));
vi.mock("../../views/Sessions", () => ({ default: () => <div>view:Sessions</div> }));
vi.mock("../../views/AgentSettings", () => ({
	default: () => <div>view:AgentSettings</div>,
}));
vi.mock("../../views/AccountSettings", () => ({
	default: () => <div>view:AccountSettings</div>,
}));
vi.mock("../../views/Chat", () => ({ default: () => <div>view:Chat</div> }));
vi.mock("../../views/NotFound", () => ({
	default: () => <div>view:NotFound</div>,
}));
vi.mock("../../views/Leads", () => ({
	default: () => <div data-testid="leads-view">view:Leads</div>,
}));

vi.mock("../../components/RequireAuth", () => ({
	RequireAuth: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../components/AdminLayout", () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/AuthLanguageSwitcher", () => ({
	AuthLanguageSwitcher: () => <div>layout:AuthLanguageSwitcher</div>,
}));

function LocationProbe() {
	const location = useLocation();
	return <div data-testid="location">{location.pathname}</div>;
}

function renderAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<App />
			<LocationProbe />
		</MemoryRouter>,
	);
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("#72 /leads route", () => {
	it("mounts the lead inbox at /leads inside the authed shell", () => {
		renderAt("/leads");

		expect(screen.getByTestId("leads-view")).toBeInTheDocument();
		expect(screen.getByTestId("location")).toHaveTextContent("/leads");
		// The dashboard group, not the signed-out one.
		expect(
			screen.queryByText("layout:AuthLanguageSwitcher"),
		).not.toBeInTheDocument();
	});

	it("keeps /leads out of the signed-out group", () => {
		renderAt("/login");
		expect(screen.getByText("view:Login")).toBeInTheDocument();
		expect(
			screen.getByText("layout:AuthLanguageSwitcher"),
		).toBeInTheDocument();
		expect(screen.queryByTestId("leads-view")).toBeNull();
	});
});
