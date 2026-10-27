"use client";

import { useNavigate, useParams } from "react-router-dom";
import AdminLayout from "../components/AdminLayout";
import { useState, useEffect, useRef } from "react";
import { api } from "../services/api";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "../hooks/useMediaQuery";

interface QuickAction {
	titleKey: string;
	descriptionKey: string;
	path: string;
	/**
	 * `agent` actions stay inside `/agents/:agentId`; `sources` actions belong to
	 * the bound knowledge base and are resolved in `resolveActionPath`.
	 */
	scope: "agent" | "sources";
	icon: JSX.Element;
}

const quickActionsConfig: QuickAction[] = [
	{
		titleKey: "navigation.playground",
		descriptionKey: "labels.testAiEffect",
		path: "/playground",
		scope: "agent",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				aria-hidden="true"
			>
				<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
			</svg>
		),
	},
	{
		titleKey: "navigation.fileManagement",
		descriptionKey: "labels.manageFiles",
		path: "/files",
		scope: "sources",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				aria-hidden="true"
			>
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
				<polyline points="14 2 14 8 20 8" />
			</svg>
		),
	},
	{
		titleKey: "navigation.urlKnowledge",
		descriptionKey: "labels.addWebKnowledge",
		path: "/urls",
		scope: "sources",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				aria-hidden="true"
			>
				<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
				<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
			</svg>
		),
	},
];

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

interface StatItem {
	id: string;
	label: string;
	value: string;
}

export default function Dashboard() {
	const { t } = useTranslation("common");
	const navigate = useNavigate();
	const { agentId: routeAgentId } = useParams<{ agentId?: string }>();
	const isMobile = useIsMobile();
	const agentIdCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const [quota, setQuota] = useState<QuotaState | null>(null);
	const [agentId, setAgentId] = useState<string | null>(null);
	const [agentName, setAgentName] = useState<string>("");
	const [kbId, setKbId] = useState<string | null>(null);
	const [activeSessionCount, setActiveSessionCount] = useState<number | null>(
		null,
	);
	const [agentIdCopied, setAgentIdCopied] = useState(false);

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
			setActiveSessionCount(
				typeof agent.active_session_count === "number"
					? agent.active_session_count
					: null,
			);
			const quotaData = await api.getQuota(agent.id);
			setQuota(quotaData);
		} catch (error) {
			console.error("Failed to load data:", error);
			navigate("/agents");
		}
	};

	/**
	 * Source quick actions land on the KB's source page. An unbound agent opens
	 * the KB list with the bind modal pre-selected for it.
	 */
	const resolveActionPath = (action: QuickAction): string => {
		if (action.scope === "sources") {
			if (kbId) return `/knowledge-bases/${kbId}`;
			if (agentId) return `/knowledge-bases?bindAgent=${encodeURIComponent(agentId)}`;
			return "/knowledge-bases";
		}
		return routeAgentId ? `/agents/${routeAgentId}${action.path}` : action.path;
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

	// Section 17 keeps exactly four statistics: API health, agent identity and
	// the two usage counters. Knowledge-base parameters are intentionally gone.
	const stats: StatItem[] = [
		{
			id: "api",
			label: t("labels.apiStatus"),
			value: t("labels.normalOperation"),
		},
		{
			id: "agent",
			label: t("labels.agentName"),
			value: agentName || NO_VALUE,
		},
		{
			id: "users",
			label: t("dashboard.userCount"),
			value: NO_VALUE,
		},
		{
			id: "sessions",
			label: t("dashboard.sessionCount"),
			value:
				typeof activeSessionCount === "number"
					? String(activeSessionCount)
					: NO_VALUE,
		},
	];

	return (
		<AdminLayout>
			<div
				className="admin-page"
				data-testid="dashboard-page"
				style={{
					padding: isMobile ? "var(--space-4)" : "var(--space-8)",
					margin: "0 auto",
					minWidth: 0,
				}}
			>
				<header className="page-header">
					<div>
						<h1 className="page-title">{t("navigation.dashboard")}</h1>
						{/*
						 * Spec §17 asks for no greeting paragraph, but
						 * tests/unit/Dashboard.agentScope.test.tsx asserts this exact
						 * string, so it is kept as a restrained secondary line instead
						 * of a gradient hero. See report: DEVIATION + BLOCKER.
						 */}
						<p
							style={{
								margin: "var(--space-1) 0 0",
								fontSize: "var(--text-sm)",
								color: "var(--color-text-muted)",
							}}
						>
							{t("labels.welcome", { agentName: agentName || t("appName") })}
						</p>
					</div>
				</header>

				<div
					data-testid="dashboard-stats"
					style={{
						display: "grid",
						gridTemplateColumns: isMobile
							? "1fr"
							: "repeat(auto-fit, minmax(200px, 1fr))",
						gap: "var(--space-4)",
						marginTop: isMobile ? "var(--space-6)" : "var(--space-8)",
					}}
				>
					{stats.map((stat) => (
						<div
							key={stat.id}
							className="stat"
							data-testid={`dashboard-stat-${stat.id}`}
						>
							<div className="stat-label">{stat.label}</div>
							<div
								className="stat-value"
								style={{
									fontVariantNumeric: "tabular-nums",
									marginTop: "var(--space-2)",
								}}
							>
								{stat.value}
							</div>
						</div>
					))}
				</div>

				<section
					className="card"
					data-testid="dashboard-status"
					style={{
						marginTop: isMobile ? "var(--space-6)" : "var(--space-8)",
						padding: "var(--space-5)",
						display: "flex",
						flexDirection: "column",
						gap: "var(--space-3)",
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "var(--space-3)",
							flexWrap: "wrap",
						}}
					>
						<span className="badge badge-success">
							{t("labels.normalOperation")}
						</span>
						<span
							style={{
								fontSize: "var(--text-sm)",
								color: "var(--color-text-secondary)",
							}}
						>
							{t("labels.systemStatus")}
						</span>
						<span
							style={{
								fontSize: "var(--text-sm)",
								color: "var(--color-text-muted)",
							}}
						>
							{t("status.configured")}
						</span>
					</div>

					{quota ? (
						<div
							className="mono"
							style={{
								fontSize: "var(--text-sm)",
								color: "var(--color-text-secondary)",
								fontVariantNumeric: "tabular-nums",
							}}
						>
							{`${t("labels.quotaInfo")}: ${quota.used_messages_today} / ${quota.max_messages_per_day} ${t("labels.messagesPerDay")}`}
						</div>
					) : (
						<div
							className="empty"
							style={{
								fontSize: "var(--text-sm)",
								color: "var(--color-text-muted)",
							}}
						>
							{t("labels.noData")}
						</div>
					)}

					{agentId && (
						<button
							type="button"
							className="mono"
							onClick={handleCopyAgentId}
							style={{
								display: "flex",
								alignItems: "center",
								gap: "var(--space-2)",
								minHeight: 44,
								padding: "0 var(--space-3)",
								borderRadius: "var(--radius-sm)",
								border: "1px solid var(--color-border)",
								background: "transparent",
								color: agentIdCopied
									? "var(--color-success)"
									: "var(--color-text-secondary)",
								fontSize: "var(--text-xs)",
								fontVariantNumeric: "tabular-nums",
								cursor: "pointer",
								textAlign: "left",
								overflowWrap: "anywhere",
								transition: "color var(--transition-fast)",
							}}
							title={agentIdCopied ? t("status.success") : t("buttons.copy")}
						>
							<span>{agentIdCopied ? t("status.success") : t("buttons.copy")}</span>
							<span>{agentId}</span>
						</button>
					)}
				</section>

				<section
					style={{
						marginTop: isMobile ? "var(--space-6)" : "var(--space-8)",
					}}
				>
					<h2
						style={{
							margin: "0 0 var(--space-4)",
							fontSize: "var(--text-base)",
							fontWeight: 500,
							color: "var(--color-text-primary)",
						}}
					>
						{t("labels.quickStart")}
					</h2>
					<div
						style={{
							display: "grid",
							gridTemplateColumns: isMobile
								? "1fr"
								: "repeat(auto-fit, minmax(240px, 1fr))",
							gap: "var(--space-3)",
						}}
					>
						{quickActionsConfig.map((action) => (
							<button
								key={action.path}
								type="button"
								onClick={() => navigate(resolveActionPath(action))}
								className="card"
								style={{
									display: "flex",
									alignItems: "center",
									gap: "var(--space-3)",
									minHeight: 44,
									padding: "var(--space-4)",
									cursor: "pointer",
									textAlign: "left",
									color: "var(--color-text-primary)",
									width: "100%",
								}}
							>
								<span
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										color: "var(--color-text-muted)",
										flexShrink: 0,
									}}
								>
									{action.icon}
								</span>
								<span
									style={{
										display: "flex",
										flexDirection: "column",
										gap: "var(--space-1)",
										minWidth: 0,
									}}
								>
									<span
										style={{
											fontSize: "var(--text-sm)",
											fontWeight: 500,
										}}
									>
										{t(action.titleKey)}
									</span>
									<span
										style={{
											fontSize: "var(--text-xs)",
											color: "var(--color-text-muted)",
										}}
									>
										{t(action.descriptionKey)}
									</span>
								</span>
							</button>
						))}
					</div>
				</section>
			</div>
		</AdminLayout>
	);
}
