'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import type { Agent, URLSource } from '../services/api';
import HelpTooltip from '../components/HelpTooltip';
import { Icon } from '../components/Icon';
import { useIsMobile } from '../hooks/useMediaQuery';

interface KbIndexState {
  status: string;
}

/** The auto-fetch knobs live on the *agent*; one PATCH carries exactly one. */
type AutoFetchField =
  | 'enable_auto_fetch'
  | 'url_fetch_interval_days'
  | 'crawl_max_depth'
  | 'crawl_max_pages';
type AutoFetchPatch = Pick<Agent, AutoFetchField>;

/**
 * URL source panel for one knowledge base.
 *
 * Embedded by `KnowledgeBaseDetail` on `/knowledge-bases/:kbId`: it takes the KB
 * id from the route and uses only the canonical kb-scoped source routes, so it
 * works for an unbound KB too. The auto-fetch toggle is agent-preconditioned —
 * it is hidden unless the KB has a bound agent (the toggle PATCHes that agent).
 *
 * Auto-fetch settings persist on change (#25): there is no save button. Each
 * control PATCHes only the field it owns — the switch immediately, the numeric
 * inputs 500 ms after the last keystroke — and the card header reports the
 * result of the last PATCH (`role="status"`, `data-state`).
 */
export default function URLManagement() {
  const { t } = useTranslation('common');
  const { kbId } = useParams<{ kbId: string }>();
  const isMobile = useIsMobile();

  const [urls, setUrls] = useState<URLSource[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [refetching, setRefetching] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [autoFetchEnabled, setAutoFetchEnabled] = useState(false);
  const [fetchIntervalDays, setFetchIntervalDays] = useState(7);
  const [crawlMaxDepth, setCrawlMaxDepth] = useState(2);
  const [crawlMaxPages, setCrawlMaxPages] = useState(20);
  const [boundAgent, setBoundAgent] = useState<Agent | null>(null);
  const [crawlPolling, setCrawlPolling] = useState(false);
  const [crawlStartCount, setCrawlStartCount] = useState(0);
  const [indexState, setIndexState] = useState<KbIndexState | null>(null);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [pollingStopped, setPollingStopped] = useState(false);
  const [deletingUrlId, setDeletingUrlId] = useState<number | null>(null);
  // Row actions live in one overflow menu per row (§19).
  const [openMenuUrlId, setOpenMenuUrlId] = useState<number | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPollingRequestedRef = useRef(false);
  const crawlPollingRef = useRef(false);
  crawlPollingRef.current = crawlPolling;
  // #25 save plumbing: one debounce timer per field, and a mount flag so a late
  // PATCH never sets state on an unmounted panel.
  const autoFetchTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const mountedRef = useRef(true);

  // Auto-complete URL with https:// if missing protocol
  const normalizeUrl = (url: string): string => {
    const trimmed = url.trim();
    if (!trimmed) return trimmed;
    if (!/^https?:\/\//i.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return trimmed;
  };

  const handleUrlBlur = () => {
    if (newUrl.trim() && !/^https?:\/\//i.test(newUrl.trim())) {
      setNewUrl(normalizeUrl(newUrl));
    }
  };

  // The auto-fetch settings live on the bound agent, not on the KB. An unbound
  // KB simply has no agent to PATCH, so the toggle stays hidden.
  const loadBoundAgent = useCallback(async () => {
    if (!kbId) return;
    try {
      const kb = await api.getKnowledgeBase(kbId);
      if (!kb.bound_agent) {
        setBoundAgent(null);
        return;
      }
      const agent = await api.getAgent(kb.bound_agent.id);
      setBoundAgent(agent);
      setAutoFetchEnabled(agent.enable_auto_fetch || false);
      setFetchIntervalDays(agent.url_fetch_interval_days || 7);
      setCrawlMaxDepth(agent.crawl_max_depth ?? 2);
      setCrawlMaxPages(agent.crawl_max_pages ?? 20);
    } catch (error) {
      console.error('Failed to load the bound agent:', error);
      setBoundAgent(null);
    }
  }, [kbId]);

  useEffect(() => {
    void loadBoundAgent();
  }, [loadBoundAgent]);

  // #25: drop pending debounces on unmount, and never write state afterwards.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const timers = autoFetchTimersRef.current;
      for (const field of Object.keys(timers)) clearTimeout(timers[field]);
      autoFetchTimersRef.current = {};
    };
  }, []);

  const loadUrls = useCallback(async () => {
    if (!kbId) return;
    setLoading(true);
    try {
      const data = await api.listKbUrls(kbId);
      setUrls(data.urls);
      setTotal(data.total);

      const hasPendingOrFetching = data.urls.some(
        (url) => url.status === 'pending' || url.status === 'fetching',
      );
      // Only pending/fetching URLs start polling.
      if (
        hasPendingOrFetching &&
        !crawlPollingRef.current &&
        !stopPollingRequestedRef.current
      ) {
        setCrawlStartCount(data.total);
        setCrawlPolling(true);
      }
    } catch (error) {
      console.error('Failed to load URLs:', error);
    } finally {
      setLoading(false);
    }
  }, [kbId]);

  useEffect(() => {
    if (kbId) {
      void loadUrls();
    }
  }, [kbId, loadUrls]);

  const handleAddURL = async () => {
    if (!kbId) return;
    if (!newUrl.trim()) {
      alert(t('labels.urlManagement.enterUrl'));
      return;
    }

    stopPollingRequestedRef.current = false;
    setAdding(true);
    try {
      const result = await api.createKbUrls(kbId, [newUrl]);
      alert(
        t('labels.urlManagement.addedCount', { count: result.urls.length }),
      );
      if (result.auto_fetch_queued && result.job_id) {
        setCrawlPolling(true);
      }
      setNewUrl('');
      await loadUrls();
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '';
      if (errMsg.includes('Invalid URL')) {
        alert(t('labels.urlManagement.invalidUrl'));
      } else {
        alert(
          `${t('labels.urlManagement.addFailed')}: ${errMsg || t('errors.unknown')}`,
        );
      }
    } finally {
      setAdding(false);
    }
  };

  const handleRefetch = async () => {
    if (!kbId) return;
    if (!confirm(t('labels.urlManagement.confirmRefetch'))) return;

    stopPollingRequestedRef.current = false;
    setRefetching(true);
    try {
      const result = await api.refetchKbUrls(kbId, undefined, true);
      setCrawlStartCount(total);
      setCrawlPolling(true);
      await loadUrls();
      alert(t('labels.urlManagement.refetchStarted', { jobId: result.job_id }));
    } catch (error) {
      alert(
        `${t('labels.urlManagement.refetchFailed')}: ${
          error instanceof Error ? error.message : t('errors.unknown')
        }`,
      );
    } finally {
      setRefetching(false);
    }
  };

  const stopPolling = useCallback(async () => {
    stopPollingRequestedRef.current = true;
    try {
      if (kbId) {
        await api.cancelKbUrlTasks(kbId);
      }
    } catch (error) {
      console.error('Failed to cancel URL tasks:', error);
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setCrawlPolling(false);
    setPollingStopped(true);
    window.setTimeout(() => setPollingStopped(false), 2000);
  }, [kbId]);

  // Polling effect for crawl progress.
  useEffect(() => {
    if (!crawlPolling || !kbId) return;

    let pollCount = 0;
    let lastUrlCount = crawlStartCount;
    let consecutiveNoChange = 0;

    const pollURLs = async () => {
      pollCount++;

      try {
        const [data, status] = await Promise.all([
          api.listKbUrls(kbId),
          api.getKbIndexStatus(kbId).catch(() => null),
        ]);

        setUrls(data.urls);
        setTotal(data.total);
        setIndexState(status);

        const newUrlsAdded = data.total > lastUrlCount;
        if (newUrlsAdded) {
          lastUrlCount = data.total;
          consecutiveNoChange = 0;
        } else {
          consecutiveNoChange++;
        }

        const hasPendingOrFetching = data.urls.some(
          (url) => url.status === 'pending' || url.status === 'fetching',
        );
        // The KB index task is the only backend-side work signal available for
        // an unbound KB (there is no agent to ask for `tasks:status`).
        const backendBusy =
          status !== null &&
          (status.status === 'indexing' || status.status === 'rebuilding');

        // Stop requires: no queued URL, no backend index work, at least 3 polls
        // and one poll with a stable URL count. success-but-unindexed is NOT an
        // active signal — it may be a terminal failure.
        const shouldStop =
          !hasPendingOrFetching &&
          !backendBusy &&
          pollCount > 3 &&
          consecutiveNoChange >= 1;

        if (shouldStop) {
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          setCrawlPolling(false);
          await loadUrls();
          return;
        }

        // Fallback: 30 unchanged polls with no backend work means the crawl is
        // stuck; stop and let the operator retry.
        if (consecutiveNoChange > 30 && !backendBusy) {
          await stopPolling();
        }
      } catch (error) {
        console.error('[pollURLs] Polling error:', error);
      }
    };

    void pollURLs();

    pollingIntervalRef.current = setInterval(() => {
      void pollURLs();
    }, 2000);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [crawlPolling, kbId, crawlStartCount, stopPolling, loadUrls]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  const handleCrawlSite = async () => {
    if (!kbId) return;
    if (!newUrl.trim()) {
      alert(t('labels.urlManagement.enterUrl'));
      return;
    }

    const normalizedUrl = normalizeUrl(newUrl);

    stopPollingRequestedRef.current = false;
    setCrawling(true);
    setCrawlStartCount(total);
    try {
      await api.crawlKbSite(kbId, normalizedUrl, crawlMaxDepth, crawlMaxPages);
      setNewUrl('');
      setCrawlPolling(true);
    } catch (error) {
      console.error('Crawl API error:', error);
      const errMsg = error instanceof Error ? error.message : '';
      if (errMsg.includes('Invalid URL')) {
        alert(t('labels.urlManagement.invalidUrl'));
      } else {
        alert(
          `${t('labels.urlManagement.crawlFailed')}: ${
            errMsg || t('errors.unknown')
          }`,
        );
      }
    } finally {
      setCrawling(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, { className: string; label: string }> = {
      success: {
        className: 'badge badge-success',
        label: t('status.successBadge'),
      },
      failed: { className: 'badge badge-error', label: t('status.failed') },
      fetching: {
        className: 'badge badge-warning badge-pulse',
        label: t('status.fetching'),
      },
      pending: {
        className: 'badge badge-info badge-pulse',
        label: t('status.pending'),
      },
    };
    return styles[status] || { className: 'badge', label: status };
  };

  const getIndexStatusBadge = (
    url: URLSource,
  ): { className: string; label: string; showRebuild: boolean } | null => {
    if (url.status !== 'success') {
      return { className: 'badge', label: 'Not ready', showRebuild: false };
    }

    switch (url.indexing_status) {
      case 'ready':
        return {
          className: 'badge badge-success',
          label: 'Indexed',
          showRebuild: false,
        };
      case 'processing':
        return {
          className: 'badge badge-info',
          label: 'Indexing...',
          showRebuild: false,
        };
      case 'error':
        return {
          className: 'badge badge-error',
          label: 'Index Error',
          showRebuild: true,
        };
      case 'pending':
      default:
        if (url.is_indexed) {
          return {
            className: 'badge badge-success',
            label: 'Indexed',
            showRebuild: false,
          };
        }
        return {
          className: 'badge badge-warning',
          label: 'Not Indexed',
          showRebuild: true,
        };
    }
  };

  const handleRebuildIndex = async () => {
    if (!kbId) return;
    try {
      await api.rebuildKbIndex(kbId);
      setTimeout(() => void loadUrls(), 1000);
    } catch (error) {
      console.error('Failed to rebuild index:', error);
    }
  };

  const handleDelete = async (urlId: number) => {
    if (!kbId) return;
    if (!confirm(t('labels.urlManagement.confirmDelete'))) return;

    setDeletingUrlId(urlId);
    try {
      await api.deleteKbUrl(kbId, urlId);
      await loadUrls();
    } catch (error) {
      alert(
        `${t('labels.urlManagement.deleteFailed')}: ${
          error instanceof Error ? error.message : t('errors.unknown')
        }`,
      );
    } finally {
      setDeletingUrlId(null);
    }
  };

  const handleClearAll = () => {
    if (!kbId) return;
    if (urls.length === 0) return;
    setShowClearConfirm(true);
  };

  const confirmClearAll = async () => {
    if (!kbId) return;

    setClearing(true);
    try {
      const result = await api.clearKbUrls(kbId);
      setShowClearConfirm(false);
      await loadUrls();
      alert(
        t('labels.urlManagement.clearSuccess', {
          count: result.deleted_count ?? 0,
        }),
      );
    } catch (error) {
      alert(
        `${t('labels.urlManagement.clearFailed')}: ${
          error instanceof Error ? error.message : t('errors.unknown')
        }`,
      );
    } finally {
      setClearing(false);
    }
  };

  // #25 — persist on change. One field per PATCH so two quick edits never
  // overwrite each other with a stale full payload.
  const persistAutoFetch = useCallback(
    async (agentId: string, patch: AutoFetchPatch) => {
      if (!mountedRef.current) return;
      setSaveStatus('saving');
      try {
        await api.updateAgent(agentId, patch);
        if (mountedRef.current) setSaveStatus('saved');
      } catch (error) {
        console.error('Failed to save auto-fetch settings:', error);
        if (mountedRef.current) setSaveStatus('error');
      }
    },
    [],
  );

  const queueAutoFetchPatch = (
    field: keyof AutoFetchPatch,
    patch: AutoFetchPatch,
  ) => {
    // An unbound KB has no agent to PATCH: the crawl knobs stay local and only
    // feed `crawl:create`.
    if (!boundAgent) return;
    const agentId = boundAgent.id;
    const pending = autoFetchTimersRef.current[field];
    if (pending) clearTimeout(pending);
    autoFetchTimersRef.current[field] = setTimeout(() => {
      delete autoFetchTimersRef.current[field];
      void persistAutoFetch(agentId, patch);
    }, 500);
  };

  const handleAutoFetchToggle = (checked: boolean) => {
    setAutoFetchEnabled(checked);
    if (!boundAgent) return;
    void persistAutoFetch(boundAgent.id, { enable_auto_fetch: checked });
  };
  const backendBusy =
    indexState !== null &&
    (indexState.status === 'indexing' || indexState.status === 'rebuilding');

  // Row actions live in one overflow menu per URL row (§19: destructive
  // actions in a row menu). Nothing here fetches: the menu only re-uses the
  // handlers above.
  const renderRowMenu = (url: URLSource) => {
    const menuOpen = openMenuUrlId === url.id;
    const busy = deletingUrlId === url.id;
    return (
      <div
        style={{
          position: 'relative',
          display: 'flex',
          justifyContent: isMobile ? 'flex-start' : 'flex-end',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          className="btn btn-icon"
          aria-label={`${t('knowledgeBases.columns.actions')} ${url.url}`}
          title={`${t('knowledgeBases.columns.actions')} ${url.url}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={busy}
          onClick={() =>
            setOpenMenuUrlId((current) => (current === url.id ? null : url.id))
          }
        >
          {busy ? (
            <div className="spinner" style={{ width: '14px', height: '14px' }} />
          ) : (
            <Icon name="more" size={16} />
          )}
        </button>
        {menuOpen && (
          <div
            role="menu"
            aria-label={`${t('knowledgeBases.columns.actions')} ${url.url}`}
            style={{
              position: 'absolute',
              top: 'calc(100% + var(--space-1))',
              right: isMobile ? 'auto' : 0,
              left: isMobile ? 0 : 'auto',
              zIndex: 20,
              minWidth: 200,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-1)',
              padding: 'var(--space-1)',
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            {url.status === 'success' && !url.is_indexed && (
              <button
                type="button"
                role="menuitem"
                className="btn btn-ghost"
                style={{ justifyContent: 'flex-start' }}
                onClick={() => {
                  setOpenMenuUrlId(null);
                  void handleRebuildIndex();
                }}
              >
                {t('buttons.rebuild')}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="btn btn-danger"
              style={{ justifyContent: 'flex-start' }}
              disabled={busy}
              onClick={() => {
                setOpenMenuUrlId(null);
                void handleDelete(url.id);
              }}
            >
              {t('buttons.delete')}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <section
      data-testid="kb-url-panel"
      className="url-panel"
      aria-busy={loading}
      style={{ minWidth: 0, borderRight: 'none', height: 'auto' }}
    >
      {showClearConfirm && (
        <div className="modal-backdrop">
          <div
            className="card card-raised"
            style={{ width: '100%', maxWidth: 420 }}
          >
            <div className="card-header">
              <h2 className="card-title">
                {t('labels.urlManagement.clearAll')}
              </h2>
            </div>
            <div className="card-body">
              <p
                style={{
                  color: 'var(--fg-dim)',
                  lineHeight: 'var(--leading-relaxed)',
                }}
              >
                {t('labels.urlManagement.confirmClearAll')}
              </p>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 'var(--space-2)',
                  marginTop: 'var(--space-5)',
                }}
              >
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  onClick={() => setShowClearConfirm(false)}
                  disabled={clearing}
                  aria-label={t('buttons.cancel')}
                  title={t('buttons.cancel')}
                >
                  <Icon name="close" size={16} />
                </button>
                {/* Destructive confirm keeps its words: the user must read what
                  * they are confirming (round-6 rule). */}
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={confirmClearAll}
                  disabled={clearing}
                >
                  {clearing
                    ? t('labels.urlManagement.clearing')
                    : t('buttons.confirm')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <header className="page-header">
        <div style={{ minWidth: 0 }}>
          <h2 className="page-title">{t('labels.urlManagement.title')}</h2>
          <p className="page-subtitle">
            {t('labels.urlManagement.description')}
          </p>
        </div>
        <div className="page-actions">
          {total > 0 && (
            <span className="badge badge-neutral">
              {t('labels.urlManagement.total', { total: String(total) })}
            </span>
          )}
        </div>
      </header>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            {t('labels.urlManagement.addUrl')}
          </h3>
          <HelpTooltip
            title={t('labels.urlManagement.addUrlHelpTitle')}
            content={[
              t('labels.urlManagement.addUrlHelpContent1'),
              t('labels.urlManagement.addUrlHelpContent2'),
              t('labels.urlManagement.addUrlHelpContent3'),
              t('labels.urlManagement.addUrlHelpContent4'),
              '',
              t('labels.urlManagement.addUrlHelpDetail'),
              t('labels.urlManagement.addUrlHelpBullet1'),
              t('labels.urlManagement.addUrlHelpBullet2'),
              t('labels.urlManagement.addUrlHelpBullet3'),
              t('labels.urlManagement.addUrlHelpBullet4'),
            ]}
            position="top"
            size="sm"
          />
        </div>
        <div className="card-body">
          <div className="field">
            <label className="field-label">
              {t('labels.urlManagement.webpageUrl')}
              <HelpTooltip
                title={t('labels.urlManagement.webpageUrlHelpTitle')}
                content={[
                  t('labels.urlManagement.webpageUrlHelpContent1'),
                  t('labels.urlManagement.webpageUrlHelpContent2'),
                  t('labels.urlManagement.webpageUrlHelpContent3'),
                ]}
                position="top"
                size="sm"
              />
            </label>
            <input
              className="input"
              type="text"
              aria-label={t('labels.urlManagement.webpageUrl')}
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onBlur={handleUrlBlur}
              placeholder={t('labels.urlManagement.urlPlaceholder')}
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile
                ? 'minmax(0, 1fr)'
                : 'repeat(2, minmax(0, 1fr))',
              gap: 'var(--space-4)',
            }}
          >
            <div className="field">
              <label className="field-label">
                {t('labels.urlManagement.crawlDepth')}
                <HelpTooltip
                  title={t('labels.urlManagement.crawlDepth')}
                  content={[t('labels.urlManagement.crawlDepthDesc')]}
                  position="top"
                  size="sm"
                />
              </label>
              <input
                className="input"
                type="number"
                aria-label={t('labels.urlManagement.crawlDepth')}
                value={crawlMaxDepth}
                onChange={(e) => {
                  const next = Math.max(
                    1,
                    Math.min(5, parseInt(e.target.value) || 2),
                  );
                  setCrawlMaxDepth(next);
                  queueAutoFetchPatch('crawl_max_depth', {
                    crawl_max_depth: next,
                  });
                }}
                min={1}
                max={5}
              />
            </div>
            <div className="field">
              <label className="field-label">
                {t('labels.urlManagement.crawlMaxPages')}
                <HelpTooltip
                  title={t('labels.urlManagement.crawlMaxPages')}
                  content={[t('labels.urlManagement.crawlMaxPagesDesc')]}
                  position="top"
                  size="sm"
                />
              </label>
              <input
                className="input"
                type="number"
                aria-label={t('labels.urlManagement.crawlMaxPages')}
                value={crawlMaxPages}
                onChange={(e) => {
                  const next = Math.max(
                    1,
                    Math.min(500, parseInt(e.target.value) || 20),
                  );
                  setCrawlMaxPages(next);
                  queueAutoFetchPatch('crawl_max_pages', {
                    crawl_max_pages: next,
                  });
                }}
                min={1}
                max={500}
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAddURL}
              disabled={adding || !newUrl.trim()}
            >
              {adding ? (
                <>
                  <div className="spinner" style={{ width: '14px', height: '14px' }} />
                  {t('labels.urlManagement.adding')}
                </>
              ) : (
                t('labels.urlManagement.singlePageCrawl')
              )}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCrawlSite}
              disabled={crawling || backendBusy || !newUrl.trim()}
            >
              {crawling ? (
                <>
                  <div className="spinner" style={{ width: '14px', height: '14px' }} />
                  {t('labels.urlManagement.crawling')}
                </>
              ) : (
                t('labels.urlManagement.crawlSite')
              )}
            </button>
            <button
              type="button"
              className="btn btn-icon"
              aria-label={t('labels.urlManagement.refetchAll')}
              title={t('labels.urlManagement.refetchAll')}
              onClick={handleRefetch}
              disabled={refetching}
              style={{ marginLeft: 'auto' }}
            >
              {refetching ? (
                <div className="spinner" style={{ width: '14px', height: '14px' }} />
              ) : (
                <Icon name="refresh" size={16} />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Auto fetch: only meaningful when the KB is bound to an agent. */}
      {boundAgent && (
        <div data-testid="kb-url-autofetch" className="card">
          <div className="card-header">
            <h3 className="card-title">{t('labels.urlManagement.autoFetch')}</h3>
            <div
              role="status"
              aria-live="polite"
              className="playground-status"
              data-testid="kb-url-autofetch-status"
              data-state={saveStatus}
            >
              {saveStatus === 'saving' && (
                <>
                  <div className="spinner playground-status-spinner" />
                  <span>{t('status.saving')}</span>
                </>
              )}
              {saveStatus === 'saved' && <span>{t('status.saved')}</span>}
              {saveStatus === 'error' && <span>{t('errors.saveFailed')}</span>}
            </div>
            <span
              className="badge badge-neutral"
              style={{ whiteSpace: 'normal', textAlign: 'left' }}
            >
              {t('labels.urlManagement.autoFetchDescription')}
            </span>
          </div>
          <div className="card-body">
            <label className="switch" style={{ alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={autoFetchEnabled}
                onChange={(e) => handleAutoFetchToggle(e.target.checked)}
                aria-label={t('labels.urlManagement.enableAutoFetch')}
              />
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)',
                    fontWeight: 500,
                    color: 'var(--fg-strong)',
                  }}
                >
                  {t('labels.urlManagement.enableAutoFetch')}
                  <HelpTooltip
                    title={t('labels.urlManagement.enableAutoFetchHelpTitle')}
                    content={[
                      t('labels.urlManagement.enableAutoFetchHelpContent1'),
                      t('labels.urlManagement.enableAutoFetchHelpContent2'),
                      t('labels.urlManagement.enableAutoFetchHelpContent3'),
                    ]}
                    position="top"
                    size="sm"
                  />
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--fg-dim)',
                  }}
                >
                  {t('labels.urlManagement.enableAutoFetchDesc')}
                </span>
              </span>
            </label>

            {autoFetchEnabled && (
              <div className="field" style={{ marginTop: 'var(--space-4)' }}>
                <label className="field-label">
                  {t('labels.urlManagement.fetchInterval')}
                </label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    flexWrap: 'wrap',
                  }}
                >
                  <input
                    className="input"
                    type="number"
                    aria-label={t('labels.urlManagement.fetchInterval')}
                    value={fetchIntervalDays}
                    onChange={(e) => {
                      const next = Math.max(1, parseInt(e.target.value) || 7);
                      setFetchIntervalDays(next);
                      queueAutoFetchPatch('url_fetch_interval_days', {
                        url_fetch_interval_days: next,
                      });
                    }}
                    min={1}
                    max={30}
                    style={{ width: '120px' }}
                  />
                  <span
                    style={{
                      color: 'var(--fg-dim)',
                      fontSize: 'var(--text-sm)',
                    }}
                  >
                    {t('labels.urlManagement.days')}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">{t('labels.urlManagement.urlList')}</h3>
          <div className="page-actions">
            {crawlPolling && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={stopPolling}
              >
                <div className="spinner" style={{ width: '14px', height: '14px' }} />
                {t('labels.urlManagement.stopPolling')}
              </button>
            )}
            {pollingStopped && !crawlPolling && (
              <span className="badge badge-success">
                {t('labels.urlManagement.pollingStopped')}
              </span>
            )}
            {urls.length > 0 && (
              <button
                type="button"
                className="btn btn-danger btn-icon"
                onClick={handleClearAll}
                disabled={clearing}
                aria-label={t('labels.urlManagement.clearAll')}
                title={t('labels.urlManagement.clearAll')}
              >
                {clearing ? (
                  <div
                    className="spinner"
                    style={{ width: '14px', height: '14px' }}
                  />
                ) : (
                  <Icon name="trash" size={16} />
                )}
              </button>
            )}
          </div>
        </div>

        <div className="card-body">
          {crawlPolling && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-4)',
                marginBottom: 'var(--space-4)',
                background: 'var(--color-info-bg)',
                border: '1px solid var(--color-info)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div className="spinner" style={{ width: '16px', height: '16px' }} />
              <span style={{ color: 'var(--fg-strong)', fontWeight: 500 }}>
                {t('labels.urlManagement.crawlInProgress')}
              </span>
            </div>
          )}

          {/* Crawl error banner */}
          {!crawlPolling &&
            urls.some((u) => u.status === 'failed' && u.last_error) && (
              <div
                style={{
                  padding: 'var(--space-3) var(--space-4)',
                  marginBottom: 'var(--space-4)',
                  background: 'var(--color-error-bg)',
                  border: '1px solid var(--color-error)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <span
                  style={{
                    color: 'var(--color-error)',
                    fontWeight: 500,
                    fontSize: 'var(--text-sm)',
                  }}
                >
                  {t('labels.urlManagement.crawlError')}
                </span>
                <div style={{ marginTop: 'var(--space-1)' }}>
                  {urls
                    .filter((u) => u.status === 'failed' && u.last_error)
                    .slice(0, 3)
                    .map((u) => (
                      <p
                        key={u.id}
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: 'var(--fg-dim)',
                          margin: '2px 0',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {u.url}: {u.last_error}
                      </p>
                    ))}
                </div>
              </div>
            )}

          {urls.length === 0 ? (
            <div className="empty">
              <p className="empty-title">{t('labels.urlManagement.noUrls')}</p>
              <p className="empty-description">
                {t('labels.urlManagement.pleaseAddUrl')}
              </p>
            </div>
          ) : (
            <div className="kb-table-scroll">
              <table className="kb-table">
                <thead>
                  <tr>
                    <th>{t('labels.urlManagement.webpageUrl')}</th>
                    <th>{t('knowledgeBases.columns.status')}</th>
                    <th>{t('labels.indexStatus')}</th>
                    <th>{t('labels.urlManagement.lastFetch')}</th>
                    <th>{t('knowledgeBases.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {urls.map((url) => {
                    const status = getStatusBadge(url.status);
                    const index = getIndexStatusBadge(url);
                    return (
                      <tr key={url.id}>
                        <td style={{ maxWidth: 0 }}>
                          <a
                            href={url.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'block',
                              color: 'var(--color-accent-primary)',
                              textDecoration: 'none',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {url.url}
                          </a>
                          {url.title && (
                            <p
                              style={{
                                marginTop: 'var(--space-1)',
                                fontSize: 'var(--text-sm)',
                                color: 'var(--fg-dim)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {url.title}
                            </p>
                          )}
                          {/* Indexing error display */}
                          {url.status === 'success' &&
                            !url.is_indexed &&
                            url.indexing_error && (
                              <p
                                style={{
                                  marginTop: 'var(--space-2)',
                                  padding: 'var(--space-1) var(--space-2)',
                                  fontSize: 'var(--text-xs)',
                                  color: 'var(--color-error)',
                                  background: 'var(--color-error-bg)',
                                  borderLeft: '2px solid var(--color-error)',
                                  borderRadius: 'var(--radius-sm)',
                                }}
                              >
                                {url.indexing_error}
                              </p>
                            )}
                          {/* Fetch error display */}
                          {url.status === 'failed' && url.last_error && (
                            <p
                              style={{
                                marginTop: 'var(--space-2)',
                                padding: 'var(--space-1) var(--space-2)',
                                fontSize: 'var(--text-xs)',
                                color: 'var(--color-error)',
                                background: 'var(--color-error-bg)',
                                borderLeft: '2px solid var(--color-error)',
                                borderRadius: 'var(--radius-sm)',
                              }}
                            >
                              {url.last_error}
                            </p>
                          )}
                        </td>
                        <td>
                          <span className={status.className}>{status.label}</span>
                        </td>
                        <td>
                          {index ? (
                            <span className={index.className}>{index.label}</span>
                          ) : null}
                        </td>
                        <td
                          style={{
                            fontSize: 'var(--text-sm)',
                            color: 'var(--fg-dim)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {url.last_fetch_at
                            ? new Date(url.last_fetch_at).toLocaleString()
                            : ''}
                        </td>
                        <td>{renderRowMenu(url)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
