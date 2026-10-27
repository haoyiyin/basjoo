'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';

interface SourcesSummaryProps {
  agentId: string;
  refreshTrigger?: number;
}

interface SourcesSummaryData {
  urls: {
    total: number;
    indexed: number;
    pending: number;
    total_size_kb: number;
  };
  files: {
    total: number;
    ready: number;
    processing: number;
    total_size_kb: number;
  };
  has_pending: boolean;
}

/**
 * Compact summary of an agent's knowledge sources.
 *
 * Restyle (spec §20): the three ad-hoc translucent fills became the shared
 * `card` / token surfaces, and every colour now comes from a design token.
 * The `sources.*` copy keys are unchanged.
 */
export default function SourcesSummary({
  agentId,
  refreshTrigger = 0,
}: SourcesSummaryProps) {
  const { t } = useTranslation('common');
  const [data, setData] = useState<SourcesSummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSummary = useCallback(async () => {
    if (!agentId) return;
    try {
      const summary = await api.getSourcesSummary(agentId);
      setData(summary);
    } catch (error) {
      console.error('Failed to load sources summary:', error);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary, refreshTrigger]);

  if (loading || !data) {
    return (
      <div className="card" aria-busy="true">
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  const totalSizeKb = data.urls.total_size_kb + data.files.total_size_kb;

  const statRowStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-3)',
    padding: 'var(--space-4)',
    background: 'var(--color-bg-tertiary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    marginBottom: 'var(--space-4)',
  } as const;

  return (
    <section className="card">
      <header className="card-header">
        <h2 className="card-title">{t('sources.title')}</h2>
      </header>

      {/* URL stats */}
      <div style={statRowStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            minWidth: 0,
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            style={{ color: 'var(--fg-dim)', flexShrink: 0 }}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span style={{ color: 'var(--fg-strong)', fontWeight: 500 }}>
            {t('sources.links', { count: data.urls.total })}
          </span>
        </div>
        <span style={{ color: 'var(--fg-dim)', fontSize: 'var(--text-sm)' }}>
          {data.urls.total_size_kb} KB
        </span>
      </div>

      {/* File stats */}
      <div style={statRowStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            minWidth: 0,
            flexWrap: 'wrap',
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            style={{ color: 'var(--fg-dim)', flexShrink: 0 }}
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span style={{ color: 'var(--fg-strong)', fontWeight: 500 }}>
            {t('sources.fileItems', { count: data.files.total })}
          </span>
          {data.files.processing > 0 && (
            <span className="badge badge-warning">
              {data.files.processing} {t('sources.processing')}
            </span>
          )}
        </div>
        <span style={{ color: 'var(--fg-dim)', fontSize: 'var(--text-sm)' }}>
          {data.files.total_size_kb} KB
        </span>
      </div>

      {/* Total size */}
      <div style={{ ...statRowStyle, marginBottom: 0 }}>
        <span
          style={{ color: 'var(--fg-default)', fontSize: 'var(--text-sm)' }}
        >
          {t('sources.totalSize')}
        </span>
        <span style={{ color: 'var(--fg-strong)', fontWeight: 500 }}>
          {totalSizeKb.toFixed(2)} KB
        </span>
      </div>
    </section>
  );
}
