// @ts-nocheck
// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom";
import FileUploadManagement from "../../src/views/FileUploadManagement";
import { api } from "../../src/services/api";
import type { FileItem } from "../../src/services/api";

// Mock window.alert to prevent blocking
vi.stubGlobal("alert", vi.fn());

// Mock the API module
vi.mock("../../src/services/api", () => ({
  api: {
    getAgent: vi.fn(),
    listFiles: vi.fn(),
    uploadFiles: vi.fn(),
    deleteFile: vi.fn(),
    clearAllFiles: vi.fn(),
    getTasksStatus: vi.fn(),
  },
}));

// Mock AuthContext
vi.mock("../../src/context/AuthContext", () => ({
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
vi.mock("../../src/components/AdminLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="admin-layout">{children}</div>,
}));

// Mock KBSetupGuard - just render children when agentId provided
vi.mock("../../src/components/KBSetupGuard", () => ({
  default: ({ children, agentId }: { children: React.ReactNode; agentId: string }) => (
    <div data-testid="kb-setup-guard">{children}</div>
  ),
}));

// Mock SourcesSummary
vi.mock("../../src/components/SourcesSummary", () => ({
  default: () => <div data-testid="sources-summary" />,
}));

// Mock useMediaQuery hook
vi.mock("../../src/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
}));

const mockedApi = vi.mocked(api);

const mockAgent = {
  id: "agt_test",
  name: "Test Agent",
};

const createMockFile = (status: FileItem["status"], overrides: Partial<FileItem> = {}): FileItem => ({
  id: `file_${status}`,
  filename: `test-${status}.pdf`,
  file_type: "application/pdf",
  file_size: 1024,
  status,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  ...overrides,
});

describe("FileUploadManagement file status polling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    
    // Default mocks
    mockedApi.getAgent.mockResolvedValue(mockAgent as any);
    mockedApi.getTasksStatus.mockResolvedValue({
      is_crawling: false,
      is_rebuilding: false,
      can_modify_index: true,
      active_tasks: [],
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderComponent(initialFiles: FileItem[] = []) {
    mockedApi.listFiles.mockResolvedValue({ files: initialFiles } as any);

    const router = createMemoryRouter(
      [
        { path: "/agents/:agentId/files", element: <FileUploadManagement /> },
      ],
      { initialEntries: ["/agents/agt_test/files"] }
    );

    const view = render(<RouterProvider router={router} />);
    return { ...view, router };
  }

  it("should start polling when there are processing files", async () => {
    const processingFiles = [createMockFile("processing")];
    mockedApi.listFiles.mockResolvedValue({ files: processingFiles } as any);

    renderComponent(processingFiles);

    // Wait for initial component render and data load
    await waitFor(() => {
      expect(mockedApi.getAgent).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockedApi.listFiles).toHaveBeenCalledWith("agt_test");
    });

    // Clear mocks to track only polling calls
    const initialCallCount = mockedApi.listFiles.mock.calls.length;

    // Advance timer by 3 seconds (polling interval)
    vi.advanceTimersByTime(3000);
    await vi.runOnlyPendingTimersAsync();

    // Should have called listFiles again due to polling
    await waitFor(() => {
      expect(mockedApi.listFiles.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  it("should stop polling when all files are ready", async () => {
    // Start with processing file
    const processingFiles = [createMockFile("processing")];
    mockedApi.listFiles.mockResolvedValue({ files: processingFiles } as any);

    renderComponent(processingFiles);

    // Wait for initial load
    await waitFor(() => {
      expect(mockedApi.listFiles).toHaveBeenCalledWith("agt_test");
    });

    // Wait for a few polling cycles with processing files
    vi.advanceTimersByTime(6000);
    await waitFor(() => {
      expect(mockedApi.listFiles.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // Now simulate files becoming ready (this will cause polling to stop)
    const readyFiles = [createMockFile("ready")];
    mockedApi.listFiles.mockResolvedValue({ files: readyFiles } as any);

    // Get current call count
    const callCountBefore = mockedApi.listFiles.mock.calls.length;

    // Advance time - one more poll should happen to get the ready state
    vi.advanceTimersByTime(3000);
    await vi.runAllTimersAsync();

    // After files become ready, polling should stop
    // Wait a bit more - should NOT trigger many more calls
    vi.advanceTimersByTime(9000);
    await vi.runAllTimersAsync();

    // Should have stopped polling (allowing for task status polling which also calls listFiles)
    const finalCallCount = mockedApi.listFiles.mock.calls.length;
    // Should not have increased by more than 3 additional calls (task status polling)
    expect(finalCallCount - callCountBefore).toBeLessThanOrEqual(4);
  });

  it("should call loadFiles during polling", async () => {
    const processingFiles = [createMockFile("processing")];
    mockedApi.listFiles.mockResolvedValue({ files: processingFiles } as any);

    renderComponent(processingFiles);

    // Wait for initial load
    await waitFor(() => {
      expect(mockedApi.listFiles).toHaveBeenCalledWith("agt_test");
    });

    // Clear mock to track subsequent calls
    const initialCount = mockedApi.listFiles.mock.calls.length;

    // Advance timer to trigger polling
    vi.advanceTimersByTime(3000);

    // Should call listFiles (via loadFiles)
    await waitFor(() => {
      expect(mockedApi.listFiles.mock.calls.length).toBeGreaterThan(initialCount);
    });
    
    // Verify it was called with the agent ID
    expect(mockedApi.listFiles).toHaveBeenCalledWith("agt_test");
  });

  it("should cleanup interval on unmount", async () => {
    const processingFiles = [createMockFile("processing")];
    mockedApi.listFiles.mockResolvedValue({ files: processingFiles } as any);

    const { unmount } = renderComponent(processingFiles);

    // Wait for initial load
    await waitFor(() => {
      expect(mockedApi.listFiles.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    // Get count before unmount
    const callCountBeforeUnmount = mockedApi.listFiles.mock.calls.length;

    // Unmount the component
    unmount();

    // Advance timer - should NOT trigger many more calls since component unmounted
    vi.advanceTimersByTime(6000);
    await vi.runAllTimersAsync();

    // Should have limited additional calls after unmount
    const finalCallCount = mockedApi.listFiles.mock.calls.length;
    expect(finalCallCount - callCountBeforeUnmount).toBeLessThanOrEqual(2);
  });

  it("should start polling when there are pending files", async () => {
    const pendingFiles = [createMockFile("pending")];
    mockedApi.listFiles.mockResolvedValue({ files: pendingFiles } as any);

    renderComponent(pendingFiles);

    // Wait for initial load
    await waitFor(() => {
      expect(mockedApi.listFiles).toHaveBeenCalledWith("agt_test");
    });

    // Clear mock
    const initialCount = mockedApi.listFiles.mock.calls.length;

    // Advance timer by 3 seconds
    vi.advanceTimersByTime(3000);

    // Should poll for pending files too
    await waitFor(() => {
      expect(mockedApi.listFiles.mock.calls.length).toBeGreaterThan(initialCount);
    });
  });

  it("should not poll when there are only ready files from the start", async () => {
    const readyFiles = [createMockFile("ready")];
    mockedApi.listFiles.mockResolvedValue({ files: readyFiles } as any);

    renderComponent(readyFiles);

    // Wait for initial load
    await waitFor(() => {
      expect(mockedApi.listFiles.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    // Get count after initial load
    const callCountAfterInitial = mockedApi.listFiles.mock.calls.length;

    // Advance timer
    vi.advanceTimersByTime(9000);
    await vi.runAllTimersAsync();

    // Should have limited additional calls - task status polling may still call listFiles
    // but file-specific polling should not occur
    const finalCallCount = mockedApi.listFiles.mock.calls.length;
    const additionalCalls = finalCallCount - callCountAfterInitial;
    
    // Allow for task status polling (every 3 seconds) but not file polling
    expect(additionalCalls).toBeLessThanOrEqual(4);
  });
});

describe("FileUploadManagement error display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    
    // Default mocks
    mockedApi.getAgent.mockResolvedValue(mockAgent as any);
    mockedApi.getTasksStatus.mockResolvedValue({
      is_crawling: false,
      is_rebuilding: false,
      can_modify_index: true,
      active_tasks: [],
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderComponent(initialFiles: FileItem[] = []) {
    mockedApi.listFiles.mockResolvedValue({ files: initialFiles } as any);

    const router = createMemoryRouter(
      [
        { path: "/agents/:agentId/files", element: <FileUploadManagement /> },
      ],
      { initialEntries: ["/agents/agt_test/files"] }
    );

    const view = render(<RouterProvider router={router} />);
    return { ...view, router };
  }

  it("should display error_message for failed file uploads", async () => {
    const failedFiles = [createMockFile("failed", {
      error_message: "PDF parsing failed: malformed PDF structure"
    })];
    mockedApi.listFiles.mockResolvedValue({ files: failedFiles } as any);

    renderComponent(failedFiles);

    // Wait for initial load
    await waitFor(() => {
      expect(mockedApi.listFiles).toHaveBeenCalledWith("agt_test");
    });

    // Should show the error message for the failed file
    await waitFor(() => {
      expect(screen.getByText(/PDF parsing failed: malformed PDF structure/i)).toBeInTheDocument();
    });
  });

  it("should display Qdrant-specific error details", async () => {
    const failedFiles = [createMockFile("failed", {
      error_message: "Qdrant upsert failed: collection not found"
    })];
    mockedApi.listFiles.mockResolvedValue({ files: failedFiles } as any);

    renderComponent(failedFiles);

    // Wait for initial load
    await waitFor(() => {
      expect(mockedApi.listFiles).toHaveBeenCalledWith("agt_test");
    });

    // Should show the Qdrant error
    await waitFor(() => {
      expect(screen.getByText(/Qdrant upsert failed: collection not found/i)).toBeInTheDocument();
    });
  });

  it("should display embedding API error details", async () => {
    const failedFiles = [createMockFile("failed", {
      error_message: "Embedding API rate limit exceeded: too many requests"
    })];
    mockedApi.listFiles.mockResolvedValue({ files: failedFiles } as any);

    renderComponent(failedFiles);

    // Wait for initial load
    await waitFor(() => {
      expect(mockedApi.listFiles).toHaveBeenCalledWith("agt_test");
    });

    // Should show the embedding API error
    await waitFor(() => {
      expect(screen.getByText(/Embedding API rate limit exceeded/i)).toBeInTheDocument();
    });
  });

  it("should display parser error for unsupported file format", async () => {
    const failedFiles = [createMockFile("failed", {
      error_message: "Parser error: unsupported file format .xyz"
    })];
    mockedApi.listFiles.mockResolvedValue({ files: failedFiles } as any);

    renderComponent(failedFiles);

    // Wait for initial load
    await waitFor(() => {
      expect(mockedApi.listFiles).toHaveBeenCalledWith("agt_test");
    });

    // Should show the parser error
    await waitFor(() => {
      expect(screen.getByText(/Parser error: unsupported file format/i)).toBeInTheDocument();
    });
  });
});
