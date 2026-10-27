"use client";

import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AdminLayout from "../components/AdminLayout";
import { api } from "../services/api";

/**
 * Resolves an agent's knowledge base for the agent-scoped knowledge routes
 * (spec §13). One component serves three routes:
 *
 *  - `/agents/:agentId/knowledge` — the sidebar 知识库 entry. Bound: forwards to
 *    `/knowledge-bases/:kbId` (source management). Unbound: renders an inline
 *    bind prompt whose primary action navigates to
 *    `/knowledge-bases?bindAgent=<id>`, which opens the bind sheet for that
 *    agent (see `KnowledgeBases.tsx`). It must NOT silently bounce the operator
 *    to the KB list.
 *  - `/agents/:agentId/urls` and `/agents/:agentId/files` — legacy bookmarks,
 *    not navigation. Both keep the plain redirect, bound or unbound.
 */
export default function KnowledgeBaseSetup() {
	const { t } = useTranslation("common");
	const navigate = useNavigate();
	const location = useLocation();
	const { agentId } = useParams<{ agentId?: string }>();
	const [error, setError] = useState<string | null>(null);
	const [needsBinding, setNeedsBinding] = useState(false);

	// Only the `.../knowledge` route renders the prompt; the legacy source
	// routes stay redirect-only so old bookmarks keep their old behaviour.
	const isPromptRoute = /\/knowledge\/?$/.test(location.pathname);

	useEffect(() => {
		let cancelled = false;

		const resolve = async () => {
			if (!agentId) {
				navigate("/knowledge-bases", { replace: true });
				return;
			}
			try {
				const status = await api.kbStatus(agentId);
				if (cancelled) return;
				if (status.kb_id) {
					navigate(`/knowledge-bases/${status.kb_id}`, { replace: true });
				} else if (isPromptRoute) {
					setNeedsBinding(true);
				} else {
					navigate(
						`/knowledge-bases?bindAgent=${encodeURIComponent(agentId)}`,
						{ replace: true },
					);
				}
			} catch (err) {
				if (cancelled) return;
				setError(
					err instanceof Error
						? err.message
						: t("knowledgeBases.errors.loadFailed"),
				);
			}
		};

		void resolve();
		return () => {
			cancelled = true;
		};
	}, [agentId, isPromptRoute, navigate, t]);

	const bindHref = agentId
		? `/knowledge-bases?bindAgent=${encodeURIComponent(agentId)}`
		: "/knowledge-bases";

	return (
		<AdminLayout>
			<div className="admin-page" data-testid="kb-setup-page">
				<header className="page-header">
					<h1 className="page-title">{t("navigation.knowledge")}</h1>
				</header>

				{error ? (
					<div className="empty" role="alert">
						<p className="empty-description" style={{ color: "var(--color-error)" }}>
							{error}
						</p>
						<div className="empty-actions">
							<button
								type="button"
								className="btn btn-secondary"
								onClick={() => {
									setError(null);
									setNeedsBinding(false);
									navigate("/knowledge-bases", { replace: true });
								}}
							>
								{t("knowledgeBases.title")}
							</button>
						</div>
					</div>
				) : needsBinding ? (
					<div className="empty" data-testid="kb-bind-prompt">
						<h2 className="empty-title">{t("kb.bindPromptTitle")}</h2>
						<p className="empty-description">{t("kb.bindPromptDescription")}</p>
						<div className="empty-actions">
							<Link
								to={bindHref}
								className="btn btn-primary"
								data-testid="kb-bind-prompt-action"
							>
								{t("kb.bindPromptAction")}
							</Link>
						</div>
					</div>
				) : (
					<div
						data-testid="kb-setup-loading"
						style={{ display: "grid", gap: "var(--space-3)" }}
					>
						<div className="skeleton" style={{ height: 96 }} />
						<div className="skeleton skeleton-text" style={{ width: "60%" }} />
					</div>
				)}
			</div>
		</AdminLayout>
	);
}
