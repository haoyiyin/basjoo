"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AdminLayout from "../components/AdminLayout";
import KbBindSheet from "../components/KbBindSheet";
import RowMenu, { isRowControl } from "../components/RowMenu";
import { Icon } from "../components/Icon";
import { Agent, AgentCreateInput, api } from "../services/api";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
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

/**
 * Only a soft-deleted row is inert. A paused agent still opens: the operator
 * has to reach its dashboard to resume it or to fix its configuration.
 */
function isOpenableAgent(agent: Agent | null) {
	return Boolean(agent && !agent.deleted_at);
}

export default function Agents() {
	const { t } = useTranslation("common");
	const { admin } = useAuth();
	const isSuperAdmin = admin?.role === "super_admin";
	const navigate = useNavigate();
	const isMobile = useIsMobile();
	const [agents, setAgents] = useState<Agent[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [, setCountdownTick] = useState(0);
	const [form, setForm] = useState<AgentCreateInput>({
		name: "",
		description: "",
	});

	// The create form lives in a sheet (§15): nothing inline in the page body.
	// `createTriggerRef` is the `+` in `page-actions`; focus returns to it when
	// the sheet closes so keyboard users never lose their place.
	const [createSheetOpen, setCreateSheetOpen] = useState(false);
	const createTriggerRef = useRef<HTMLButtonElement | null>(null);
	const nameInputRef = useRef<HTMLInputElement | null>(null);

	// Row actions are collapsed into one overflow menu per row.
	const [openMenuAgentId, setOpenMenuAgentId] = useState<string | null>(null);

	// The KB column's unbind button is per-row: only its own row goes busy.
	const [busyKbId, setBusyKbId] = useState<string | null>(null);

	// KB binding chooser: opened after an agent is created. Rebinding lives on
	// the agent dashboard; the row's KB column unbinds directly (the KB and its
	// sources are kept). The row menu never toggles the binding.
	const [chooserAgent, setChooserAgent] = useState<Agent | null>(null);

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
			setForm({
				name: "",
				description: "",
			});
			setCreateSheetOpen(false);
			setChooserAgent(created);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("errors.networkError"));
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (agent: Agent) => {
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
	const handleRequestDelete = (agent: Agent) => {
		const confirmed = window.confirm(
			t("agents.deleteConfirm", { name: agent.name }),
		);
		if (!confirmed) return;
		void handleDelete(agent);
	};

	const handlePause = async (agent: Agent) => {
		setSaving(true);
		setError(null);
		try {
			await api.pauseAgent(agent.id);
			await loadAgents();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("errors.networkError"));
		} finally {
			setSaving(false);
		}
	};

	// Pausing stops the chat API (the widget included) and keeps the KB
	// binding, so it is worth one confirmation.
	const handleRequestPause = (agent: Agent) => {
		const confirmed = window.confirm(
			t("agents.pauseConfirm", { name: agent.name }),
		);
		if (!confirmed) return;
		void handlePause(agent);
	};

	const handleResume = async (agent: Agent) => {
		setSaving(true);
		setError(null);
		try {
			await api.resumeAgent(agent.id);
			await loadAgents();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("errors.networkError"));
		} finally {
			setSaving(false);
		}
	};

	// Unbinding keeps the knowledge base and its sources; it only drops the
	// pointer, so it is offered from the KB column itself.
	const handleUnbind = async (agent: Agent) => {
		const kbName = agent.kb_name;
		if (!kbName) return;
		const confirmed = window.confirm(
			t("agents.unbindKnowledgeBaseConfirm", { name: kbName }),
		);
		if (!confirmed) return;
		setBusyKbId(agent.id);
		setError(null);
		try {
			await api.bindAgentKnowledgeBase(agent.id, null);
			await loadAgents();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("errors.networkError"));
		} finally {
			setBusyKbId(null);
		}
	};

	const handleRestore = async (agent: Agent) => {
		setSaving(true);
		setError(null);
		try {
			const restored = await api.restoreAgent(agent.id);
			api.setSelectedAgentId(restored.id);
			await loadAgents();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("errors.networkError"));
		} finally {
			setSaving(false);
		}
	};

	const handleKbSheetClose = () => {
		const agent = chooserAgent;
		setChooserAgent(null);
		if (!agent) return;
		api.setSelectedAgentId(agent.id);
		navigate(`/agents/${agent.id}/dashboard`);
	};

	const handleKbBound = (agentId: string) => {
		setChooserAgent(null);
		api.setSelectedAgentId(agentId);
		navigate(`/agents/${agentId}/dashboard`);
	};

	const rowStyle = isMobile
		? { flexDirection: "column" as const, alignItems: "stretch" as const }
		: undefined;
	const iconButtonStyle = isMobile
		? { minWidth: 44, minHeight: 44 }
		: undefined;

	const renderRowActions = (agent: Agent) => {
		return (
			<RowMenu
				label={t("agents.rowActions", { name: agent.name })}
				triggerLabel={t("agents.rowActions", { name: agent.name })}
				open={openMenuAgentId === agent.id}
				onOpenChange={(next) => setOpenMenuAgentId(next ? agent.id : null)}
				align={isMobile ? "start" : "end"}
				triggerTestId={`agent-actions-${agent.id}`}
				menuTestId={`agent-menu-${agent.id}`}
				triggerStyle={{
					...iconButtonStyle,
					flexShrink: 0,
					alignSelf: isMobile ? "flex-start" : "flex-end",
				}}
			>
				{agent.deleted_at ? (
					<button
						type="button"
						role="menuitem"
						data-testid={`agent-restore-${agent.id}`}
						className="row-menu-item"
						style={{ color: "var(--color-success)" }}
						disabled={saving}
						onClick={() => {
							void handleRestore(agent);
						}}
					>
						{t("agents.restore")}
					</button>
				) : (
					<>
						{agent.is_active ? (
							<button
								type="button"
								role="menuitem"
								data-testid={`agent-pause-${agent.id}`}
								className="row-menu-item"
								disabled={saving}
								onClick={() => {
									handleRequestPause(agent);
								}}
							>
								{t("agents.pause")}
							</button>
						) : (
							<button
								type="button"
								role="menuitem"
								data-testid={`agent-resume-${agent.id}`}
								className="row-menu-item"
								style={{ color: "var(--color-success)" }}
								disabled={saving}
								onClick={() => {
									void handleResume(agent);
								}}
							>
								{t("agents.resume")}
							</button>
						)}
						<button
							type="button"
							role="menuitem"
							data-testid={`agent-delete-${agent.id}`}
							className="row-menu-item"
							style={{ color: "var(--color-error)" }}
							disabled={saving}
							onClick={() => {
								handleRequestDelete(agent);
							}}
						>
							{t("agents.delete")}
						</button>
					</>
				)}
			</RowMenu>
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
						<button
							type="button"
							ref={createTriggerRef}
							className="btn btn-icon"
							data-testid="agent-create-open"
							aria-label={t("agents.createTitle")}
							title={t("agents.createTitle")}
							style={iconButtonStyle}
							onClick={openCreateSheet}
						>
							<Icon name="plus" size={16} />
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
							const updatedAt = formatAgentUpdatedAt(agent);
							const purgeCountdown = agent.deleted_at
								? formatPurgeCountdown(agent.purge_after, t) ||
									t("status.pending")
								: null;
							return (
								<li
									key={agent.id}
									className="list-row list-grid list-grid--agents"
									data-testid={`agent-row-${agent.id}`}
									style={rowStyle}
									onClick={(event) => {
										// A soft-deleted agent restores or purges first: its row is inert.
										if (!isOpenableAgent(agent) || isRowControl(event.target)) return;
										navigate(`/agents/${agent.id}/dashboard`);
									}}
								>
									{/* Column 1 — name. The name is the keyboard affordance (the row itself is
									 * not focusable, so it gets no tabIndex); clicking elsewhere in the row
									 * navigates too, guarded so the menu and the name keep their own click. */}
									<div className="list-cell list-row-main">
										<span className="list-row-name">
											{agent.deleted_at ? (
												<span className="list-row-title">{agent.name}</span>
											) : (
												<Link
													className="list-row-title list-row-affordance"
													to={`/agents/${agent.id}/dashboard`}
													data-testid={`agent-name-${agent.id}`}
												>
													{agent.name}
												</Link>
											)}
											{!agent.deleted_at && (
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
											)}
										</span>
										<span className="list-row-description">
											{agent.description || t("agents.noDescription")}
										</span>
										{purgeCountdown && (
											<span
												className="list-row-note"
												style={{
													fontSize: "var(--text-xs)",
													fontWeight: "var(--weight-semibold)",
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
									</div>
									{/* Column 2 — knowledge base. Its own cell, with its own header
									 * label: the 知识库 text that used to repeat inside the row is gone
									 * (R2). */}
									<div
										className="list-cell list-cell--kb"
										data-testid={`agent-kb-${agent.id}`}
									>
										<span className="list-cell-label">
											{t("agents.columns.knowledgeBase")}
										</span>
										<span
											style={{
												display: "inline-flex",
												alignItems: "center",
												gap: "var(--space-2)",
												minWidth: 0,
											}}
										>
											<span data-testid={`agent-kb-name-${agent.id}`}>
												{agent.kb_name ||
													t("knowledgeBases.unboundValue")}
											</span>
											{/* The row navigates on click, so the button relies on
											 * `isRowControl` (a <button>) rather than on
											 * stopPropagation alone. Unbinding keeps the KB. */}
											{isSuperAdmin && agent.kb_name && (
												<button
													type="button"
													className="btn btn-ghost btn-icon"
													data-testid={`agent-kb-unbind-${agent.id}`}
													aria-label={t("agents.unbindKnowledgeBase", {
														name: agent.kb_name,
													})}
													title={t("agents.unbindKnowledgeBase", {
														name: agent.kb_name,
													})}
													disabled={busyKbId === agent.id}
													style={iconButtonStyle}
													onClick={(event) => {
														event.stopPropagation();
														void handleUnbind(agent);
													}}
												>
													<Icon name="close" size={16} />
												</button>
											)}
										</span>
									</div>
									{/* Column 3 — updated. */}
									<div
										className="list-cell list-cell--updated"
										data-testid={`agent-updated-${agent.id}`}
									>
										{updatedAt
											? t("agents.updatedAt", { date: updatedAt })
											: null}
									</div>
									{/* Column 4 — status. */}
									<div
										className="list-cell list-cell--status"
										data-testid={`agent-status-${agent.id}`}
									>
										{agent.deleted_at ? (
											<span className="badge badge-error">
												{t("agents.statusDeleted")}
											</span>
										) : agent.is_active ? (
											<span className="badge badge-success">
												{t("status.active")}
											</span>
										) : (
											<span className="badge badge-warning">
												{t("agents.statusPaused")}
											</span>
										)}
									</div>
									{/* Column 5 — actions. */}
									<div
										className="list-cell list-cell--actions"
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
								title={t("knowledgeBases.actions.close")}
								style={iconButtonStyle}
								onClick={closeCreateSheet}
							>
								<Icon name="close" size={16} />
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
								className="btn btn-secondary btn-icon"
								disabled={saving}
								aria-label={t("buttons.cancel")}
								title={t("buttons.cancel")}
								onClick={closeCreateSheet}
							>
								<Icon name="close" size={16} />
							</button>
							<button
								type="submit"
								className="btn btn-primary btn-icon"
								aria-label={t("agents.create")}
								title={saving ? t("status.saving") : t("agents.create")}
								aria-busy={saving}
								disabled={
									saving ||
									!isAgentNameValid ||
									(form.description?.trim().length || 0) >
										AGENT_DESCRIPTION_MAX_LENGTH
							}
							>
								{saving ? (
									<div
										className="spinner"
										style={{ width: "14px", height: "14px" }}
									/>
								) : (
									<Icon name="check" size={16} />
								)}
							</button>
						</div>
					</form>
				</>
			)}

			{chooserAgent && (
				<KbBindSheet
					agentId={chooserAgent.id}
					onboarding
					onClose={handleKbSheetClose}
					onBound={handleKbBound}
				/>
			)}
		</AdminLayout>
	);
}
