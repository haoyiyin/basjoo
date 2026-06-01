// @ts-nocheck
// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import AgentPanel from "../../src/views/AgentPanel";
import { api } from "../../src/services/api";

vi.mock("../../src/services/api", () => ({
  api: {
    listAgents: vi.fn(),
    getAgent: vi.fn(),
  },
}));

vi.mock("../../src/context/AuthContext", () => ({
  useAuth: () => ({
    admin: {
      id: 1,
      name: "Owner",
      email: "owner@example.com",
      role: "super_admin",
    },
    token: "test-token",
    logout: vi.fn(),
  }),
}));

vi.mock("../../src/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockedApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.getAgent.mockResolvedValue({ id: "agt_active", name: "Active Agent" } as any);
  mockedApi.listAgents.mockResolvedValue({
    agents: [
      {
        id: "agt_active",
        name: "Active Agent",
        description: "Available",
        agent_type: "website_support",
        channel_mode: "web_widget",
        is_active: true,
        deleted_at: null,
        last_error_code: null,
      },
      {
        id: "agt_inactive",
        name: "Inactive Agent",
        description: "Stopped",
        agent_type: "website_support",
        channel_mode: "web_widget",
        is_active: false,
        deleted_at: null,
        last_error_code: null,
      },
      {
        id: "agt_deleted",
        name: "Deleted Agent",
        description: "Soft deleted",
        agent_type: "website_support",
        channel_mode: "web_widget",
        is_active: false,
        deleted_at: "2026-06-01T00:00:00Z",
        last_error_code: null,
      },
    ],
    total: 3,
  } as any);
});

describe("AgentPanel inactive agent visibility", () => {
  it("only renders active non-deleted agents as openable workspace cards", async () => {
    const router = createMemoryRouter(
      [
        { path: "/", element: <AgentPanel /> },
        { path: "/agents/:agentId/dashboard", element: <div>Scoped Dashboard</div> },
      ],
      { initialEntries: ["/"] },
    );

    render(<RouterProvider router={router} />);

    await screen.findByText("Active Agent");

    expect(screen.queryByText("Inactive Agent")).not.toBeInTheDocument();
    expect(screen.queryByText("Deleted Agent")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Active Agent/ })).toBeInTheDocument();
  });
});
