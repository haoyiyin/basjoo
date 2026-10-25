"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { api } from "../services/api";
import type {
	EmbeddingProvider,
	KbStatus,
	KbStatusPayload,
	KnowledgeBaseDetail,
} from "../services/api";
import { useAuth } from "../context/AuthContext";
import AdminLayout from "../components/AdminLayout";

const providerLabelKey: Record<EmbeddingProvider, string> = {
	jina: "kbForm.providerJina",
	siliconflow: "kbForm.providerSiliconflow",
	custom: "kbForm.providerCustom",
};

const statusBadgeClass: Record<KbStatus, string> = {
	active: "badge badge-success",
	resetting: "badge badge-warning",
	processing: "badge badge-info",
	error: "badge badge-error",
};

interface KnowledgeBaseSetupProps {
	agentId?: string;
	onSetupComplete?: () => void;
}

/**
 * Agent-scoped knowledge page (`/agents/:agentId/knowledge`).
 *
 * The KB is created, reset and deleted on the workspace `/knowledge-bases`
 * page; this view only shows the agent's current binding and lets a
 * super_admin bind an existing KB or unbind the current one.
 */
export default function KnowledgeBaseSetup({
	agentId: agentIdProp,
	onSetupComplete,
}: KnowledgeBaseSetupProps) {
	const { t } = useTranslation("common");
	const { admin } = useAuth();
	const { agentId: routeAgentId } = useParams<{ agentId?: string }>();
	const [agentId, setAgentId] = useState<string | null>(
		agentIdProp || routeAgentId || null,
	);
	const [kbStatus, setKbStatus] = useState<KbStatusPayload | null>(null);
	const [kbDetail, setKbDetail] = useState<KnowledgeBaseDetail | null>(null);
	const [availableKbs, setAvailableKbs] = useState<KnowledgeBaseDetail[]>([]);
	const [selectedKbId, setSelectedKbId] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showBindForm, setShowBindForm] = useState(false);

	const isSuperAdmin = admin?.role === "super_admin";

	// Reload is driven by a counter rather than a `t`-dependent callback: the
	// translation function is not referentially stable, so depending on it would
	// refetch on every render.
	const [reloadToken, setReloadToken] = useState(0);

	useEffect(() => {
		const resolvedAgentId = agentIdProp || routeAgentId;
		if (resolvedAgentId) {
			setAgentId(resolvedAgentId);
		} else {
			setError(t("errors.loadFailed"));
			setLoading(false);
		}
	}, [agentIdProp, routeAgentId]);

	useEffect(() => {
		if (!agentId) return;
		let cancelled = false;
		const load = async () => {
			setLoading(true);
			setError(null);
			try {
				const status = await api.kbStatus(agentId);
				if (cancelled) return;
				setKbStatus(status);
				if (status.kb_id) {
					try {
						const detail = await api.getKnowledgeBase(status.kb_id);
						if (!cancelled) setKbDetail(detail);
					} catch {
						// The detail payload is supplementary; the status response
						// alone is enough to render the binding.
						if (!cancelled) setKbDetail(null);
					}
				} else {
					setKbDetail(null);
				}
				const list = await api.listKnowledgeBases();
				if (cancelled) return;
				setAvailableKbs(
					list.knowledge_bases.filter(
						(kb) => kb.bound_agent === null && kb.status === "active",
					),
				);
			} catch (err) {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : t("errors.loadFailed"));
			} finally {
				if (!cancelled) setLoading(false);
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [agentId, reloadToken]);

	const handleUnbind = async () => {
		if (!agentId || !kbStatus?.kb_id) return;
		const confirmed = window.confirm(
			t("knowledgeBases.unbindConfirm", {
				agent: kbStatus.kb?.name ?? kbStatus.kb_id,
			}),
		);
		if (!confirmed) return;
		setSaving(true);
		setError(null);
		try {
			await api.bindAgentKnowledgeBase(agentId, null);
			setShowBindForm(false);
			setReloadToken((value) => value + 1);
			onSetupComplete?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("errors.saveFailed"));
		} finally {
			setSaving(false);
		}
	};

	const handleBind = async () => {
		if (!agentId || !selectedKbId) return;
		setSaving(true);
		setError(null);
		try {
			await api.bindAgentKnowledgeBase(agentId, selectedKbId);
			setSelectedKbId("");
			setShowBindForm(false);
			setReloadToken((value) => value + 1);
			onSetupComplete?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("errors.saveFailed"));
		} finally {
			setSaving(false);
		}
	};

	const getProviderLabel = (provider: EmbeddingProvider): string => {
		switch (provider) {
			case "jina":
				return t("labels.embeddingProviderJina");
			case "siliconflow":
				return t("labels.embeddingProviderSiliconFlow");
			case "custom":
				return t("labels.embeddingProviderCustom");
			default:
				return provider;
		}
	};

	const configRow = (label: string, value: string | number) => (
		<div
			key={label}
			style={{
				display: "flex",
				alignItems: "center",
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

	const boundKbName = kbDetail?.name ?? kbStatus?.kb?.name ?? null;
	const boundProvider =
		kbDetail?.embedding_provider ?? kbStatus?.kb?.embedding_provider ?? null;
	const boundModel =
		kbDetail?.embedding_model ?? kbStatus?.kb?.embedding_model ?? null;
	const boundStatus = kbDetail?.status ?? kbStatus?.kb?.status ?? null;

	if (loading) {
		return (
			<AdminLayout>
				<div
					style={{
						display: "flex",
						justifyContent: "center",
						alignItems: "center",
						minHeight: "300px",
					}}
				>
					<div className="spinner" />
				</div>
			</AdminLayout>
		);
	}

	return (
		<AdminLayout>
			<div
				style={{
					padding: "var(--space-8)",
					maxWidth: "1400px",
					margin: "0 auto",
				}}
			>
				<div style={{ marginBottom: "var(--space-6)" }}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "var(--space-3)",
							flexWrap: "wrap",
							marginBottom: "var(--space-2)",
						}}
					>
						<h1
							style={{
								fontSize: "var(--text-2xl)",
								fontWeight: 700,
								color: "var(--color-text-primary)",
								margin: 0,
							}}
						>
							{t("kb.title")}
						</h1>
						{boundStatus && (
							<span className={statusBadgeClass[boundStatus]}>
								{t(`knowledgeBases.status.${boundStatus}`)}
							</span>
						)}
					</div>
					<p
						style={{
							fontSize: "var(--text-base)",
							color: "var(--color-text-secondary)",
							margin: 0,
						}}
					>
						{t("knowledgeBases.subtitle")}
					</p>
				</div>

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

				<div
					className="liquid-glass-card"
					style={{ padding: "var(--space-6)", marginBottom: "var(--space-6)" }}
				>
					{boundKbName ? (
						<>
							<h3
								style={{
									fontSize: "var(--text-lg)",
									fontWeight: 600,
									marginBottom: "var(--space-4)",
									color: "var(--color-text-primary)",
								}}
							>
								{boundKbName}
							</h3>
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: "var(--space-1)",
								}}
							>
								{configRow(
									t("kb.provider"),
									boundProvider
										? getProviderLabel(boundProvider)
										: t("knowledgeBases.detail.notSet"),
								)}
								{configRow(
									t("kb.modelName"),
									boundModel ?? t("knowledgeBases.detail.notSet"),
								)}
								{configRow(
									t("knowledgeBases.detail.documents"),
									kbDetail
										? `${kbDetail.ready_document_count}/${kbDetail.document_count}`
										: t("knowledgeBases.detail.notSet"),
								)}
								{configRow(
									t("knowledgeBases.detail.chunks"),
									kbDetail?.total_chunks ?? t("knowledgeBases.detail.notSet"),
								)}
							</div>
							{kbDetail?.error_message && (
								<div
									role="alert"
									style={{
										padding: "var(--space-3) var(--space-4)",
										borderRadius: "var(--radius-md)",
										fontSize: "var(--text-sm)",
										background: "var(--color-error-bg)",
										border: "1px solid var(--color-error)",
										color: "var(--color-error)",
										marginTop: "var(--space-4)",
									}}
								>
									{kbDetail.error_message}
								</div>
							)}
						</>
					) : (
						<p
							style={{
								fontSize: "var(--text-sm)",
								color: "var(--color-text-secondary)",
								margin: 0,
							}}
						>
							{t("kb.setupRequired")}
						</p>
					)}

					<div
						style={{
							display: "flex",
							gap: "var(--space-3)",
							flexWrap: "wrap",
							marginTop: "var(--space-6)",
						}}
					>
						{isSuperAdmin && !boundKbName && (
							<button
								type="button"
								data-testid="kb-bind-existing"
								className="btn-primary"
								disabled={saving || availableKbs.length === 0}
								onClick={() => setShowBindForm((value) => !value)}
							>
								{t("agents.kbBindExisting", {
									defaultValue: "Bind an existing knowledge base",
								})}
							</button>
						)}
						{isSuperAdmin && boundKbName && (
							<button
								type="button"
								data-testid="kb-unbind"
								className="btn-danger"
								disabled={saving}
								onClick={handleUnbind}
							>
								{t("knowledgeBases.actions.unbind")}
							</button>
						)}
						<Link
							to="/knowledge-bases"
							className="btn-secondary"
							style={{ textDecoration: "none" }}
						>
							{t("knowledgeBases.openList", {
								defaultValue: "Open knowledge bases",
							})}
						</Link>
					</div>

					{showBindForm && (
						<div
							data-testid="kb-bind-form"
							style={{ marginTop: "var(--space-5)" }}
						>
							<label
								htmlFor="kb-bind-select"
								style={{
									display: "block",
									marginBottom: "var(--space-2)",
									fontSize: "var(--text-sm)",
									color: "var(--color-text-secondary)",
								}}
							>
								{t("knowledgeBases.bindTitle")}
							</label>
							<select
								id="kb-bind-select"
								value={selectedKbId}
								onChange={(event) => setSelectedKbId(event.target.value)}
								style={{ width: "100%" }}
							>
								<option value="">
									{t("knowledgeBases.bindAgentPlaceholder")}
								</option>
								{availableKbs.map((kb) => (
									<option key={kb.id} value={kb.id}>
										{kb.name}
									</option>
								))}
							</select>
							<div
								style={{
									display: "flex",
									gap: "var(--space-3)",
									justifyContent: "flex-end",
									marginTop: "var(--space-4)",
								}}
							>
								<button
									type="button"
									className="btn-secondary"
									disabled={saving}
									onClick={() => {
										setSelectedKbId("");
										setShowBindForm(false);
									}}
								>
									{t("buttons.cancel")}
								</button>
								<button
									type="button"
									data-testid="kb-bind-submit"
									className="btn-primary"
									disabled={saving || !selectedKbId}
									onClick={handleBind}
								>
									{t("knowledgeBases.bindSubmit")}
								</button>
							</div>
						</div>
					)}
				</div>
			</div>
		</AdminLayout>
	);
}
