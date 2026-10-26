"use client";

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AdminLayout from "../components/AdminLayout";
import FileUploadManagement from "./FileUploadManagement";
import URLManagement from "./URLManagement";
import { api } from "../services/api";
import type { KbSourcesSummaryResponse, KnowledgeBaseDetail as KbDetail } from "../services/api";
import { useIsMobile } from "../hooks/useMediaQuery";

const statusBadgeClass: Record<string, string> = {
	active: "badge badge-success",
	resetting: "badge badge-warning",
	processing: "badge badge-info",
	error: "badge badge-error",
};

/**
 * `/knowledge-bases/:kbId` — the one place where an operator works on a KB's
 * sources.
 *
 * Both panels take `kbId` from the route via `useParams`, so this view only
 * loads the KB header (name, embedding config, counters) and switches between
 * the URL and file panels. Nothing here is agent-scoped: an unbound KB is a
 * first-class target.
 */
export default function KnowledgeBaseDetail() {
	const { t } = useTranslation("common");
	const { kbId } = useParams<{ kbId: string }>();
	const isMobile = useIsMobile();

	const [kb, setKb] = useState<KbDetail | null>(null);
	const [summary, setSummary] = useState<KbSourcesSummaryResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [reloadToken, setReloadToken] = useState(0);

	const load = useCallback(async () => {
		if (!kbId) return;
		setLoading(true);
		setError(null);
		try {
			const [detail, sources] = await Promise.all([
				api.getKnowledgeBase(kbId),
				api.getKbSourcesSummary(kbId).catch(() => null),
			]);
			setKb(detail);
			setSummary(sources);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : t("knowledgeBases.errors.loadFailed"),
			);
		} finally {
			setLoading(false);
		}
	}, [kbId, t]);

	useEffect(() => {
		void load();
	}, [load, reloadToken]);

	if (!kbId) {
		return (
			<AdminLayout>
				<div style={{ padding: "var(--space-8)", textAlign: "center" }}>
					{t("knowledgeBases.errors.loadFailed")}
				</div>
			</AdminLayout>
		);
	}

	return (
		<AdminLayout>
			<div
				className="admin-page"
				data-testid="kb-detail-page"
				style={{
					padding: isMobile ? "var(--space-4)" : "var(--space-8)",
					maxWidth: "1400px",
					margin: "0 auto",
					minWidth: 0,
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "var(--space-3)",
						marginBottom: "var(--space-4)",
						flexWrap: "wrap",
					}}
				>
					<Link
						to="/knowledge-bases"
						className="btn-secondary"
						style={{ textDecoration: "none", minHeight: "44px" }}
					>
						← {t("knowledgeBases.title")}
					</Link>
					<button
						type="button"
						className="btn-secondary"
						onClick={() => setReloadToken((value) => value + 1)}
						disabled={loading}
						style={{ minHeight: "44px" }}
					>
						{t("buttons.refresh")}
					</button>
				</div>

				<div style={{ marginBottom: "var(--space-6)" }}>
					<h1
						data-testid="kb-detail-title"
						style={{
							fontSize: isMobile ? "var(--text-2xl)" : "var(--text-4xl)",
							fontWeight: 700,
							color: "var(--color-text-primary)",
							marginBottom: "var(--space-2)",
							wordBreak: "break-word",
						}}
					>
						{kb?.name ?? t("status.loading")}
					</h1>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "var(--space-3)",
							flexWrap: "wrap",
							color: "var(--color-text-secondary)",
							fontSize: "var(--text-sm)",
						}}
					>
						{kb && (
							<span className={statusBadgeClass[kb.status] ?? "badge"}>
								{t(`knowledgeBases.status.${kb.status}`)}
							</span>
						)}
						{kb && (
							<span>
								{kb.embedding_model} · {kb.ready_document_count}/
								{kb.document_count} · {kb.total_chunks}
							</span>
						)}
						<span data-testid="kb-detail-bound-agent">
							{kb?.bound_agent
								? kb.bound_agent.name
								: t("knowledgeBases.unboundValue")}
						</span>
					</div>
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

				{summary && (
					<div
						data-testid="kb-detail-summary"
						style={{
							display: "grid",
							gridTemplateColumns: isMobile
								? "minmax(0, 1fr)"
								: "repeat(auto-fit, minmax(160px, 1fr))",
							gap: "var(--space-3)",
							marginBottom: "var(--space-6)",
						}}
					>
						<div
							className="liquid-glass-card"
							style={{ padding: "var(--space-4)", minWidth: 0 }}
						>
							<div style={{ color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>
								{t("sources.links", { count: summary.urls.total })}
							</div>
							<div style={{ fontWeight: 700, color: "var(--color-text-primary)" }}>
								{summary.urls.indexed}/{summary.urls.total}
							</div>
						</div>
						<div
							className="liquid-glass-card"
							style={{ padding: "var(--space-4)", minWidth: 0 }}
						>
							<div style={{ color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>
								{t("sources.fileItems", { count: summary.files.total })}
							</div>
							<div style={{ fontWeight: 700, color: "var(--color-text-primary)" }}>
								{summary.files.ready}/{summary.files.total}
							</div>
						</div>
					</div>
				)}

				{/*
				 * The two source panels are composed here. Both read `kbId` from the
				 * route via `useParams` and talk only to the kb-scoped API.
				 */}
				<div style={{ display: "grid", gap: "var(--space-8)", minWidth: 0 }}>
					<URLManagement />
					<FileUploadManagement />
				</div>
			</div>
		</AdminLayout>
	);
}
