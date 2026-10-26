"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AdminLayout from "../components/AdminLayout";
import KbFormModal from "../components/KbFormModal";
import type { KbFormValues } from "../components/KbFormModal";
import { useAuth } from "../context/AuthContext";
import {
	Agent,
	AgentCreateInput,
	KnowledgeBaseDetail,
	api,
} from "../services/api";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "../hooks/useMediaQuery";
import {
	AGENT_NAME_MAX_DISPLAY_WIDTH,
	getAgentNameDisplayWidth,
	trimToAgentNameMaxDisplayWidth,
} from "../lib/agentNameLength";

const AGENT_DESCRIPTION_MAX_LENGTH = 200;

function formatPurgeCountdown(
	purgeAfter: string | null | undefined,
	t: (key: string, options?: Record<string, unknown>) => string,
) {
	if (!purgeAfter) return null;
	const remainingMs = new Date(purgeAfter).getTime() - Date.now();
	if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
		return `0 ${t("time.days")} 0 ${t("time.hours")}`;
	}
	const totalHours = Math.ceil(remainingMs / (1000 * 60 * 60));
	const days = Math.floor(totalHours / 24);
	const hours = totalHours % 24;
	const dayLabel = days === 1 ? t("time.day") : t("time.days");
	const hourLabel = hours === 1 ? t("time.hour") : t("time.hours");
	return `${days} ${dayLabel} ${hours} ${hourLabel}`;
}

function isOpenableAgent(agent: Agent | null) {
	return Boolean(agent && agent.is_active === true && !agent.deleted_at);
}

type KbChooserPurpose = "onboarding" | "list";
type KbChooserView = "choose" | "bind" | "create";

export default function Agents() {
	const { t } = useTranslation("common");
	const navigate = useNavigate();
	const isMobile = useIsMobile();
	const [agents, setAgents] = useState<Agent[]>([]);
	const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [, setCountdownTick] = useState(0);
	const [form, setForm] = useState<AgentCreateInput>({
		name: "",
		description: "",
	});
	const { admin } = useAuth();
	const isSuperAdmin = admin?.role === "super_admin";

	// KB binding chooser: opened after an agent is created and by the per-agent
	// Bind control. The KB itself is created in /knowledge-bases; this modal only
	// binds an existing KB or creates one through the shared KbFormModal.
	const [chooserAgent, setChooserAgent] = useState<Agent | null>(null);
	const [chooserPurpose, setChooserPurpose] =
		useState<KbChooserPurpose>("onboarding");
	const [chooserView, setChooserView] = useState<KbChooserView>("choose");
	const [chooserKbs, setChooserKbs] = useState<KnowledgeBaseDetail[]>([]);
	const [chooserKbId, setChooserKbId] = useState("");
	const [chooserBusy, setChooserBusy] = useState(false);
	const [chooserError, setChooserError] = useState<string | null>(null);
	const selectedAgent = useMemo(
		() => agents.find((agent) => agent.id === selectedAgentId) || null,
		[agents, selectedAgentId],
	);
	const selectedOpenableAgent = isOpenableAgent(selectedAgent)
		? selectedAgent
		: null;

	const agentNameDisplayWidth = getAgentNameDisplayWidth(form.name.trim());
	const isAgentNameValid =
		Boolean(form.name.trim()) &&
		agentNameDisplayWidth <= AGENT_NAME_MAX_DISPLAY_WIDTH;

	const loadAgents = async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await api.listAgents();
			setAgents(data.agents);
			setSelectedAgentId((current) => {
				if (current && data.agents.some((agent) => agent.id === current)) {
					return current;
				}
				return (
					data.agents.find((agent) => isOpenableAgent(agent))?.id ||
					data.agents[0]?.id ||
					null
				);
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : t("errors.networkError"));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		loadAgents();
	}, []);

	useEffect(() => {
		const timer = window.setInterval(
			() => setCountdownTick((value) => value + 1),
			60_000,
		);
		return () => window.clearInterval(timer);
	}, []);

	const handleSelect = (agentId: string) => {
		setSelectedAgentId(agentId);
	};

	const handleCreate = async (event: FormEvent) => {
		event.preventDefault();
		const name = form.name.trim();
		const description = form.description?.trim() || undefined;
		if (
			!isAgentNameValid ||
			(description?.length || 0) > AGENT_DESCRIPTION_MAX_LENGTH
		)
			return;

		setSaving(true);
		setError(null);
		try {
			const created = await api.createAgent({
				...form,
				name,
				description,
				widget_title: name,
			});
			setAgents((prev) => [created, ...prev]);
			setSelectedAgentId(created.id);
			setForm({
				name: "",
				description: "",
			});
			await openKbChooser(created, "onboarding");
		} catch (err) {
			setError(err instanceof Error ? err.message : t("errors.networkError"));
		} finally {
			setSaving(false);
		}
	};

	const handleDeactivate = async (agent: Agent) => {
		setSaving(true);
		setError(null);
		try {
			await api.deleteAgent(agent.id);
			await loadAgents();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("errors.networkError"));
		} finally {
			setSaving(false);
		}
	};

	const handleRestore = async (agent: Agent) => {
		setSaving(true);
		setError(null);
		try {
			const restored = await api.restoreAgent(agent.id);
			api.setSelectedAgentId(restored.id);
			await loadAgents();
			setSelectedAgentId(restored.id);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("errors.networkError"));
		} finally {
			setSaving(false);
		}
	};

	const unboundActiveKbs = useMemo(
		() =>
			chooserKbs.filter(
				(kb) => kb.bound_agent === null && kb.status === "active",
			),
		[chooserKbs],
	);

	const openKbChooser = async (agent: Agent, purpose: KbChooserPurpose) => {
		setChooserAgent(agent);
		setChooserPurpose(purpose);
		setChooserView("choose");
		setChooserKbId("");
		setChooserError(null);
		setChooserKbs([]);
		try {
			const data = await api.listKnowledgeBases();
			setChooserKbs(data.knowledge_bases);
		} catch (err) {
			setChooserError(
				err instanceof Error
					? err.message
					: t("knowledgeBases.errors.loadFailed"),
			);
		}
	};

	const closeKbChooser = () => {
		setChooserAgent(null);
		setChooserView("choose");
		setChooserKbId("");
		setChooserError(null);
		setChooserBusy(false);
	};

	const completeKbBinding = async (agentId: string) => {
		if (chooserPurpose === "onboarding") {
			api.setSelectedAgentId(agentId);
			closeKbChooser();
			navigate(`/agents/${agentId}/dashboard`);
			return;
		}
		closeKbChooser();
		await loadAgents();
	};

	const handleChooserBindExisting = async () => {
		if (!chooserAgent || !chooserKbId) return;
		const agentId = chooserAgent.id;
		setChooserBusy(true);
		setChooserError(null);
		try {
			await api.bindAgentKnowledgeBase(agentId, chooserKbId);
			await completeKbBinding(agentId);
		} catch (err) {
			setChooserError(
				err instanceof Error
					? err.message
					: t("knowledgeBases.errors.bindFailed"),
			);
		} finally {
			setChooserBusy(false);
		}
	};

	const handleChooserCreate = async (values: KbFormValues) => {
		if (!chooserAgent) return;
		const agentId = chooserAgent.id;
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
		await completeKbBinding(agentId);
	};

	const handleChooserCancel = async () => {
		const agent = chooserAgent;
		if (!agent) return;
		if (chooserPurpose === "onboarding") {
			await completeKbBinding(agent.id);
			return;
		}
		closeKbChooser();
	};

	const handleUnbindAgentKb = async (agent: Agent) => {
		if (!agent.kb_id) return;
		const confirmed = window.confirm(
			t("knowledgeBases.unbindConfirm", { agent: agent.name }),
		);
		if (!confirmed) return;
		setSaving(true);
		setError(null);
		try {
			await api.bindAgentKnowledgeBase(agent.id, null);
			await loadAgents();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("errors.networkError"));
		} finally {
			setSaving(false);
		}
	};

	return (
		<AdminLayout>
			<div
				className="admin-page"
				data-testid="agents-page"
				style={{
					padding: isMobile ? "var(--space-4)" : "var(--space-8)",
					maxWidth: "1200px",
					margin: "0 auto",
					minWidth: 0,
				}}
			>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						gap: "var(--space-4)",
						alignItems: "flex-start",
						marginBottom: "var(--space-6)",
					}}
				>
					<div>
						<h1
							style={{
								fontSize: "var(--text-3xl)",
								fontWeight: 700,
								color: "var(--color-text-primary)",
								marginBottom: "var(--space-2)",
							}}
						>
							{t("agents.title")}
						</h1>
						<p
							style={{
								color: "var(--color-text-secondary)",
								fontSize: "var(--text-sm)",
							}}
						>
							{t("agents.subtitle")}
						</p>
					</div>
					{selectedOpenableAgent && (
						<button
							onClick={() =>
								navigate(`/agents/${selectedOpenableAgent.id}/dashboard`)
							}
							style={{
								border: "1px solid var(--color-border)",
								background: "var(--color-bg-secondary)",
								color: "var(--color-text-primary)",
								borderRadius: "var(--radius-md)",
								padding: "var(--space-3) var(--space-4)",
								cursor: "pointer",
							}}
						>
							{t("agents.open")}
						</button>
					)}
				</div>

				{error && (
					<div
						style={{
							padding: "var(--space-4)",
							border: "1px solid rgba(239, 68, 68, 0.3)",
							background: "rgba(239, 68, 68, 0.08)",
							color: "var(--color-error)",
							borderRadius: "var(--radius-md)",
							marginBottom: "var(--space-5)",
						}}
					>
						{error}
					</div>
				)}

				<div
					style={{
						display: "grid",
						gridTemplateColumns: isMobile
							? "1fr"
							: "minmax(0, 1.25fr) minmax(320px, 0.75fr)",
						gap: "var(--space-5)",
					}}
				>
					<section
						className="liquid-glass-card"
						style={{ padding: "var(--space-5)" }}
					>
						<h2
							style={{
								color: "var(--color-text-primary)",
								fontSize: "var(--text-xl)",
								marginBottom: "var(--space-4)",
							}}
						>
							{t("agents.allAgents")}
						</h2>
						{loading ? (
							<div style={{ color: "var(--color-text-muted)" }}>
								{t("status.loading")}
							</div>
						) : agents.length === 0 ? (
							<div
								style={{
									color: "var(--color-text-muted)",
									padding: "var(--space-8)",
									textAlign: "center",
								}}
							>
								{t("agents.empty")}
							</div>
						) : (
							<div style={{ display: "grid", gap: "var(--space-3)" }}>
								{agents.map((agent) => (
									<div
										key={agent.id}
										style={{
											display: "grid",
											gridTemplateColumns: isMobile ? "1fr" : "1fr auto",
											gap: "var(--space-3)",
											alignItems: "start",
											padding: "var(--space-4)",
											border: `1px solid ${agent.id === selectedAgentId ? "var(--color-accent-primary)" : "var(--color-border)"}`,
											borderRadius: "var(--radius-md)",
											background:
												agent.id === selectedAgentId
													? "hsla(188deg, 90%, 50%, 0.08)"
													: "var(--color-bg-secondary)",
										}}
									>
										<button
											onClick={() => handleSelect(agent.id)}
											style={{
												width: "100%",
												display: "flex",
												flexDirection: "column",
												alignItems: "flex-start",
												textAlign: "left",
												background: "transparent",
												border: "none",
												color: "inherit",
												cursor: "pointer",
												padding: 0,
											}}
										>
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: "var(--space-3)",
													marginBottom: "var(--space-2)",
													width: "100%",
												}}
											>
												<span
													style={{
														width: 36,
														height: 36,
														borderRadius: "var(--radius-md)",
														display: "inline-flex",
														alignItems: "center",
														justifyContent: "center",
														background: "var(--color-accent-gradient)",
														color: "var(--color-text-inverse)",
														fontWeight: 700,
													}}
												>
													{agent.name.charAt(0).toUpperCase()}
												</span>
												<div>
													<div
														style={{
															color: "var(--color-text-primary)",
															fontWeight: 700,
														}}
													>
														{agent.name}
													</div>
													<div
														style={{
															color: "var(--color-text-muted)",
															fontSize: "var(--text-xs)",
														}}
													>
														{agent.id}
													</div>
												</div>
											</div>
											<div
												style={{
													display: "flex",
													flexDirection: "column",
													alignItems: "flex-start",
													width: "100%",
												}}
											>
												<div
													style={{
														color: "var(--color-text-secondary)",
														fontSize: "var(--text-sm)",
														width: "100%",
														whiteSpace: "normal",
													}}
												>
													{agent.description || t("agents.noDescription")}
												</div>
												<div
													data-testid={`agent-kb-${agent.id}`}
													style={{
														display: "flex",
														alignItems: "center",
														gap: "var(--space-2)",
														flexWrap: "wrap",
														marginTop: "var(--space-2)",
														fontSize: "var(--text-xs)",
														color: "var(--color-text-muted)",
													}}
												>
													<span style={{ fontWeight: 600 }}>
														{t("agents.kbColumn", { defaultValue: "Knowledge base" })}:
													</span>
													<span data-testid={`agent-kb-name-${agent.id}`}>
														{agent.kb_name || t("knowledgeBases.unboundValue")}
													</span>
												</div>
												{agent.deleted_at && (
													<div
														style={{
															display: "block",
															width: "100%",
															marginTop: "var(--space-2)",
															lineHeight: 1.4,
															color: "var(--color-error)",
															fontSize: "var(--text-xs)",
															fontWeight: 600,
															wordBreak: "break-word",
															whiteSpace: "normal",
														}}
													>
														{t("agents.autoDeleteCountdown", {
															time:
																formatPurgeCountdown(agent.purge_after, t) ||
																t("status.pending"),
														})}
													</div>
												)}
											</div>
										</button>
										<div
											style={{
												display: "flex",
												gap: "var(--space-2)",
												justifyContent: isMobile ? "flex-start" : "flex-end",
											}}
										>
											{isSuperAdmin && !agent.deleted_at && (
												<button
													type="button"
													data-testid={`agent-kb-bind-${agent.id}`}
													className="btn-secondary"
													disabled={saving}
													onClick={() =>
														agent.kb_id
															? handleUnbindAgentKb(agent)
															: openKbChooser(agent, "list")
													}
												>
													{agent.kb_id
														? t("knowledgeBases.actions.unbind")
														: t("knowledgeBases.actions.bind")}
												</button>
											)}
											{isOpenableAgent(agent) && (
												<button
													onClick={() =>
														navigate(`/agents/${agent.id}/dashboard`)
													}
													style={{
														padding: "var(--space-2) var(--space-3)",
														borderRadius: "var(--radius-md)",
														border: "1px solid var(--color-border)",
														background: "transparent",
														color: "var(--color-text-primary)",
														cursor: "pointer",
													}}
												>
													{t("agents.open")}
												</button>
											)}
											{agent.deleted_at ? (
												<button
													onClick={() => handleRestore(agent)}
													disabled={saving}
													style={{
														padding: "var(--space-2) var(--space-3)",
														borderRadius: "var(--radius-md)",
														border: "1px solid rgba(16, 185, 129, 0.3)",
														background: "transparent",
														color: "var(--color-success)",
														cursor: saving ? "not-allowed" : "pointer",
													}}
												>
													{t("agents.restore")}
												</button>
											) : (
												<button
													onClick={() => handleDeactivate(agent)}
													disabled={saving}
													style={{
														padding: "var(--space-2) var(--space-3)",
														borderRadius: "var(--radius-md)",
														border: "1px solid rgba(239, 68, 68, 0.3)",
														background: "transparent",
														color: "var(--color-error)",
														cursor: saving ? "not-allowed" : "pointer",
													}}
												>
													{t("agents.deactivate")}
												</button>
											)}
										</div>
									</div>
								))}
							</div>
						)}
					</section>

					<form
						onSubmit={handleCreate}
						className="liquid-glass-card"
						style={{ padding: "var(--space-5)", alignSelf: "start" }}
					>
						<h2
							style={{
								color: "var(--color-text-primary)",
								fontSize: "var(--text-xl)",
								marginBottom: "var(--space-4)",
							}}
						>
							{t("agents.createTitle")}
						</h2>
						<label
							style={{
								display: "block",
								color: "var(--color-text-secondary)",
								fontSize: "var(--text-sm)",
								marginBottom: "var(--space-2)",
							}}
						>
							{t("labels.agentName")}
						</label>
						<input
							value={form.name}
							onChange={(event) =>
								setForm((prev) => ({
									...prev,
									name: trimToAgentNameMaxDisplayWidth(event.target.value),
								}))
							}
							maxLength={AGENT_NAME_MAX_DISPLAY_WIDTH}
							placeholder={t("agents.namePlaceholder")}
							style={{
								width: "100%",
								marginBottom: "var(--space-2)",
								padding: "var(--space-3)",
								borderRadius: "var(--radius-md)",
								border: "1px solid var(--color-border)",
								background: "var(--color-bg-secondary)",
								color: "var(--color-text-primary)",
							}}
						/>
						<div
							style={{
								display: "flex",
								justifyContent: "flex-end",
								color: "var(--color-text-muted)",
								fontSize: "var(--text-xs)",
								marginBottom: "var(--space-4)",
							}}
						>
							{t("agents.characterCount", {
								count: agentNameDisplayWidth,
								max: AGENT_NAME_MAX_DISPLAY_WIDTH,
							})}
						</div>
						<label
							style={{
								display: "block",
								color: "var(--color-text-secondary)",
								fontSize: "var(--text-sm)",
								marginBottom: "var(--space-2)",
							}}
						>
							{t("labels.description")}
						</label>
						<textarea
							value={form.description}
							onChange={(event) =>
								setForm((prev) => ({
									...prev,
									description: event.target.value.slice(
										0,
										AGENT_DESCRIPTION_MAX_LENGTH,
									),
								}))
							}
							maxLength={AGENT_DESCRIPTION_MAX_LENGTH}
							rows={4}
							placeholder={t("agents.descriptionPlaceholder")}
							style={{
								width: "100%",
								marginBottom: "var(--space-2)",
								padding: "var(--space-3)",
								borderRadius: "var(--radius-md)",
								border: "1px solid var(--color-border)",
								background: "var(--color-bg-secondary)",
								color: "var(--color-text-primary)",
								resize: "vertical",
							}}
						/>
						<div
							style={{
								display: "flex",
								justifyContent: "flex-end",
								color: "var(--color-text-muted)",
								fontSize: "var(--text-xs)",
								marginBottom: "var(--space-4)",
							}}
						>
							{t("agents.characterCount", {
								count: form.description?.length || 0,
								max: AGENT_DESCRIPTION_MAX_LENGTH,
							})}
						</div>
						<button
							type="submit"
							disabled={
								saving ||
								!isAgentNameValid ||
								(form.description?.trim().length || 0) >
									AGENT_DESCRIPTION_MAX_LENGTH
							}
							style={{
								width: "100%",
								padding: "var(--space-3)",
								borderRadius: "var(--radius-md)",
								border: "none",
								background: "var(--color-accent-gradient)",
								color: "var(--color-text-inverse)",
								fontWeight: 700,
								cursor: saving || !isAgentNameValid ? "not-allowed" : "pointer",
								opacity: saving || !isAgentNameValid ? 0.6 : 1,
							}}
						>
							{saving ? t("status.saving") : t("agents.create")}
						</button>
					</form>
				</div>
			</div>
			{chooserAgent && (
				<div
					data-testid="kb-onboarding-modal"
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 9999,
						background: "rgba(0,0,0,0.55)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						padding: "var(--space-4)",
					}}
					role="dialog"
					aria-modal="true"
					aria-label={t("agents.kbOnboardingTitle")}
					onClick={handleChooserCancel}
				>
					{chooserView === "create" ? (
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
								onSubmit={handleChooserCreate}
								onClose={() => {
									setChooserError(null);
									setChooserView("choose");
								}}
							/>
						</div>
					) : (
						<div
							className="liquid-glass-card"
							style={{
								maxWidth: 560,
								width: "100%",
								maxHeight: "calc(100vh - 32px)",
								overflowY: "auto",
								padding: "var(--space-6)",
							}}
							onClick={(event) => event.stopPropagation()}
						>
							<h3
								style={{
									fontSize: "var(--text-lg)",
									fontWeight: 600,
									marginBottom: "var(--space-2)",
									color: "var(--color-text-primary)",
								}}
							>
								{t("agents.kbOnboardingTitle")}
							</h3>
							{chooserView === "choose" && (
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

							{chooserError && (
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
									{chooserError}
								</div>
							)}

							{chooserView === "choose" ? (
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
										disabled={chooserBusy}
										onClick={() => {
											setChooserError(null);
											setChooserKbId("");
											setChooserView("bind");
										}}
									>
										{t("agents.kbBindExisting", {
											defaultValue: "Bind an existing knowledge base",
										})}
									</button>
									<button
										type="button"
										data-testid="kb-chooser-create"
										className="btn-secondary"
										disabled={chooserBusy}
										onClick={() => {
											setChooserError(null);
											setChooserView("create");
										}}
									>
										{t("agents.kbCreateNew", {
											defaultValue: "Create a new knowledge base",
										})}
									</button>
									<button
										type="button"
										data-testid="kb-chooser-skip"
										className="btn-secondary"
										disabled={chooserBusy}
										onClick={handleChooserCancel}
									>
										{t("agents.kbOnboardingSkip")}
									</button>
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
										data-testid="kb-chooser-select"
										aria-label={t("knowledgeBases.bindAgentLabel")}
										value={chooserKbId}
										onChange={(event) => setChooserKbId(event.target.value)}
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
											{t("agents.kbNoneAvailable", {
												defaultValue:
													"No unbound active knowledge base available. Create one under Knowledge Bases.",
											})}
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
											className="btn-secondary"
											disabled={chooserBusy}
											onClick={() => {
												setChooserError(null);
												setChooserView("choose");
											}}
										>
											{t("buttons.back")}
										</button>
										<button
											type="button"
											data-testid="kb-chooser-bind-submit"
											className="btn-primary"
											disabled={chooserBusy || !chooserKbId}
											onClick={handleChooserBindExisting}
										>
											{t("knowledgeBases.bindSubmit")}
										</button>
									</div>
								</>
							)}
						</div>
					)}
				</div>
			)}
		</AdminLayout>
	);
}
