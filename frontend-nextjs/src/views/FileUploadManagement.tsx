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
	// Row actions live in one overflow menu per row (§19).
	const [openMenuFileId, setOpenMenuFileId] = useState<string | null>(null);
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
		<section
			data-testid="kb-file-panel"
			className="file-panel"
			aria-busy={loading}
			style={{ minWidth: 0, borderRight: "none", height: "auto" }}
		>
			{showClearConfirm && (
				<div className="modal-backdrop">
					<div className="card card-raised" style={{ width: "100%", maxWidth: 420 }}>
						<div className="card-header">
							<h2 className="card-title">{t("files.clearAll")}</h2>
						</div>
						<div className="card-body">
							<p
								style={{
									color: "var(--fg-dim)",
									lineHeight: "var(--leading-relaxed)",
								}}
							>
								{t("files.confirmClearAll")}
							</p>
							<div
								style={{
									display: "flex",
									justifyContent: "flex-end",
									gap: "var(--space-2)",
									marginTop: "var(--space-5)",
								}}
							>
								<button
									type="button"
									className="btn btn-ghost"
									onClick={() => setShowClearConfirm(false)}
									disabled={clearing}
								>
									{t("buttons.cancel")}
								</button>
								<button
									type="button"
									className="btn btn-danger"
									onClick={confirmClearAll}
									disabled={clearing}
								>
									{clearing ? t("files.clearing") : t("buttons.confirm")}
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			<header className="page-header">
				<div style={{ minWidth: 0 }}>
					<h2 className="page-title">{t("navigation.fileManagement")}</h2>
					<p className="page-subtitle">{t("files.description")}</p>
				</div>
				<div className="page-actions">
					{files.length > 0 && (
						<span className="badge badge-neutral">
							{t("labels.totalItems", { total: files.length })}
						</span>
					)}
				</div>
			</header>

			{error && (
				<div
					role="alert"
					style={{
						padding: "var(--space-3) var(--space-4)",
						marginBottom: "var(--space-4)",
						fontSize: "var(--text-sm)",
						background: "var(--color-error-bg)",
						border: "1px solid var(--color-error)",
						borderRadius: "var(--radius-md)",
						color: "var(--color-error)",
					}}
				>
					{error}
				</div>
			)}

			<div className="card">
				<div className="card-header">
					<h3 className="card-title">{t("files.uploadTitle")}</h3>
				</div>
				<div className="card-body">
					<div
						onDragEnter={handleDrag}
						onDragLeave={handleDrag}
						onDragOver={handleDrag}
						onDrop={handleDrop}
						onClick={() => fileInputRef.current?.click()}
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							gap: "var(--space-2)",
							padding: isMobile ? "var(--space-5)" : "var(--space-8)",
							textAlign: "center",
							cursor: "pointer",
							background: dragActive
								? "var(--color-accent-bg)"
								: "var(--color-bg-tertiary)",
							border: `2px dashed ${
								dragActive ? "var(--color-border-focus)" : "var(--color-border)"
							}`,
							borderRadius: "var(--radius-lg)",
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
							width="32"
							height="32"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							aria-hidden="true"
							style={{ color: "var(--fg-dim)" }}
						>
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
							<polyline points="17 8 12 3 7 8" />
							<line x1="12" y1="3" x2="12" y2="15" />
						</svg>
						<p style={{ color: "var(--fg-strong)", fontWeight: 500 }}>
							{t("files.dropzoneText")}
						</p>
						<p
							className="field-hint"
							style={{ fontSize: "var(--text-sm)", color: "var(--fg-dim)" }}
						>
							{t("files.supportedFormats")}
						</p>
					</div>

					{(uploading || uploadProgress) && (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "var(--space-2)",
								marginTop: "var(--space-4)",
								padding: "var(--space-3)",
								fontSize: "var(--text-sm)",
								color: "var(--fg-default)",
								background: "var(--color-info-bg)",
								borderRadius: "var(--radius-md)",
							}}
						>
							<div className="spinner" style={{ width: "14px", height: "14px" }} />
							{uploadProgress ?? t("files.uploading", { count: 0 })}
						</div>
					)}
				</div>
			</div>

			<div className="card">
				<div className="card-header">
					<h3 className="card-title">{t("files.fileList")}</h3>
					<div className="page-actions">
						{files.length > 0 && (
							<button
								type="button"
								className="btn btn-danger"
								onClick={handleClearAll}
								disabled={clearing}
							>
								{clearing ? t("files.clearing") : t("files.clearAll")}
							</button>
						)}
					</div>
				</div>

				<div className="card-body">
					{files.length === 0 ? (
						<div className="empty">
							<p className="empty-title">{t("files.noFiles")}</p>
							<p className="empty-description">{t("files.uploadHint")}</p>
						</div>
					) : (
						<div className="kb-table-scroll">
							<table className="kb-table">
								<thead>
									<tr>
										<th>{t("knowledgeBases.columns.name")}</th>
										<th>{t("knowledgeBases.columns.status")}</th>
										<th>{t("knowledgeBases.columns.actions")}</th>
									</tr>
								</thead>
								<tbody>
									{files.map((file) => {
										const badge = getStatusBadge(file.status);
										const menuOpen = openMenuFileId === file.id;
										const busy = deletingFileId === file.id;
										return (
											<tr key={file.id}>
												<td style={{ maxWidth: 0 }}>
													<div
														style={{
															display: "flex",
															alignItems: "center",
															gap: "var(--space-2)",
															minWidth: 0,
														}}
													>
														<span
															aria-hidden="true"
															style={{
																display: "flex",
																flexShrink: 0,
																color: "var(--fg-dim)",
															}}
														>
															{getFileTypeIcon(file.file_type)}
														</span>
														<span
															style={{
																minWidth: 0,
																fontWeight: 500,
																color: "var(--fg-strong)",
																overflow: "hidden",
																textOverflow: "ellipsis",
																whiteSpace: "nowrap",
															}}
														>
															{file.filename}
														</span>
													</div>
													<div
														style={{
															display: "flex",
															alignItems: "center",
															gap: "var(--space-3)",
															marginTop: "var(--space-1)",
															flexWrap: "wrap",
															fontSize: "var(--text-xs)",
															color: "var(--fg-dim)",
														}}
													>
														<span style={{ textTransform: "uppercase" }}>
															{file.file_type}
														</span>
														{formatFileSize(file.file_size)}
														<span>
															{new Date(file.created_at).toLocaleDateString()}
														</span>
													</div>
													{file.status === "failed" && (
														<p
															style={{
																marginTop: "var(--space-2)",
																padding: "var(--space-2) var(--space-3)",
																fontSize: "var(--text-xs)",
																lineHeight: "var(--leading-normal)",
																color: "var(--color-error)",
																background: "var(--color-error-bg)",
																borderLeft: "2px solid var(--color-error)",
																borderRadius: "var(--radius-sm)",
															}}
														>
															{file.error_message?.trim() ||
																t("files.processingFailedFallback")}
														</p>
													)}
												</td>
												<td>
													<span className={badge.className}>{badge.label}</span>
												</td>
												<td>
													<div
														style={{
															position: "relative",
															display: "flex",
															justifyContent: isMobile ? "flex-start" : "flex-end",
															flexShrink: 0,
														}}
													>
														<button
															type="button"
															className="btn btn-icon"
															aria-label={`${t("knowledgeBases.columns.actions")} ${file.filename}`}
															aria-haspopup="menu"
															aria-expanded={menuOpen}
															disabled={busy}
															onClick={() =>
																setOpenMenuFileId((current) =>
																	current === file.id ? null : file.id,
																)
															}
														>
															{busy ? (
																<div
																	className="spinner"
																	style={{ width: "14px", height: "14px" }}
																/>
															) : (
																<svg
																	width="16"
																	height="16"
																	viewBox="0 0 16 16"
																	fill="currentColor"
																	aria-hidden="true"
																>
																	<circle cx="8" cy="3" r="1.4" />
																	<circle cx="8" cy="8" r="1.4" />
																	<circle cx="8" cy="13" r="1.4" />
																</svg>
															)}
														</button>
														{menuOpen && (
															<div
																role="menu"
																aria-label={`${t("knowledgeBases.columns.actions")} ${file.filename}`}
																style={{
																	position: "absolute",
																	top: "calc(100% + var(--space-1))",
																	right: isMobile ? "auto" : 0,
																	left: isMobile ? 0 : "auto",
																	zIndex: 20,
																	minWidth: 200,
																	display: "flex",
																	flexDirection: "column",
																	gap: "var(--space-1)",
																	padding: "var(--space-1)",
																	background: "var(--color-bg-elevated)",
																	border: "1px solid var(--color-border)",
																	borderRadius: "var(--radius-md)",
																	boxShadow: "var(--shadow-lg)",
																}}
															>
																<button
																	type="button"
																	role="menuitem"
																	className="btn btn-danger"
																	style={{ justifyContent: "flex-start" }}
																	disabled={busy}
																	onClick={() => {
																		setOpenMenuFileId(null);
																		void handleDelete(file.id);
																	}}
																>
																	{t("buttons.delete")}
																</button>
															</div>
														)}
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
