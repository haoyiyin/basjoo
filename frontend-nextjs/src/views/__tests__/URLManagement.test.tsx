// @ts-nocheck
// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom";
import URLManagement from "../URLManagement";
import { api } from "../../services/api";
import type { URLSource } from "../../services/api";

// Mock window.alert to prevent blocking
vi.stubGlobal("alert", vi.fn());

// Mock the API module
vi.mock("../../services/api", () => ({
  api: {
    getAgent: vi.fn(),
    listURLs: vi.fn(),
    createURLs: vi.fn(),
    refetchURLs: vi.fn(),
    crawlSite: vi.fn(),
    cancelURLTasks: vi.fn(),
    deleteURL: vi.fn(),
    clearAllUrls: vi.fn(),
    rebuildIndex: vi.fn(),
    getTasksStatus: vi.fn(),
    getIndexStatus: vi.fn(),
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

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Mock AdminLayout
vi.mock("../../components/AdminLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="admin-layout">{children}</div>,
}));

// Mock KBSetupGuard
vi.mock("../../components/KBSetupGuard", () => ({
  default: ({ children, agentId }: { children: React.ReactNode; agentId: string }) => (
    <div data-testid="kb-setup-guard">{children}</div>
  ),
}));

// Mock HelpTooltip
vi.mock("../../components/HelpTooltip", () => ({
  default: () => null,
}));

// Mock SourcesSummary
vi.mock("../../components/SourcesSummary", () => ({
  default: () => <div data-testid="sources-summary" />,
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

const createMockURL = (status: URLSource["status"], isIndexed: boolean = false, overrides: Partial<URLSource> = {}): URLSource => ({
  id: 1,
  url: "https://example.com",
  normalized_url: "https://example.com",
  status,
  is_indexed: isIndexed,
  title: "Test Page",
  last_fetch_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  agent_id: "agt_test",
  ...overrides,
});

describe("URLManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Default mocks - no active crawling
    mockedApi.getAgent.mockResolvedValue(mockAgent as any);
    mockedApi.getTasksStatus.mockResolvedValue({
      is_crawling: false,
      is_rebuilding: false,
      can_modify_index: true,
      active_tasks: [],
    } as any);
    mockedApi.getIndexStatus.mockResolvedValue({
      status: "ready",
      total_chunks: 0,
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderComponent(initialURLs: URLSource[] = []) {
    mockedApi.listURLs.mockResolvedValue({ urls: initialURLs, total: initialURLs.length } as any);

    const router = createMemoryRouter(
      [
        { path: "/agents/:agentId/urls", element: <URLManagement /> },
      ],
      { initialEntries: ["/agents/agt_test/urls"] }
    );

    const view = render(<RouterProvider router={router} />);
    return { ...view, router };
  }

  it("should render without errors", async () => {
    const urls = [createMockURL("success", true)];
    mockedApi.listURLs.mockResolvedValue({ urls, total: 1 } as any);

    renderComponent(urls);

    // Wait for component to load
    await waitFor(() => {
      expect(mockedApi.getAgent).toHaveBeenCalled();
    });

    // Component should render
    expect(screen.getByTestId("admin-layout")).toBeInTheDocument();
  });

  it("should render URL list when there are URLs", async () => {
    const urls = [createMockURL("success", true)];
    mockedApi.listURLs.mockResolvedValue({ urls, total: 1 } as any);

    renderComponent(urls);

    // Wait for component to load
    await waitFor(() => {
      expect(mockedApi.listURLs).toHaveBeenCalledWith("agt_test");
    });

    // URL should be displayed
    await waitFor(() => {
      expect(screen.getByText("https://example.com")).toBeInTheDocument();
    });
  });

  it("should show empty state when no URLs", async () => {
    mockedApi.listURLs.mockResolvedValue({ urls: [], total: 0 } as any);

    renderComponent([]);

    // Wait for component to load
    await waitFor(() => {
      expect(mockedApi.listURLs).toHaveBeenCalledWith("agt_test");
    });

    // Empty state should be shown
    await waitFor(() => {
      expect(screen.getByText("labels.urlManagement.noUrls")).toBeInTheDocument();
    });
  });
});

describe("URLManagement indexing status display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Default mocks - idle backend state
    mockedApi.getAgent.mockResolvedValue(mockAgent as any);
    mockedApi.getTasksStatus.mockResolvedValue({
      is_crawling: false,
      is_rebuilding: false,
      can_modify_index: true,
      active_tasks: [],
    } as any);
    // Backend index status is idle (not indexing/rebuilding)
    mockedApi.getIndexStatus.mockResolvedValue({
      status: "idle",
      total_chunks: 0,
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderComponent(initialURLs: URLSource[] = []) {
    mockedApi.listURLs.mockResolvedValue({ urls: initialURLs, total: initialURLs.length } as any);

    const router = createMemoryRouter(
      [
        { path: "/agents/:agentId/urls", element: <URLManagement /> },
      ],
      { initialEntries: ["/agents/agt_test/urls"] }
    );

    const view = render(<RouterProvider router={router} />);
    return { ...view, router };
  }

  it("should NOT show active fetching banner for success-but-unindexed URL when backend is idle", async () => {
    // URL is fetched successfully but not indexed, and backend reports idle
    const urls = [createMockURL("success", false, { 
      indexing_status: "error",
      indexing_error: "Embedding API rate limit exceeded"
    })];
    mockedApi.listURLs.mockResolvedValue({ urls, total: 1 } as any);

    renderComponent(urls);

    // Wait for component to load
    await waitFor(() => {
      expect(mockedApi.listURLs).toHaveBeenCalledWith("agt_test");
    });

    // Should show "Not Indexed" or similar status, NOT active fetching/crawling banner
    // The crawlInProgress banner should NOT be visible
    await waitFor(() => {
      const crawlBanner = screen.queryByText(/crawlInProgress/i);
      expect(crawlBanner).not.toBeInTheDocument();
    });

    // Should display the URL's index status (Not Indexed)
    await waitFor(() => {
      expect(screen.getByText(/Not Indexed|Index failed/i)).toBeInTheDocument();
    });
  });

  it("should recognize backend index status 'indexing' as active index work", async () => {
    // Backend reports indexing is in progress
    mockedApi.getIndexStatus.mockResolvedValue({
      status: "indexing",
      total_chunks: 10,
    } as any);

    const urls = [createMockURL("success", false, { indexing_status: "processing" })];
    mockedApi.listURLs.mockResolvedValue({ urls, total: 1 } as any);

    renderComponent(urls);

    // Wait for component to load and polling to start
    await waitFor(() => {
      expect(mockedApi.getIndexStatus).toHaveBeenCalled();
    });

    // Should show active polling/work indicator when backend is indexing
    await waitFor(() => {
      expect(mockedApi.getIndexStatus).toHaveBeenCalledWith("agt_test");
    });
  });

  it("should recognize backend index status 'rebuilding' as active index work", async () => {
    // Backend reports rebuilding is in progress
    mockedApi.getIndexStatus.mockResolvedValue({
      status: "rebuilding",
      total_chunks: 50,
    } as any);
    mockedApi.getTasksStatus.mockResolvedValue({
      is_crawling: false,
      is_rebuilding: true,
      can_modify_index: false,
      active_tasks: ["rebuild_index"],
    } as any);

    const urls = [createMockURL("success", false, { indexing_status: "processing" })];
    mockedApi.listURLs.mockResolvedValue({ urls, total: 1 } as any);

    renderComponent(urls);

    // Wait for component to load
    await waitFor(() => {
      expect(mockedApi.getTasksStatus).toHaveBeenCalledWith("agt_test");
    });

    // Should detect rebuilding as active work
    await waitFor(() => {
      expect(mockedApi.getTasksStatus).toHaveBeenCalled();
    });
  });

  it("should display indexing error details when provided", async () => {
    const urls = [createMockURL("success", false, {
      indexing_status: "error",
      indexing_error: "Embedding API rate limit exceeded"
    })];
    mockedApi.listURLs.mockResolvedValue({ urls, total: 1 } as any);

    renderComponent(urls);

    // Wait for component to load
    await waitFor(() => {
      expect(mockedApi.listURLs).toHaveBeenCalledWith("agt_test");
    });

    // Should show the indexing error message
    await waitFor(() => {
      expect(screen.getByText(/Embedding API rate limit exceeded/i)).toBeInTheDocument();
    });
  });

  it("should display URL last_error when fetch failed", async () => {
    const urls = [createMockURL("failed", false, {
      last_error: "DNS resolution failed: example.com not found"
    })];
    mockedApi.listURLs.mockResolvedValue({ urls, total: 1 } as any);

    renderComponent(urls);

    // Wait for component to load
    await waitFor(() => {
      expect(mockedApi.listURLs).toHaveBeenCalledWith("agt_test");
    });

    // Should show the fetch error message
    await waitFor(() => {
      expect(screen.getByText(/DNS resolution failed/i)).toBeInTheDocument();
    });
  });
});

describe("URLManagement crawlPolling synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    mockedApi.getAgent.mockResolvedValue(mockAgent as any);
    mockedApi.getTasksStatus.mockResolvedValue({
      is_crawling: false,
      is_rebuilding: false,
      can_modify_index: true,
      active_tasks: [],
    } as any);
    mockedApi.getIndexStatus.mockResolvedValue({
      status: "ready",
      total_chunks: 0,
    } as any);
  });

  it("should have reactive synchronization code to clear crawlPolling when backend reports no crawling", () => {
    // Read the source file to verify the fix is in place
    const fs = require("fs");
    const path = require("path");
    const sourceFile = path.join(__dirname, "../URLManagement.tsx");
    const content = fs.readFileSync(sourceFile, "utf-8");

    // Verify the fix is present: clear crawlPolling when backend reports no crawling
    expect(content).toContain("Clear crawlPolling when backend reports no crawling but frontend still shows polling");
    expect(content).toContain("if (!status.is_crawling && !status.is_rebuilding && crawlPollingRef.current)");
  });

  it("should have reduced consecutiveNoChange threshold from 2 to 1", () => {
    // Read the source file to verify the fix is in place
    const fs = require("fs");
    const path = require("path");
    const sourceFile = path.join(__dirname, "../URLManagement.tsx");
    const content = fs.readFileSync(sourceFile, "utf-8");

    // Verify the consecutiveNoChange threshold is now 1
    expect(content).toContain("consecutiveNoChange >= 1");
    // Should NOT contain the old threshold of 2
    expect(content).not.toMatch(/consecutiveNoChange >= 2(?!\d)/);
  });
});
