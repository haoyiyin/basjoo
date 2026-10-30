"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Icon } from "./Icon";
import { api } from "../services/api";
import type { QaImportPair, QaItem, QaMatchResponse } from "../services/api";

/**
 * Curated Q&A panel for one knowledge base (#39).
 *
 * Rendered by `KnowledgeBaseDetail` below the source panels. A pair belongs to
 * the KB (not the agent) and is indexed the moment it is saved, so nothing here
 * ever triggers a reindex — that is the point of the feature.
 *
 * Every control is a design-system primitive: the panel is a `.card`, the pairs
 * are `.list` / `.list-row`, and the two forms are `.field` + `.input`. There is
 * no literal colour and no fixed width, so the panel reflows at 375px.
 */

/** Mirrors the backend's `MIN_QA_QUESTION_LENGTH` (issue #42's rule). */
const MIN_QUESTION_LENGTH = 15;

/**
 * Mirrors `api.v1.qa_endpoints`' keyword limits (#60). Kept in the UI so an
 * over-long paste is caught before a round trip; the backend is still the only
 * authority, and its `keyword_too_short: …` detail is what the form shows.
 */
const MAX_KEYWORDS = 20;
const MAX_KEYWORD_LENGTH = 40;

/**
 * Turn the operator's comma/space-separated string into the array the API wants.
 *
 * Splitting on both separators means `退款, 退货` and `退款 退货` behave the same,
 * which matters for a Chinese IME where a comma may arrive full-width. Blank
 * entries are dropped here (a trailing comma is not an error); the backend still
 * rejects a genuinely unusable keyword with a message worth showing.
 */
export function parseKeywords(raw: string): string[] {
	return raw
		.split(/[,，、\s]+/)
		.map((keyword) => keyword.trim())
		.filter((keyword) => keyword.length > 0);
}

const sourceBadgeClass: Record<string, string> = {
	manual: "badge badge-neutral",
	revise: "badge badge-info",
	unanswered: "badge badge-warning",
};

/**
 * Blank-line separated blocks: the first line is the question, the remaining
 * lines are the answer. Blank rows and single-line blocks are dropped instead
 * of failing the whole import.
 */
export function parseImportPairs(raw: string): QaImportPair[] {
	const blocks = raw
		.split(/\n\s*\n/)
		.map((block) => block.trim())
		.filter((block) => block.length > 0);

	const pairs: QaImportPair[] = [];
	for (const block of blocks) {
		const lines = block
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
		if (lines.length < 2) continue;
		pairs.push({
			question: lines[0],
			answer: lines.slice(1).join("\n"),
		});
	}
	return pairs;
}

function formatHitTime(value: string | null | undefined): string {
	if (!value) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export interface QaManagementProps {
	/** Defaults to the `:kbId` route param, like the source panels. */
	kbId?: string;
}

export default function QaManagement({ kbId: kbIdProp }: QaManagementProps) {
	const { t } = useTranslation("common");
	const params = useParams<{ kbId: string }>();
	const kbId = kbIdProp ?? params.kbId;

	const [items, setItems] = useState<QaItem[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// `null` = form closed; otherwise the form is open in that mode.
	const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [question, setQuestion] = useState("");
	const [answer, setAnswer] = useState("");
	const [keywordsText, setKeywordsText] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	// #60 — the read-only tester: what the keyword path would serve right now.
	const [testerMessage, setTesterMessage] = useState("");
	const [testerResult, setTesterResult] = useState<QaMatchResponse | null>(null);
	const [testerError, setTesterError] = useState<string | null>(null);
	const [testing, setTesting] = useState(false);

	const [importOpen, setImportOpen] = useState(false);
	const [importText, setImportText] = useState("");
	const [importing, setImporting] = useState(false);
	const [importResult, setImportResult] = useState<string | null>(null);

	const [busyId, setBusyId] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!kbId) return;
		setLoading(true);
		try {
			const data = await api.listQaItems(kbId);
			setItems(data.items);
			setTotal(data.total);
			setError(null);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : t("qa.errors.loadFailed"),
			);
		} finally {
			setLoading(false);
		}
	}, [kbId, t]);

	useEffect(() => {
		void load();
	}, [load]);

	const closeForm = () => {
		setFormMode(null);
		setEditingId(null);
		setQuestion("");
		setAnswer("");
		setKeywordsText("");
		setFormError(null);
	};

	const openCreate = () => {
		setFormMode("create");
		setEditingId(null);
		setQuestion("");
		setAnswer("");
		setKeywordsText("");
		setFormError(null);
	};

	const openEdit = (item: QaItem) => {
		setFormMode("edit");
		setEditingId(item.id);
		setQuestion(item.question);
		setAnswer(item.answer);
		setKeywordsText((item.keywords ?? []).join(", "));
		setFormError(null);
	};

	const handleSubmit = async () => {
		if (!kbId || saving) return;
		const trimmedQuestion = question.trim();
		const trimmedAnswer = answer.trim();
		const keywords = parseKeywords(keywordsText);
		if (trimmedQuestion.length < MIN_QUESTION_LENGTH) {
			setFormError(t("qa.questionTooShort"));
			return;
		}
		if (!trimmedAnswer) {
			setFormError(t("qa.answerRequired"));
			return;
		}
		if (keywords.length > MAX_KEYWORDS) {
			setFormError(t("qa.errors.tooManyKeywords", { max: MAX_KEYWORDS }));
			return;
		}
		if (keywords.some((keyword) => keyword.length > MAX_KEYWORD_LENGTH)) {
			setFormError(
				t("qa.errors.keywordTooLong", { max: MAX_KEYWORD_LENGTH }),
			);
			return;
		}
		setFormError(null);
		setSaving(true);
		try {
			if (formMode === "edit" && editingId) {
				// Always sent on an edit: `[]` is how "clear the trigger words" is
				// expressed, and omitting the field means "leave them alone".
				await api.updateQaItem(kbId, editingId, {
					question: trimmedQuestion,
					answer: trimmedAnswer,
					keywords,
				});
			} else {
				await api.createQaItem(kbId, {
					question: trimmedQuestion,
					answer: trimmedAnswer,
					// Omitted when empty: the backend's default is already `[]`, and a
					// pair without trigger words is the pre-#60 shape.
					...(keywords.length > 0 ? { keywords } : {}),
				});
			}
			closeForm();
			await load();
		} catch (err) {
			// The backend's `keyword_too_short: <kw>` detail is the useful message,
			// so it is shown verbatim rather than replaced by a generic copy.
			setFormError(
				err instanceof Error ? err.message : t("qa.errors.saveFailed"),
			);
		} finally {
			setSaving(false);
		}
	};

	const handleToggle = async (item: QaItem) => {
		if (!kbId) return;
		setBusyId(item.id);
		try {
			const updated = await api.updateQaItem(kbId, item.id, {
				enabled: !item.enabled,
			});
			setItems((current) =>
				current.map((row) => (row.id === updated.id ? updated : row)),
			);
			setError(null);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : t("qa.errors.saveFailed"),
			);
		} finally {
			setBusyId(null);
		}
	};

	const handleDelete = async (item: QaItem) => {
		if (!kbId) return;
		if (!window.confirm(t("qa.deleteConfirm"))) return;
		setBusyId(item.id);
		try {
			await api.deleteQaItem(kbId, item.id);
			setItems((current) => current.filter((row) => row.id !== item.id));
			setTotal((current) => Math.max(0, current - 1));
			setError(null);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : t("qa.errors.deleteFailed"),
			);
		} finally {
			setBusyId(null);
		}
	};

	const handleTest = async () => {
		if (!kbId || testing) return;
		const message = testerMessage.trim();
		if (!message) return;
		setTesting(true);
		setTesterError(null);
		try {
			setTesterResult(await api.testQaMatch(kbId, message));
		} catch (err) {
			setTesterResult(null);
			setTesterError(
				err instanceof Error ? err.message : t("qa.testerFailed"),
			);
		} finally {
			setTesting(false);
		}
	};

	const handleImport = async () => {
		if (!kbId || importing) return;
		const pairs = parseImportPairs(importText);
		if (pairs.length === 0) {
			setImportResult(t("qa.importEmpty"));
			return;
		}
		setImporting(true);
		setImportResult(null);
		try {
			const result = await api.importQaItems(kbId, pairs);
			setImportResult(
				t("qa.importResult", {
					created: result.created,
					skipped: result.skipped,
				}),
			);
			setImportText("");
			await load();
		} catch (err) {
			setImportResult(
				err instanceof Error ? err.message : t("qa.errors.importFailed"),
			);
		} finally {
			setImporting(false);
		}
	};

	if (!kbId) return null;

	return (
		<section className="card" data-testid="kb-qa-panel">
			<div className="card-header">
				<div style={{ minWidth: 0 }}>
					<h2 className="card-title">{t("qa.title")}</h2>
					<p
						className="page-subtitle"
						style={{ marginTop: "var(--space-1)", marginBottom: 0 }}
					>
						{t("qa.description")}
					</p>
				</div>
				<div className="page-actions">
					<button
						type="button"
						className="btn btn-secondary"
						onClick={() => {
							setImportOpen((open) => !open);
							setImportResult(null);
						}}
						aria-expanded={importOpen}
					>
						{t("qa.import")}
					</button>
					<button
						type="button"
						className="btn btn-primary"
						onClick={openCreate}
					>
						<Icon name="plus" size={16} />
						{t("qa.addPair")}
					</button>
				</div>
			</div>

			<div className="card-body">
				{error && (
					<p role="alert" className="field-error" data-testid="qa-error">
						{error}
					</p>
				)}

				{/* #60 — the tester: what the keyword path would answer right now. */}
				<div className="field" data-testid="qa-tester">
					<label className="field-label" htmlFor="qa-tester-input">
						{t("qa.testerTitle")}
					</label>
					<p className="field-hint">{t("qa.testerDescription")}</p>
					<div className="page-actions page-actions-start">
						<input
							id="qa-tester-input"
							className="input"
							type="text"
							value={testerMessage}
							onChange={(event) => setTesterMessage(event.target.value)}
							placeholder={t("qa.testerPlaceholder")}
						/>
						<button
							type="button"
							className="btn btn-secondary"
							onClick={() => void handleTest()}
							disabled={testing}
							aria-busy={testing}
						>
							{testing ? (
								<div
									className="spinner"
									style={{ width: "14px", height: "14px" }}
								/>
							) : null}
							{t("qa.testerSubmit")}
						</button>
					</div>
					{testerError && (
						<p
							role="alert"
							className="field-error"
							data-testid="qa-tester-error"
						>
							{testerError}
						</p>
					)}
					{testerResult?.matched ? (
						<div className="list-row" data-testid="qa-tester-hit">
							<div className="list-row-main">
								<span className="list-row-title">
									{t("qa.testerQuestion")}: {testerResult.matched.question}
								</span>
								<span className="list-row-description">
									{t("qa.testerAnswer")}: {testerResult.matched.answer}
								</span>
								<span
									className="list-row-meta"
									style={{ flexWrap: "wrap" }}
								>
									<span className="mono" data-testid="qa-tester-score">
										{t("qa.testerScore", {
											score: (testerResult.score ?? 0).toFixed(2),
										})}
									</span>
									{/* The keywords that fired, verbatim from the matcher. */}
									{testerResult.matched_keywords.length > 0 && (
										<span className="mono" data-testid="qa-tester-keywords">
											{t("qa.testerMatchedKeywords", {
												keywords: testerResult.matched_keywords.join(", "),
											})}
										</span>
									)}
								</span>
							</div>
						</div>
					) : testerResult ? (
						<p
							role="status"
							className="field-hint"
							data-testid="qa-tester-miss"
						>
							{t("qa.testerMiss")}
						</p>
					) : null}
				</div>

				{importOpen && (
					<div className="field" data-testid="qa-import-form">
						<label className="field-label" htmlFor="qa-import-text">
							{t("qa.importTitle")}
						</label>
						<textarea
							id="qa-import-text"
							className="input textarea"
							value={importText}
							onChange={(event) => setImportText(event.target.value)}
							rows={6}
							placeholder={t("qa.importPlaceholder")}
						/>
						<p className="field-hint">{t("qa.importDescription")}</p>
						<div className="page-actions page-actions-start">
							<button
								type="button"
								className="btn btn-primary"
								onClick={handleImport}
								disabled={importing}
								aria-busy={importing}
							>
								{importing ? (
									<div
										className="spinner"
										style={{ width: "14px", height: "14px" }}
									/>
								) : null}
								{t("qa.importSubmit")}
							</button>
							<button
								type="button"
								className="btn btn-ghost"
								onClick={() => {
									setImportOpen(false);
									setImportText("");
									setImportResult(null);
								}}
							>
								{t("buttons.cancel")}
							</button>
						</div>
						{importResult && (
							<p
								role="status"
								aria-live="polite"
								className="field-hint"
								data-testid="qa-import-result"
							>
								{importResult}
							</p>
						)}
					</div>
				)}

				{formMode && (
					<div className="field" data-testid="qa-form">
						<h3 className="card-title">
							{formMode === "edit" ? t("qa.editTitle") : t("qa.createTitle")}
						</h3>
						<label className="field-label" htmlFor="qa-question">
							{t("qa.question")}
						</label>
						<input
							id="qa-question"
							className="input"
							type="text"
							value={question}
							onChange={(event) => setQuestion(event.target.value)}
							placeholder={t("qa.questionPlaceholder")}
						/>
						<label className="field-label" htmlFor="qa-answer">
							{t("qa.answer")}
						</label>
						<textarea
							id="qa-answer"
							className="input textarea"
							value={answer}
							onChange={(event) => setAnswer(event.target.value)}
							rows={4}
							placeholder={t("qa.answerPlaceholder")}
						/>
						<label className="field-label" htmlFor="qa-keywords">
							{t("qa.keywords")}
						</label>
						<input
							id="qa-keywords"
							className="input"
							type="text"
							value={keywordsText}
							onChange={(event) => setKeywordsText(event.target.value)}
							placeholder={t("qa.keywordsPlaceholder")}
						/>
						<p className="field-hint">{t("qa.keywordsHint")}</p>
						{formError && (
							<p role="alert" className="field-error">
								{formError}
							</p>
						)}
						<div className="page-actions page-actions-start">
							<button
								type="button"
								className="btn btn-primary"
								onClick={handleSubmit}
								disabled={saving}
								aria-busy={saving}
							>
								{saving ? (
									<div
										className="spinner"
										style={{ width: "14px", height: "14px" }}
									/>
								) : null}
								{formMode === "edit"
									? t("qa.saveSubmit")
									: t("qa.createSubmit")}
							</button>
							<button
								type="button"
								className="btn btn-ghost"
								onClick={closeForm}
							>
								{t("buttons.cancel")}
							</button>
						</div>
					</div>
				)}

				{loading && items.length === 0 ? (
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
				) : items.length === 0 ? (
					<div className="empty" data-testid="qa-empty">
						<p className="empty-title">{t("qa.empty")}</p>
						<p className="empty-description">{t("qa.emptyHint")}</p>
						<div className="empty-actions">
							<button
								type="button"
								className="btn btn-primary"
								onClick={openCreate}
							>
								{t("qa.addPair")}
							</button>
						</div>
					</div>
				) : (
					<ul className="list" data-testid="qa-list">
						{items.map((item) => {
							const busy = busyId === item.id;
							const hitAt = formatHitTime(item.last_hit_at);
							return (
								<li
									key={item.id}
									className="list-row"
									data-testid={`qa-row-${item.id}`}
								>
									<div className="list-row-main">
										<span className="list-row-title">{item.question}</span>
										<span className="list-row-description">{item.answer}</span>
										<span
											className="list-row-meta"
											style={{ flexWrap: "wrap" }}
										>
											<span
												className={
													sourceBadgeClass[item.source] ?? "badge badge-neutral"
												}
											>
												{t(`qa.sources.${item.source}`)}
											</span>
											<span className="mono">
												{item.hits > 0
													? t("qa.hits", { count: item.hits })
													: t("qa.neverHit")}
											</span>
											{hitAt && (
												<span className="mono">
													{t("qa.lastHit", { date: hitAt })}
												</span>
											)}
											{/* #60 — the pair's trigger words as chips. */}
											{(item.keywords ?? []).length > 0 ? (
												(item.keywords ?? []).map((keyword) => (
													<span
														key={keyword}
														className="badge badge-info"
														data-testid={`qa-keyword-${item.id}-${keyword}`}
													>
														{keyword}
													</span>
												))
											) : (
												<span
													className="mono"
													data-testid={`qa-keywords-empty-${item.id}`}
												>
													{t("qa.keywordsEmpty")}
												</span>
											)}
											{!item.enabled && (
												<span className="badge badge-neutral">
													{t("qa.enabledOff")}
												</span>
											)}
										</span>
									</div>
									<div className="list-row-meta">
										<label className="switch">
											<input
												type="checkbox"
												checked={item.enabled}
												disabled={busy}
												onChange={() => void handleToggle(item)}
												aria-label={t("qa.toggleLabel", {
													question: item.question,
												})}
											/>
										</label>
										<button
											type="button"
											className="btn btn-ghost"
											onClick={() => openEdit(item)}
											disabled={busy}
											aria-label={t("qa.editLabel", {
												question: item.question,
											})}
										>
											{t("buttons.edit")}
										</button>
										<button
											type="button"
											className="btn btn-danger btn-icon"
											onClick={() => void handleDelete(item)}
											disabled={busy}
											aria-label={t("qa.deleteLabel", {
												question: item.question,
											})}
											title={t("qa.deleteLabel", { question: item.question })}
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

				{total > items.length && (
					<p className="field-hint" style={{ marginTop: "var(--space-3)" }}>
						{t("qa.showing", { shown: items.length, total })}
					</p>
				)}
			</div>
		</section>
	);
}
