"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../services/api";
import type { KnowledgeBaseDetail } from "../services/api";
import { Icon } from "./Icon";
import KbFormModal from "./KbFormModal";
import type { KbFormValues } from "./KbFormModal";

type KbChooserView = "choose" | "bind" | "create";

export interface KbBindSheetProps {
	agentId: string;
	/** First-run flow: shows the setup copy and a skip action. */
	onboarding?: boolean;
	onClose: () => void;
	onBound: (agentId: string) => void;
}

/**
 * The single knowledge-base chooser sheet (R3). It was lifted out of `Agents`
 * so the agent dashboard can open the same surface instead of a second
 * implementation: choose an existing unbound KB, create a new one, or back out.
 */
export default function KbBindSheet({
	agentId,
	onboarding = false,
	onClose,
	onBound,
}: KbBindSheetProps) {
	const { t } = useTranslation("common");
	const [view, setView] = useState<KbChooserView>("choose");
	const [kbs, setKbs] = useState<KnowledgeBaseDetail[]>([]);
	const [kbId, setKbId] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		api
			.listKnowledgeBases()
			.then((data) => {
				if (!cancelled) setKbs(data.knowledge_bases);
			})
			.catch((err) => {
				if (!cancelled) {
					setError(
						err instanceof Error
							? err.message
							: t("knowledgeBases.errors.loadFailed"),
					);
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const unboundActiveKbs = useMemo(
		() => kbs.filter((kb) => kb.bound_agent === null && kb.status === "active"),
		[kbs],
	);

	const bindExisting = async () => {
		if (!kbId) return;
		setBusy(true);
		setError(null);
		try {
			await api.bindAgentKnowledgeBase(agentId, kbId);
			onBound(agentId);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: t("knowledgeBases.errors.bindFailed"),
			);
		} finally {
			setBusy(false);
		}
	};

	const createAndBind = async (values: KbFormValues) => {
		const createdKb = await api.createKnowledgeBase({
			name: values.name,
			embedding_provider: values.embedding_provider,
			embedding_model: values.embedding_model,
			embedding_base_url: values.embedding_base_url,
			embedding_api_key: values.embedding_api_key,
			embedding_batch_size: values.embedding_batch_size,
			chunk_size: values.chunk_size,
			chunk_overlap: values.chunk_overlap,
		});
		await api.bindAgentKnowledgeBase(agentId, createdKb.id);
		onBound(agentId);
	};

	return (
		<div
			data-testid="kb-onboarding-modal"
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 9999,
				background: "var(--color-bg-overlay)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: "var(--space-4)",
			}}
			role="dialog"
			aria-modal="true"
			aria-label={t("agents.kbOnboardingTitle")}
			onClick={onClose}
		>
			{view === "create" ? (
				<div
					style={{
						maxWidth: 560,
						width: "100%",
						maxHeight: "calc(100vh - 32px)",
						overflowY: "auto",
					}}
					onClick={(event) => event.stopPropagation()}
				>
					<KbFormModal
						mode="create"
						onSubmit={createAndBind}
						onClose={() => {
							setError(null);
							setView("choose");
						}}
					/>
				</div>
			) : (
				<div
					className="card"
					style={{
						maxWidth: 560,
						width: "100%",
						maxHeight: "calc(100vh - 32px)",
						overflowY: "auto",
						padding: "var(--space-6)",
					}}
					onClick={(event) => event.stopPropagation()}
				>
					<h3 className="card-title" style={{ marginBottom: "var(--space-2)" }}>
						{t("agents.kbOnboardingTitle")}
					</h3>
					{view === "choose" && (
						<p
							style={{
								fontSize: "var(--text-sm)",
								color: "var(--color-text-secondary)",
								marginBottom: "var(--space-4)",
							}}
						>
							{t("agents.kbOnboardingDescription")}
						</p>
					)}

					{error && (
						<div
							role="alert"
							style={{
								padding: "var(--space-3) var(--space-4)",
								borderRadius: "var(--radius-md)",
								fontSize: "var(--text-sm)",
								background: "var(--color-error-bg)",
								border: "1px solid var(--color-error)",
								color: "var(--color-error)",
								marginBottom: "var(--space-4)",
							}}
						>
							{error}
						</div>
					)}

					{view === "choose" ? (
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: "var(--space-3)",
							}}
						>
							<button
								type="button"
								data-testid="kb-chooser-bind"
								className="btn-primary"
								disabled={busy}
								onClick={() => {
									setError(null);
									setKbId("");
									setView("bind");
								}}
							>
								{t("agents.kbBindExisting")}
							</button>
							<button
								type="button"
								data-testid="kb-chooser-create"
								className="btn-secondary"
								disabled={busy}
								onClick={() => {
									setError(null);
									setView("create");
								}}
							>
								{t("agents.kbCreateNew")}
							</button>
							{onboarding && (
								<button
									type="button"
									data-testid="kb-chooser-skip"
									className="btn-secondary"
									disabled={busy}
									onClick={onClose}
								>
									{t("agents.kbOnboardingSkip")}
								</button>
							)}
						</div>
					) : (
						<>
							<label
								htmlFor="agent-kb-binding-select"
								style={{
									display: "block",
									marginBottom: "var(--space-2)",
									fontSize: "var(--text-sm)",
									color: "var(--color-text-secondary)",
								}}
							>
								{t("knowledgeBases.bindTitle")}
							</label>
							<select
								id="agent-kb-binding-select"
								className="select"
								data-testid="kb-chooser-select"
								aria-label={t("knowledgeBases.bindAgentLabel")}
								value={kbId}
								onChange={(event) => setKbId(event.target.value)}
								style={{ width: "100%" }}
							>
								<option value="">
									{t("knowledgeBases.bindAgentPlaceholder")}
								</option>
								{unboundActiveKbs.map((kb) => (
									<option key={kb.id} value={kb.id}>
										{kb.name}
									</option>
								))}
							</select>
							{unboundActiveKbs.length === 0 && (
								<p
									style={{
										marginTop: "var(--space-3)",
										fontSize: "var(--text-xs)",
										color: "var(--color-text-muted)",
									}}
								>
									{t("agents.kbNoneAvailable")}
								</p>
							)}
							<div
								style={{
									display: "flex",
									gap: "var(--space-3)",
									justifyContent: "flex-end",
									marginTop: "var(--space-6)",
								}}
							>
								<button
									type="button"
									className="btn btn-secondary btn-icon"
									aria-label={t("buttons.back")}
									title={t("buttons.back")}
									disabled={busy}
									onClick={() => {
										setError(null);
										setView("choose");
									}}
								>
									<Icon name="back" size={16} />
								</button>
								<button
									type="button"
									data-testid="kb-chooser-bind-submit"
									className="btn btn-primary btn-icon"
									disabled={busy || !kbId}
									onClick={bindExisting}
									aria-label={t("knowledgeBases.bindSubmit")}
									title={t("knowledgeBases.bindSubmit")}
								>
									<Icon name="check" size={16} />
								</button>
							</div>
						</>
					)}
				</div>
			)}
		</div>
	);
}
