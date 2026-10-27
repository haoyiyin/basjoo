"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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

/**
 * `updated_at` is optional on the API payload; fall back to `created_at` and
 * return null when neither parses so the meta line can be dropped entirely
 * rather than rendering "Invalid Date".
 */
function formatAgentUpdatedAt(agent: Agent): string | null {
	const raw = agent.updated_at || agent.created_at;
	if (!raw) return null;
	const parsed = new Date(raw);
	if (Number.isNaN(parsed.getTime())) return null;
	return parsed.toLocaleDateString();
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

	// The create form lives in a sheet (§15): nothing inline in the page body.
	// `createTriggerRef` is the `+` in `page-actions`; focus returns to it when
	// the sheet closes so keyboard users never lose their place.
	const [createSheetOpen, setCreateSheetOpen] = useState(false);
	const createTriggerRef = useRef<HTMLButtonElement | null>(null);
	const nameInputRef = useRef<HTMLInputElement | null>(null);

	// Row actions are collapsed into one overflow menu per row.
	const [openMenuAgentId, setOpenMenuAgentId] = useState<string | null>(null);

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

	const openCreateSheet = () => {
		setError(null);
		setCreateSheetOpen(true);
	};

	const closeCreateSheet = () => {
		setCreateSheetOpen(false);
		createTriggerRef.current?.focus();
	};

	// Focus moves into the sheet on open; Escape closes it from anywhere inside
	// the dialog (the listener is on `document`, not the input, so it also works
	// while focus sits on the footer buttons).
	useEffect(() => {
		if (!createSheetOpen) return;
		nameInputRef.current?.focus();
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				closeCreateSheet();
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [createSheetOpen]);

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
			setCreateSheetOpen(false);
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

	// Soft delete is destructive enough to ask first; the row then shows the
	// purge countdown until the workspace reaps it.
	const handleRequestDeactivate = (agent: Agent) => {
		const confirmed = window.confirm(
			t("agents.deactivateConfirm", { name: agent.name }),
		);
		if (!confirmed) return;
		void handleDeactivate(agent);
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

	const rowStyle = isMobile
		? { flexDirection: "column" as const, alignItems: "stretch" as const }
		: undefined;
	const iconButtonStyle = isMobile
		? { minWidth: 44, minHeight: 44 }
		: undefined;

	const renderRowActions = (agent: Agent) => {
		const menuOpen = openMenuAgentId === agent.id;
		return (
			<div
				style={{
					position: "relative",
					display: "flex",
					justifyContent: isMobile ? "flex-start" : "flex-end",
					flexShrink: 0,
				}}
			>
				<button
					type="button"
					className="btn btn-icon"
					data-testid={`agent-actions-${agent.id}`}
					aria-label={t("agents.rowActions", { name: agent.name })}
					aria-haspopup="menu"
					aria-expanded={menuOpen}
					style={iconButtonStyle}
					onClick={() =>
						setOpenMenuAgentId((current) =>
							current === agent.id ? null : agent.id,
						)
					}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="currentColor"
						aria-hidden="true"
					>
						<circle cx="8" cy="3" r="1.4" />
						<circle cx="8" cy="8" r="1.4" />
						<circle cx="8" cy="13" r="1.4" />
					</svg>
				</button>
				{menuOpen && (
					<div
						role="menu"
						data-testid={`agent-menu-${agent.id}`}
						aria-label={t("agents.rowActions", { name: agent.name })}
						style={{
							position: "absolute",
							top: "calc(100% + var(--space-1))",
							right: isMobile ? "auto" : 0,
							left: isMobile ? 0 : "auto",
							zIndex: 20,
							minWidth: 200,
							display: "flex",
							flexDirection: "column",
							gap: "var(--space-1)",
							padding: "var(--space-1)",
							background: "var(--color-bg-elevated)",
							border: "1px solid var(--color-border)",
							borderRadius: "var(--radius-md)",
							boxShadow: "var(--shadow-lg)",
						}}
					>
						{isOpenableAgent(agent) && (
							<button
								type="button"
								role="menuitem"
								className="btn btn-ghost"
								style={{ justifyContent: "flex-start" }}
								onClick={() => {
									setOpenMenuAgentId(null);
									navigate(`/agents/${agent.id}/dashboard`);
								}}
							>
								{t("agents.open")}
							</button>
						)}
						{isSuperAdmin && !agent.deleted_at && (
							<button
								type="button"
								role="menuitem"
								data-testid={`agent-kb-bind-${agent.id}`}
								className="btn btn-ghost"
								style={{ justifyContent: "flex-start" }}
								disabled={saving}
								onClick={() => {
									setOpenMenuAgentId(null);
									if (agent.kb_id) {
										void handleUnbindAgentKb(agent);
										return;
									}
									void openKbChooser(agent, "list");
								}}
							>
								{agent.kb_id
									? t("knowledgeBases.actions.unbind")
									: t("knowledgeBases.actions.bind")}
							</button>
						)}
						{agent.deleted_at ? (
							<button
								type="button"
								role="menuitem"
								data-testid={`agent-restore-${agent.id}`}
								className="btn btn-ghost"
								style={{
									justifyContent: "flex-start",
									color: "var(--color-success)",
								}}
								disabled={saving}
								onClick={() => {
									setOpenMenuAgentId(null);
									void handleRestore(agent);
								}}
							>
								{t("agents.restore")}
							</button>
						) : (
							<button
								type="button"
								role="menuitem"
								data-testid={`agent-deactivate-${agent.id}`}
								className="btn btn-ghost"
								style={{
									justifyContent: "flex-start",
									color: "var(--color-error)",
								}}
								disabled={saving}
								onClick={() => {
									setOpenMenuAgentId(null);
									handleRequestDeactivate(agent);
								}}
							>
								{t("agents.deactivate")}
							</button>
						)}
					</div>
				)}
			</div>
		);
	};

	return (
		<AdminLayout>
			<div className="admin-page" data-testid="agents-page">
				<header className="page-header">
					<div style={{ minWidth: 0 }}>
						<h1 className="page-title">{t("agents.title")}</h1>
						<p className="page-subtitle">{t("agents.subtitle")}</p>
						<p className="page-subtitle" data-testid="agents-count">
							{t("agents.allAgents")} · {agents.length}
						</p>
					</div>
					<div className="page-actions">
						{selectedOpenableAgent && (
							<button
								type="button"
								className="btn btn-secondary"
								onClick={() =>
									navigate(
										`/agents/${selectedOpenableAgent.id}/dashboard`,
									)
								}
							>
								{t("agents.openCurrent")}
							</button>
						)}
						<button
							type="button"
							ref={createTriggerRef}
							className="btn btn-icon"
							data-testid="agent-create-open"
							aria-label={t("agents.createTitle")}
							style={iconButtonStyle}
							onClick={openCreateSheet}
						>
							<svg
								width="16"
								height="16"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.75"
								strokeLinecap="round"
								aria-hidden="true"
							>
								<path d="M8 3v10M3 8h10" />
							</svg>
						</button>
					</div>
				</header>

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

				{loading ? (
					<div className="list" aria-busy="true" data-testid="agents-loading">
						{[0, 1, 2].map((index) => (
							<div key={index} className="list-row">
								<div
									className="skeleton skeleton-text"
									style={{ width: "100%" }}
								/>
							</div>
						))}
					</div>
				) : agents.length === 0 ? (
					<div className="empty" data-testid="agents-empty">
						<p className="empty-title">{t("agents.empty")}</p>
						<p className="empty-description">
							{t("agents.emptyHint")}
						</p>
						<div className="empty-actions">
							<button
								type="button"
								className="btn btn-primary"
								onClick={openCreateSheet}
							>
								{t("agents.createTitle")}
							</button>
						</div>
					</div>
				) : (
					<div className="list-frame">
						{/* Column-label row: desktop-only plan for R1. It uses the same grid
						 * contract (`list-grid` + `list-grid--agents`) as the rows below, so
						 * header cell N sits exactly above data cell N. Sharing `.list-frame`
						 * with the <ul> keeps exactly one <li> per agent. */}
						<div
							className="list-header list-grid list-grid--agents"
							data-testid="agents-list-header"
						>
							<span className="list-header-cell">
								{t("agents.columns.name")}
							</span>
							<span className="list-header-cell">
								{t("agents.columns.knowledgeBase")}
							</span>
							<span className="list-header-cell">
								{t("agents.columns.updated")}
							</span>
							<span className="list-header-cell">
								{t("agents.columns.status")}
							</span>
							<span className="list-header-cell">
								{t("agents.columns.actions")}
							</span>
						</div>
						<ul className="list" data-testid="agents-list">
						{agents.map((agent) => {
							const isSelected = agent.id === selectedAgentId;
							const updatedAt = formatAgentUpdatedAt(agent);
							const purgeCountdown = agent.deleted_at
								? formatPurgeCountdown(agent.purge_after, t) ||
									t("status.pending")
								: null;
							return (
								<li
									key={agent.id}
									className={
										isSelected
											? "list-row list-grid list-grid--agents is-selected"
											: "list-row list-grid list-grid--agents"
									}
									data-testid={`agent-row-${agent.id}`}
									style={rowStyle}
								>
									{/* Column 1 — name. The selection control IS this cell (so the
									 * aria-pressed affordance covers the name and its description),
									 * and the description stacks under the name inside it. */}
									<button
										type="button"
										className="list-cell list-row-main"
										aria-pressed={isSelected}
										style={{
											background: "transparent",
											border: "none",
											padding: 0,
											textAlign: "left",
											cursor: "pointer",
											gap: "var(--space-1)",
										}}
										onClick={() => handleSelect(agent.id)}
									>
										<span className="list-row-name">
											<span className="list-row-title list-row-affordance">
												{agent.name}
											</span>
											<svg
												className="list-row-chevron"
												viewBox="0 0 16 16"
												fill="none"
												stroke="currentColor"
												strokeWidth="1.75"
												strokeLinecap="round"
												strokeLinejoin="round"
												aria-hidden="true"
												data-testid={`agent-chevron-${agent.id}`}
											>
												<path d="M6 3.5 10.5 8 6 12.5" />
											</svg>
										</span>
										<span className="list-row-description">
											{agent.description || t("agents.noDescription")}
										</span>
										{purgeCountdown && (
											<span
												style={{
													fontSize: "var(--text-xs)",
													fontWeight:
														"var(--weight-semibold)",
													lineHeight: "var(--leading-snug)",
													color: "var(--color-error)",
													wordBreak: "break-word",
												}}
											>
												{t("agents.autoDeleteCountdown", {
													time: purgeCountdown,
												})}
											</span>
										)}
									</button>
									{/* Column 2 — knowledge base. Its own cell, with its own header
									 * label: the 知识库 text that used to repeat inside the row is gone
									 * (R2). */}
									<div
										className="list-cell"
										data-testid={`agent-kb-${agent.id}`}
									>
										<span data-testid={`agent-kb-name-${agent.id}`}>
											{agent.kb_name ||
												t("knowledgeBases.unboundValue")}
										</span>
									</div>
									{/* Column 3 — updated. */}
									<div
										className="list-cell"
										data-testid={`agent-updated-${agent.id}`}
									>
										{updatedAt
											? t("agents.updatedAt", { date: updatedAt })
											: null}
									</div>
									{/* Column 4 — status. */}
									<div
										className="list-cell"
										data-testid={`agent-status-${agent.id}`}
									>
										{agent.deleted_at ? (
											<span className="badge badge-error">
												{t("agents.statusInactive")}
											</span>
										) : agent.is_active ? (
											<span className="badge badge-success">
												{t("status.active")}
											</span>
										) : (
											<span className="badge badge-warning">
												{t("agents.statusInactive")}
											</span>
										)}
									</div>
									{/* Column 5 — actions. */}
									<div
										className="list-cell"
										data-testid={`agent-actions-cell-${agent.id}`}
									>
										{renderRowActions(agent)}
									</div>
								</li>
							);
						})}
					</ul>
					</div>
				)}
			</div>

			{createSheetOpen && (
				<>
					<div
						className="sheet-backdrop"
						data-testid="agent-create-backdrop"
						onClick={closeCreateSheet}
					/>
					<form
						className="sheet"
						role="dialog"
						aria-modal="true"
						aria-labelledby="agent-create-sheet-title"
						data-testid="agent-create-sheet"
						style={{
							position: "fixed",
							zIndex: 60,
							...(isMobile
								? {}
								: {
										top: "var(--space-8)",
										left: "50%",
										width: "min(520px, 92vw)",
										transform: "translateX(-50%)",
										borderRadius: "var(--radius-lg)",
									}),
						}}
						onSubmit={handleCreate}
					>
						<div className="sheet-header">
							<h2 id="agent-create-sheet-title">
								{t("agents.createTitle")}
							</h2>
							<button
								type="button"
								className="btn btn-icon"
								aria-label={t("knowledgeBases.actions.close")}
								style={iconButtonStyle}
								onClick={closeCreateSheet}
							>
								<svg
									width="16"
									height="16"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.75"
									strokeLinecap="round"
									aria-hidden="true"
								>
									<path d="M4 4l8 8M12 4l-8 8" />
								</svg>
							</button>
						</div>
						<div className="sheet-body">
							<div className="field">
								<label className="field-label" htmlFor="agent-create-name">
									{t("labels.agentName")}
								</label>
								<input
									id="agent-create-name"
									ref={nameInputRef}
									className="input"
									value={form.name}
									onChange={(event) =>
										setForm((prev) => ({
											...prev,
											name: trimToAgentNameMaxDisplayWidth(
												event.target.value,
											),
										}))
									}
									maxLength={AGENT_NAME_MAX_DISPLAY_WIDTH}
									placeholder={t("agents.namePlaceholder")}
								/>
								<div
									className="field-hint"
									style={{ textAlign: "right" }}
								>
									{t("agents.characterCount", {
										count: agentNameDisplayWidth,
										max: AGENT_NAME_MAX_DISPLAY_WIDTH,
									})}
								</div>
							</div>
							<div className="field">
								<label
									className="field-label"
									htmlFor="agent-create-description"
								>
									{t("labels.description")}
								</label>
								<textarea
									id="agent-create-description"
									className="input textarea"
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
								/>
								<div
									className="field-hint"
									style={{ textAlign: "right" }}
								>
									{t("agents.characterCount", {
										count: form.description?.length || 0,
										max: AGENT_DESCRIPTION_MAX_LENGTH,
									})}
								</div>
							</div>
						</div>
						<div className="sheet-footer">
							<button
								type="button"
								className="btn btn-secondary"
								disabled={saving}
								onClick={closeCreateSheet}
							>
								{t("buttons.cancel")}
							</button>
							<button
								type="submit"
								className="btn btn-primary"
								disabled={
									saving ||
									!isAgentNameValid ||
									(form.description?.trim().length || 0) >
										AGENT_DESCRIPTION_MAX_LENGTH
								}
							>
								{saving ? t("status.saving") : t("agents.create")}
							</button>
						</div>
					</form>
				</>
			)}

			{chooserAgent && (
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
							<h3
								className="card-title"
								style={{ marginBottom: "var(--space-2)" }}
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
										{t("agents.kbBindExisting")}
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
										{t("agents.kbCreateNew")}
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
										className="select"
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
