"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { api } from "../services/api";
import type { FileItem } from "../services/api";
import { useIsMobile } from "../hooks/useMediaQuery";

/**
 * File source panel for one knowledge base.
 *
 * Embedded by `KnowledgeBaseDetail` on `/knowledge-bases/:kbId`: it takes the KB
 * id from the route and uses only the canonical kb-scoped source routes, so an
 * unbound KB can ingest files with no agent involved.
 */
export default function FileUploadManagement() {
	const { t } = useTranslation("common");
	const { kbId } = useParams<{ kbId: string }>();
	const isMobile = useIsMobile();
	const [files, setFiles] = useState<FileItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);
	const [uploadProgress, setUploadProgress] = useState<string | null>(null);
	const [clearing, setClearing] = useState(false);
	const [showClearConfirm, setShowClearConfirm] = useState(false);
	const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
	const [dragActive, setDragActive] = useState(false);
	const filesPollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
		null,
	);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const loadFiles = useCallback(async () => {
		if (!kbId) return;
		setLoading(true);
		try {
			const data = await api.listKbFiles(kbId);
			setFiles(data.files);
			setError(null);
		} catch (err) {
			setError(
				`${t("errors.loadFailed")}: ${err instanceof Error ? err.message : t("errors.unknown")}`,
			);
		} finally {
			setLoading(false);
		}
	}, [kbId, t]);

	// Stable ref so the polling interval always calls the newest loader.
	const loadFilesRef = useRef(loadFiles);
	loadFilesRef.current = loadFiles;

	useEffect(() => {
		if (kbId) {
			void loadFiles();
		}
	}, [kbId, loadFiles]);

	// File status polling - auto-refresh while any file is still processing.
	useEffect(() => {
		const hasProcessingFiles = files.some(
			(f) => f.status === "processing" || f.status === "pending",
		);

		if (hasProcessingFiles && !filesPollingIntervalRef.current) {
			let pollCount = 0;
			const maxPolls = 100; // Safety limit to prevent infinite polling
			filesPollingIntervalRef.current = setInterval(() => {
				pollCount++;
				if (pollCount > maxPolls) {
					if (filesPollingIntervalRef.current) {
						clearInterval(filesPollingIntervalRef.current);
						filesPollingIntervalRef.current = null;
					}
					return;
				}
				void loadFilesRef.current();
			}, 3000);
		} else if (!hasProcessingFiles && filesPollingIntervalRef.current) {
			clearInterval(filesPollingIntervalRef.current);
			filesPollingIntervalRef.current = null;
		}

		// Note: no cleanup here — the interval is managed by the condition above.
	}, [files]);

	// Cleanup on unmount.
	useEffect(() => {
		return () => {
			if (filesPollingIntervalRef.current) {
				clearInterval(filesPollingIntervalRef.current);
				filesPollingIntervalRef.current = null;
			}
		};
	}, []);

	const handleDrag = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (e.type === "dragenter" || e.type === "dragover") {
			setDragActive(true);
		} else if (e.type === "dragleave") {
			setDragActive(false);
		}
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setDragActive(false);
		if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
			void handleFiles(Array.from(e.dataTransfer.files));
		}
	};

	const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files && e.target.files.length > 0) {
			void handleFiles(Array.from(e.target.files));
		}
	};

	const handleFiles = async (selectedFiles: File[]) => {
		if (!kbId || selectedFiles.length === 0) return;

		setUploading(true);
		setUploadProgress(t("files.uploading", { count: selectedFiles.length }));
		try {
			const result = await api.uploadKbFiles(kbId, selectedFiles);
			if (result.failed > 0) {
				alert(
					t("files.uploadPartial", {
						uploaded: result.uploaded,
						failed: result.failed,
					}),
				);
			}
			await loadFiles();
		} catch (err) {
			alert(
				`${t("files.uploadFailed")}: ${err instanceof Error ? err.message : t("errors.unknown")}`,
			);
		} finally {
			setUploading(false);
			setUploadProgress(null);
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		}
	};

	const handleDelete = async (fileId: string) => {
		if (!kbId) return;
		if (!confirm(t("files.confirmDelete"))) return;

		setDeletingFileId(fileId);
		try {
			await api.deleteKbFile(kbId, fileId);
			await loadFiles();
		} catch (err) {
			alert(
				`${t("errors.deleteFailed")}: ${err instanceof Error ? err.message : t("errors.unknown")}`,
			);
		} finally {
			setDeletingFileId(null);
		}
	};

	const handleClearAll = () => {
		if (!kbId) return;
		if (files.length === 0) return;
		setShowClearConfirm(true);
	};

	const confirmClearAll = async () => {
		if (!kbId) return;

		setClearing(true);
		try {
			const result = await api.clearKbFiles(kbId);
			setShowClearConfirm(false);
			await loadFiles();
			alert(
				t("files.clearSuccess", {
					count: result.deleted_count ?? 0,
				}),
			);
		} catch (err) {
			alert(
				`${t("files.clearFailed")}: ${err instanceof Error ? err.message : t("errors.unknown")}`,
			);
		} finally {
			setClearing(false);
		}
	};

	const formatFileSize = (bytes: number): string => {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	};

	const getFileTypeIcon = (fileType: string) => {
		const type = fileType.toLowerCase();
		if (type.includes("pdf")) {
			return (
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
				>
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
					<polyline points="14 2 14 8 20 8" />
				</svg>
			);
		}
		return (
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
				<polyline points="14 2 14 8 20 8" />
			</svg>
		);
	};

	const getStatusBadge = (status: string) => {
		const styles: Record<string, { className: string; label: string }> = {
			ready: { className: "badge badge-success", label: t("files.ready") },
			processing: {
				className: "badge badge-warning badge-pulse",
				label: t("files.processing"),
			},
			uploading: {
				className: "badge badge-info",
				label: t("files.uploadingStatus"),
			},
			pending: { className: "badge badge-info", label: t("files.pending") },
			failed: { className: "badge badge-error", label: t("status.failed") },
		};
		return styles[status] || { className: "badge", label: status };
	};

	return (
		<section data-testid="kb-file-panel" className="file-panel" style={{ minWidth: 0 }}>
			{showClearConfirm && (
				<div
					style={{
						position: "fixed",
						inset: 0,
						background: "rgba(15, 23, 42, 0.6)",
						backdropFilter: "blur(8px)",
						WebkitBackdropFilter: "blur(8px)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						padding: "var(--space-4)",
						zIndex: 1000,
					}}
				>
					<div
						className="glass-modal"
						style={{
							width: "100%",
							maxWidth: "420px",
							padding: "var(--space-6)",
						}}
					>
						<h3
							style={{
								margin: 0,
								marginBottom: "var(--space-3)",
								fontSize: "var(--text-lg)",
								color: "var(--color-text-primary)",
							}}
						>
							{t("files.clearAll")}
						</h3>
						<p
							style={{
								margin: 0,
								marginBottom: "var(--space-5)",
								color: "var(--color-text-secondary)",
								lineHeight: 1.6,
							}}
						>
							{t("files.confirmClearAll")}
						</p>
						<div
							style={{
								display: "flex",
								justifyContent: "flex-end",
								gap: "var(--space-3)",
							}}
						>
							<button
								type="button"
								className="btn-ghost"
								onClick={() => setShowClearConfirm(false)}
								disabled={clearing}
							>
								{t("buttons.cancel")}
							</button>
							<button
								type="button"
								className="btn-primary"
								onClick={confirmClearAll}
								disabled={clearing}
								style={{
									background: "var(--color-error)",
									borderColor: "var(--color-error)",
								}}
							>
								{clearing ? t("files.clearing") : t("buttons.confirm")}
							</button>
						</div>
					</div>
				</div>
			)}

			<header style={{ marginBottom: "var(--space-6)" }}>
				<h2
					style={{
						fontSize: isMobile ? "var(--text-xl)" : "var(--text-2xl)",
						fontWeight: 700,
						color: "var(--color-text-primary)",
						marginBottom: "var(--space-1)",
					}}
				>
					{t("navigation.fileManagement")}
				</h2>
				<p style={{ color: "var(--color-text-secondary)" }}>
					{t("files.description")}
				</p>
			</header>

			{error && (
				<div
					role="alert"
					style={{
						padding: "var(--space-3) var(--space-4)",
						borderRadius: "var(--radius-md)",
						fontSize: "var(--text-sm)",
						background: "var(--color-error-bg)",
						border: "1px solid var(--color-error)",
						color: "var(--color-error)",
						marginBottom: "var(--space-4)",
					}}
				>
					{error}
				</div>
			)}

			<div style={{ display: "grid", gap: "var(--space-6)", minWidth: 0 }}>
				<div className="liquid-glass-card" style={{ padding: "var(--space-6)" }}>
					<h3
						style={{
							fontSize: "var(--text-lg)",
							fontWeight: 600,
							marginBottom: "var(--space-5)",
							color: "var(--color-text-primary)",
							display: "flex",
							alignItems: "center",
							gap: "var(--space-3)",
						}}
					>
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
						>
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
							<polyline points="17 8 12 3 7 8" />
							<line x1="12" y1="3" x2="12" y2="15" />
						</svg>
						{t("files.uploadTitle")}
					</h3>

					<div
						onDragEnter={handleDrag}
						onDragLeave={handleDrag}
						onDragOver={handleDrag}
						onDrop={handleDrop}
						onClick={() => fileInputRef.current?.click()}
						style={{
							border: `2px dashed ${dragActive ? "var(--color-accent-primary)" : "var(--color-border)"}`,
							borderRadius: "var(--radius-xl)",
							padding: isMobile ? "var(--space-5)" : "var(--space-8)",
							textAlign: "center",
							cursor: "pointer",
							background: dragActive
								? "hsla(188deg, 90%, 50%, 0.06)"
								: "var(--color-bg-tertiary)",
							transition: "all var(--transition-base)",
						}}
					>
						<input
							ref={fileInputRef}
							type="file"
							multiple
							accept=".pdf,.txt,.md,.html,.docx,.xlsx"
							onChange={handleFileInput}
							style={{ display: "none" }}
						/>
						<svg
							width="48"
							height="48"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							style={{
								margin: "0 auto var(--space-4)",
								color: "var(--color-text-muted)",
							}}
						>
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
							<polyline points="17 8 12 3 7 8" />
							<line x1="12" y1="3" x2="12" y2="15" />
						</svg>
						<p
							style={{
								fontSize: "var(--text-base)",
								color: "var(--color-text-primary)",
								fontWeight: 500,
								marginBottom: "var(--space-2)",
							}}
						>
							{t("files.dropzoneText")}
						</p>
						<p
							style={{
								fontSize: "var(--text-sm)",
								color: "var(--color-text-muted)",
							}}
						>
							{t("files.supportedFormats")}
						</p>
					</div>

					{(uploading || uploadProgress) && (
						<div
							style={{
								marginTop: "var(--space-4)",
								padding: "var(--space-3)",
								background: "rgba(6, 182, 212, 0.1)",
								borderRadius: "var(--radius-md)",
								display: "flex",
								alignItems: "center",
								gap: "var(--space-2)",
								color: "var(--color-accent-primary)",
								fontSize: "var(--text-sm)",
							}}
						>
							<div
								className="spinner"
								style={{ width: "14px", height: "14px" }}
							/>
							{uploadProgress ?? t("files.uploading", { count: 0 })}
						</div>
					)}
				</div>

				<div className="liquid-glass-card" style={{ padding: "var(--space-6)" }}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							marginBottom: "var(--space-5)",
							gap: "var(--space-3)",
							flexWrap: "wrap",
						}}
					>
						<h3
							style={{
								fontSize: "var(--text-lg)",
								fontWeight: 600,
								color: "var(--color-text-primary)",
								display: "flex",
								alignItems: "center",
								gap: "var(--space-3)",
							}}
						>
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								<line x1="8" y1="6" x2="21" y2="6" />
								<line x1="8" y1="12" x2="21" y2="12" />
								<line x1="8" y1="18" x2="21" y2="18" />
								<line x1="3" y1="6" x2="3.01" y2="6" />
								<line x1="3" y1="12" x2="3.01" y2="12" />
								<line x1="3" y1="18" x2="3.01" y2="18" />
							</svg>
							{t("files.fileList")}
						</h3>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "var(--space-2)",
								flexWrap: "wrap",
							}}
						>
							{files.length > 0 && (
								<button
									type="button"
									onClick={handleClearAll}
									disabled={clearing}
									className="btn-ghost"
									style={{
										display: "flex",
										alignItems: "center",
										gap: "var(--space-2)",
										color: "var(--color-error)",
										opacity: clearing ? 0.5 : 1,
										cursor: clearing ? "not-allowed" : "pointer",
										minHeight: "44px",
									}}
								>
									{clearing ? t("files.clearing") : t("files.clearAll")}
								</button>
							)}
							<button
								onClick={() => void loadFiles()}
								disabled={loading}
								className="btn-ghost"
								style={{
									display: "flex",
									alignItems: "center",
									gap: "var(--space-2)",
									minHeight: "44px",
								}}
							>
								{loading ? (
									<div className="spinner" />
								) : (
									<svg
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
									>
										<path d="M23 4v6h-6M1 20v-6h6" />
										<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
									</svg>
								)}
								{t("buttons.refresh")}
							</button>
						</div>
					</div>

					<div
						style={{
							maxHeight: "500px",
							overflow: "auto",
							display: "flex",
							flexDirection: "column",
							gap: "var(--space-3)",
						}}
					>
						{files.length === 0 ? (
							<div
								style={{
									textAlign: "center",
									padding: "var(--space-12)",
									color: "var(--color-text-muted)",
								}}
							>
								<p style={{ fontSize: "var(--text-base)" }}>
									{t("files.noFiles")}
								</p>
								<p
									style={{
										fontSize: "var(--text-sm)",
										marginTop: "var(--space-2)",
									}}
								>
									{t("files.uploadHint")}
								</p>
							</div>
						) : (
							files.map((file) => (
								<div
									key={file.id}
									style={{
										padding: "var(--space-4)",
										background:
											file.status === "ready"
												? "var(--color-bg-tertiary)"
												: file.status === "processing" ||
														file.status === "uploading" ||
														file.status === "pending"
													? "rgba(245, 158, 11, 0.1)"
													: "rgba(239, 68, 68, 0.1)",
										borderRadius: "var(--radius-md)",
										border:
											file.status === "ready"
												? "1px solid var(--color-border)"
												: file.status === "processing" ||
														file.status === "uploading" ||
														file.status === "pending"
													? "2px solid var(--color-warning)"
													: "2px solid var(--color-error)",
									}}
								>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "space-between",
											gap: "var(--space-4)",
										}}
									>
										<div style={{ flex: 1, minWidth: 0 }}>
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: "var(--space-2)",
													marginBottom: "var(--space-2)",
													flexWrap: "wrap",
												}}
											>
												<span className={getStatusBadge(file.status).className}>
													{getStatusBadge(file.status).label}
												</span>
												<span
													style={{
														display: "flex",
														color: "var(--color-text-muted)",
													}}
												>
													{getFileTypeIcon(file.file_type)}
												</span>
											</div>
											<div
												style={{
													fontSize: "var(--text-sm)",
													fontWeight: 500,
													color: "var(--color-text-primary)",
													overflow: "hidden",
													textOverflow: "ellipsis",
													whiteSpace: "nowrap",
												}}
											>
												{file.filename}
											</div>
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: "var(--space-3)",
													marginTop: "var(--space-1)",
													flexWrap: "wrap",
												}}
											>
												<span
													style={{
														fontSize: "var(--text-xs)",
														color: "var(--color-text-muted)",
													}}
												>
													{formatFileSize(file.file_size)}
												</span>
												<span
													style={{
														fontSize: "var(--text-xs)",
														color: "var(--color-text-muted)",
														textTransform: "uppercase",
													}}
												>
													{file.file_type}
												</span>
												<span
													style={{
														fontSize: "var(--text-xs)",
														color: "var(--color-text-muted)",
													}}
												>
													{new Date(file.created_at).toLocaleDateString()}
												</span>
											</div>
											{file.status === "failed" && (
												<div
													style={{
														marginTop: "var(--space-2)",
														padding: "var(--space-2) var(--space-3)",
														background: "rgba(239, 68, 68, 0.1)",
														borderRadius: "var(--radius-sm)",
														borderLeft: "2px solid var(--color-error)",
													}}
												>
													<p
														style={{
															fontSize: "var(--text-xs)",
															color: "var(--color-error)",
															margin: 0,
															lineHeight: 1.4,
														}}
													>
														{file.error_message?.trim() ||
															t("files.processingFailedFallback")}
													</p>
												</div>
											)}
										</div>
										<button
											onClick={() => handleDelete(file.id)}
											disabled={deletingFileId === file.id}
											className="btn-ghost"
											aria-label={t("buttons.delete")}
											style={{
												color: "var(--color-error)",
												padding: "var(--space-2)",
												opacity: deletingFileId === file.id ? 0.5 : 1,
												cursor:
													deletingFileId === file.id
														? "not-allowed"
														: "pointer",
												minHeight: "44px",
												minWidth: "44px",
											}}
										>
											{deletingFileId === file.id ? (
												<div
													className="spinner"
													style={{ width: "14px", height: "14px" }}
												/>
											) : (
												<svg
													width="16"
													height="16"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
												>
													<polyline points="3 6 5 6 21 6" />
													<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
												</svg>
											)}
										</button>
									</div>
								</div>
							))
						)}
					</div>
				</div>
			</div>
		</section>
	);
}
