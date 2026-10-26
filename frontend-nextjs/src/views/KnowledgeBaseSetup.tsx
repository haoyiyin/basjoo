"use client";

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AdminLayout from "../components/AdminLayout";
import { api } from "../services/api";

/**
 * Redirect-only view for the legacy agent-scoped knowledge routes
 * (`/agents/:agentId/knowledge`, `/urls`, `/files`).
 *
 * Source management lives on `/knowledge-bases/:kbId`, so this resolves the
 * agent's bound KB and forwards there. An unbound agent lands on the KB list
 * with `?bindAgent=<agentId>`, which opens the bind modal for that agent.
 */
export default function KnowledgeBaseSetup() {
	const { t } = useTranslation("common");
	const navigate = useNavigate();
	const { agentId } = useParams<{ agentId?: string }>();
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		const redirect = async () => {
			if (!agentId) {
				navigate("/knowledge-bases", { replace: true });
				return;
			}
			try {
				const status = await api.kbStatus(agentId);
				if (cancelled) return;
				if (status.kb_id) {
					navigate(`/knowledge-bases/${status.kb_id}`, { replace: true });
				} else {
					navigate(
						`/knowledge-bases?bindAgent=${encodeURIComponent(agentId)}`,
						{ replace: true },
					);
				}
			} catch (err) {
				if (cancelled) return;
				setError(
					err instanceof Error ? err.message : t("knowledgeBases.errors.loadFailed"),
				);
			}
		};

		void redirect();
		return () => {
			cancelled = true;
		};
	}, [agentId, navigate, t]);

	return (
		<AdminLayout>
			<div
				style={{
					padding: "var(--space-8)",
					maxWidth: "720px",
					margin: "0 auto",
					textAlign: "center",
				}}
			>
				{error ? (
					<>
						<p role="alert" style={{ color: "var(--color-error)" }}>
							{error}
						</p>
						<button
							type="button"
							className="btn-secondary"
							style={{ minHeight: "44px" }}
							onClick={() => navigate("/knowledge-bases", { replace: true })}
						>
							{t("knowledgeBases.title")}
						</button>
					</>
				) : (
					<div className="spinner" style={{ margin: "0 auto" }} />
				)}
			</div>
		</AdminLayout>
	);
}
