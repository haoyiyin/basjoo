"use client";

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AdminLayout from "../components/AdminLayout";
import QaManagement from "../components/QaManagement";
import FileUploadManagement from "./FileUploadManagement";
import URLManagement from "./URLManagement";
import { api } from "../services/api";
import type { KbSourcesSummaryResponse, KnowledgeBaseDetail as KbDetail } from "../services/api";

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
 * loads the KB header (name, embedding config, counters) and composes the URL
 * and file panels. Nothing here is agent-scoped: an unbound KB is a
 * first-class target.
 *
 * Layout uses the DS `admin-page` / `page-header` / `stat-grid` system like
 * every other admin view — no glass surface, no inline colour, no weight
 * outside the 400/500/600 ramp.
 */
export default function KnowledgeBaseDetail() {
	const { t } = useTranslation("common");
	const { kbId } = useParams<{ kbId: string }>();

	const [kb, setKb] = useState<KbDetail | null>(null);
	const [summary, setSummary] = useState<KbSourcesSummaryResponse | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!kbId) return;
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
		}
	}, [kbId, t]);

	// §18: no manual refresh button — the page loads itself on mount and the
	// source panels keep their own auto-polling.
	useEffect(() => {
		void load();
	}, [load]);

	if (!kbId) {
		return (
			<AdminLayout>
				<div className="admin-page" data-testid="kb-detail-page">
					<div className="empty">
						<p className="empty-description">
							{t("knowledgeBases.errors.loadFailed")}
						</p>
					</div>
				</div>
			</AdminLayout>
		);
	}

	return (
		<AdminLayout>
			<div className="admin-page" data-testid="kb-detail-page">
				<div className="page-actions page-actions-start">
					<Link to="/knowledge-bases" className="btn btn-secondary">
						← {t("knowledgeBases.title")}
					</Link>
				</div>

				<header className="page-header">
					<h1 className="page-title" data-testid="kb-detail-title">
						{kb?.name ?? t("status.loading")}
					</h1>
					<div className="list-row-meta">
						{kb && (
							<span className={statusBadgeClass[kb.status] ?? "badge"}>
								{t(`knowledgeBases.status.${kb.status}`)}
							</span>
						)}
						{kb && (
							<span className="mono">
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
				</header>

				{error && (
					<div role="alert" className="badge badge-error kb-detail-error">
						{error}
					</div>
				)}

				{summary && (
					<div className="stat-grid" data-testid="kb-detail-summary">
						<div className="stat">
							<div className="stat-label">
								{t("sources.links", { count: summary.urls.total })}
							</div>
							<div className="stat-value">
								{summary.urls.indexed}/{summary.urls.total}
							</div>
						</div>
						<div className="stat">
							<div className="stat-label">
								{t("sources.fileItems", { count: summary.files.total })}
							</div>
							<div className="stat-value">
								{summary.files.ready}/{summary.files.total}
							</div>
						</div>
					</div>
				)}

				{/*
				 * The two source panels are composed here. Both read `kbId` from the
				 * route via `useParams` and talk only to the kb-scoped API.
				 */}
				<div className="kb-source-panels">
					<URLManagement />
					<FileUploadManagement />
					{/*
					 * Curated Q&A (#39) lives on the KB, not the agent: a pair is embedded
					 * into the KB's own `qa_<hex>` collection and needs no reindex.
					 */}
					<QaManagement kbId={kbId} />
				</div>
			</div>
		</AdminLayout>
	);
}
