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
 *
 * Restyle (spec §20): the bootstrap-yellow banner and the blue hand-styled CTA
 * are gone. The banner is a warning-tinted `.card` whose call to action is the
 * shared `btn btn-primary`, and the blocking layer is a `.card` on tokens —
 * no literal hex, no gradient text, no decorative blobs.
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
						role="status"
						className="card"
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							flexWrap: "wrap",
							gap: "var(--space-3)",
							padding: "var(--space-3) var(--space-4)",
							marginBottom: "var(--space-4)",
							background: "var(--color-warning-bg)",
							border: "1px solid var(--color-warning)",
							boxShadow: "none",
						}}
					>
						<span
							style={{
								color: "var(--color-warning)",
								fontSize: "var(--text-sm)",
								lineHeight: "var(--leading-normal)",
								minWidth: 0,
							}}
						>
							{t("kb.bannerMessage")}
						</span>
						<Link
							to="/knowledge-bases"
							className="btn btn-primary"
							style={{ flexShrink: 0 }}
						>
							{t("kb.setupButton")}
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
					background: "var(--color-bg-overlay)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					padding: isMobile ? "var(--space-4)" : "var(--space-6)",
					overflowY: "auto",
				}}
			>
				<div
					className="card card-raised"
					role="dialog"
					aria-modal="true"
					aria-labelledby="kb-setup-guard-title"
					data-testid="kb-setup-guard"
					style={{
						width: "100%",
						maxWidth: "480px",
						padding: "var(--space-8)",
						textAlign: "center",
					}}
				>
					<img
						src="/logo.png"
						alt="Basjoo"
						style={{
							width: "56px",
							height: "56px",
							objectFit: "contain",
							marginBottom: "var(--space-4)",
						}}
					/>
					<h1
						id="kb-setup-guard-title"
						className="page-title"
						style={{ marginBottom: "var(--space-2)" }}
					>
						{t("kb.setupTitle")}
					</h1>
					<p
						className="page-subtitle"
						style={{ marginBottom: "var(--space-3)" }}
					>
						{t("kb.setupDescription")}
					</p>
					<p
						className="caption"
						style={{ marginBottom: "var(--space-6)" }}
					>
						{t("knowledgeBases.emptyHint")}
					</p>
					<div
						style={{
							display: "flex",
							justifyContent: "center",
						}}
					>
						<Link to="/knowledge-bases" className="btn btn-primary">
							{t("kb.guardOpenList")}
						</Link>
					</div>
				</div>
			</div>
		);
	}

	return <>{children}</>;
}
