"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "./Icon";
import { api } from "../services/api";
import type { Procedure, ProcedureStep } from "../services/api";

/**
 * Procedure editor (#39) — the human-written script the agent walks one step
 * per turn.
 *
 * A procedure belongs to the agent. The runtime picks the first enabled one and
 * injects only its *current* step, so the editor's job is to keep an ordered,
 * editable step list and to flag the steps that need a channel capability. A
 * step whose action the channel cannot perform (e.g. `phone`) makes the runtime
 * skip the whole procedure — that rule is stated in the panel hint so an
 * operator is never surprised by a procedure that silently never runs.
 *
 * Controls are the DS primitives only: `.card`, `.list`, `.list-row`, `.field`,
 * `.input`, `.select`, `.btn`, `.switch`, `.badge`, `.empty`.
 */

/** Capability values the widget can honour today, plus the free-form `phone`. */
const ACTION_NONE = "";
const ACTION_LINK = "link";
const ACTION_FORM = "form";
const ACTION_PHONE = "phone";

interface DraftStep {
	text: string;
	requires_action: string;
}

function stepsFromProcedure(procedure: Procedure | null): DraftStep[] {
	const steps = procedure?.steps ?? [];
	if (steps.length === 0) return [{ text: "", requires_action: ACTION_NONE }];
	return steps.map((step: ProcedureStep) => ({
		text: step.text ?? "",
		requires_action: step.requires_action ?? ACTION_NONE,
	}));
}

export interface ProcedureEditorProps {
	agentId: string;
}

export default function ProcedureEditor({ agentId }: ProcedureEditorProps) {
	const { t } = useTranslation("common");

	const [procedures, setProcedures] = useState<Procedure[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// `null` = editor closed; `"new"` = creating; otherwise the edited id.
	const [editingId, setEditingId] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [enabled, setEnabled] = useState(true);
	const [steps, setSteps] = useState<DraftStep[]>([
		{ text: "", requires_action: ACTION_NONE },
	]);
	const [formError, setFormError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [busyId, setBusyId] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!agentId) return;
		setLoading(true);
		try {
			const data = await api.listProcedures(agentId);
			setProcedures(data.items);
			setError(null);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : t("procedures.errors.loadFailed"),
			);
		} finally {
			setLoading(false);
		}
	}, [agentId, t]);

	useEffect(() => {
		void load();
	}, [load]);

	const closeEditor = () => {
		setEditingId(null);
		setName("");
		setEnabled(true);
		setSteps([{ text: "", requires_action: ACTION_NONE }]);
		setFormError(null);
	};

	const openCreate = () => {
		setEditingId("new");
		setName("");
		setEnabled(true);
		setSteps([{ text: "", requires_action: ACTION_NONE }]);
		setFormError(null);
	};

	const openEdit = (procedure: Procedure) => {
		setEditingId(procedure.id);
		setName(procedure.name);
		setEnabled(procedure.enabled);
		setSteps(stepsFromProcedure(procedure));
		setFormError(null);
	};

	const updateStep = (index: number, patch: Partial<DraftStep>) => {
		setSteps((current) =>
			current.map((step, position) =>
				position === index ? { ...step, ...patch } : step,
			),
		);
		setFormError(null);
	};

	const addStep = () => {
		setSteps((current) => [
			...current,
			{ text: "", requires_action: ACTION_NONE },
		]);
	};

	const removeStep = (index: number) => {
		setSteps((current) =>
			current.length === 1 ? current : current.filter((_, i) => i !== index),
		);
	};

	const moveStep = (index: number, delta: number) => {
		setSteps((current) => {
			const target = index + delta;
			if (target < 0 || target >= current.length) return current;
			const next = [...current];
			const [moved] = next.splice(index, 1);
			next.splice(target, 0, moved);
			return next;
		});
	};

	const handleSave = async () => {
		if (saving) return;
		const trimmedName = name.trim();
		if (!trimmedName) {
			setFormError(t("procedures.nameRequired"));
			return;
		}
		const cleaned = steps
			.map((step) => ({
				text: step.text.trim(),
				requires_action:
					step.requires_action === ACTION_NONE ? null : step.requires_action,
			}))
			.filter((step) => step.text.length > 0);
		if (cleaned.length === 0) {
			setFormError(t("procedures.stepRequired"));
			return;
		}
		setFormError(null);
		setSaving(true);
		try {
			if (editingId && editingId !== "new") {
				await api.updateProcedure(agentId, editingId, {
					name: trimmedName,
					steps: cleaned,
					enabled,
				});
			} else {
				await api.createProcedure(agentId, {
					name: trimmedName,
					steps: cleaned,
					enabled,
				});
			}
			closeEditor();
			await load();
		} catch (err) {
			setFormError(
				err instanceof Error ? err.message : t("procedures.errors.saveFailed"),
			);
		} finally {
			setSaving(false);
		}
	};

	const handleToggle = async (procedure: Procedure) => {
		setBusyId(procedure.id);
		try {
			const updated = await api.updateProcedure(agentId, procedure.id, {
				enabled: !procedure.enabled,
			});
			setProcedures((current) =>
				current.map((row) => (row.id === updated.id ? updated : row)),
			);
			setError(null);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : t("procedures.errors.saveFailed"),
			);
		} finally {
			setBusyId(null);
		}
	};

	const handleDelete = async (procedure: Procedure) => {
		if (!window.confirm(t("procedures.deleteConfirm", { name: procedure.name })))
			return;
		setBusyId(procedure.id);
		try {
			await api.deleteProcedure(agentId, procedure.id);
			setProcedures((current) =>
				current.filter((row) => row.id !== procedure.id),
			);
			if (editingId === procedure.id) closeEditor();
			setError(null);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: t("procedures.errors.deleteFailed"),
			);
		} finally {
			setBusyId(null);
		}
	};

	const actionOptions: Array<{ value: string; label: string }> = [
		{ value: ACTION_NONE, label: t("procedures.actionNone") },
		{ value: ACTION_LINK, label: t("procedures.actionLink") },
		{ value: ACTION_FORM, label: t("procedures.actionForm") },
		{ value: ACTION_PHONE, label: t("procedures.actionPhone") },
	];

	return (
		<section className="card" data-testid="agent-procedures-card">
			<div className="card-header">
				<div style={{ minWidth: 0 }}>
					<h2 className="card-title">{t("procedures.title")}</h2>
					<p
						className="page-subtitle"
						style={{ marginTop: "var(--space-1)", marginBottom: 0 }}
					>
						{t("procedures.description")}
					</p>
				</div>
				<div className="page-actions">
					<button
						type="button"
						className="btn btn-primary"
						onClick={openCreate}
					>
						<Icon name="plus" size={16} />
						{t("procedures.add")}
					</button>
				</div>
			</div>

			<div className="card-body">
				{error && (
					<p role="alert" className="field-error">
						{error}
					</p>
				)}

				<p className="field-hint" style={{ marginBottom: "var(--space-4)" }}>
					{t("procedures.unavailableActionHint")}
				</p>

				{editingId !== null && (
					<div className="field" data-testid="procedure-form">
						<h3 className="card-title">
							{editingId === "new"
								? t("procedures.createTitle")
								: t("procedures.editTitle")}
						</h3>

						<label className="field-label" htmlFor="procedure-name">
							{t("procedures.name")}
						</label>
						<input
							id="procedure-name"
							className="input"
							type="text"
							value={name}
							onChange={(event) => {
								setName(event.target.value);
								setFormError(null);
							}}
							placeholder={t("procedures.namePlaceholder")}
						/>

						<span className="field-label">{t("procedures.steps")}</span>
						{steps.map((step, index) => (
							<div
								key={index}
								className="field"
								style={{ marginBottom: "var(--space-3)" }}
								data-testid={`procedure-step-${index}`}
							>
								<label
									className="field-label"
									htmlFor={`procedure-step-text-${index}`}
								>
									{t("procedures.step", { index: index + 1 })}
								</label>
								<input
									id={`procedure-step-text-${index}`}
									className="input"
									type="text"
									value={step.text}
									onChange={(event) =>
										updateStep(index, { text: event.target.value })
									}
									placeholder={t("procedures.stepTextPlaceholder")}
								/>
								<label
									className="field-label"
									htmlFor={`procedure-step-action-${index}`}
								>
									{t("procedures.stepAction")}
								</label>
								<select
									id={`procedure-step-action-${index}`}
									className="input select"
									aria-label={t("procedures.stepActionFor", {
										index: index + 1,
									})}
									value={step.requires_action}
									onChange={(event) =>
										updateStep(index, {
											requires_action: event.target.value,
										})
									}
								>
									{actionOptions.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
								<div className="page-actions page-actions-start">
									<button
										type="button"
										className="btn btn-ghost btn-icon"
										onClick={() => moveStep(index, -1)}
										disabled={index === 0}
										aria-label={t("procedures.moveUp", { index: index + 1 })}
										title={t("procedures.moveUp", { index: index + 1 })}
									>
										<Icon name="chevron-up" size={16} />
									</button>
									<button
										type="button"
										className="btn btn-ghost btn-icon"
										onClick={() => moveStep(index, 1)}
										disabled={index === steps.length - 1}
										aria-label={t("procedures.moveDown", { index: index + 1 })}
										title={t("procedures.moveDown", { index: index + 1 })}
									>
										<Icon name="chevron-down" size={16} />
									</button>
									<button
										type="button"
										className="btn btn-danger btn-icon"
										onClick={() => removeStep(index)}
										disabled={steps.length === 1}
										aria-label={t("procedures.removeStep", { index: index + 1 })}
										title={t("procedures.removeStep", { index: index + 1 })}
									>
										<Icon name="trash" size={16} />
									</button>
								</div>
							</div>
						))}

						<div className="page-actions page-actions-start">
							<button
								type="button"
								className="btn btn-secondary btn-icon"
								aria-label={t("procedures.addStep")}
								title={t("procedures.addStep")}
								onClick={addStep}
							>
								<Icon name="plus" size={16} />
							</button>
						</div>

						<label className="switch">
							<input
								type="checkbox"
								checked={enabled}
								onChange={(event) => setEnabled(event.target.checked)}
								aria-label={t("procedures.enabledLabel")}
							/>
							<span>{t("procedures.enabledLabel")}</span>
						</label>

						{formError && (
							<p role="alert" className="field-error">
								{formError}
							</p>
						)}

						<div className="page-actions page-actions-start">
							<button
								type="button"
								className="btn btn-primary"
								onClick={handleSave}
								disabled={saving}
								aria-busy={saving}
							>
								{saving ? (
									<div
										className="spinner"
										style={{ width: "14px", height: "14px" }}
									/>
								) : null}
								{editingId === "new"
									? t("procedures.createSubmit")
									: t("procedures.saveSubmit")}
							</button>
							<button
								type="button"
								className="btn btn-ghost btn-icon"
								aria-label={t("buttons.cancel")}
								title={t("buttons.cancel")}
								onClick={closeEditor}
							>
								<Icon name="close" size={16} />
							</button>
						</div>
					</div>
				)}

				{loading && procedures.length === 0 ? (
					<div className="list" aria-busy="true">
						{[0, 1].map((index) => (
							<div key={index} className="list-row">
								<div
									className="skeleton skeleton-text"
									style={{ width: "100%" }}
								/>
							</div>
						))}
					</div>
				) : procedures.length === 0 ? (
					<div className="empty" data-testid="procedures-empty">
						<p className="empty-title">{t("procedures.empty")}</p>
						<p className="empty-description">{t("procedures.emptyHint")}</p>
						<div className="empty-actions">
							<button
								type="button"
								className="btn btn-primary"
								onClick={openCreate}
							>
								{t("procedures.add")}
							</button>
						</div>
					</div>
				) : (
					<ul className="list" data-testid="procedures-list">
						{procedures.map((procedure) => {
							const busy = busyId === procedure.id;
							return (
								<li
									key={procedure.id}
									className="list-row"
									data-testid={`procedure-row-${procedure.id}`}
								>
									<div className="list-row-main">
										<span className="list-row-title">{procedure.name}</span>
										<span
											className="list-row-meta"
											style={{ flexWrap: "wrap" }}
										>
											<span className="badge badge-neutral">
												{t("procedures.stepCount", {
													count: procedure.steps.length,
												})}
											</span>
											{!procedure.enabled && (
												<span className="badge badge-neutral">
													{t("procedures.disabledBadge")}
												</span>
											)}
										</span>
									</div>
									<div className="list-row-meta">
										<label className="switch">
											<input
												type="checkbox"
												checked={procedure.enabled}
												disabled={busy}
												onChange={() => void handleToggle(procedure)}
												aria-label={t("procedures.enableLabel", {
													name: procedure.name,
												})}
											/>
										</label>
										<button
											type="button"
											className="btn btn-ghost btn-icon"
											onClick={() => openEdit(procedure)}
											disabled={busy}
											aria-label={t("procedures.editLabel", {
												name: procedure.name,
											})}
											title={t("procedures.editLabel", {
												name: procedure.name,
											})}
										>
											<Icon name="edit" size={16} />
										</button>
										<button
											type="button"
											className="btn btn-danger btn-icon"
											onClick={() => void handleDelete(procedure)}
											disabled={busy}
											aria-label={t("procedures.deleteLabel", {
												name: procedure.name,
											})}
											title={t("procedures.deleteLabel", {
												name: procedure.name,
											})}
										>
											{busy ? (
												<div
													className="spinner"
													style={{ width: "14px", height: "14px" }}
												/>
											) : (
												<Icon name="trash" size={16} />
											)}
										</button>
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</section>
	);
}
