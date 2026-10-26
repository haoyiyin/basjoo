// @ts-nocheck
// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom";
import URLManagement from "../URLManagement";
import { api } from "../../services/api";
import type { URLSource } from "../../services/api";

// Mock window.alert / confirm to prevent blocking
vi.stubGlobal("alert", vi.fn());
vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

// The panel is KB-scoped: it reads `kbId` from the route and calls only the
// canonical kb-scoped helpers. No agent id appears in the request path.
vi.mock("../../services/api", () => ({
  api: {
    getKnowledgeBase: vi.fn(),
    getAgent: vi.fn(),
    listKbUrls: vi.fn(),
    createKbUrls: vi.fn(),
    refetchKbUrls: vi.fn(),
    crawlKbSite: vi.fn(),
    cancelKbUrlTasks: vi.fn(),
    deleteKbUrl: vi.fn(),
    clearKbUrls: vi.fn(),
    rebuildKbIndex: vi.fn(),
    getKbIndexStatus: vi.fn(),
    updateAgent: vi.fn(),
  },
}));

// Mock AuthContext
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    admin: { id: 1, name: "Test Admin", email: "test@example.com", role: "super_admin" },
    token: "test-token",
    logout: vi.fn(),
  }),
}));

// Mock react-i18next (stable `t`: the loader is memoised on it)
const stableT = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}|${JSON.stringify(params)}` : key;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT }),
}));

// Mock HelpTooltip
vi.mock("../../components/HelpTooltip", () => ({
  default: () => null,
}));

// Mock useMediaQuery hook
vi.mock("../../hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useIsTablet: () => false,
}));

const mockedApi = vi.mocked(api);

const mockAgent = {
  id: "agt_test",
  name: "Test Agent",
  enable_auto_fetch: false,
  url_fetch_interval_days: 7,
  crawl_max_depth: 2,
  crawl_max_pages: 20,
};

const createMockURL = (
  status: URLSource["status"],
  isIndexed = false,
  overrides: Partial<URLSource> = {},
): URLSource => ({
  id: 1,
  url: "https://example.com",
  normalized_url: "https://example.com",
  status,
  is_indexed: isIndexed,
  title: "Test Page",
  last_fetch_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

function stubUrlList(urls: URLSource[]) {
  mockedApi.listKbUrls.mockResolvedValue({
    urls,
    total: urls.length,
    quota: { used: urls.length, max: 100 },
  } as any);
}

function renderComponent(initialURLs: URLSource[] = [], boundAgent: unknown = null) {
  stubUrlList(initialURLs);
  mockedApi.getKnowledgeBase.mockResolvedValue({
    id: "kb_test",
    name: "Test KB",
    bound_agent: boundAgent ? { id: mockAgent.id, name: mockAgent.name } : null,
  } as any);
  mockedApi.getAgent.mockResolvedValue(mockAgent as any);
  mockedApi.getKbIndexStatus.mockResolvedValue({ kb_id: "kb_test", status: "idle" } as any);

  const router = createMemoryRouter(
    [{ path: "/knowledge-bases/:kbId", element: <URLManagement /> }],
    { initialEntries: ["/knowledge-bases/kb_test"] },
  );

  const view = render(<RouterProvider router={router} />);
  return { ...view, router };
}

describe("URLManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the KB's URLs through the kb-scoped helper and never the agent alias", async () => {
    const urls = [createMockURL("success", true)];
    renderComponent(urls);

    await waitFor(() => {
      expect(mockedApi.listKbUrls).toHaveBeenCalledWith("kb_test");
    });

    // The legacy agent-scoped helpers must not be reachable from this view.
    expect(mockedApi.listURLs).toBeUndefined();
    expect(mockedApi.createURLs).toBeUndefined();
    expect(mockedApi.uploadFiles).toBeUndefined();
  });

  it("should render URL list when there are URLs", async () => {
    const urls = [createMockURL("success", true)];
    renderComponent(urls);

    await waitFor(() => {
      expect(mockedApi.listKbUrls).toHaveBeenCalledWith("kb_test");
    });

    await waitFor(() => {
      expect(screen.getByText("https://example.com")).toBeInTheDocument();
    });
  });

  it("should show empty state when no URLs", async () => {
    renderComponent([]);

    await waitFor(() => {
      expect(mockedApi.listKbUrls).toHaveBeenCalledWith("kb_test");
    });

    await waitFor(() => {
      expect(screen.getByText("labels.urlManagement.noUrls")).toBeInTheDocument();
    });
  });

  it("hides the auto-fetch toggle when the KB has no bound agent", async () => {
    renderComponent([], null);

    await waitFor(() => {
      expect(mockedApi.getKnowledgeBase).toHaveBeenCalledWith("kb_test");
    });

    expect(screen.queryByTestId("kb-url-autofetch")).not.toBeInTheDocument();
    expect(mockedApi.getAgent).not.toHaveBeenCalled();
  });

  it("saves auto-fetch settings against the KB's bound agent, not the KB id", async () => {
    mockedApi.updateAgent.mockResolvedValue(mockAgent as any);
    renderComponent([], mockAgent);

    expect(await screen.findByTestId("kb-url-autofetch")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockedApi.getAgent).toHaveBeenCalledWith("agt_test");
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "labels.urlManagement.saveSettings",
      }),
    );

    await waitFor(() => {
      expect(mockedApi.updateAgent).toHaveBeenCalledTimes(1);
    });

    // The auto-fetch knobs live on the *agent*; the KB page must never PATCH a
    // KB-scoped endpoint for them.
    const [agentId, patch] = mockedApi.updateAgent.mock.calls[0];
    expect(agentId).toBe("agt_test");
    expect(patch).toMatchObject({
      enable_auto_fetch: false,
      url_fetch_interval_days: 7,
      crawl_max_depth: 2,
      crawl_max_pages: 20,
    });
  });
});

describe("URLManagement indexing status display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should NOT show active fetching banner for success-but-unindexed URL when backend is idle", async () => {
    const urls = [
      createMockURL("success", false, {
        indexing_status: "error",
        indexing_error: "Embedding API rate limit exceeded",
      }),
    ];
    renderComponent(urls);

    await waitFor(() => {
      expect(mockedApi.listKbUrls).toHaveBeenCalledWith("kb_test");
    });

    await waitFor(() => {
      expect(screen.queryByText(/crawlInProgress/i)).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/Index Error/i)).toBeInTheDocument();
    });
  });

  it("should display 'Indexing...' badge for URLs with indexing_status 'processing'", async () => {
    const urls = [createMockURL("success", false, { indexing_status: "processing" })];
    renderComponent(urls);

    await waitFor(() => {
      expect(mockedApi.listKbUrls).toHaveBeenCalledWith("kb_test");
    });

    await waitFor(() => {
      expect(screen.getByText(/Indexing\.\.\./i)).toBeInTheDocument();
    });
  });

  it("should display indexing error details when provided", async () => {
    const urls = [
      createMockURL("success", false, {
        indexing_status: "error",
        indexing_error: "Embedding API rate limit exceeded",
      }),
    ];
    renderComponent(urls);

    await waitFor(() => {
      expect(mockedApi.listKbUrls).toHaveBeenCalledWith("kb_test");
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Embedding API rate limit exceeded/i),
      ).toBeInTheDocument();
    });
  });

  it("should display URL last_error when fetch failed", async () => {
    const urls = [
      createMockURL("failed", false, {
        last_error: "DNS resolution failed: example.com not found",
      }),
    ];
    renderComponent(urls);

    await waitFor(() => {
      expect(mockedApi.listKbUrls).toHaveBeenCalledWith("kb_test");
    });

    await waitFor(() => {
      const elements = screen.getAllByText(/DNS resolution failed/i);
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("URLManagement crawlPolling synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the documented reason for not stopping URL polling on is_crawling=false", () => {
    const fs = require("fs");
    const path = require("path");
    const sourceFile = path.join(__dirname, "../URLManagement.tsx");
    const content = fs.readFileSync(sourceFile, "utf-8");

    // The KB page has no `tasks:status` agent poll any more; the polling loop
    // owns its stop conditions and must say so.
    expect(content).toContain(
      "The KB index task is the only backend-side work signal",
    );
    expect(content).toContain("success-but-unindexed is NOT an");
    expect(content).toContain("active signal");
  });

  it("uses a one-poll-stable stop threshold instead of a two-poll one", () => {
    const fs = require("fs");
    const path = require("path");
    const sourceFile = path.join(__dirname, "../URLManagement.tsx");
    const content = fs.readFileSync(sourceFile, "utf-8");

    expect(content).toContain("consecutiveNoChange >= 1");
    expect(content).not.toMatch(/consecutiveNoChange >= 2(?!\d)/);
  });
});
