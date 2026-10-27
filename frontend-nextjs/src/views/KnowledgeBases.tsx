"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AdminLayout from "../components/AdminLayout";
import KbFormModal from "../components/KbFormModal";
import type { KbFormValues } from "../components/KbFormModal";
import { useAuth } from "../context/AuthContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { api } from "../services/api";
import type {
	Agent,
	EmbeddingProvider,
	KnowledgeBaseDetail,
	KbStatus,
} from "../services/api";

const statusBadgeClass: Record<KbStatus, string> = {
	active: "badge badge-success",
	resetting: "badge badge-warning",
	processing: "badge badge-info",
	error: "badge badge-error",
};

const providerLabelKey: Record<EmbeddingProvider, string> = {
	jina: "kbForm.providerJina",
	siliconflow: "kbForm.providerSiliconflow",
	custom: "kbForm.providerCustom",
	local: "kbForm.providerLocal",
};

/**
 * Workspace knowledge-base list.
 *
 * Mirrors the agent list (§16): every KB is one `list-row`, and the row's name
 * is the only navigation affordance — it opens `/knowledge-bases/:kbId`, the
 * source-management page. There is deliberately no inline detail panel, no
 * "manage sources" action and no unbind control: unbinding happens from the
 * agent side only.
 *
 * The KB lifecycle is decoupled from agents: this view is the only place that
 * creates, resets, deletes and binds KBs. Mutations are super_admin only.
 */
export default function KnowledgeBases() {
	const { t } = useTranslation("common");
	const { admin } = useAuth();
	const isMobile = useIsMobile();
	const isSuperAdmin = admin?.role === "super_admin";

	const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseDetail[]>(
		[],
	);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	// Row mutations are collapsed into one overflow menu per row (§16 mirrors the
	// agent list's row treatment).
	const [openMenuKbId, setOpenMenuKbId] = useState<string | null>(null);
	const [reloadToken, setReloadToken] = useState(0);
	const [agents, setAgents] = useState<Agent[]>([]);

	const [createOpen, setCreateOpen] = useState(false);
	const [resetTarget, setResetTarget] = useState<KnowledgeBaseDetail | null>(
		null,
	);
	const [bindTarget, setBindTarget] = useState<KnowledgeBaseDetail | null>(null);
	const [bindAgentId, setBindAgentId] = useState("");

	// Agent-initiated bind: the agent page sends `?bindAgent=<id>` for an agent
	// with no KB. In that direction the agent is fixed and the operator picks
	// which KB to bind, so the modal swaps its select around.
	const [searchParams, setSearchParams] = useSearchParams();
	const bindAgentFromQuery = searchParams.get("bindAgent");
	const [bindAgentForKb, setBindAgentForKb] = useState<string | null>(null);
	const [bindKbId, setBindKbId] = useState("");

	const load = async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await api.listKnowledgeBases();
			setKnowledgeBases(data.knowledge_bases);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : t("knowledgeBases.errors.loadFailed"),
			);
		} finally {
			setLoading(false);
		}
	};

	// Load once on mount; the reload counter drives retry and post-mutation
	// reloads (§18: no manual refresh button, the page loads itself).
	useEffect(() => {
		void load();
	}, [reloadToken]);

	// `?bindAgent=` opens the bind modal for that agent once agents are loaded.
	useEffect(() => {
		if (!bindAgentFromQuery) return;
		let cancelled = false;
		const openForAgent = async () => {
			await loadAgents();
			if (cancelled) return;
			setBindAgentForKb(bindAgentFromQuery);
			setBindKbId("");
		};
		void openForAgent();
		return () => {
			cancelled = true;
		};
	}, [bindAgentFromQuery]);

	const closeBindAgentModal = useCallback(() => {
		setBindAgentForKb(null);
		setBindKbId("");
		if (bindAgentFromQuery) {
			const next = new URLSearchParams(searchParams);
			next.delete("bindAgent");
			setSearchParams(next, { replace: true });
		}
	}, [bindAgentFromQuery, searchParams, setSearchParams]);

	const loadAgents = async () => {
		try {
			const data = await api.listAgents();
			setAgents(data.agents.filter((agent) => !agent.deleted_at));
		} catch (err) {
			setActionError(
				err instanceof Error
					? err.message
					: t("knowledgeBases.errors.loadAgentsFailed"),
			);
		}
	};

	const runAction = async (
		kbId: string,
		action: () => Promise<void>,
		fallbackKey: string,
	) => {
		setBusyId(kbId);
		setActionError(null);
		try {
			await action();
			await load();
		} catch (err) {
			setActionError(err instanceof Error ? err.message : t(fallbackKey));
		} finally {
			setBusyId(null);
		}
	};

	const handleCreate = async (values: KbFormValues) => {
		await api.createKnowledgeBase({
			name: values.name,
			embedding_provider: values.embedding_provider,
			embedding_model: values.embedding_model,
			embedding_base_url: values.embedding_base_url,
			embedding_api_key: values.embedding_api_key,
			embedding_batch_size: values.embedding_batch_size,
			chunk_size: values.chunk_size,
			chunk_overlap: values.chunk_overlap,
		});
		setCreateOpen(false);
		await load();
	};

	const handleReset = async (values: KbFormValues) => {
		if (!resetTarget) return;
		await api.resetKnowledgeBase(resetTarget.id, {
			embedding_provider: values.embedding_provider,
			embedding_model: values.embedding_model,
			embedding_base_url: values.embedding_base_url,
			embedding_api_key: values.embedding_api_key || undefined,
			embedding_batch_size: values.embedding_batch_size,
		});
		setResetTarget(null);
		await load();
	};

	const handleBind = async () => {
		if (!bindTarget || !bindAgentId) return;
		const kbId = bindTarget.id;
		setBindTarget(null);
		setBindAgentId("");
		await runAction(
			kbId,
			() => api.bindAgentKnowledgeBase(bindAgentId, kbId).then(() => undefined),
			"knowledgeBases.errors.bindFailed",
		);
	};

	const handleBindAgentToKb = async () => {
		if (!bindAgentForKb || !bindKbId) return;
		const agentId = bindAgentForKb;
		const kbId = bindKbId;
		setBindAgentForKb(null);
		setBindKbId("");
		await runAction(
			kbId,
			() => api.bindAgentKnowledgeBase(agentId, kbId).then(() => undefined),
			"knowledgeBases.errors.bindFailed",
		);
	};

	const handleDelete = async (kb: KnowledgeBaseDetail) => {
		const confirmed = window.confirm(
			t("knowledgeBases.deleteConfirm", { name: kb.name }),
		);
		if (!confirmed) return;
		await runAction(
			kb.id,
			() => api.deleteKnowledgeBase(kb.id).then(() => undefined),
			"knowledgeBases.errors.deleteFailed",
		);
	};

	const openBindModal = async (kb: KnowledgeBaseDetail) => {
		setActionError(null);
		await loadAgents();
		setBindAgentId("");
		setBindTarget(kb);
	};

	const bindableKbs = useMemo(
		() => knowledgeBases.filter((kb) => !kb.bound_agent && kb.status === "active"),
		[knowledgeBases],
	);

	const rowStyle = isMobile
		? { flexDirection: "column" as const, alignItems: "stretch" as const }
		: undefined;
	const iconButtonStyle = isMobile
		? { minWidth: 44, minHeight: 44 }
		: undefined;

	const renderRowActions = (kb: KnowledgeBaseDetail) => {
		if (!isSuperAdmin) return null;
		const busy = busyId === kb.id;
		const menuOpen = openMenuKbId === kb.id;
		return (
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
					data-testid={`kb-actions-${kb.id}`}
					aria-label={t("knowledgeBases.rowActions", { name: kb.name })}
					aria-haspopup="menu"
					aria-expanded={menuOpen}
					style={iconButtonStyle}
					onClick={() =>
						setOpenMenuKbId((current) =>
							current === kb.id ? null : kb.id,
						)
					}
				>
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
				</button>
				{menuOpen && (
					<div
						role="menu"
						data-testid={`kb-menu-${kb.id}`}
						aria-label={t("knowledgeBases.rowActions", { name: kb.name })}
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
						{!kb.bound_agent && (
							<button
								type="button"
								role="menuitem"
								className="btn btn-ghost"
								style={{ justifyContent: "flex-start" }}
								disabled={busy}
								onClick={() => {
									setOpenMenuKbId(null);
									void openBindModal(kb);
								}}
							>
								{t("knowledgeBases.actions.bind")}
							</button>
						)}
						<button
							type="button"
							role="menuitem"
							className="btn btn-ghost"
							style={{ justifyContent: "flex-start" }}
							disabled={busy}
							onClick={() => {
								setOpenMenuKbId(null);
								setActionError(null);
								setResetTarget(kb);
							}}
						>
							{t("knowledgeBases.actions.reset")}
						</button>
						<button
							type="button"
							role="menuitem"
							data-testid={`kb-delete-${kb.id}`}
							className="btn btn-ghost"
							style={{
								justifyContent: "flex-start",
								color: "var(--color-error)",
							}}
							disabled={busy}
							onClick={() => {
								setOpenMenuKbId(null);
								void handleDelete(kb);
							}}
						>
							{t("knowledgeBases.actions.delete")}
						</button>
					</div>
				)}
			</div>
		);
	};

	return (
		<AdminLayout>
			<div className="admin-page" data-testid="kb-list-page">
				<header className="page-header">
					<div style={{ minWidth: 0 }}>
						<h1 className="page-title">{t("knowledgeBases.title")}</h1>
						<p className="page-subtitle">{t("knowledgeBases.subtitle")}</p>
					</div>
					<div className="page-actions">
						{isSuperAdmin && (
							<button
								type="button"
								className="btn btn-primary"
								onClick={() => {
									setActionError(null);
									setCreateOpen(true);
								}}
							>
								{t("knowledgeBases.newKnowledgeBase")}
							</button>
						)}
					</div>
				</header>

				{actionError && (
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
						{actionError}
					</div>
				)}

				{loading ? (
					<div className="list" aria-busy="true" data-testid="kb-list-loading">
						{[0, 1, 2].map((index) => (
							<div key={index} className="list-row">
								<div
									className="skeleton skeleton-text"
									style={{ width: "100%" }}
								/>
							</div>
						))}
					</div>
				) : error ? (
					<div className="empty" data-testid="kb-list-error">
						<p className="empty-title" role="alert">
							{error}
						</p>
						<div className="empty-actions">
							<button
								type="button"
								className="btn btn-secondary"
								onClick={() => setReloadToken((value) => value + 1)}
							>
								{t("knowledgeBases.retry")}
							</button>
						</div>
					</div>
				) : knowledgeBases.length === 0 ? (
					<div className="empty" data-testid="kb-list-empty">
						<p className="empty-title">{t("knowledgeBases.empty")}</p>
						<p className="empty-description">
							{t("knowledgeBases.emptyHint")}
						</p>
						{isSuperAdmin && (
							<div className="empty-actions">
								<button
									type="button"
									className="btn btn-primary"
									onClick={() => {
										setActionError(null);
										setCreateOpen(true);
									}}
								>
									{t("knowledgeBases.newKnowledgeBase")}
								</button>
							</div>
						)}
					</div>
				) : (
					<>
						{/* Column-label row: desktop-only plan for R1. It carries the SAME grid
						 * contract as the data rows beneath (`list-grid` + the `list-grid--kb`
						 * flavour), so header cell N and data cell N share one column index.
						 * It lives OUTSIDE the <ul class="list"> so the list keeps exactly one
						 * child per KB (no header <li>, no extra listitem). */}
						<div
							className="list-header list-grid list-grid--kb"
							data-testid="kb-list-header"
						>
							<span className="list-header-cell">
								{t("knowledgeBases.columns.name")}
							</span>
							<span className="list-header-cell">
								{t("knowledgeBases.columns.documents")}
							</span>
							<span className="list-header-cell">
								{t("knowledgeBases.columns.chunks")}
							</span>
							<span className="list-header-cell">
								{t("knowledgeBases.columns.boundAgent")}
							</span>
							<span className="list-header-cell">
								{t("knowledgeBases.columns.status")}
							</span>
							<span className="list-header-cell">
								{t("knowledgeBases.columns.actions")}
							</span>
						</div>
						<ul className="list" data-testid="kb-list">
						{knowledgeBases.map((kb) => (
							<li
								key={kb.id}
								className="list-row list-grid list-grid--kb"
								data-testid={`kb-row-${kb.id}`}
								style={rowStyle}
							>
								{/* Column 1 — name. The NAME is the affordance, not the row: the link
								 * (with its chevron) is the only navigation target, so the row can
								 * still host the menu button. The description stacks under the name
								 * inside this same cell. */}
								<div className="list-cell list-row-main">
									<span className="list-row-name">
										<Link
											className="list-row-title list-row-affordance"
											to={`/knowledge-bases/${kb.id}`}
											data-testid={`kb-name-${kb.id}`}
										>
											{kb.name}
										</Link>
										<svg
											className="list-row-chevron"
											viewBox="0 0 16 16"
											fill="none"
											stroke="currentColor"
											strokeWidth="1.75"
											strokeLinecap="round"
											strokeLinejoin="round"
											aria-hidden="true"
											data-testid={`kb-chevron-${kb.id}`}
										>
											<path d="M6 3.5 10.5 8 6 12.5" />
										</svg>
									</span>
									<span className="list-row-description">
										{t(providerLabelKey[kb.embedding_provider])} ·{" "}
										{kb.embedding_model}
									</span>
								</div>
								{/* Column 2 — documents. The value only: the column header names it,
								 * so repeating 文档 here would duplicate the header (R2). */}
								<div
									className="list-cell"
									data-testid={`kb-documents-${kb.id}`}
								>
									<span className="list-cell-value">
										{kb.ready_document_count}/{kb.document_count}
									</span>
								</div>
								{/* Column 3 — chunks. */}
								<div
									className="list-cell"
									data-testid={`kb-chunks-${kb.id}`}
								>
									<span className="list-cell-value">{kb.total_chunks}</span>
								</div>
								{/* Column 4 — bound agent. */}
								<div
									className="list-cell"
									data-testid={`kb-bound-agent-${kb.id}`}
								>
									<span
										style={{
											color: kb.bound_agent
												? "var(--color-text-secondary)"
												: "var(--color-text-muted)",
										}}
									>
										{kb.bound_agent
											? kb.bound_agent.name
											: t("knowledgeBases.unboundValue")}
									</span>
								</div>
								{/* Column 5 — status. */}
								<div
									className="list-cell"
									data-testid={`kb-status-${kb.id}`}
								>
									<span className={statusBadgeClass[kb.status]}>
										{t(`knowledgeBases.status.${kb.status}`)}
									</span>
								</div>
								{/* Column 6 — actions. */}
								<div
									className="list-cell"
									data-testid={`kb-actions-cell-${kb.id}`}
								>
									{renderRowActions(kb)}
								</div>
							</li>
						))}
					</ul>
					</>
				)}
			</div>

			{createOpen && (
				<KbFormModal
					mode="create"
					onSubmit={handleCreate}
					onClose={() => setCreateOpen(false)}
				/>
			)}

			{resetTarget && (
				<KbFormModal
					mode="reset"
					initial={resetTarget}
					onSubmit={handleReset}
					onClose={() => setResetTarget(null)}
				/>
			)}

			{bindTarget && (
				<div
					className="modal-backdrop"
					data-testid="kb-bind-modal"
					onClick={() => setBindTarget(null)}
				>
					<div
						className="card card-raised"
						role="dialog"
						aria-modal="true"
						style={{ maxWidth: "440px", width: "100%", minWidth: 0 }}
						onClick={(event) => event.stopPropagation()}
					>
						<h3 className="card-title" style={{ marginBottom: "var(--space-2)" }}>
							{t("knowledgeBases.bindTitle")}
						</h3>
						<p
							className="page-subtitle"
							style={{ marginBottom: "var(--space-4)" }}
						>
							{t("knowledgeBases.bindDescription", { name: bindTarget.name })}
						</p>
						<label className="field" style={{ display: "block" }}>
							<span className="field-label">
								{t("knowledgeBases.bindAgentLabel")}
							</span>
							<select
								className="select"
								aria-label={t("knowledgeBases.bindAgentLabel")}
								value={bindAgentId}
								onChange={(event) => setBindAgentId(event.target.value)}
								style={{ width: "100%" }}
							>
								<option value="">
									{t("knowledgeBases.bindAgentPlaceholder")}
								</option>
								{agents.map((agent) => (
									<option key={agent.id} value={agent.id}>
										{agent.name}
									</option>
								))}
							</select>
						</label>
						<div
							style={{
								display: "flex",
								gap: "var(--space-3)",
								justifyContent: "flex-end",
								marginTop: "var(--space-6)",
							}}
						>
							<button
								type="button"
								className="btn btn-secondary"
								onClick={() => setBindTarget(null)}
							>
								{t("buttons.cancel")}
							</button>
							<button
								type="button"
								className="btn btn-primary"
								disabled={!bindAgentId}
								onClick={handleBind}
							>
								{t("knowledgeBases.bindSubmit")}
							</button>
						</div>
					</div>
				</div>
			)}

			{bindAgentForKb && (
				<div
					className="modal-backdrop"
					data-testid="kb-bind-agent-modal"
					onClick={closeBindAgentModal}
				>
					<div
						className="card card-raised"
						role="dialog"
						aria-modal="true"
						style={{ maxWidth: "440px", width: "100%", minWidth: 0 }}
						onClick={(event) => event.stopPropagation()}
					>
						<h3 className="card-title" style={{ marginBottom: "var(--space-2)" }}>
							{t("knowledgeBases.bindAgentTitle")}
						</h3>
						<p
							className="page-subtitle"
							style={{ marginBottom: "var(--space-4)" }}
						>
							{t("knowledgeBases.bindAgentDescription")}
						</p>
						<label className="field" style={{ display: "block" }}>
							<span className="field-label">
								{t("knowledgeBases.bindKbLabel")}
							</span>
							<select
								className="select"
								aria-label={t("knowledgeBases.bindKbLabel")}
								value={bindKbId}
								onChange={(event) => setBindKbId(event.target.value)}
								style={{ width: "100%" }}
							>
								<option value="">{t("knowledgeBases.bindKbPlaceholder")}</option>
								{bindableKbs.map((kb) => (
									<option key={kb.id} value={kb.id}>
										{kb.name}
									</option>
								))}
							</select>
						</label>
						<div
							style={{
								display: "flex",
								gap: "var(--space-3)",
								justifyContent: "flex-end",
								marginTop: "var(--space-6)",
							}}
						>
							<button
								type="button"
								className="btn btn-secondary"
								onClick={closeBindAgentModal}
							>
								{t("buttons.cancel")}
							</button>
							<button
								type="button"
								className="btn btn-primary"
								disabled={!bindKbId}
								onClick={handleBindAgentToKb}
							>
								{t("knowledgeBases.bindSubmit")}
							</button>
						</div>
					</div>
				</div>
			)}
		</AdminLayout>
	);
}
