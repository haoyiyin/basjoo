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

// The view is a KB-scoped panel: it reads `kbId` from the route and calls only
// the canonical kb-scoped helpers. There is no agent in the request path.
vi.mock("../../src/services/api", () => ({
	api: {
		listKbFiles: vi.fn(),
		uploadKbFiles: vi.fn(),
		deleteKbFile: vi.fn(),
		clearKbFiles: vi.fn(),
	},
}));

// Mock AuthContext (AdminLayout is mocked, but the module graph still loads it).
vi.mock("../../src/context/AuthContext", () => ({
	useAuth: () => ({
		admin: {
			id: 1,
			name: "Test Admin",
			email: "test@example.com",
			role: "super_admin",
		},
		token: "test-token",
		logout: vi.fn(),
	}),
}));

// Mock react-i18next. `t` must be referentially stable: the loader is memoised
// on it, so a fresh function per render would re-run the fetch forever.
const stableT = (key: string) => key;

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: stableT }),
}));

// Mock useMediaQuery hook
vi.mock("../../src/hooks/useMediaQuery", () => ({
	useIsMobile: () => false,
}));

const mockedApi = vi.mocked(api);

const createMockFile = (
	status: FileItem["status"],
	overrides: Partial<FileItem> = {},
): FileItem => ({
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
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function renderComponent(initialFiles: FileItem[] = []) {
		mockedApi.listKbFiles.mockResolvedValue({
			files: initialFiles,
			total: initialFiles.length,
			quota: { used: initialFiles.length, max: 100 },
		} as any);

		const router = createMemoryRouter(
			[{ path: "/knowledge-bases/:kbId", element: <FileUploadManagement /> }],
			{ initialEntries: ["/knowledge-bases/kb_test"] },
		);

		const view = render(<RouterProvider router={router} />);
		return { ...view, router };
	}

	// #47: a failed row shows the provider's own words, and the generic
	// `files.processingFailedFallback` sentence only when nothing was recorded.
	it("renders the upstream ingestion error instead of the generic fallback", async () => {
		const failedFile = createMockFile("failed", {
			error_detail:
				"401 Unauthorized from https://api.openai.com/v1/embeddings",
			error_message: "Document processing failed. Please upload a valid, readable document.",
		});

		renderComponent([failedFile]);

		await waitFor(() => {
			expect(screen.getByText(failedFile.filename)).toBeInTheDocument();
		});

		// The provider's message is the primary line...
		expect(
			screen.getByText("401 Unauthorized from https://api.openai.com/v1/embeddings"),
		).toBeInTheDocument();
		// ...and the generic fallback key is never rendered while detail exists.
		expect(
			screen.queryByText("files.processingFailedFallback"),
		).not.toBeInTheDocument();
	});

	it("falls back to the generic sentence when no upstream cause was stored", async () => {
		const failedFile = createMockFile("failed", {
			error_detail: null,
			error_message: undefined,
		});

		renderComponent([failedFile]);

		await waitFor(() => {
			expect(screen.getByText(failedFile.filename)).toBeInTheDocument();
		});

		expect(screen.getByText("files.processingFailedFallback")).toBeInTheDocument();
	});

	it("should start polling when there are processing files", async () => {
		const processingFiles = [createMockFile("processing")];
		mockedApi.listKbFiles.mockResolvedValue({
			files: processingFiles,
			total: 1,
			quota: { used: 1, max: 100 },
		} as any);

		renderComponent(processingFiles);

		await waitFor(() => {
			expect(mockedApi.listKbFiles).toHaveBeenCalledWith("kb_test");
		});

		const initialCallCount = mockedApi.listKbFiles.mock.calls.length;

		// Advance timer by 3 seconds (polling interval)
		vi.advanceTimersByTime(3000);
		await vi.runOnlyPendingTimersAsync();

		await waitFor(() => {
			expect(mockedApi.listKbFiles.mock.calls.length).toBeGreaterThan(
				initialCallCount,
			);
		});
	});

	it("should stop polling when all files are ready", async () => {
		const processingFiles = [createMockFile("processing")];
		mockedApi.listKbFiles.mockResolvedValue({
			files: processingFiles,
			total: 1,
			quota: { used: 1, max: 100 },
		} as any);

		renderComponent(processingFiles);

		await waitFor(() => {
			expect(mockedApi.listKbFiles).toHaveBeenCalledWith("kb_test");
		});

		// Files become ready: the next poll should be the last one. Set the mock
		// BEFORE advancing so no poll can observe the still-processing payload.
		const readyFiles = [createMockFile("ready")];
		mockedApi.listKbFiles.mockResolvedValue({
			files: readyFiles,
			total: 1,
			quota: { used: 1, max: 100 },
		} as any);

		const callCountBefore = mockedApi.listKbFiles.mock.calls.length;

		// `advanceTimersByTime` is synchronous: it fires the interval but does not
		// flush the promises the poll then awaits. Advancing twice in a row (as
		// this test used to, via 3000 then 9000) lets the interval fire again
		// before React has re-rendered with the "ready" payload, so the call delta
		// drifts between 1 and 4 depending on how the fake clock interleaves with
		// the real one under `shouldAdvanceTime`. Advance asynchronously once, so
		// each poll's promise settles and the effect can clear the interval.
		await vi.advanceTimersByTimeAsync(3000);
		await waitFor(() => {
			expect(mockedApi.listKbFiles.mock.calls.length).toBeGreaterThan(
				callCountBefore,
			);
		});

		// The interval must now be gone. Two more polling windows with a ready
		// payload may add at most the one poll that was already in flight.
		const countAfterFirstPoll = mockedApi.listKbFiles.mock.calls.length;
		await vi.advanceTimersByTimeAsync(9000);
		expect(mockedApi.listKbFiles.mock.calls.length).toBeLessThanOrEqual(
			countAfterFirstPoll + 1,
		);
	});

	it("should call loadFiles during polling", async () => {
		const processingFiles = [createMockFile("processing")];
		mockedApi.listKbFiles.mockResolvedValue({
			files: processingFiles,
			total: 1,
			quota: { used: 1, max: 100 },
		} as any);

		renderComponent(processingFiles);

		await waitFor(() => {
			expect(mockedApi.listKbFiles).toHaveBeenCalledWith("kb_test");
		});

		const initialCount = mockedApi.listKbFiles.mock.calls.length;

		vi.advanceTimersByTime(3000);

		await waitFor(() => {
			expect(mockedApi.listKbFiles.mock.calls.length).toBeGreaterThan(
				initialCount,
			);
		});

		expect(mockedApi.listKbFiles).toHaveBeenCalledWith("kb_test");
	});

	it("should cleanup interval on unmount", async () => {
		const processingFiles = [createMockFile("processing")];
		mockedApi.listKbFiles.mockResolvedValue({
			files: processingFiles,
			total: 1,
			quota: { used: 1, max: 100 },
		} as any);

		const { unmount } = renderComponent(processingFiles);

		await waitFor(() => {
			expect(mockedApi.listKbFiles.mock.calls.length).toBeGreaterThanOrEqual(1);
		});

		const callCountBeforeUnmount = mockedApi.listKbFiles.mock.calls.length;

		unmount();

		vi.advanceTimersByTime(6000);
		await vi.runAllTimersAsync();

		const finalCallCount = mockedApi.listKbFiles.mock.calls.length;
		expect(finalCallCount - callCountBeforeUnmount).toBe(0);
	});

	it("should start polling when there are pending files", async () => {
		const pendingFiles = [createMockFile("pending")];
		mockedApi.listKbFiles.mockResolvedValue({
			files: pendingFiles,
			total: 1,
			quota: { used: 1, max: 100 },
		} as any);

		renderComponent(pendingFiles);

		await waitFor(() => {
			expect(mockedApi.listKbFiles).toHaveBeenCalledWith("kb_test");
		});

		const initialCount = mockedApi.listKbFiles.mock.calls.length;

		vi.advanceTimersByTime(3000);

		await waitFor(() => {
			expect(mockedApi.listKbFiles.mock.calls.length).toBeGreaterThan(
				initialCount,
			);
		});
	});

	it("should not poll when there are only ready files from the start", async () => {
		const readyFiles = [createMockFile("ready")];
		mockedApi.listKbFiles.mockResolvedValue({
			files: readyFiles,
			total: 1,
			quota: { used: 1, max: 100 },
		} as any);

		renderComponent(readyFiles);

		await waitFor(() => {
			expect(mockedApi.listKbFiles.mock.calls.length).toBeGreaterThanOrEqual(1);
		});

		const callCountAfterInitial = mockedApi.listKbFiles.mock.calls.length;

		vi.advanceTimersByTime(9000);
		await vi.runAllTimersAsync();

		const finalCallCount = mockedApi.listKbFiles.mock.calls.length;
		expect(finalCallCount - callCountAfterInitial).toBe(0);
	});
});

describe("FileUploadManagement error display", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function renderComponent(initialFiles: FileItem[] = []) {
		mockedApi.listKbFiles.mockResolvedValue({
			files: initialFiles,
			total: initialFiles.length,
			quota: { used: initialFiles.length, max: 100 },
		} as any);

		const router = createMemoryRouter(
			[{ path: "/knowledge-bases/:kbId", element: <FileUploadManagement /> }],
			{ initialEntries: ["/knowledge-bases/kb_test"] },
		);

		const view = render(<RouterProvider router={router} />);
		return { ...view, router };
	}

	it("should display localized friendly backend message when error_message is present", async () => {
		const failedFiles = [
			createMockFile("failed", {
				error_message: "PDF file is corrupted or unreadable",
			}),
		];
		mockedApi.listKbFiles.mockResolvedValue({
			files: failedFiles,
			total: 1,
			quota: { used: 1, max: 100 },
		} as any);

		renderComponent(failedFiles);

		await waitFor(() => {
			expect(mockedApi.listKbFiles).toHaveBeenCalledWith("kb_test");
		});

		await waitFor(() => {
			expect(
				screen.getByText(/PDF file is corrupted or unreadable/i),
			).toBeInTheDocument();
		});
	});

	it("should display localized friendly infrastructure error", async () => {
		const failedFiles = [
			createMockFile("failed", {
				error_message:
					"The knowledge base storage is temporarily unavailable. Please try again later.",
			}),
		];
		mockedApi.listKbFiles.mockResolvedValue({
			files: failedFiles,
			total: 1,
			quota: { used: 1, max: 100 },
		} as any);

		renderComponent(failedFiles);

		await waitFor(() => {
			expect(mockedApi.listKbFiles).toHaveBeenCalledWith("kb_test");
		});

		await waitFor(() => {
			expect(
				screen.getByText(/knowledge base storage is temporarily unavailable/i),
			).toBeInTheDocument();
		});
	});

	it("should display localized friendly rate-limit error", async () => {
		const failedFiles = [
			createMockFile("failed", {
				error_message:
					"The embedding service is currently busy. Please wait a moment and try again.",
			}),
		];
		mockedApi.listKbFiles.mockResolvedValue({
			files: failedFiles,
			total: 1,
			quota: { used: 1, max: 100 },
		} as any);

		renderComponent(failedFiles);

		await waitFor(() => {
			expect(mockedApi.listKbFiles).toHaveBeenCalledWith("kb_test");
		});

		await waitFor(() => {
			expect(
				screen.getByText(/embedding service is currently busy/i),
			).toBeInTheDocument();
		});
	});

	it("should display localized friendly unsupported format error", async () => {
		const failedFiles = [
			createMockFile("failed", {
				error_message:
					"This file format is not supported. Please upload a PDF, TXT, MD, HTML, DOCX, or XLSX document.",
			}),
		];
		mockedApi.listKbFiles.mockResolvedValue({
			files: failedFiles,
			total: 1,
			quota: { used: 1, max: 100 },
		} as any);

		renderComponent(failedFiles);

		await waitFor(() => {
			expect(mockedApi.listKbFiles).toHaveBeenCalledWith("kb_test");
		});

		await waitFor(() => {
			expect(
				screen.getByText(/This file format is not supported/i),
			).toBeInTheDocument();
		});
	});

	it("should display localized frontend fallback when error_message is absent", async () => {
		const failedFiles = [createMockFile("failed")];
		mockedApi.listKbFiles.mockResolvedValue({
			files: failedFiles,
			total: 1,
			quota: { used: 1, max: 100 },
		} as any);

		renderComponent(failedFiles);

		await waitFor(() => {
			expect(mockedApi.listKbFiles).toHaveBeenCalledWith("kb_test");
		});

		await waitFor(() => {
			expect(
				screen.getByText(/files\.processingFailedFallback/i),
			).toBeInTheDocument();
		});
	});

	it("should display localized frontend fallback when error_message is empty string", async () => {
		const failedFiles = [
			createMockFile("failed", {
				error_message: "",
			}),
		];
		mockedApi.listKbFiles.mockResolvedValue({
			files: failedFiles,
			total: 1,
			quota: { used: 1, max: 100 },
		} as any);

		renderComponent(failedFiles);

		await waitFor(() => {
			expect(mockedApi.listKbFiles).toHaveBeenCalledWith("kb_test");
		});

		await waitFor(() => {
			expect(
				screen.getByText(/files\.processingFailedFallback/i),
			).toBeInTheDocument();
		});
	});

	it("should display translated failed status badge", async () => {
		const failedFiles = [createMockFile("failed")];
		mockedApi.listKbFiles.mockResolvedValue({
			files: failedFiles,
			total: 1,
			quota: { used: 1, max: 100 },
		} as any);

		renderComponent(failedFiles);

		await waitFor(() => {
			expect(mockedApi.listKbFiles).toHaveBeenCalledWith("kb_test");
		});

		await waitFor(() => {
			expect(screen.getByText("status.failed")).toBeInTheDocument();
		});
	});
});
