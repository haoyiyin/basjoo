"use client";

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AdminLayout from "../components/AdminLayout";
import { api } from "../services/api";

/** `null` means "not answered yet" — never render a fabricated number. */
type Count = number | null;

/**
 * Workspace home.
 *
 * One line of orientation and nothing else: how many agents and knowledge bases
 * exist, and whether the API answers. Every figure links to the list that owns
 * it, so the page stays a signpost and never becomes a second dashboard — the
 * agent dashboard already carries the real usage statistics.
 */
export default function Home() {
	const { t } = useTranslation("common");
	const [agents, setAgents] = useState<Count>(null);
	const [knowledgeBases, setKnowledgeBases] = useState<Count>(null);
	const [apiOk, setApiOk] = useState<boolean | null>(null);

	useEffect(() => {
		let cancelled = false;

		const load = async () => {
			// allSettled, not all: one failing endpoint must not blank the other
			// two figures, so each settles on its own.
			const [agentsResult, kbResult, healthResult] = await Promise.allSettled([
				api.listAgents(),
				api.listKnowledgeBases(),
				api.checkHealth(),
			]);
			if (cancelled) return;

			if (agentsResult.status === "fulfilled") {
				setAgents(agentsResult.value.total);
			}
			if (kbResult.status === "fulfilled") {
				setKnowledgeBases(kbResult.value.total);
			}
			setApiOk(
				healthResult.status === "fulfilled" &&
					// The backend answers `{"status":"healthy"}`; anything 2xx
					// that is not explicitly unhealthy counts as up, because a
					// failure surfaces as a rejected promise, not as a body.
					healthResult.value.status !== "unhealthy",
			);
		};

		void load();
		return () => {
			cancelled = true;
		};
	}, []);

	const figure = (value: Count) => (value === null ? "—" : value);

	return (
		<AdminLayout>
			<div className="admin-page" data-testid="home-page">
				<header className="page-header">
					<h1 className="page-title">{t("home.title")}</h1>
				</header>

				<div className="stat-grid" data-testid="home-overview">
					<Link className="stat stat-link" to="/agents">
						<span className="stat-label">{t("home.agentsCount")}</span>
						<span className="stat-value">{figure(agents)}</span>
					</Link>
					<Link className="stat stat-link" to="/knowledge-bases">
						<span className="stat-label">{t("home.knowledgeCount")}</span>
						<span className="stat-value">{figure(knowledgeBases)}</span>
					</Link>
					<div className="stat" data-testid="home-api-status">
						<span className="stat-label">{t("home.apiStatus")}</span>
						<span className="stat-value stat-value-badge">
							{apiOk === null ? (
								"—"
							) : apiOk ? (
								<span className="badge badge-success">
									{t("labels.normalOperation")}
								</span>
							) : (
								<span className="badge badge-error">
									{t("labels.apiConnectionFailed")}
								</span>
							)}
						</span>
					</div>
				</div>
			</div>
		</AdminLayout>
	);
}
