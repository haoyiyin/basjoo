"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import AdminLayout from "../components/AdminLayout";
import KbFormModal from "../components/KbFormModal";
import type { KbFormValues } from "../components/KbFormModal";
import { useAuth } from "../context/AuthContext";
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
};

const thStyle = {
	textAlign: "left",
	padding: "var(--space-3) var(--space-4)",
	fontSize: "var(--text-xs)",
	fontWeight: 600,
	letterSpacing: "0.05em",
	textTransform: "uppercase",
	color: "var(--color-text-muted)",
	borderBottom: "1px solid var(--color-border)",
} as const;

const tdStyle = {
	padding: "var(--space-4)",
	fontSize: "var(--text-sm)",
	color: "var(--color-text-primary)",
	borderBottom: "1px solid var(--color-border)",
	verticalAlign: "middle",
} as const;

/**
 * Workspace knowledge-base list with an inline detail panel.
 *
 * The KB lifecycle is decoupled from agents: this view is the only place that
 * creates, resets, deletes and binds KBs. Mutations are super_admin only.
 */
export default function KnowledgeBases() {
	const { t } = useTranslation("common");
	const { admin } = useAuth();
	const isSuperAdmin = admin?.role === "super_admin";

	const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseDetail[]>(
		[],
	);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [reloadToken, setReloadToken] = useState(0);
	const [agents, setAgents] = useState<Agent[]>([]);

	const [createOpen, setCreateOpen] = useState(false);
	const [resetTarget, setResetTarget] = useState<KnowledgeBaseDetail | null>(
		null,
	);
	const [bindTarget, setBindTarget] = useState<KnowledgeBaseDetail | null>(null);
	const [bindAgentId, setBindAgentId] = useState("");

	const load = async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await api.listKnowledgeBases();
			setKnowledgeBases(data.knowledge_bases);
			setSelectedId((current) => {
				if (current && data.knowledge_bases.some((kb) => kb.id === current)) {
					return current;
				}
				return data.knowledge_bases[0]?.id ?? null;
			});
		} catch (err) {
			setError(
				err instanceof Error ? err.message : t("knowledgeBases.errors.loadFailed"),
			);
		} finally {
			setLoading(false);
		}
	};

	// Load once on mount; the reload counter drives refresh/retry.
	useEffect(() => {
		void load();
	}, [reloadToken]);

	const selected = useMemo(
		() => knowledgeBases.find((kb) => kb.id === selectedId) ?? null,
		[knowledgeBases, selectedId],
	);

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

	const handleUnbind = async (kb: KnowledgeBaseDetail) => {
		if (!kb.bound_agent) return;
		const confirmed = window.confirm(
			t("knowledgeBases.unbindConfirm", { agent: kb.bound_agent.name }),
		);
		if (!confirmed) return;
		const agentId = kb.bound_agent.id;
		await runAction(
			kb.id,
			() => api.bindAgentKnowledgeBase(agentId, null).then(() => undefined),
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

	const renderActions = (kb: KnowledgeBaseDetail) => {
		const busy = busyId === kb.id;
		return (
			<div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
				<button
					type="button"
					className="btn-secondary"
					onClick={() => setSelectedId(kb.id)}
				>
					{t("knowledgeBases.actions.details")}
				</button>
				{isSuperAdmin && !kb.bound_agent && (
					<button
						type="button"
						className="btn-secondary"
						disabled={busy}
						onClick={() => openBindModal(kb)}
					>
						{t("knowledgeBases.actions.bind")}
					</button>
				)}
				{isSuperAdmin && kb.bound_agent && (
					<button
						type="button"
						className="btn-secondary"
						disabled={busy}
						onClick={() => handleUnbind(kb)}
					>
						{t("knowledgeBases.actions.unbind")}
					</button>
				)}
				{isSuperAdmin && (
					<button
						type="button"
						className="btn-secondary"
						disabled={busy}
						onClick={() => {
							setActionError(null);
							setResetTarget(kb);
						}}
					>
						{t("knowledgeBases.actions.reset")}
					</button>
				)}
				{isSuperAdmin && (
					<button
						type="button"
						className="btn-danger"
						disabled={busy}
						onClick={() => handleDelete(kb)}
					>
						{t("knowledgeBases.actions.delete")}
					</button>
				)}
			</div>
		);
	};

	const configRow = (label: string, value: string | number) => (
		<div
			key={label}
			style={{
				display: "flex",
				justifyContent: "space-between",
				gap: "var(--space-4)",
				padding: "var(--space-3) 0",
				borderBottom: "1px solid var(--color-border)",
			}}
		>
			<span
				style={{
					fontSize: "var(--text-sm)",
					color: "var(--color-text-secondary)",
				}}
			>
				{label}
			</span>
			<span
				style={{
					fontSize: "var(--text-sm)",
					fontWeight: 500,
					color: "var(--color-text-primary)",
					textAlign: "right",
					wordBreak: "break-word",
				}}
			>
				{value}
			</span>
		</div>
	);

	return (
		<AdminLayout>
			<div
				style={{
					padding: "var(--space-8)",
					maxWidth: "1400px",
					margin: "0 auto",
				}}
			>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "flex-start",
						gap: "var(--space-4)",
						flexWrap: "wrap",
						marginBottom: "var(--space-6)",
					}}
				>
					<div>
						<h1
							style={{
								fontSize: "var(--text-2xl)",
								fontWeight: 700,
								color: "var(--color-text-primary)",
								margin: 0,
								marginBottom: "var(--space-2)",
							}}
						>
							{t("knowledgeBases.title")}
						</h1>
						<p
							style={{
								fontSize: "var(--text-sm)",
								color: "var(--color-text-secondary)",
								margin: 0,
							}}
						>
							{t("knowledgeBases.subtitle")}
						</p>
					</div>
					<div style={{ display: "flex", gap: "var(--space-2)" }}>
						<button
							type="button"
							className="btn-secondary"
							onClick={() => load()}
							disabled={loading}
						>
							{t("buttons.refresh")}
						</button>
						{isSuperAdmin && (
							<button
								type="button"
								className="btn-primary"
								onClick={() => {
									setActionError(null);
									setCreateOpen(true);
								}}
							>
								{t("knowledgeBases.newKnowledgeBase")}
							</button>
						)}
					</div>
				</div>

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

				<div className="liquid-glass-card" style={{ padding: "var(--space-2)" }}>
					{loading ? (
						<div
							style={{
								display: "flex",
								justifyContent: "center",
								alignItems: "center",
								minHeight: "200px",
							}}
						>
							<div className="spinner" />
						</div>
					) : error ? (
						<div
							style={{
								padding: "var(--space-6)",
								textAlign: "center",
								color: "var(--color-error)",
								fontSize: "var(--text-sm)",
							}}
						>
							<p style={{ marginBottom: "var(--space-4)" }}>{error}</p>
							<button type="button" className="btn-secondary" onClick={() => load()}>
								{t("knowledgeBases.retry")}
							</button>
						</div>
					) : knowledgeBases.length === 0 ? (
						<div
							style={{
								padding: "var(--space-8)",
								textAlign: "center",
								color: "var(--color-text-secondary)",
								fontSize: "var(--text-sm)",
							}}
						>
							<p style={{ marginBottom: "var(--space-2)" }}>
								{t("knowledgeBases.empty")}
							</p>
							<p style={{ color: "var(--color-text-muted)" }}>
								{t("knowledgeBases.emptyHint")}
							</p>
						</div>
					) : (
						<table style={{ width: "100%", borderCollapse: "collapse" }}>
							<thead>
								<tr>
									<th style={thStyle}>{t("knowledgeBases.columns.name")}</th>
									<th style={thStyle}>
										{t("knowledgeBases.columns.embedding")}
									</th>
									<th style={thStyle}>
										{t("knowledgeBases.columns.documents")}
									</th>
									<th style={thStyle}>{t("knowledgeBases.columns.chunks")}</th>
									<th style={thStyle}>{t("knowledgeBases.columns.status")}</th>
									<th style={thStyle}>
										{t("knowledgeBases.columns.boundAgent")}
									</th>
									<th style={thStyle}>
										{t("knowledgeBases.columns.actions")}
									</th>
								</tr>
							</thead>
							<tbody>
								{knowledgeBases.map((kb) => (
									<tr key={kb.id} data-testid={`kb-row-${kb.id}`}>
										<td style={tdStyle}>{kb.name}</td>
										<td style={tdStyle}>
											<div style={{ fontWeight: 500 }}>
												{t(providerLabelKey[kb.embedding_provider])}
											</div>
											<div
												style={{
													fontSize: "var(--text-xs)",
													color: "var(--color-text-muted)",
												}}
											>
												{kb.embedding_model}
											</div>
										</td>
										<td style={tdStyle}>
											{kb.ready_document_count}/{kb.document_count}
										</td>
										<td style={tdStyle}>{kb.total_chunks}</td>
										<td style={tdStyle}>
											<span className={statusBadgeClass[kb.status]}>
												{t(`knowledgeBases.status.${kb.status}`)}
											</span>
										</td>
										<td style={tdStyle}>
											{kb.bound_agent ? (
												kb.bound_agent.name
											) : (
												<span style={{ color: "var(--color-text-muted)" }}>
													{t("knowledgeBases.unboundValue")}
												</span>
											)}
										</td>
										<td style={tdStyle}>{renderActions(kb)}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>

				{selected && (
					<div
						data-testid="kb-detail-panel"
						className="liquid-glass-card"
						style={{ padding: "var(--space-6)", marginTop: "var(--space-6)" }}
					>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								gap: "var(--space-4)",
								marginBottom: "var(--space-4)",
								flexWrap: "wrap",
							}}
						>
							<h2
								style={{
									fontSize: "var(--text-lg)",
									fontWeight: 600,
									color: "var(--color-text-primary)",
									margin: 0,
								}}
							>
								{selected.name}
							</h2>
							<button
								type="button"
								className="btn-secondary"
								onClick={() => setSelectedId(null)}
							>
								{t("knowledgeBases.actions.close")}
							</button>
						</div>

						{selected.error_message && (
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
								{selected.error_message}
							</div>
						)}

						{configRow(
							t("knowledgeBases.detail.provider"),
							t(providerLabelKey[selected.embedding_provider]),
						)}
						{configRow(
							t("knowledgeBases.detail.model"),
							selected.embedding_model,
						)}
						{configRow(
							t("knowledgeBases.detail.baseUrl"),
							selected.embedding_base_url ||
								t("knowledgeBases.detail.notSet"),
						)}
						{configRow(
							t("knowledgeBases.detail.dimension"),
							selected.embedding_dimension ?? t("knowledgeBases.detail.notSet"),
						)}
						{configRow(
							t("knowledgeBases.detail.batchSize"),
							selected.embedding_batch_size,
						)}
						{configRow(
							t("knowledgeBases.detail.chunkSize"),
							selected.chunk_size,
						)}
						{configRow(
							t("knowledgeBases.detail.chunkOverlap"),
							selected.chunk_overlap,
						)}
						{configRow(
							t("knowledgeBases.detail.documents"),
							`${selected.ready_document_count}/${selected.document_count}`,
						)}
						{configRow(
							t("knowledgeBases.detail.chunks"),
							selected.total_chunks,
						)}
						{configRow(
							t("knowledgeBases.detail.boundAgent"),
							selected.bound_agent?.name ?? t("knowledgeBases.unboundValue"),
						)}

						<div style={{ marginTop: "var(--space-4)" }}>
							{renderActions(selected)}
						</div>
					</div>
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
					data-testid="kb-bind-modal"
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 9999,
						background: "rgba(0, 0, 0, 0.5)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
					onClick={() => setBindTarget(null)}
				>
					<div
						className="liquid-glass-card"
						role="dialog"
						aria-modal="true"
						style={{
							padding: "var(--space-6)",
							maxWidth: "440px",
							width: "100%",
							margin: "var(--space-4)",
						}}
						onClick={(event) => event.stopPropagation()}
					>
						<h3
							style={{
								fontSize: "var(--text-lg)",
								fontWeight: 600,
								marginBottom: "var(--space-2)",
								color: "var(--color-text-primary)",
							}}
						>
							{t("knowledgeBases.bindTitle")}
						</h3>
						<p
							style={{
								fontSize: "var(--text-sm)",
								color: "var(--color-text-secondary)",
								marginBottom: "var(--space-4)",
							}}
						>
							{t("knowledgeBases.bindDescription", { name: bindTarget.name })}
						</p>
						<select
							aria-label={t("knowledgeBases.bindAgentLabel")}
							value={bindAgentId}
							onChange={(event) => setBindAgentId(event.target.value)}
							style={{ width: "100%" }}
						>
							<option value="">{t("knowledgeBases.bindAgentPlaceholder")}</option>
							{agents.map((agent) => (
								<option key={agent.id} value={agent.id}>
									{agent.name}
								</option>
							))}
						</select>
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
								className="btn-secondary"
								onClick={() => setBindTarget(null)}
							>
								{t("buttons.cancel")}
							</button>
							<button
								type="button"
								className="btn-primary"
								disabled={!bindAgentId}
								onClick={handleBind}
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
