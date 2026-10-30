"use client";

import { Link, useNavigate, useParams } from "react-router-dom";
import AdminLayout from "../components/AdminLayout";
import KbBindSheet from "../components/KbBindSheet";
import { Icon } from "../components/Icon";
import { useState, useEffect, useRef } from "react";
import { api } from "../services/api";
import type {
	AnalyticsOverview,
	AnalyticsRange,
	AnalyticsTile,
} from "../services/api";
import { useTranslation } from "react-i18next";

/**
 * Placeholder for statistics the API cannot currently supply. It is a
 * typographic symbol, not translatable copy: it must never be replaced with a
 * fabricated number.
 */
const NO_VALUE = "—";

/** The ranges the console offers, and how many days each one covers. */
const RANGES: Array<{ key: AnalyticsRange; days: number }> = [
	{ key: "24h", days: 1 },
	{ key: "7d", days: 7 },
	{ key: "30d", days: 30 },
	{ key: "90d", days: 90 },
];

/**
 * Metrics where "more" is worse. The delta is coloured by meaning, not by sign:
 * a rise in unanswered questions is not good news, and a dashboard that paints
 * every upward line green teaches the operator to ignore the colour.
 */
const LOWER_IS_BETTER = new Set<keyof AnalyticsOverview["tiles"]>([
	"unanswered",
	"negative_feedback",
	"handoffs",
]);

/**
 * One tile's delta, in the operator's words.
 *
 * The three zero-previous cases are all distinct and all handled here, because
 * this is the only place the payload's numbers become text: `pct` prints a
 * signed percentage, `new` says the metric did not exist in the comparison
 * window, and `none` says it did not move. None of them can print `NaN` or
 * `Infinity`, because `delta_pct` is `null` in the last two cases.
 */
function deltaText(
	tile: AnalyticsTile | undefined,
	t: (key: string, options?: Record<string, unknown>) => string,
): string {
	if (!tile) return NO_VALUE;
	if (tile.delta_kind === "new") return t("analytics.deltaNew");
	if (tile.delta_kind === "none") return t("analytics.deltaNone");
	if (tile.delta_pct === null || !Number.isFinite(tile.delta_pct)) {
		return NO_VALUE;
	}
	const rounded = Math.abs(tile.delta_pct).toFixed(1).replace(/\.0$/, "");
	if (tile.delta_pct === 0) return t("analytics.deltaNone");
	return tile.delta_pct > 0
		? t("analytics.deltaUp", { value: rounded })
		: t("analytics.deltaDown", { value: rounded });
}

/**
 * The comparison window in words; the payload owns the wording when it can.
 *
 * The fallback is only used before the payload arrives (or after it failed), so
 * it carries a singular key of its own: "vs the previous 1 days" is the kind of
 * detail that makes an operator distrust every other number on the page.
 */
function windowText(
	overview: AnalyticsOverview | null,
	days: number,
	t: (key: string, options?: Record<string, unknown>) => string,
): string {
	if (overview?.window?.label) return overview.window.label;
	return days === 1
		? t("analytics.windowFallbackOne")
		: t("analytics.windowFallback", { days });
}

/**
 * The secondary tiles, in reading order. The three primary tiles (visitors,
 * sessions, unanswered) are written out because the unanswered one is a link
 * into #42's queue; these are rendered from a list because they differ only in
 * their metric name.
 */
const SECONDARY_TILES: Array<{
	name: keyof AnalyticsOverview["tiles"];
	label: string;
}> = [
	{ name: "messages", label: "analytics.metrics.messages" },
	{ name: "leads", label: "analytics.metrics.leads" },
	{ name: "handoffs", label: "analytics.metrics.handoffs" },
	{ name: "negative_feedback", label: "analytics.metrics.negativeFeedback" },
	{ name: "positive_feedback_rate", label: "analytics.metrics.positiveRate" },
];

/** Metrics whose value is a 0..1 ratio and must be read as a percentage. */
const RATIO_TILES = new Set<string>(["positive_feedback_rate"]);

/** A metric's value as the operator reads it — never `NaN`, never a blank. */
function tileValue(tile: AnalyticsTile | undefined, name: string): string {
	if (!tile || typeof tile.value !== "number" || !Number.isFinite(tile.value)) {
		return NO_VALUE;
	}
	if (RATIO_TILES.has(name)) return `${Math.round(tile.value * 100)}%`;
	return tile.value.toLocaleString();
}

/**
 * `is-better` / `is-worse` / `is-flat`, from the metric's meaning.
 *
 * A rise in unanswered questions is bad news; a rise in resolved conversations
 * is good. The colour therefore follows the metric, not the arithmetic sign —
 * otherwise the dashboard teaches the operator that green means "went up".
 */
function deltaTone(
	tile: AnalyticsTile | undefined,
	name: keyof AnalyticsOverview["tiles"],
): string {
	if (!tile || tile.delta_kind !== "pct" || tile.delta_pct === null) {
		return "is-flat";
	}
	if (tile.delta_pct === 0) return "is-flat";
	const rising = tile.delta_pct > 0;
	const improving = LOWER_IS_BETTER.has(name) ? !rising : rising;
	return improving ? "is-better" : "is-worse";
}

const OUTCOME_ROWS: Array<{ key: string; label: string }> = [
	{ key: "resolved", label: "analytics.outcomes.resolved" },
	{ key: "abandoned", label: "analytics.outcomes.abandoned" },
	{ key: "escalated", label: "analytics.outcomes.escalated" },
	{ key: "no-answer", label: "analytics.outcomes.noAnswer" },
];

export default function Dashboard() {
	const { t } = useTranslation("common");
	const navigate = useNavigate();
	const { agentId: routeAgentId } = useParams<{ agentId?: string }>();
	const agentIdCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const [agentId, setAgentId] = useState<string | null>(null);
	const [agentName, setAgentName] = useState<string>("");
	const [apiKeySet, setApiKeySet] = useState(false);
	const [activeSessionCount, setActiveSessionCount] = useState<number | null>(
		null,
	);
	const [visitorCount, setVisitorCount] = useState<number | null>(null);
	// #42: unanswered questions in the last 7 days. The analytics endpoint is
	// workstream 6's; until it lands this is one dedicated call to the triage
	// queue's own `total`, so no counter column exists either way.
	const [unansweredCount, setUnansweredCount] = useState<number | null>(null);
	// #45: the analytics payload behind the tiles, the outcome split, the top
	// unanswered list and the export link. One request, so every number on the
	// page describes the same window.
	const [range, setRange] = useState<AnalyticsRange>("7d");
	const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
	const [overviewLoading, setOverviewLoading] = useState(true);
	const [overviewError, setOverviewError] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [agentIdCopied, setAgentIdCopied] = useState(false);
	const [kbId, setKbId] = useState<string | null>(null);
	const [kbName, setKbName] = useState<string | null>(null);
	const [bindOpen, setBindOpen] = useState(false);

	useEffect(() => {
		loadData();
	}, []);

	useEffect(() => {
		if (!routeAgentId) return;
		void loadOverview(routeAgentId, range);
	}, [routeAgentId, range]);

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
		} catch (error) {
			console.error("Failed to load data:", error);
			navigate("/agents");
			return;
		}
		// Independent of the identity block: a missing quality signal must
		// never send the operator to /agents.
		await loadUnanswered(routeAgentId);
	};

	/**
	 * #45: the window's tiles, outcome split and top unanswered questions.
	 * Failure is a rendered state, not a redirect: the rest of the dashboard
	 * still loads when the analytics query fails.
	 */
	const loadOverview = async (agentIdValue: string, rangeKey: AnalyticsRange) => {
		setOverviewLoading(true);
		try {
			const result = await api.getAnalyticsOverview({
				agent_id: agentIdValue,
				range: rangeKey,
			});
			setOverview(result);
			setOverviewError(false);
		} catch (error) {
			console.error("Failed to load analytics:", error);
			setOverview(null);
			setOverviewError(true);
		} finally {
			setOverviewLoading(false);
		}
	};

	/**
	 * #42's stat: how many answers in the last 7 days did not really answer.
	 * The analytics endpoint (workstream 6) will own this number; until then the
	 * triage queue's own `total` is the same count from the same rows, so no
	 * counter column is introduced.
	 */
	const loadUnanswered = async (agentIdValue: string) => {
		const since = new Date(
			Date.now() - 7 * 24 * 60 * 60 * 1000,
		).toISOString();
		try {
			const result = await api.getUnanswered({
				agent_id: agentIdValue,
				since,
				limit: 1,
			});
			setUnansweredCount(result.total);
		} catch (error) {
			console.error("Failed to load unanswered count:", error);
			setUnansweredCount(null);
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

	/**
	 * #45: download the CSV for exactly the filters on screen.
	 *
	 * The same `range` and `agent_id` go to the export route as to the tile
	 * query, so the file always describes the numbers the operator is looking
	 * at — an export that silently used a default window would be a report about
	 * a period nobody asked for.
	 */
	const handleExport = async () => {
		if (!routeAgentId) return;
		setExporting(true);
		try {
			const { blob, filename } = await api.exportStatsCsv({
				agent_id: routeAgentId,
				range,
			});
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = filename;
			document.body.appendChild(anchor);
			anchor.click();
			document.body.removeChild(anchor);
			// Revoking immediately after click is safe (the navigation has
			// already started) and keeps a long session from leaking blobs.
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error("Failed to export stats:", error);
		} finally {
			setExporting(false);
		}
	};

	// Tones are resolved here, not inline, so the `className` templates carry no
	// string literal the design-system scan could mistake for a CSS class name.
	const userTone = deltaTone(overview?.tiles.visitors, "visitors");
	const sessionTone = deltaTone(overview?.tiles.sessions, "sessions");
	const unansweredTone = deltaTone(overview?.tiles.unanswered, "unanswered");
	// The number of days in the selected range, used only as the fallback when
	// the payload could not supply its own wording.
	const rangeDays = RANGES.find((option) => option.key === range)?.days ?? 7;
	const comparison = windowText(overview, rangeDays, t);

	return (
		<AdminLayout>
			<div className="admin-page" data-testid="dashboard-page">
				<header className="page-header">
					<div>
						<h1 className="page-title">{t("navigation.dashboard")}</h1>
						{/* The comparison window, in words, stated once above the tiles.
						 * The wording comes from the payload so the page, every tile and
						 * the exported header cannot describe different periods. */}
						<p className="page-subtitle" data-testid="dashboard-window">
							{comparison}
						</p>
					</div>
					<div className="page-actions">
						<label className="field-inline" htmlFor="dashboard-range">
							<span className="field-label">{t("analytics.rangeLabel")}</span>
							<select
								id="dashboard-range"
								className="select"
								data-testid="dashboard-range"
								value={range}
								onChange={(event) =>
									setRange(event.target.value as AnalyticsRange)
								}
							>
								{RANGES.map((option) => (
									<option key={option.key} value={option.key}>
										{t(`analytics.ranges.${option.key}`)}
									</option>
								))}
							</select>
						</label>
						<button
							type="button"
							className="btn btn-secondary"
							data-testid="dashboard-export"
							onClick={handleExport}
							disabled={exporting || overviewLoading}
						>
							{exporting ? t("analytics.exporting") : t("analytics.export")}
						</button>
					</div>
				</header>

				{/* Usage counters only: three large numbers, not six equal cards.
				 * Each carries its delta AND the window that delta was measured
				 * against, so "+12%" can never appear unlabelled. */}
				<div className="stat-grid" data-testid="dashboard-stats">
					<div className="stat" data-testid="dashboard-stat-user">
						<div className="stat-label">{t("dashboard.userCount")}</div>
						<div className="stat-value">
							{/* The value and its delta must describe the same number, so
							 * the window's own count wins and the agent's lifetime
							 * `visitor_count` is only the fallback for a failed query. */}
							{overview
								? tileValue(overview.tiles.visitors, "visitors")
								: visitorCount === null
									? NO_VALUE
									: visitorCount}
						</div>
						<div
							className={`stat-delta ${userTone}`}
							data-testid="dashboard-stat-user-delta"
						>
							{deltaText(overview?.tiles.visitors, t)}{" "}
							{comparison}
						</div>
					</div>
					<div className="stat" data-testid="dashboard-stat-session">
						<div className="stat-label">{t("dashboard.sessionCount")}</div>
						<div className="stat-value">
							{overview
								? tileValue(overview.tiles.sessions, "sessions")
								: activeSessionCount === null
									? NO_VALUE
									: activeSessionCount}
						</div>
						<div
							className={`stat-delta ${sessionTone}`}
							data-testid="dashboard-stat-session-delta"
						>
							{deltaText(overview?.tiles.sessions, t)}{" "}
							{comparison}
						</div>
					</div>
					{/* #42: the whole card is the link to the filtered session list, so
					 * the number is one click away from the rows that produced it. */}
					<Link
						className="stat stat-link"
						to={`/agents/${routeAgentId ?? ""}/sessions?unanswered=1`}
						data-testid="dashboard-stat-unanswered"
						title={t("unanswered.dashboardStatHint")}
					>
						<div className="stat-label">{t("unanswered.dashboardStat")}</div>
						<div className="stat-value">
							{overview
								? tileValue(overview.tiles.unanswered, "unanswered")
								: unansweredCount === null
									? NO_VALUE
									: unansweredCount}
						</div>
						<div
							className={`stat-delta ${unansweredTone}`}
							data-testid="dashboard-stat-unanswered-delta"
						>
							{deltaText(overview?.tiles.unanswered, t)}{" "}
							{comparison}
						</div>
					</Link>
				</div>

				{/* Loading / failure / content. A failed analytics query leaves the
				 * rest of the page intact and says so, rather than blanking it. */}
				{overviewLoading && !overview && (
					<p className="field-hint" data-testid="dashboard-analytics-loading">
						{t("analytics.loading")}
					</p>
				)}
				{overviewError && !overviewLoading && (
					<p className="field-hint" data-testid="dashboard-analytics-error">
						{t("analytics.loadError")}
					</p>
				)}

				{overview && (
					<>
						<h2 className="card-title" data-testid="dashboard-metrics-title">
							{t("analytics.metricsTitle", { label: comparison })}
						</h2>
						<div className="stat-grid" data-testid="dashboard-metrics">
							{SECONDARY_TILES.map(({ name, label }) => {
								const tile = overview.tiles[name];
								return (
									<div
										className="stat"
										key={name}
										data-testid={`dashboard-metric-${name}`}
									>
										<div className="stat-label">{t(label)}</div>
										<div className="stat-value">{tileValue(tile, name)}</div>
										{/* The delta and its window are one line: a percentage
										 * without the period it was measured over is the bug the
										 * issue names, so they are never rendered apart. */}
										<div className={`stat-delta ${deltaTone(tile, name)}`}>
											{deltaText(tile, t)} {comparison}
										</div>
									</div>
								);
							})}
						</div>

						{/* What actually happened in those conversations — the async
						 * classifier's verdict, not a second guess. */}
						<h2 className="card-title" data-testid="dashboard-outcomes-title">
							{t("analytics.outcomesTitle")}
						</h2>
						{overview.outcome_split.classified === 0 ? (
							<div className="empty" data-testid="dashboard-outcomes-empty">
								<p className="empty-title">{t("analytics.outcomesEmptyTitle")}</p>
								<p className="empty-description">
									{t("analytics.outcomesEmptyDescription")}
								</p>
							</div>
						) : (
							<ul className="list" data-testid="dashboard-outcomes">
								{OUTCOME_ROWS.map(({ key, label }) => {
									const counts: Record<string, number> = {
										resolved: overview.outcome_split.resolved,
										abandoned: overview.outcome_split.abandoned,
										escalated: overview.outcome_split.escalated,
										"no-answer": overview.outcome_split["no-answer"],
									};
									const count = counts[key] ?? 0;
									const total = overview.outcome_split.classified || 1;
									return (
										<li className="list-row" key={key} data-testid={`dashboard-outcome-${key}`}>
											<div className="list-row-main">
												<span className="list-row-title">{t(label)}</span>
											</div>
											<div className="list-row-meta">
												<span>{String(count)}</span>
												<span>{Math.round((count / total) * 100)}%</span>
											</div>
										</li>
									);
								})}
								{overview.outcome_split.unclassified > 0 && (
									<li className="list-row" data-testid="dashboard-outcome-unclassified">
										<div className="list-row-main">
											<span className="list-row-title">
												{t("analytics.outcomes.unclassified")}
											</span>
										</div>
										<div className="list-row-meta">
											<span>{overview.outcome_split.unclassified}</span>
										</div>
									</li>
								)}
							</ul>
						)}

						{/* "What to do next": the questions this agent could not answer,
						 * each a click into #42's queue. The list is a pointer, not a
						 * second implementation of the triage flow. */}
						<h2 className="card-title" data-testid="dashboard-top-unanswered-title">
							{t("analytics.topUnansweredTitle")}
						</h2>
						{overview.top_unanswered.length === 0 ? (
							<div className="empty" data-testid="dashboard-top-unanswered-empty">
								<p className="empty-title">{t("analytics.topUnansweredEmptyTitle")}</p>
								<p className="empty-description">
									{t("analytics.topUnansweredEmptyDescription")}
								</p>
							</div>
						) : (
							<>
								<ul className="list" data-testid="dashboard-top-unanswered">
									{overview.top_unanswered.map((item, index) => (
										<li
											className="list-row"
											key={`${item.message_id ?? index}`}
											data-testid={`dashboard-top-unanswered-${index}`}
										>
											<div className="list-row-main">
												<span className="list-row-title">{item.question}</span>
											</div>
											<div className="list-row-meta">
												<span>
													{t("analytics.occurrences", {
														count: item.occurrences,
													})}
												</span>
											</div>
										</li>
									))}
								</ul>
								<div className="page-actions page-actions-start">
									<Link
										className="btn btn-secondary"
										to={`/agents/${routeAgentId ?? ""}/sessions?unanswered=1`}
										data-testid="dashboard-top-unanswered-link"
									>
										{t("analytics.topUnansweredAction")}
									</Link>
								</div>
							</>
						)}
					</>
				)}

				{/* Status and identity: a definition list, not a card per fact. The
				 * heading carries the same accent tick as every other section on
				 * the shell, so the dashboard's lower half is a titled section
				 * rather than an unlabelled block under two cards. */}
				<h2 className="card-title" data-testid="dashboard-identity-title">
					{t("dashboard.agentInfo")}
				</h2>
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
										className="btn btn-secondary btn-icon"
										data-testid="dashboard-kb-bind"
										aria-label={t("dashboard.bindExisting")}
										title={t("dashboard.bindExisting")}
										onClick={() => setBindOpen(true)}
									>
										<Icon name="link" size={16} />
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
