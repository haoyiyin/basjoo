'use client';

/**
 * #72 — the lead inbox.
 *
 * One page over `GET /api/v1/admin/leads` (see
 * `backend/api/v1/leads_endpoints.py`): every visitor who left contact details,
 * newest first, with the queue size in the header and a manual "contacted"
 * mark per row (`PATCH /api/v1/admin/leads/{id}` with `{contacted}`).
 *
 * The payload drives everything — the view never invents a field:
 *
 *   items[] : id, agent_id, session_id?, name?, email?, phone?, message?,
 *             source, page_url?, contacted, contacted_at?, created_at?, updated_at?
 *   total   : rows in the workspace scope
 *   uncontacted : rows in the same scope still waiting for a human
 *
 * `session_id` is the PUBLIC chat session id, so the detail panel links back to
 * that agent's session centre (`/agents/:agentId/sessions`). The rows carry
 * `agent_id` for exactly this reason: a session lives under its agent, and the
 * workspace inbox spans every agent.
 *
 * Two entry points, one view: `/leads` is the super_admin's cross-agent
 * roll-up, `/agents/:agentId/leads` is the same inbox narrowed to the agent the
 * operator works. The scoping is the server's (`?agent_id=`), never a
 * client-side filter of the workspace payload.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../components/AdminLayout';
import { Icon } from '../components/Icon';
import { isRowControl } from '../components/RowMenu';
import { useIsMobile } from '../hooks/useMediaQuery';
import { api } from '../services/api';
import type { Lead } from '../services/api';

/**
 * The sources `backend/services/lead_service.py` normalises into — `LEAD_SOURCES`.
 * The filter lists the contract, not whatever happens to be on screen, so an
 * empty bucket is still a choice the operator can make.
 */
const LEAD_SOURCES = ['offline-form', 'prechat', 'trigger', 'manual'] as const;

type LeadSourceFilter = 'all' | (typeof LEAD_SOURCES)[number];

/** `2026-01-02T03:04:05Z` -> `Jan 2, 03:04`; an absent date stays an em dash. */
function formatCreated(value: string | null | undefined): string {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	return date.toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

export default function Leads() {
	const { t } = useTranslation('common');
	const isMobile = useIsMobile();
	// Present only on `/agents/:agentId/leads`; absent on the root roll-up.
	const { agentId } = useParams<{ agentId?: string }>();

	const [leads, setLeads] = useState<Lead[]>([]);
	const [total, setTotal] = useState(0);
	const [uncontacted, setUncontacted] = useState(0);
	const [sourceFilter, setSourceFilter] = useState<LeadSourceFilter>('all');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// The id whose toggle is in flight: one PATCH at a time per row, and the
	// checkbox is disabled meanwhile so a double click cannot race itself.
	const [togglingId, setTogglingId] = useState<string | null>(null);
	const [toggleError, setToggleError] = useState<string | null>(null);

	const loadLeads = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const payload = await api.listLeads(agentId ? { agentId } : {});
			setLeads(Array.isArray(payload.items) ? payload.items : []);
			setTotal(typeof payload.total === 'number' ? payload.total : 0);
			setUncontacted(
				typeof payload.uncontacted === 'number' ? payload.uncontacted : 0,
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : t('leads.errors.loadFailed'));
		} finally {
			setLoading(false);
		}
	}, [t, agentId]);

	useEffect(() => {
		void loadLeads();
	}, [loadLeads]);

	const visibleLeads = useMemo(
		() =>
			sourceFilter === 'all'
				? leads
				: leads.filter((lead) => lead.source === sourceFilter),
		[leads, sourceFilter],
	);

	const selectedLead = useMemo(
		() => visibleLeads.find((lead) => lead.id === selectedId) ?? null,
		[visibleLeads, selectedId],
	);

	/**
	 * The header count is the server's `uncontacted`, and it is not decremented
	 * locally: the same number is the workspace's queue, so it has to come back
	 * from the server rather than be re-derived from the one page on screen.
	 */
	const handleToggleContacted = async (lead: Lead) => {
		if (togglingId) return;
		const next = !lead.contacted;
		setTogglingId(lead.id);
		setToggleError(null);
		try {
			const updated = await api.setLeadContacted(lead.id, next);
			setLeads((current) =>
				current.map((row) => (row.id === lead.id ? { ...row, ...updated } : row)),
			);
			// The row is now the opposite of what the queue counted, so the count
			// moves with it — one row, one PATCH, one number.
			setUncontacted((current) => Math.max(0, next ? current - 1 : current + 1));
		} catch (err) {
			setToggleError(
				err instanceof Error ? err.message : t('leads.errors.updateFailed'),
			);
		} finally {
			setTogglingId(null);
		}
	};

	const sourceLabel = (source: string): string => {
		if ((LEAD_SOURCES as readonly string[]).includes(source)) {
			return t(`leads.sources.${source}`);
		}
		return source;
	};

	return (
		<AdminLayout>
			<div className="admin-page" data-testid="leads-page">
				<header className="page-header">
					<div style={{ minWidth: 0 }}>
						<h1 className="page-title">{t('leads.title')}</h1>
						<p className="page-subtitle">{t('leads.subtitle')}</p>
					</div>
					<div className="page-actions">
						<button
							type="button"
							className="btn btn-secondary"
							data-testid="leads-reload"
							aria-label={t('leads.reload')}
							title={t('leads.reload')}
							onClick={() => void loadLeads()}
							disabled={loading}
						>
							<Icon name="refresh" size={16} />
							{t('leads.reload')}
						</button>
					</div>
				</header>

				{/* The queue size: how much of this inbox still needs a human. */}
				<div
					data-testid="leads-uncontacted-count"
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 'var(--space-2)',
						flexWrap: 'wrap',
						marginBottom: 'var(--space-4)',
						fontSize: 'var(--text-sm)',
						color: 'var(--fg-dim)',
					}}
				>
					<span
						className={
							uncontacted > 0 ? 'badge badge-warning' : 'badge badge-success'
						}
					>
						{t('leads.uncontactedCount', { count: uncontacted })}
					</span>
					<span>{t('leads.totalCount', { count: total })}</span>
				</div>

				{toggleError && (
					<p
						role="alert"
						className="field-error"
						data-testid="leads-action-error"
					>
						{toggleError}
					</p>
				)}

				<div className="field" style={{ maxWidth: isMobile ? '100%' : '280px' }}>
					<label className="field-label" htmlFor="leads-source-filter">
						{t('leads.filterLabel')}
					</label>
					<select
						id="leads-source-filter"
						className="select"
						value={sourceFilter}
						onChange={(event) =>
							setSourceFilter(event.target.value as LeadSourceFilter)
						}
					>
						<option value="all">{t('leads.sources.all')}</option>
						{LEAD_SOURCES.map((source) => (
							<option key={source} value={source}>
								{t(`leads.sources.${source}`)}
							</option>
						))}
					</select>
				</div>

				{loading ? (
					<div className="list" aria-busy="true" data-testid="leads-loading">
						{[0, 1, 2].map((index) => (
							<div key={index} className="list-row">
								<div
									className="skeleton skeleton-text"
									style={{ width: '100%' }}
								/>
							</div>
						))}
					</div>
				) : error ? (
					<div className="empty" data-testid="leads-error">
						<p className="empty-title" role="alert">
							{error}
						</p>
					</div>
				) : visibleLeads.length === 0 ? (
					<div className="empty" data-testid="leads-empty">
						<p className="empty-title">{t('leads.emptyTitle')}</p>
						<p className="empty-description">{t('leads.emptyDescription')}</p>
					</div>
				) : (
					<>
						{/* Column labels sit OUTSIDE the <ul> so they never become a
						 * phantom list item (same contract as the KB list). */}
						<div
							className="list-header"
							data-testid="leads-list-header"
							style={{ display: 'grid', gridTemplateColumns: LEAD_COLUMNS }}
						>
							<span className="list-header-cell">{t('leads.columns.name')}</span>
							<span className="list-header-cell">{t('leads.columns.email')}</span>
							<span className="list-header-cell">{t('leads.columns.phone')}</span>
							<span className="list-header-cell">{t('leads.columns.source')}</span>
							<span className="list-header-cell">{t('leads.columns.page')}</span>
							<span className="list-header-cell">{t('leads.columns.created')}</span>
							<span className="list-header-cell">
								{t('leads.columns.contacted')}
							</span>
						</div>
						<ul className="list" data-testid="leads-list">
							{visibleLeads.map((lead) => {
								const isSelected = selectedId === lead.id;
								return (
									<li
										key={lead.id}
										className={isSelected ? 'list-row is-selected' : 'list-row'}
										data-testid={`lead-row-${lead.id}`}
										style={{ display: 'grid', gridTemplateColumns: LEAD_COLUMNS }}
										onClick={(event) => {
											if (isRowControl(event.target)) return;
											setSelectedId(isSelected ? null : lead.id);
										}}
									>
										<span className="list-cell" data-testid={`lead-name-${lead.id}`}>
											<span className="list-cell-value">
												{lead.name || t('leads.unknownName')}
											</span>
										</span>
										<span className="list-cell">{lead.email || '—'}</span>
										<span className="list-cell">{lead.phone || '—'}</span>
										<span className="list-cell">
											<span className="badge badge-neutral">
												{sourceLabel(lead.source)}
											</span>
										</span>
										<span
											className="list-cell"
											style={{
												overflow: 'hidden',
												textOverflow: 'ellipsis',
												whiteSpace: 'nowrap',
											}}
											title={lead.page_url ?? undefined}
										>
											{lead.page_url || '—'}
										</span>
										<span className="list-cell">{formatCreated(lead.created_at)}</span>
										<span className="list-cell">
											<label className="field-inline">
												<input
													type="checkbox"
													data-testid={`lead-contacted-${lead.id}`}
													aria-label={t('leads.contactedToggle', {
														name: lead.name || t('leads.unknownName'),
													})}
													checked={lead.contacted}
													disabled={togglingId === lead.id}
													onChange={() => void handleToggleContacted(lead)}
												/>
												<span>
													{lead.contacted
														? t('leads.contacted')
														: t('leads.notContacted')}
												</span>
											</label>
										</span>
									</li>
								);
							})}
						</ul>
					</>
				)}

				{/* The row's detail: everything the row had no room for, plus the way
				 * back to the conversation the lead was captured in. */}
				{selectedLead && (
					<section
						className="card"
						data-testid="lead-detail"
						style={{ marginTop: 'var(--space-4)' }}
					>
						<div className="card-header">
							<h2 className="card-title">
								{selectedLead.name || t('leads.unknownName')}
							</h2>
							<div className="page-actions">
								<button
									type="button"
									className="btn btn-ghost btn-icon"
									aria-label={t('leads.closeDetail')}
									title={t('leads.closeDetail')}
									onClick={() => setSelectedId(null)}
								>
									<Icon name="close" size={16} />
								</button>
							</div>
						</div>

						<dl
							style={{
								display: 'grid',
								gap: 'var(--space-3)',
								margin: 0,
								minWidth: 0,
							}}
						>
							<DetailRow label={t('leads.columns.email')} value={selectedLead.email} />
							<DetailRow label={t('leads.columns.phone')} value={selectedLead.phone} />
							<DetailRow
								label={t('leads.columns.source')}
								value={sourceLabel(selectedLead.source)}
							/>
							<DetailRow
								label={t('leads.columns.created')}
								value={formatCreated(selectedLead.created_at)}
							/>
							<DetailRow label={t('leads.message')} value={selectedLead.message} />
							<DetailRow
								label={t('leads.columns.page')}
								value={selectedLead.page_url}
							/>
						</dl>

						{/* A lead captured in a conversation links back to that agent's
						 * session centre. An offline-form lead has no `session_id` and
						 * therefore no dead link. */}
						{selectedLead.session_id && (
							<div style={{ marginTop: 'var(--space-4)' }}>
								<Link
									className="btn btn-secondary"
									data-testid="lead-session-link"
									to={`/agents/${encodeURIComponent(selectedLead.agent_id)}/sessions`}
								>
									{t('leads.openSession')}
									<span className="mono" style={{ marginLeft: 'var(--space-2)' }}>
										{selectedLead.session_id}
									</span>
								</Link>
							</div>
						)}
					</section>
				)}
			</div>
		</AdminLayout>
	);
}

/**
 * The column plan for the inbox. Declared once and used by both the label row
 * and the data rows so cell N and header N always share one column.
 */
const LEAD_COLUMNS =
	'minmax(0, 1.4fr) minmax(0, 1.4fr) minmax(0, 1fr) 110px minmax(0, 1.2fr) 130px 160px';

interface DetailRowProps {
	label: string;
	value: string | null | undefined;
}

function DetailRow({ label, value }: DetailRowProps) {
	return (
		<div style={{ minWidth: 0 }}>
			<dt className="field-label">{label}</dt>
			<dd
				style={{
					margin: 0,
					fontSize: 'var(--text-base)',
					color: 'var(--color-text-primary)',
					wordBreak: 'break-word',
				}}
			>
				{value || '—'}
			</dd>
		</div>
	);
}
