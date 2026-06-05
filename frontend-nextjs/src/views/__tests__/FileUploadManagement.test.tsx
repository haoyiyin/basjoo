// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom";
import FileUploadManagement from "../FileUploadManagement";
import { api } from "../../services/api";
import type { FileItem } from "../../services/api";

// Mock window.alert to prevent blocking
vi.stubGlobal("alert", vi.fn());

// Mock the API module
vi.mock("../../services/api", () => ({
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

// Mock KBSetupGuard - just render children when agentId provided
vi.mock("../../components/KBSetupGuard", () => ({
  default: ({ children, agentId }: { children: React.ReactNode; agentId: string }) => (
    <div data-testid="kb-setup-guard">{children}</div>
  ),
}));

// Mock SourcesSummary
vi.mock("../../components/SourcesSummary", () => ({
  default: () => <div data-testid="sources-summary" />,
}));

// Mock useMediaQuery hook
vi.mock("../../hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
}));

const mockedApi = vi.mocked(api);

const mockAgent = {
  id: "agt_test",
  name: "Test Agent",
};

const createMockFile = (status: FileItem["status"]): FileItem => ({
  id: `file_${status}`,
  filename: `test-${status}.pdf`,
  file_type: "application/pdf",
  file_size: 1024,
  status,
  created_at: "2026-06-01T00:00:00Z",
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

    // Clear mock to count only polling calls
    const initialCallCount = mockedApi.listFiles.mock.calls.length;

    // Advance timer by 3 seconds (polling interval)
    vi.advanceTimersByTime(3000);

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

    // Advance to trigger polling at least once
    vi.advanceTimersByTime(3000);
    
    await waitFor(() => {
      expect(mockedApi.listFiles.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // Now simulate files becoming ready
    const readyFiles = [createMockFile("ready")];
    mockedApi.listFiles.mockResolvedValue({ files: readyFiles } as any);

    // Get current call count
    const callCountBefore = mockedApi.listFiles.mock.calls.length;

    // Advance again - this might trigger one more poll
    vi.advanceTimersByTime(3000);
    await vi.runAllTimersAsync();

    // After files become ready, polling should stop
    // Wait and verify no more calls happen
    vi.advanceTimersByTime(6000);
    await vi.runAllTimersAsync();

    // Should have stopped polling after files became ready
    // (allowing for the extra call that detected the ready state)
    const finalCallCount = mockedApi.listFiles.mock.calls.length;
    expect(finalCallCount).toBeLessThanOrEqual(callCountBefore + 2);
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
      expect(mockedApi.listFiles).toHaveBeenCalledTimes(1);
    });

    // Unmount the component
    unmount();

    // Advance timer - should NOT trigger more calls since component unmounted
    vi.advanceTimersByTime(6000);
    await vi.runAllTimersAsync();

    // Should still only have 1 call (initial load)
    expect(mockedApi.listFiles).toHaveBeenCalledTimes(1);
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
      expect(mockedApi.listFiles).toHaveBeenCalledTimes(1);
    });

    // Advance timer
    vi.advanceTimersByTime(6000);
    await vi.runAllTimersAsync();

    // Should NOT have called again - no polling needed for ready files
    expect(mockedApi.listFiles).toHaveBeenCalledTimes(1);
  });
});
