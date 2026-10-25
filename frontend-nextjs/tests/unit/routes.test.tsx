// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";

// --- View mocks -------------------------------------------------------------
// Every view is replaced with a marker element so the route table can be
// asserted without dragging in auth, network, or i18n side effects.

vi.mock("../../src/views/Login", () => ({
	Login: () => <div>view:Login</div>,
}));
vi.mock("../../src/views/Register", () => ({
	Register: () => <div>view:Register</div>,
}));
vi.mock("../../src/views/Setup", () => ({
	Setup: () => <div>view:Setup</div>,
}));
vi.mock("../../src/views/AgentSelector", () => ({
	default: () => <div>view:AgentSelector</div>,
}));
vi.mock("../../src/views/AgentPanel", () => ({
	default: () => <div>view:AgentPanel</div>,
}));
vi.mock("../../src/views/Agents", () => ({
	default: () => <div>view:Agents</div>,
}));
vi.mock("../../src/views/Dashboard", () => ({
	default: () => <div>view:Dashboard</div>,
}));
vi.mock("../../src/views/FileUploadManagement", () => ({
	default: () => <div>view:FileUploadManagement</div>,
}));
vi.mock("../../src/views/KnowledgeBaseSetup", () => ({
	default: () => <div>view:KnowledgeBaseSetup</div>,
}));
vi.mock("../../src/views/KnowledgeBases", () => ({
	default: () => <div>view:KnowledgeBases</div>,
}));
vi.mock("../../src/views/Playground", () => ({
	default: () => <div>view:Playground</div>,
}));
vi.mock("../../src/views/Sessions", () => ({
	default: () => <div>view:Sessions</div>,
}));
vi.mock("../../src/views/AgentSettings", () => ({
	default: () => <div>view:AgentSettings</div>,
}));
vi.mock("../../src/views/URLManagement", () => ({
	default: () => <div>view:URLManagement</div>,
}));
vi.mock("../../src/views/AdminUsers", () => ({
	AdminUsers: () => <div>view:AdminUsers</div>,
}));
vi.mock("../../src/views/Chat", () => ({
	default: () => <div>view:Chat</div>,
}));

// Layout dependencies: pass auth straight through, and mark the auth switcher.
vi.mock("../../src/components/RequireAuth", () => ({
	RequireAuth: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../src/components/AuthLanguageSwitcher", () => ({
	AuthLanguageSwitcher: () => <div>layout:AuthLanguageSwitcher</div>,
}));

/** Exposes the router's current pathname so redirects can be asserted exactly. */
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

function currentPath(): string {
	return screen.getByTestId("location").textContent ?? "";
}

// --- Real routes: exactly the 18 rendering entries of the route table --------

const routes: Array<[path: string, view: string]> = [
	["/login", "view:Login"],
	["/register", "view:Register"],
	["/setup", "view:Setup"],
	["/agent-selector", "view:AgentSelector"],
	["/", "view:AgentPanel"],
	["/agents", "view:Agents"],
	["/agents/some-id/dashboard", "view:Dashboard"],
	["/agents/some-id/files", "view:FileUploadManagement"],
	["/agents/some-id/knowledge", "view:KnowledgeBaseSetup"],
	["/knowledge-bases", "view:KnowledgeBases"],
	["/agents/some-id/playground", "view:Playground"],
	["/agents/some-id/sessions", "view:Sessions"],
	["/agents/some-id/settings/agent", "view:AgentSettings"],
	["/agents/some-id/urls", "view:URLManagement"],
	["/agents/some-id/users", "view:AdminUsers"],
	["/chat/some-session", "view:Chat"],
	["/files", "view:FileUploadManagement"],
	["/settings/agent", "view:AgentSettings"],
];

describe("route table", () => {
	it.each(routes)("%s renders %s", (path, view) => {
		renderAt(path);
		expect(screen.getByText(view)).toBeInTheDocument();
		expect(currentPath()).toBe(path);
	});

	// --- The 6 redirect entries ----------------------------------------------

	const redirects: Array<[from: string, to: string, view: string]> = [
		["/sessions", "/", "view:AgentPanel"],
		["/knowledge", "/knowledge-bases", "view:KnowledgeBases"],
		["/playground", "/", "view:AgentPanel"],
		["/urls", "/", "view:AgentPanel"],
		["/users", "/", "view:AgentPanel"],
		["/qa", "/files", "view:FileUploadManagement"],
	];

	it.each(redirects)("%s redirects to %s", (from, to, view) => {
		renderAt(from);
		expect(currentPath()).toBe(to);
		expect(screen.getByText(view)).toBeInTheDocument();
	});

	it("wraps the (auth) routes in the auth layout and not the dashboard layout", () => {
		renderAt("/login");
		expect(screen.getByText("layout:AuthLanguageSwitcher")).toBeInTheDocument();
	});

	it("does not render the auth layout switcher on dashboard routes", () => {
		renderAt("/");
		expect(screen.queryByText("layout:AuthLanguageSwitcher")).not.toBeInTheDocument();
	});
});
