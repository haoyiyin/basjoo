"use client";

import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AdminLayout from "../components/AdminLayout";
import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../services/api";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "../hooks/useMediaQuery";

interface QuickAction {
	titleKey: string;
	descriptionKey: string;
	path: string;
	icon: JSX.Element;
	gradient: string;
	glowColor: string;
}

const quickActionsConfig: QuickAction[] = [
	{
		titleKey: "navigation.playground",
		descriptionKey: "labels.testAiEffect",
		path: "/playground",
		icon: (
			<svg
				width="24"
				height="24"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
			</svg>
		),
		gradient:
			"linear-gradient(135deg, hsl(188deg, 90%, 50%) 0%, hsl(188deg, 80%, 40%) 100%)",
		glowColor: "hsla(188deg, 90%, 50%, 0.25)",
	},
	{
		titleKey: "navigation.fileManagement",
		descriptionKey: "labels.manageFiles",
		path: "/files",
		icon: (
			<svg
				width="24"
				height="24"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
				<polyline points="14 2 14 8 20 8" />
			</svg>
		),
		gradient:
			"linear-gradient(135deg, hsl(265deg, 90%, 65%) 0%, hsl(265deg, 80%, 55%) 100%)",
		glowColor: "hsla(265deg, 90%, 65%, 0.25)",
	},
	{
		titleKey: "navigation.urlKnowledge",
		descriptionKey: "labels.addWebKnowledge",
		path: "/urls",
		icon: (
			<svg
				width="24"
				height="24"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
				<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
			</svg>
		),
		gradient:
			"linear-gradient(135deg, hsl(150deg, 80%, 45%) 0%, hsl(150deg, 70%, 35%) 100%)",
		glowColor: "hsla(150deg, 80%, 45%, 0.25)",
	},
];

/* Stat card with mouse-tracking gradient */
function StatCard({
	stat,
	idx,
	isMobile,
}: {
	stat: {
		label: string;
		value: string | number;
		indexed?: number;
		color: string;
		accentHue: number;
	};
	idx: number;
	isMobile: boolean;
}) {
	const cardRef = useRef<HTMLDivElement>(null);
	const [mousePos, setMousePos] = useState({ x: 50, y: 50 });

	const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
		if (!cardRef.current) return;
		const rect = cardRef.current.getBoundingClientRect();
		const x = ((e.clientX - rect.left) / rect.width) * 100;
		const y = ((e.clientY - rect.top) / rect.height) * 100;
		setMousePos({ x, y });
	}, []);

	return (
		<div
			ref={cardRef}
			onMouseMove={handleMouseMove}
			className="liquid-glass-card"
			style={{
				padding: isMobile ? "var(--space-5)" : "var(--space-6)",
				animation: "fadeIn 0.5s cubic-bezier(0.25, 1.1, 0.5, 1.15) forwards",
				animationDelay: `${idx * 0.1}s`,
				opacity: 0,
				position: "relative",
				overflow: "hidden",
				cursor: "default",
			}}
		>
			{/* Mouse-tracking aurora gradient */}
			<div
				style={{
					position: "absolute",
					inset: 0,
					background: `radial-gradient(circle at ${mousePos.x}% ${mousePos.y}%, hsla(${stat.accentHue}deg, 90%, 50%, 0.08) 0%, transparent 50%)`,
					transition: "background 0.3s ease",
					pointerEvents: "none",
				}}
			/>

			<div
				style={{
					fontSize: "var(--text-sm)",
					color: "var(--color-text-muted)",
					marginBottom: "var(--space-2)",
					textTransform: "uppercase",
					letterSpacing: "0.05em",
					position: "relative",
				}}
			>
				{stat.label}
			</div>
			<div
				style={{
					display: "flex",
					alignItems: "baseline",
					gap: "var(--space-2)",
					position: "relative",
				}}
			>
				<span
					style={{
						fontSize: "var(--text-3xl)",
						fontWeight: 700,
						color: stat.color,
						textShadow: `0 0 30px hsla(${stat.accentHue}deg, 90%, 50%, 0.3)`,
					}}
				>
					{stat.value}
				</span>
				{typeof stat.indexed === "number" && stat.indexed > 0 && (
					<span
						style={{
							fontSize: "var(--text-sm)",
							color: "var(--color-text-muted)",
						}}
					>
						({stat.indexed}{" "}
						{stat.label.includes("URL") || stat.label.includes("url")
							? "indexed"
							: "ready"}
						)
					</span>
				)}
			</div>
		</div>
	);
}

export default function Dashboard() {
	const { t } = useTranslation("common");
	const navigate = useNavigate();
	const { agentId: routeAgentId } = useParams<{ agentId?: string }>();
	const { admin } = useAuth();
	const isMobile = useIsMobile();
	const agentIdCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const [quota, setQuota] = useState<{
		used_urls: number;
		max_urls: number;
		used_files: number;
		max_files: number;
		used_messages_today: number;
		max_messages_per_day: number;
	} | null>(null);
	const [sourcesSummary, setSourcesSummary] = useState<{
		urls: { total: number; indexed: number; pending: number };
		files: { total: number; ready: number; processing: number };
		has_pending: boolean;
	} | null>(null);
	const [agentId, setAgentId] = useState<string | null>(null);
	const [agentName, setAgentName] = useState<string>("");
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
			const [quotaData, sourcesData] = await Promise.all([
				api.getQuota(agent.id),
				api.getSourcesSummary(agent.id),
			]);
			setQuota(quotaData);
			setSourcesSummary(sourcesData);
		} catch (error) {
			console.error("Failed to load data:", error);
			navigate("/agents");
		}
	};

	const getGreeting = () => {
		const hour = new Date().getHours();
		if (hour < 12) return t("time.goodMorning");
		if (hour < 18) return t("time.goodAfternoon");
		return t("time.goodEvening");
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

	const stats = [
		{
			label: t("labels.urlKnowledgeSource"),
			value: sourcesSummary?.urls.total ?? 0,
			indexed: sourcesSummary?.urls.indexed ?? 0,
			color: "var(--color-accent-primary)",
			accentHue: 188,
		},
		{
			label: t("labels.fileItems"),
			value: sourcesSummary?.files.total ?? 0,
			indexed: sourcesSummary?.files.ready ?? 0,
			color: "var(--color-accent-secondary)",
			accentHue: 265,
		},
		{
			label: t("labels.indexedDocBlocks"),
			value: sourcesSummary
				? sourcesSummary.urls.indexed + sourcesSummary.files.ready
				: "-",
			color: "var(--color-warning)",
			accentHue: 38,
		},
	];

	return (
		<AdminLayout>
			<div
				style={{
					padding: isMobile ? "var(--space-4)" : "var(--space-8)",
					maxWidth: "1400px",
					margin: "0 auto",
				}}
			>
				{/* Greeting header */}
				<header
					style={{
						marginBottom: isMobile ? "var(--space-6)" : "var(--space-10)",
						animation:
							"fadeIn 0.5s cubic-bezier(0.25, 1.1, 0.5, 1.15) forwards",
					}}
				>
					<h1
						style={{
							fontSize: isMobile ? "var(--text-2xl)" : "var(--text-4xl)",
							fontWeight: 700,
							marginBottom: "var(--space-2)",
							background: "var(--color-accent-gradient)",
							WebkitBackgroundClip: "text",
							backgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						{getGreeting()}，{admin?.name}
					</h1>
					<p
						style={{
							fontSize: isMobile ? "var(--text-base)" : "var(--text-lg)",
							color: "var(--color-text-secondary)",
						}}
					>
						{t("labels.welcome", { agentName: agentName || t("appName") })}
					</p>
				</header>

				{/* Stat cards */}
				<div
					className="responsive-grid-3"
					style={{
						display: "grid",
						gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
						gap: "var(--space-4)",
						marginBottom: isMobile ? "var(--space-6)" : "var(--space-10)",
					}}
				>
					{stats.map((stat, idx) => (
						<StatCard key={idx} stat={stat} idx={idx} isMobile={isMobile} />
					))}
				</div>

				{/* Quick actions */}
				<section
					style={{
						marginBottom: isMobile ? "var(--space-6)" : "var(--space-10)",
					}}
				>
					<h2
						style={{
							fontSize: isMobile ? "var(--text-lg)" : "var(--text-xl)",
							fontWeight: 600,
							marginBottom: "var(--space-6)",
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
								: "repeat(auto-fit, minmax(280px, 1fr))",
							gap: "var(--space-4)",
						}}
					>
						{quickActionsConfig.map((action, idx) => (
							<button
								key={action.path}
								onClick={() =>
									navigate(
										routeAgentId
											? `/agents/${routeAgentId}${action.path}`
											: action.path,
									)
								}
								className="liquid-glass-card"
								style={{
									display: "flex",
									alignItems: "flex-start",
									gap: "var(--space-4)",
									padding: "var(--space-6)",
									cursor: "pointer",
									textAlign: "left",
									animation:
										"fadeIn 0.5s cubic-bezier(0.25, 1.1, 0.5, 1.15) forwards",
									animationDelay: `${(idx + 4) * 0.1}s`,
									opacity: 0,
									width: "100%",
								}}
								onMouseEnter={(e) => {
									e.currentTarget.style.transform = "translateY(-4px)";
									e.currentTarget.style.boxShadow = `0 0 30px ${action.glowColor}, var(--shadow-lg)`;
									e.currentTarget.style.borderColor =
										"var(--color-border-hover)";
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.transform = "translateY(0)";
									e.currentTarget.style.boxShadow = "";
									e.currentTarget.style.borderColor = "";
								}}
							>
								<div
									style={{
										width: "48px",
										height: "48px",
										background: action.gradient,
										borderRadius: "var(--radius-md)",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										color: "white",
										flexShrink: 0,
										boxShadow: `0 0 20px ${action.glowColor}`,
									}}
								>
									{action.icon}
								</div>
								<div>
									<h3
										style={{
											fontSize: "var(--text-base)",
											fontWeight: 600,
											color: "var(--color-text-primary)",
											marginBottom: "var(--space-1)",
										}}
									>
										{t(action.titleKey)}
									</h3>
									<p
										style={{
											fontSize: "var(--text-sm)",
											color: "var(--color-text-muted)",
											margin: 0,
										}}
									>
										{t(action.descriptionKey)}
									</p>
								</div>
								<svg
									width="20"
									height="20"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									style={{
										marginLeft: "auto",
										color: "var(--color-text-muted)",
										flexShrink: 0,
									}}
								>
									<path d="M9 18l6-6-6-6" />
								</svg>
							</button>
						))}
					</div>
				</section>

				{/* System status */}
				<section>
					<h2
						style={{
							fontSize: isMobile ? "var(--text-lg)" : "var(--text-xl)",
							fontWeight: 600,
							marginBottom: "var(--space-6)",
							color: "var(--color-text-primary)",
						}}
					>
						{t("labels.systemStatus")}
					</h2>
					<div
						className="liquid-glass-card"
						style={{
							padding: isMobile ? "var(--space-4)" : "var(--space-6)",
							animation:
								"fadeIn 0.5s cubic-bezier(0.25, 1.1, 0.5, 1.15) forwards",
							animationDelay: "0.8s",
							opacity: 0,
						}}
					>
						<div
							style={{
								display: "grid",
								gridTemplateColumns: isMobile
									? "1fr"
									: "repeat(auto-fit, minmax(200px, 1fr))",
								gap: "var(--space-6)",
							}}
						>
							{/* Vector index status */}
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "var(--space-3)",
								}}
							>
								<div
									style={{
										width: "10px",
										height: "10px",
										background:
											sourcesSummary && sourcesSummary.urls.indexed > 0
												? "var(--color-success)"
												: "var(--color-warning)",
										borderRadius: "var(--radius-full)",
										boxShadow:
											sourcesSummary && sourcesSummary.urls.indexed > 0
												? "0 0 12px hsla(150deg, 80%, 45%, 0.5)"
												: "0 0 12px hsla(38deg, 95%, 55%, 0.5)",
										animation:
											sourcesSummary && sourcesSummary.urls.indexed > 0
												? "breathe 3s ease-in-out infinite"
												: "none",
									}}
								/>
								<div>
									<div
										style={{
											fontSize: "var(--text-sm)",
											color: "var(--color-text-muted)",
										}}
									>
										{t("labels.vectorIndex")}
									</div>
									<div
										style={{
											fontSize: "var(--text-base)",
											fontWeight: 500,
											color: "var(--color-text-primary)",
										}}
									>
										{sourcesSummary && sourcesSummary.urls.indexed > 0
											? t("status.established")
											: t("status.notEstablished")}
									</div>
								</div>
							</div>

							{/* API status */}
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "var(--space-3)",
								}}
							>
								<div
									style={{
										width: "10px",
										height: "10px",
										background: "var(--color-success)",
										borderRadius: "var(--radius-full)",
										boxShadow: "0 0 12px hsla(150deg, 80%, 45%, 0.5)",
										animation: "breathe 3s ease-in-out infinite",
									}}
								/>
								<div>
									<div
										style={{
											fontSize: "var(--text-sm)",
											color: "var(--color-text-muted)",
										}}
									>
										{t("labels.apiStatus")}
									</div>
									<div
										style={{
											fontSize: "var(--text-base)",
											fontWeight: 500,
											color: "var(--color-text-primary)",
										}}
									>
										{t("labels.normalOperation")}
									</div>
								</div>
							</div>

							{/* Agent status */}
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "var(--space-3)",
								}}
							>
								<div
									style={{
										width: "10px",
										height: "10px",
										background: agentId
											? "var(--color-success)"
											: "var(--color-error)",
										borderRadius: "var(--radius-full)",
										boxShadow: agentId
											? "0 0 12px hsla(150deg, 80%, 45%, 0.5)"
											: "0 0 12px hsla(350deg, 85%, 58%, 0.5)",
										animation: agentId
											? "breathe 3s ease-in-out infinite"
											: "none",
									}}
								/>
								<div>
									<div
										style={{
											fontSize: "var(--text-sm)",
											color: "var(--color-text-muted)",
										}}
									>
										Agent
									</div>
									<div
										style={{
											fontSize: "var(--text-base)",
											fontWeight: 500,
											color: "var(--color-text-primary)",
										}}
									>
										{agentId
											? t("status.configured")
											: t("status.notConfigured")}
									</div>
									{agentId && (
										<button
											onClick={handleCopyAgentId}
											style={{
												marginTop: "4px",
												padding: 0,
												border: "none",
												background: "transparent",
												cursor: "pointer",
												fontSize: "var(--text-xs)",
												color: agentIdCopied
													? "var(--color-success)"
													: "var(--color-text-muted)",
												fontFamily:
													'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
												textAlign: "left",
												wordBreak: "break-all",
												transition: "color var(--transition-fast)",
											}}
											title={
												agentIdCopied ? t("status.success") : t("buttons.copy")
											}
										>
											{agentIdCopied
												? `${t("status.success")}: ${agentId}`
												: `ID: ${agentId}`}
										</button>
									)}
								</div>
							</div>
						</div>
					</div>
				</section>
			</div>
		</AdminLayout>
	);
}
