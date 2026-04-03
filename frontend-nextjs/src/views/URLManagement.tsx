'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api'
import type { URLSource, Agent } from '../services/api';
import AdminLayout from '../components/AdminLayout';
import HelpTooltip from '../components/HelpTooltip';
import { useIsMobile } from '../hooks/useMediaQuery';
import SourcesSummary from '../components/SourcesSummary';

interface TaskStatus {
  is_crawling: boolean;
  is_rebuilding: boolean;
  can_modify_index: boolean;
  active_tasks: string[];
}

export default function URLManagement() {
  const { t } = useTranslation('common');
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [urls, setUrls] = useState<URLSource[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [jinaKeyReady, setJinaKeyReady] = useState<boolean | null>(null);
  const [newUrl, setNewUrl] = useState('');
  const [refetching, setRefetching] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoFetchEnabled, setAutoFetchEnabled] = useState(false);
  const [fetchIntervalDays, setFetchIntervalDays] = useState(7);
  const [crawlMaxDepth, setCrawlMaxDepth] = useState(2);
  const [crawlMaxPages, setCrawlMaxPages] = useState(20);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [crawlPolling, setCrawlPolling] = useState(false);
  const [crawlStartCount, setCrawlStartCount] = useState(0);
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null);
  const [isRetraining, setIsRetraining] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [pollingStopped, setPollingStopped] = useState(false);
  const [deletingUrlId, setDeletingUrlId] = useState<number | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const taskStatusIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const jinaKeyCheckInFlightRef = useRef(false);
  const redirectedForJinaKeyRef = useRef(false);
  const stopPollingRequestedRef = useRef(false);

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

  useEffect(() => {
    loadDefaultAgent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!agentId || jinaKeyCheckInFlightRef.current || jinaKeyReady !== null) return;
    // 检查开始时设为 null，表示检查中，不显示警告
    setJinaKeyReady(null);
    jinaKeyCheckInFlightRef.current = true;
    const checkJinaKey = async () => {
      try {
        const status = await api.getJinaKeyStatus(agentId);
        if (!status.configured) {
          setJinaKeyReady(false);
          if (!redirectedForJinaKeyRef.current) {
            redirectedForJinaKeyRef.current = true;
            navigate('/playground?highlightJinaKey=true');
          }
        } else {
          redirectedForJinaKeyRef.current = false;
          setJinaKeyReady(true);
        }
      } catch {
        setJinaKeyReady(false);
        if (!redirectedForJinaKeyRef.current) {
          redirectedForJinaKeyRef.current = true;
          navigate('/playground?highlightJinaKey=true');
        }
      } finally {
        jinaKeyCheckInFlightRef.current = false;
      }
    };
    checkJinaKey();
  }, [agentId, jinaKeyReady, navigate]);

  useEffect(() => {
    if (agentId && jinaKeyReady) {
      loadURLs();
      // Start task status polling
      pollTaskStatus();
      taskStatusIntervalRef.current = setInterval(pollTaskStatus, 3000);
    }
    return () => {
      if (taskStatusIntervalRef.current) {
        clearInterval(taskStatusIntervalRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, jinaKeyReady]);

  const pollTaskStatus = async () => {
    if (!agentId) return;
    try {
      const status = await api.getTasksStatus(agentId);
      setTaskStatus(status);
      // If backend reports crawling, enable polling unless the user explicitly stopped live updates
      if (status.is_crawling && !crawlPolling && !stopPollingRequestedRef.current) {
        setCrawlPolling(true);
      }
      // Sync isRetraining with backend status using functional update to avoid stale closure
      if (status.is_rebuilding) {
        setIsRetraining(true);
      } else {
        setIsRetraining(prev => {
          if (prev && !status.is_rebuilding) {
            setRefreshTrigger(t => t + 1);
            loadURLs();
          }
          return false;
        });
      }
    } catch (error) {
      console.error('Failed to poll task status:', error);
    }
  };

  const loadDefaultAgent = async () => {
    try {
      const data = await api.getDefaultAgent();
      setAgent(data);
      setAgentId(data.id);
      setAutoFetchEnabled(data.enable_auto_fetch || false);
      setFetchIntervalDays(data.url_fetch_interval_days || 7);
      setCrawlMaxDepth(data.crawl_max_depth ?? 2);
      setCrawlMaxPages(data.crawl_max_pages ?? 20);
    } catch (error) {
      alert(`${t('labels.urlManagement.loadAgentFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
    }
  };

  const loadURLs = useCallback(async () => {
    if (!agentId || !jinaKeyReady) return;
    setLoading(true);
    try {
      const data = await api.listURLs(agentId);
      setUrls(data.urls);
      setTotal(data.total);

      const hasPendingOrFetching = data.urls.some(
        (url) => url.status === 'pending' || url.status === 'fetching'
      );
      if (hasPendingOrFetching && !crawlPolling && !stopPollingRequestedRef.current) {
        setCrawlStartCount(data.total);
        setCrawlPolling(true);
      }
    } catch (error) {
      alert(`${t('labels.urlManagement.loadFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
    } finally {
      setLoading(false);
    }
  }, [agentId, jinaKeyReady, crawlPolling, t]);

  const handleAddURL = async () => {
    if (!agentId) return;
    if (!newUrl.trim()) {
      alert(t('labels.urlManagement.enterUrl'));
      return;
    }

    stopPollingRequestedRef.current = false;
    setAdding(true);
    try {
      const result = await api.createURLs(agentId, [newUrl]);
      alert(t('labels.urlManagement.addedCount', { count: result.created }));

      setNewUrl('');
      await loadURLs();
    } catch (error) {
      alert(`${t('labels.urlManagement.addFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
    } finally {
      setAdding(false);
    }
  };

  const handleRefetch = async () => {
    if (!agentId) return;
    if (!confirm(t('labels.urlManagement.confirmRefetch'))) return;

    stopPollingRequestedRef.current = false;
    setRefetching(true);
    try {
      const result = await api.refetchURLs(agentId, undefined, true);
      setCrawlStartCount(total);
      setCrawlPolling(true);
      await loadURLs();
      alert(t('labels.urlManagement.refetchStarted', { jobId: result.job_id }));
    } catch (error) {
      alert(`${t('labels.urlManagement.refetchFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
    } finally {
      setRefetching(false);
    }
  };

  const stopPolling = useCallback(async () => {
    stopPollingRequestedRef.current = true;
    try {
      if (agentId) {
        await api.cancelURLTasks(agentId);
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
  }, [agentId]);

  // Polling effect for crawl progress
  useEffect(() => {
    if (!crawlPolling || !agentId) return;

    let pollCount = 0;
    const maxPolls = 60; // 最多轮询 60 次 (约 2 分钟)
    let lastUrlCount = crawlStartCount;
    let consecutiveNoChange = 0; // 连续无变化次数

    const pollURLs = async () => {
      pollCount++;

      try {
        // 同时查询 URL 列表和任务状态
        const [data, tasksStatus] = await Promise.all([
          api.listURLs(agentId),
          api.getTasksStatus(agentId)
        ]);

        // 更新 URL 列表
        setUrls(data.urls);
        setTotal(data.total);

        // 检查是否有新 URL 被添加
        const newUrlsAdded = data.total > lastUrlCount;
        if (newUrlsAdded) {
          lastUrlCount = data.total;
          consecutiveNoChange = 0;
        } else {
          consecutiveNoChange++;
        }

        // 停止条件：
        // 1. 后端报告没有正在进行的抓取任务
        // 2. 且已经轮询了至少 3 次
        // 3. 且连续 2 次没有新 URL 增加（确保数据已稳定）
        if (!tasksStatus.is_crawling && pollCount > 3 && consecutiveNoChange >= 2) {
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          setCrawlPolling(false);
          window.setTimeout(() => {
            void loadURLs();
          }, 500);
          return;
        }

        // 备选停止条件：如果轮询超过 30 次仍没有变化，可能是抓取失败
        if (consecutiveNoChange > 30 && !tasksStatus.is_crawling) {
          await stopPolling();
        }
      } catch (error) {
        console.error('[pollURLs] Polling error:', error);
      }
    };

    // Initial poll - 立即执行第一次
    pollURLs();

    // Set up interval
    pollingIntervalRef.current = setInterval(pollURLs, 2000);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [crawlPolling, agentId, crawlStartCount, stopPolling, loadURLs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  const handleCrawlSite = async () => {
    if (!agentId || !jinaKeyReady) {
      return;
    }
    if (!newUrl.trim()) {
      alert(t('labels.urlManagement.enterUrl'));
      return;
    }

    stopPollingRequestedRef.current = false;
    setCrawling(true);
    setCrawlStartCount(total);
    try {
      await api.crawlSite(agentId, newUrl, crawlMaxDepth, crawlMaxPages);
      setNewUrl('');
      setCrawlPolling(true);
    } catch (error) {
      console.error('Crawl API error:', error);
      alert(`${t('labels.urlManagement.crawlFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
    } finally {
      setCrawling(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, { className: string; label: string }> = {
      success: { className: 'badge badge-success', label: t('status.successBadge') },
      failed: { className: 'badge badge-error', label: t('status.failed') },
      fetching: { className: 'badge badge-warning', label: t('status.fetching') },
      pending: { className: 'badge badge-info', label: t('status.pending') },
    };
    return styles[status] || { className: 'badge', label: status };
  };

  const handleDelete = async (urlId: number) => {
    if (!agentId) return;
    if (!confirm(t('labels.urlManagement.confirmDelete'))) return;

    setDeletingUrlId(urlId);
    try {
      await api.deleteURL(agentId, urlId);
      await loadURLs();
    } catch (error) {
      alert(`${t('labels.urlManagement.deleteFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
    } finally {
      setDeletingUrlId(null);
    }
  };

  const handleClearAll = () => {
    if (!agentId || !jinaKeyReady) return;
    if (urls.length === 0) return;
    setShowClearConfirm(true);
  };

  const confirmClearAll = async () => {
    if (!agentId || !jinaKeyReady) return;

    setClearing(true);
    try {
      const result = await api.clearAllUrls(agentId);
      setShowClearConfirm(false);
      await loadURLs();
      alert(t('labels.urlManagement.clearSuccess', { count: result.deleted_count }));
    } catch (error) {
      alert(`${t('labels.urlManagement.clearFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
    } finally {
      setClearing(false);
    }
  };

  const handleSaveAutoFetchSettings = async () => {
    if (!agent || !jinaKeyReady) return;
    setSaving(true);
    try {
      await api.updateAgent(agent.id, {
        enable_auto_fetch: autoFetchEnabled,
        url_fetch_interval_days: fetchIntervalDays,
        crawl_max_depth: crawlMaxDepth,
        crawl_max_pages: crawlMaxPages,
      });
      alert(t('labels.urlManagement.autoFetchSaved'));
    } catch (error) {
      alert(`${t('errors.saveFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRetrain = async () => {
    if (!agentId || !jinaKeyReady) return;
    if (taskStatus?.is_crawling) {
      alert(t('labels.qa.crawlInProgress'));
      return;
    }
    if (taskStatus?.is_rebuilding) {
      alert(t('labels.qa.rebuildInProgress'));
      return;
    }
    setIsRetraining(true);
    try {
      await api.rebuildIndex(agentId, true);
      // 轮询会自动处理训练完成后的状态更新
    } catch (error) {
      alert(`${t('sources.retrainFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
      setIsRetraining(false);
    }
  };

  return (
    <AdminLayout>
      {showClearConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '420px',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-xl)',
              padding: 'var(--space-6)',
            }}
          >
            <h3 style={{ margin: 0, marginBottom: 'var(--space-3)', fontSize: 'var(--text-lg)', color: 'var(--color-text-primary)' }}>
              {t('labels.urlManagement.clearAll')}
            </h3>
            <p style={{ margin: 0, marginBottom: 'var(--space-5)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              {t('labels.urlManagement.confirmClearAll')}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowClearConfirm(false)}
                disabled={clearing}
              >
                {t('buttons.cancel')}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={confirmClearAll}
                disabled={clearing}
                style={{ background: 'var(--color-error)', borderColor: 'var(--color-error)' }}
              >
                {clearing ? t('labels.urlManagement.clearing') : t('buttons.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{
        padding: isMobile ? 'var(--space-4)' : 'var(--space-8)',
        maxWidth: '1400px',
        margin: '0 auto',
      }}>
        <header style={{
          marginBottom: 'var(--space-8)',
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'flex-start' : 'center',
          justifyContent: 'space-between',
          gap: isMobile ? 'var(--space-4)' : '0',
        }}>
          <div>
            <h1 style={{
              fontSize: 'var(--text-3xl)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              marginBottom: 'var(--space-2)',
            }}>
              {t('labels.urlManagement.title')}
            </h1>
            <p style={{
              color: 'var(--color-text-secondary)',
            }}>
              {t('labels.urlManagement.description')}
            </p>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-4)',
          }}>
            {total > 0 && (
              <span className="badge badge-info" style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-4)' }}>
                {t('labels.urlManagement.total', { total: String(total) })}
              </span>
            )}
          </div>
        </header>

        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'minmax(320px, 380px) 1fr 300px',
          gridTemplateRows: isMobile ? 'auto' : 'auto auto',
          gap: 'var(--space-6)',
        }}>
          {jinaKeyReady === false && (
            <div style={{
              gridColumn: isMobile ? 'auto' : '1 / -1',
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-2)',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-md)',
              color: '#ef4444',
              fontSize: 'var(--text-sm)',
            }}>
              {t('labels.jinaKeyRequired')}
            </div>
          )}
          <div className="glass-card" style={{ padding: 'var(--space-6)', gridColumn: isMobile ? 'auto' : '1', gridRow: isMobile ? 'auto' : '1' }}>
            <h2 style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 600,
              marginBottom: 'var(--space-6)',
              color: 'var(--color-text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
                    {t('labels.urlManagement.addUrl')}
              <HelpTooltip
                title={t('labels.urlManagement.addUrlHelpTitle')}
                content={[
                  t('labels.urlManagement.addUrlHelpContent1'),
                  t('labels.urlManagement.addUrlHelpContent2'),
                  t('labels.urlManagement.addUrlHelpContent3'),
                  t('labels.urlManagement.addUrlHelpContent4'),
                  "",
                  t('labels.urlManagement.addUrlHelpDetail'),
                  t('labels.urlManagement.addUrlHelpBullet1'),
                  t('labels.urlManagement.addUrlHelpBullet2'),
                  t('labels.urlManagement.addUrlHelpBullet3'),
                  t('labels.urlManagement.addUrlHelpBullet4')
                ]}
                position="top"
                size="sm"
              />
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div>
                <label style={{
                  display: 'block',
                  marginBottom: 'var(--space-2)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  color: 'var(--color-text-secondary)',
                }}>
                  {t('labels.urlManagement.webpageUrl')}
                  <HelpTooltip
                    title={t('labels.urlManagement.webpageUrlHelpTitle')}
                    content={[
                      t('labels.urlManagement.webpageUrlHelpContent1'),
                      t('labels.urlManagement.webpageUrlHelpContent2'),
                      t('labels.urlManagement.webpageUrlHelpContent3')
                    ]}
                    position="top"
                    size="sm"
                  />
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    onBlur={handleUrlBlur}
                    placeholder={t('labels.urlManagement.urlPlaceholder')}
                    style={{ paddingLeft: 'var(--space-12)' }}
                  />
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{
                      position: 'absolute',
                      left: 'var(--space-4)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                </div>
              </div>

              <button
                onClick={handleAddURL}
                disabled={adding || !newUrl.trim() || !jinaKeyReady}
                style={{
                  width: '100%',
                  padding: 'var(--space-3)',
                  background: 'var(--color-accent-gradient)',
                  color: 'var(--color-text-inverse)',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  cursor: adding || !newUrl.trim() || !jinaKeyReady ? 'not-allowed' : 'pointer',
                  opacity: adding || !newUrl.trim() || !jinaKeyReady ? 0.5 : 1,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-2)',
                }}
              >
                {adding ? (
                  <>
                    <div className="spinner" />
                    {t('labels.urlManagement.adding')}
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="16" />
                      <line x1="8" y1="12" x2="16" y2="12" />
                    </svg>
              {t('labels.urlManagement.singlePageCrawl')}
                  </>
                )}
              </button>

              <button
                  onClick={handleCrawlSite}
                  disabled={crawling || !newUrl.trim() || !jinaKeyReady}
                  className="btn-secondary"
                  style={{
                    width: '100%',
                    marginTop: 'var(--space-3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--space-2)',
                    background: 'linear-gradient(135deg, #8B5CF6, #6366F1)',
                    color: 'white',
                    border: 'none',
                  }}
                >
                  {crawling ? (
                    <>
                      <div className="spinner" />
                      {t('labels.urlManagement.crawling')}
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                      {t('labels.urlManagement.crawlSite')}
                    </>
                  )}
                </button>

              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                gap: 'var(--space-4)',
                marginTop: 'var(--space-4)',
              }}>
                <div>
                  <label style={{
                    display: 'block',
                    marginBottom: 'var(--space-2)',
                    fontSize: 'var(--text-sm)',
                    fontWeight: 500,
                    color: 'var(--color-text-secondary)',
                  }}>
                    {t('labels.urlManagement.crawlDepth')}
                    <HelpTooltip
                      title={t('labels.urlManagement.crawlDepth')}
                      content={[t('labels.urlManagement.crawlDepthDesc')]}
                      position="top"
                      size="sm"
                    />
                  </label>
                  <input
                    type="number"
                    value={crawlMaxDepth}
                    onChange={(e) => setCrawlMaxDepth(Math.max(1, Math.min(5, parseInt(e.target.value) || 2)))}
                    min={1}
                    max={5}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{
                    display: 'block',
                    marginBottom: 'var(--space-2)',
                    fontSize: 'var(--text-sm)',
                    fontWeight: 500,
                    color: 'var(--color-text-secondary)',
                  }}>
                    {t('labels.urlManagement.crawlMaxPages')}
                    <HelpTooltip
                      title={t('labels.urlManagement.crawlMaxPages')}
                      content={[t('labels.urlManagement.crawlMaxPagesDesc')]}
                      position="top"
                      size="sm"
                    />
                  </label>
                  <input
                    type="number"
                    value={crawlMaxPages}
                    onChange={(e) => setCrawlMaxPages(Math.max(1, Math.min(50, parseInt(e.target.value) || 20)))}
                    min={1}
                    max={50}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div style={{
                borderTop: '1px solid var(--color-border)',
                paddingTop: 'var(--space-4)',
                marginTop: 'var(--space-4)',
              }}>
                <button
                  onClick={handleRefetch}
                  disabled={refetching}
                  className="btn-secondary"
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--space-2)',
                  }}
                >
                  {refetching ? (
                    <>
                      <div className="spinner" />
                      {t('labels.urlManagement.refetching')}
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M23 4v6h-6M1 20v-6h6" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                      </svg>
                      {t('labels.urlManagement.refetchAll')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          
          <div className="glass-card" style={{ padding: 'var(--space-6)', minWidth: 0, overflow: 'hidden', gridColumn: isMobile ? 'auto' : '2', gridRow: isMobile ? 'auto' : '1', display: 'flex', flexDirection: 'column' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                marginBottom: 'var(--space-4)',
              }}>
              <div style={{
                width: '40px',
                height: '40px',
                background: 'linear-gradient(135deg, #F59E0B, #F97316)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 0 1 9-9" />
                </svg>
              </div>
              <div>
                <h2 style={{
                  fontSize: 'var(--text-lg)',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                }}>
                  {t('labels.urlManagement.autoFetch')}
                </h2>
                <p style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text-muted)',
                }}>
                  {t('labels.urlManagement.autoFetchDescription')}
                </p>
              </div>
            </div>

            <div style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'stretch' : 'center',
              justifyContent: 'space-between',
              gap: isMobile ? 'var(--space-3)' : 'var(--space-4)',
              padding: 'var(--space-4)',
              background: 'var(--color-bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-4)',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  color: 'var(--color-text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                }}>
                  {t('labels.urlManagement.enableAutoFetch')}
                  <HelpTooltip
                    title={t('labels.urlManagement.enableAutoFetchHelpTitle')}
                    content={[
                      t('labels.urlManagement.enableAutoFetchHelpContent1'),
                      t('labels.urlManagement.enableAutoFetchHelpContent2'),
                      t('labels.urlManagement.enableAutoFetchHelpContent3')
                    ]}
                    position="top"
                    size="sm"
                  />
                </div>
                <div style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-muted)',
                  marginTop: 'var(--space-1)',
                }}>
                  {t('labels.urlManagement.enableAutoFetchDesc')}
                </div>
              </div>
              <button
                onClick={() => setAutoFetchEnabled(!autoFetchEnabled)}
                aria-pressed={autoFetchEnabled}
                style={{
                  width: isMobile ? '56px' : '48px',
                  height: isMobile ? '32px' : '28px',
                  alignSelf: isMobile ? 'flex-start' : 'auto',
                  borderRadius: isMobile ? '16px' : '14px',
                  border: 'none',
                  background: autoFetchEnabled ? 'var(--color-accent-primary)' : 'var(--color-bg-secondary)',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'background 0.2s',
                  touchAction: 'manipulation',
                }}
              >
                <span style={{
                  position: 'absolute',
                  top: '2px',
                  left: autoFetchEnabled ? (isMobile ? '26px' : '22px') : '2px',
                  width: isMobile ? '28px' : '24px',
                  height: isMobile ? '28px' : '24px',
                  borderRadius: isMobile ? '14px' : '12px',
                  background: 'white',
                  transition: 'left 0.2s',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                }} />
              </button>
            </div>

            {autoFetchEnabled && (
              <div style={{
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                alignItems: isMobile ? 'stretch' : 'center',
                gap: 'var(--space-4)',
                marginBottom: 'var(--space-4)',
              }}>
                <div style={{ flex: 1 }}>
                  <label style={{
                    display: 'block',
                    marginBottom: 'var(--space-2)',
                    fontSize: 'var(--text-sm)',
                    fontWeight: 500,
                    color: 'var(--color-text-secondary)',
                  }}>
                    {t('labels.urlManagement.fetchInterval')}
                    <HelpTooltip
                      title={t('labels.urlManagement.fetchIntervalHelpTitle')}
                      content={[
                        t('labels.urlManagement.fetchIntervalHelpContent1'),
                        t('labels.urlManagement.fetchIntervalHelpContent2'),
                        t('labels.urlManagement.fetchIntervalHelpContent3')
                      ]}
                      position="top"
                      size="sm"
                    />
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <input
                      type="number"
                      value={fetchIntervalDays}
                      onChange={(e) => setFetchIntervalDays(Math.max(1, parseInt(e.target.value) || 7))}
                      min={1}
                      max={30}
                      style={{
                        width: isMobile ? '100%' : '120px',
                        maxWidth: isMobile ? '160px' : '120px',
                      }}
                    />
                    <span style={{
                      color: 'var(--color-text-secondary)',
                      fontSize: 'var(--text-sm)',
                    }}>
                      {t('labels.urlManagement.days')}
                    </span>
                  </div>
                  <p style={{
                    marginTop: 'var(--space-2)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-muted)',
                  }}>
                    {t('labels.urlManagement.fetchIntervalDesc')}
                  </p>
                </div>
              </div>
            )}

            <button
              onClick={handleSaveAutoFetchSettings}
              disabled={saving || !jinaKeyReady}
              style={{
                width: '100%',
                padding: 'var(--space-3)',
                background: 'var(--color-accent-gradient)',
                color: 'var(--color-text-inverse)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-2)',
              }}
            >
              {saving ? (
                <>
                  <div className="spinner" />
                  {t('status.saving')}
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                  {t('labels.urlManagement.saveSettings')}
                </>
              )}
            </button>
          </div>
          
          <div className="glass-card" style={{ padding: 'var(--space-6)', height: 'fit-content', minWidth: 0, overflow: 'hidden', gridColumn: isMobile ? 'auto' : '1 / span 2', gridRow: isMobile ? 'auto' : '2' }}>
            <div style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'stretch' : 'center',
              justifyContent: 'space-between',
              marginBottom: 'var(--space-6)',
              flexWrap: 'wrap',
              gap: 'var(--space-2)',
            }}>
              <h2 style={{
                fontSize: 'var(--text-lg)',
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
                {t('labels.urlManagement.urlList')}
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', width: isMobile ? '100%' : 'auto' }}>
                {crawlPolling && (
                  <button
                    onClick={stopPolling}
                    className="btn-ghost"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 'var(--space-2)',
                      color: 'var(--color-warning)',
                      minHeight: isMobile ? '44px' : undefined,
                      width: isMobile ? '100%' : 'auto',
                    }}
                  >
                    <div className="spinner" style={{ width: '14px', height: '14px' }} />
                    {t('labels.urlManagement.stopPolling')}
                  </button>
                )}
                {pollingStopped && !crawlPolling && (
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      color: 'var(--color-success)',
                      fontSize: 'var(--text-sm)',
                      width: isMobile ? '100%' : 'auto',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {t('labels.urlManagement.pollingStopped')}
                  </span>
                )}
                {urls.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    disabled={clearing || !jinaKeyReady}
                    className="btn-ghost"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 'var(--space-2)',
                      color: 'var(--color-error)',
                      opacity: clearing || !jinaKeyReady ? 0.5 : 1,
                      cursor: clearing || !jinaKeyReady ? 'not-allowed' : 'pointer',
                      minHeight: isMobile ? '44px' : undefined,
                      width: isMobile ? '100%' : 'auto',
                    }}
                  >
                    {clearing ? (
                      <>
                        <div className="spinner" style={{ width: '14px', height: '14px' }} />
                        {t('labels.urlManagement.clearing')}
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                        {t('labels.urlManagement.clearAll')}
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={loadURLs}
                  disabled={loading}
                  className="btn-ghost"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--space-2)',
                    minHeight: isMobile ? '44px' : undefined,
                    width: isMobile ? '100%' : 'auto',
                  }}
                >
                  {loading ? (
                    <div className="spinner" />
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 4v6h-6M1 20v-6h6" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                  )}
                  {t('buttons.refresh')}
                </button>
              </div>
            </div>

            {(crawlPolling || taskStatus?.is_crawling) && (
              <div style={{
                padding: 'var(--space-3) var(--space-4)',
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(99, 102, 241, 0.1))',
                borderRadius: 'var(--radius-md)',
                marginBottom: 'var(--space-4)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                border: '1px solid rgba(139, 92, 246, 0.3)',
              }}>
                <div className="spinner" style={{ width: '16px', height: '16px' }} />
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
                  {t('labels.urlManagement.crawlInProgress')}
                </span>
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  {t('labels.urlManagement.crawlDiscovered', { count: total - crawlStartCount })}
                </span>
              </div>
            )}

            {taskStatus?.is_rebuilding && (
              <div style={{
                padding: 'var(--space-3) var(--space-4)',
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(37, 99, 235, 0.1))',
                borderRadius: 'var(--radius-md)',
                marginBottom: 'var(--space-4)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
              }}>
                <div className="spinner" style={{ width: '16px', height: '16px' }} />
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
                  {t('labels.urlManagement.indexRebuildInProgress')}
                </span>
              </div>
            )}

            <div style={{
              maxHeight: '600px',
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}>
              {urls.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: 'var(--space-12)',
                  color: 'var(--color-text-muted)',
                }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto var(--space-4)' }}>
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  <p style={{ fontSize: 'var(--text-base)' }}>{t('labels.urlManagement.noUrls')}</p>
                  <p style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-2)' }}>{t('labels.urlManagement.pleaseAddUrl')}</p>
                </div>
              ) : (
                urls.map((url) => (
                  <div
                    key={url.id}
                    style={{
                      padding: 'var(--space-4)',
                      background: url.is_indexed ? 'var(--color-bg-tertiary)' : 'rgba(245, 158, 11, 0.1)',
                      borderRadius: 'var(--radius-md)',
                      border: url.is_indexed ? '1px solid var(--color-border)' : '2px solid var(--color-warning)',
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      flexDirection: isMobile ? 'column' : 'row',
                      alignItems: isMobile ? 'stretch' : 'flex-start',
                      justifyContent: 'space-between',
                      gap: 'var(--space-4)',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--space-2)',
                          marginBottom: 'var(--space-2)',
                        }}>
                          <span className={getStatusBadge(url.status).className}>
                            {getStatusBadge(url.status).label}
                          </span>
                          {url.status === 'success' && (
                            <span 
                              className={url.is_indexed ? 'badge badge-success' : 'badge badge-warning'}
                              style={{ fontSize: 'var(--text-xs)' }}
                            >
                              {url.is_indexed ? t('sources.trained') : t('sources.pending')}
                            </span>
                          )}
                        </div>
                        <a
                          href={url.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: 'var(--text-sm)',
                            color: 'var(--color-accent-primary)',
                            textDecoration: 'none',
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {url.url}
                        </a>
                        {url.title && (
                          <p style={{
                            fontSize: 'var(--text-sm)',
                            color: 'var(--color-text-secondary)',
                            marginTop: 'var(--space-1)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {url.title}
                          </p>
                        )}
                        {url.last_fetch_at && (
                          <p style={{
                            fontSize: 'var(--text-xs)',
                            color: 'var(--color-text-muted)',
                            marginTop: 'var(--space-2)',
                          }}>
                            {t('labels.urlManagement.lastFetch')}: {new Date(url.last_fetch_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(url.id)}
                        disabled={deletingUrlId === url.id}
                        className="btn-ghost"
                        style={{
                          color: 'var(--color-error)',
                          padding: isMobile ? '10px 12px' : 'var(--space-2)',
                          opacity: deletingUrlId === url.id ? 0.5 : 1,
                          cursor: deletingUrlId === url.id ? 'not-allowed' : 'pointer',
                          minHeight: isMobile ? '44px' : undefined,
                          minWidth: isMobile ? '44px' : undefined,
                          alignSelf: isMobile ? 'flex-end' : 'auto',
                        }}
                      >
                        {deletingUrlId === url.id ? (
                          <div className="spinner" style={{ width: '14px', height: '14px' }} />
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Sources Summary - Desktop: right side, Mobile: bottom */}
          {!isMobile && agentId && (
            <div style={{ position: 'sticky', top: 'var(--space-8)', gridColumn: '3', gridRow: '1' }}>
              <SourcesSummary
                agentId={agentId}
                onRetrain={handleRetrain}
                isRetraining={isRetraining}
                refreshTrigger={refreshTrigger}
              />
            </div>
          )}
        </div>

        {/* Mobile: Sources Summary at bottom */}
        {isMobile && agentId && (
          <div style={{ marginTop: 'var(--space-6)' }}>
            <SourcesSummary
              agentId={agentId}
              onRetrain={handleRetrain}
              isRetraining={isRetraining}
              refreshTrigger={refreshTrigger}
            />
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
