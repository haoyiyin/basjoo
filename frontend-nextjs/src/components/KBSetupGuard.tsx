"use client";

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAgentKbStatus } from "../hooks/useAgentKbStatus";
import { useIsMobile } from "../hooks/useMediaQuery";

interface KBSetupGuardProps {
	agentId: string;
	children: React.ReactNode;
	mode?: "blocking" | "banner";
}

/**
 * Blocks (or banners) knowledge-dependent views while the agent has no bound,
 * active knowledge base. The CTA routes to the workspace knowledge-base list;
 * no setup happens inline, because KBs are created and bound outside the agent.
 */
export default function KBSetupGuard({
	agentId,
	children,
	mode = "blocking",
}: KBSetupGuardProps) {
	const { t } = useTranslation("common");
	const isMobile = useIsMobile();
	const { loading, kbSetupCompleted } = useAgentKbStatus(agentId);

	if (loading) {
		return (
			<div
				style={{
					display: "flex",
					justifyContent: "center",
					alignItems: "center",
					minHeight: "60vh",
				}}
			>
				<div className="spinner" />
			</div>
		);
	}

	if (kbSetupCompleted === false) {
		if (mode === "banner") {
			return (
				<>
					<div
						style={{
							padding: "12px 16px",
							background: "#fff3cd",
							border: "1px solid #ffc107",
							borderRadius: "8px",
							marginBottom: "16px",
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							flexWrap: "wrap",
							gap: "8px",
						}}
					>
						<span style={{ color: "#856404", fontSize: "var(--text-sm)" }}>
							⚠️{" "}
							{t("kb.bannerMessage", {
								defaultValue:
									"Knowledge base is not configured. File uploads will not be processed until KB setup is complete.",
							})}
						</span>
						<Link
							to="/knowledge-bases"
							style={{
								padding: "6px 12px",
								background: "#0d6efd",
								color: "#fff",
								border: "none",
								borderRadius: "4px",
								cursor: "pointer",
								fontSize: "var(--text-sm)",
								fontWeight: 500,
								textDecoration: "none",
							}}
						>
							{t("kb.setupButton", { defaultValue: "Set Up KB" })}
						</Link>
					</div>
					{children}
				</>
			);
		}
		return (
			<div
				style={{
					position: "fixed",
					inset: 0,
					zIndex: 1000,
					background: "rgba(0, 0, 0, 0.6)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					padding: isMobile ? "var(--space-4)" : "var(--space-6)",
					overflowY: "auto",
				}}
			>
				{/* Decorative blur blobs */}
				<div
					style={{
						position: "absolute",
						top: "10%",
						right: "20%",
						width: "350px",
						height: "350px",
						background:
							"radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 70%)",
						borderRadius: "50%",
						filter: "blur(60px)",
						pointerEvents: "none",
					}}
				/>
				<div
					style={{
						position: "absolute",
						bottom: "15%",
						left: "10%",
						width: "280px",
						height: "280px",
						background:
							"radial-gradient(circle, rgba(6, 182, 212, 0.12) 0%, transparent 70%)",
						borderRadius: "50%",
						filter: "blur(60px)",
						pointerEvents: "none",
					}}
				/>

				<div
					className="liquid-glass-card"
					style={{
						width: "100%",
						maxWidth: "480px",
						padding: "var(--space-6)",
						position: "relative",
						zIndex: 1,
						textAlign: "center",
						animation: "fadeIn 0.5s ease-out forwards",
					}}
				>
					<img
						src="/logo.png"
						alt="Basjoo Logo"
						style={{
							width: "64px",
							height: "64px",
							objectFit: "contain",
							marginBottom: "var(--space-4)",
						}}
					/>
					<h1
						style={{
							fontSize: "var(--text-2xl)",
							fontWeight: 700,
							marginBottom: "var(--space-2)",
							background: "linear-gradient(135deg, #0EA5E9 0%, #F97316 100%)",
							WebkitBackgroundClip: "text",
							backgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						{t("kb.setupTitle")}
					</h1>
					<p
						style={{
							color: "var(--color-text-secondary)",
							fontSize: "var(--text-base)",
							marginBottom: "var(--space-5)",
						}}
					>
						{t("kb.setupDescription")}
					</p>
					<p
						style={{
							color: "var(--color-text-muted)",
							fontSize: "var(--text-sm)",
							marginBottom: "var(--space-5)",
						}}
					>
						{t("kb.guardDescription", {
							defaultValue:
								"Create a knowledge base, then bind it to this agent. Knowledge bases are managed independently of agents.",
						})}
					</p>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: "var(--space-3)",
						}}
					>
						<Link
							to="/knowledge-bases"
							className="btn-primary"
							style={{ textDecoration: "none" }}
						>
							{t("kb.guardOpenList", {
								defaultValue: "Open knowledge bases",
							})}
						</Link>
					</div>
				</div>
			</div>
		);
	}

	return <>{children}</>;
}
