"use client";

import { Link, useNavigate, useParams } from "react-router-dom";
import AdminLayout from "../components/AdminLayout";
import KbBindSheet from "../components/KbBindSheet";
import { Icon } from "../components/Icon";
import { useState, useEffect, useRef } from "react";
import { api } from "../services/api";
import { useTranslation } from "react-i18next";

interface QuotaState {
	used_urls: number;
	max_urls: number;
	used_files: number;
	max_files: number;
	used_messages_today: number;
	max_messages_per_day: number;
}

/**
 * Placeholder for statistics the API cannot currently supply. It is a
 * typographic symbol, not translatable copy: it must never be replaced with a
 * fabricated number.
 */
const NO_VALUE = "—";

export default function Dashboard() {
	const { t } = useTranslation("common");
	const navigate = useNavigate();
	const { agentId: routeAgentId } = useParams<{ agentId?: string }>();
	const agentIdCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const [quota, setQuota] = useState<QuotaState | null>(null);
	const [agentId, setAgentId] = useState<string | null>(null);
	const [agentName, setAgentName] = useState<string>("");
	const [apiKeySet, setApiKeySet] = useState(false);
	const [activeSessionCount, setActiveSessionCount] = useState<number | null>(
		null,
	);
	const [visitorCount, setVisitorCount] = useState<number | null>(null);
	const [agentIdCopied, setAgentIdCopied] = useState(false);
	const [kbId, setKbId] = useState<string | null>(null);
	const [kbName, setKbName] = useState<string | null>(null);
	const [bindOpen, setBindOpen] = useState(false);

	useEffect(() => {
		loadData();
	}, []);

	const loadData = async () => {
		try {
			if (!routeAgentId) {
				navigate("/");
				return;
			}
			const agent = await api.getAgent(routeAgentId);
			setAgentId(agent.id);
			setAgentName(agent.name);
			setKbId(agent.kb_id ?? null);
			setKbName(agent.kb_name ?? null);
			setApiKeySet(agent.api_key_set === true);
			setActiveSessionCount(
				typeof agent.active_session_count === "number"
					? agent.active_session_count
					: null,
			);
			// Absent on an older payload: render NO_VALUE rather than invent a 0.
			setVisitorCount(
				typeof agent.visitor_count === "number" ? agent.visitor_count : null,
			);
			const quotaData = await api.getQuota(agent.id);
			setQuota(quotaData);
		} catch (error) {
			console.error("Failed to load data:", error);
			navigate("/agents");
		}
	};

	const handleCopyAgentId = async () => {
		if (!agentId) return;
		try {
			await navigator.clipboard.writeText(agentId);
		} catch {
			const textArea = document.createElement("textarea");
			textArea.value = agentId;
			document.body.appendChild(textArea);
			textArea.select();
			document.execCommand("copy");
			document.body.removeChild(textArea);
		}
		setAgentIdCopied(true);
		if (agentIdCopiedTimerRef.current)
			clearTimeout(agentIdCopiedTimerRef.current);
		agentIdCopiedTimerRef.current = setTimeout(
			() => setAgentIdCopied(false),
			2000,
		);
	};

	useEffect(() => {
		return () => {
			if (agentIdCopiedTimerRef.current)
				clearTimeout(agentIdCopiedTimerRef.current);
		};
	}, []);

	return (
		<AdminLayout>
			<div className="admin-page" data-testid="dashboard-page">
				<header className="page-header">
					<div>
						<h1 className="page-title">{t("navigation.dashboard")}</h1>
					</div>
				</header>

				{/* Usage counters only: two large numbers, not six equal cards. */}
				<div className="stat-grid" data-testid="dashboard-stats">
					<div className="stat" data-testid="dashboard-stat-user">
						<div className="stat-label">{t("dashboard.userCount")}</div>
						<div className="stat-value">
							{visitorCount === null ? NO_VALUE : visitorCount}
						</div>
					</div>
					<div className="stat" data-testid="dashboard-stat-session">
						<div className="stat-label">{t("dashboard.sessionCount")}</div>
						<div className="stat-value">
							{activeSessionCount === null ? NO_VALUE : activeSessionCount}
						</div>
					</div>
				</div>

				{/* Status and identity: a definition list, not a card per fact. */}
				<dl className="identity-list" data-testid="dashboard-identity">
					<div className="identity-row">
						<dt className="identity-label">{t("labels.apiStatus")}</dt>
						<dd className="identity-value">
							<span className="badge badge-success">
								{t("labels.normalOperation")}
							</span>
						</dd>
					</div>
					<div className="identity-row">
						<dt className="identity-label">{t("labels.apiKey")}</dt>
						<dd className="identity-value">
							<span
								className={
									apiKeySet ? "badge badge-success" : "badge badge-neutral"
								}
							>
								{apiKeySet
									? t("labels.configured")
									: t("labels.notConfigured")}
							</span>
						</dd>
					</div>
					<div className="identity-row">
						<dt className="identity-label">{t("labels.agentName")}</dt>
						<dd className="identity-value">{agentName || NO_VALUE}</dd>
					</div>
					<div className="identity-row">
						<dt className="identity-label">{t("labels.agentId")}</dt>
						<dd className="identity-value">
							{agentId ? (
								<span className="identity-id">
									<span className="mono" data-testid="dashboard-agent-id">
										{agentId}
									</span>
									<button
										type="button"
										className="btn btn-icon"
										data-testid="dashboard-agent-id-copy"
										onClick={handleCopyAgentId}
										aria-label={t("buttons.copy")}
										title={agentIdCopied ? t("status.success") : t("buttons.copy")}
									>
										<Icon name={agentIdCopied ? "check" : "copy"} size={16} />
									</button>
								</span>
							) : (
								NO_VALUE
							)}
						</dd>
					</div>
					{/* R3: the knowledge base is part of the agent's identity, with the
					 * name as a link to its source page. Rebinding is deliberately absent
					 * here (#30): the binding is changed from the agent or the KB list. */}
					<div className="identity-row" data-testid="dashboard-kb-row">
						<dt className="identity-label">
							{kbId
								? t("dashboard.boundKnowledgeBase")
								: t("dashboard.unboundKnowledgeBase")}
						</dt>
						<dd className="identity-value">
							{kbId ? (
								<span className="identity-actions">
									<Link
										to={`/knowledge-bases/${kbId}`}
										data-testid="dashboard-kb-link"
									>
										{kbName || kbId}
									</Link>
								</span>
							) : (
								<span className="identity-actions">
									<button
										type="button"
										className="btn btn-secondary"
										data-testid="dashboard-kb-bind"
										onClick={() => setBindOpen(true)}
									>
										{t("dashboard.bindExisting")}
									</button>
									<Link
										className="btn btn-primary"
										to={`/knowledge-bases?bindAgent=${routeAgentId ?? ""}`}
										data-testid="dashboard-kb-create"
									>
										{t("dashboard.createKnowledgeBase")}
									</Link>
								</span>
							)}
						</dd>
					</div>
				</dl>

				{quota && (
					<p
						className="mono"
						data-testid="dashboard-quota"
						style={{
							margin: "var(--space-4) 0 0",
							fontSize: "var(--text-sm)",
							color: "var(--fg-dim)",
						}}
					>
						{`${t("labels.quotaInfo")}: ${quota.used_messages_today} / ${quota.max_messages_per_day} ${t("labels.messagesPerDay")}`}
					</p>
				)}
			</div>

			{bindOpen && routeAgentId && (
				<KbBindSheet
					agentId={routeAgentId}
					onClose={() => setBindOpen(false)}
					onBound={() => {
						setBindOpen(false);
						void loadData();
					}}
				/>
			)}
		</AdminLayout>
	);
}
