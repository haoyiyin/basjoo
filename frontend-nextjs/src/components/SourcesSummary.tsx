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
      <div className="liquid-glass-card" style={{ padding: 'var(--space-6)' }}>
        <div style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      </div>
    );
  }

  const totalSizeKb = data.urls.total_size_kb + data.files.total_size_kb;

  return (
    <div className="liquid-glass-card" style={{ padding: 'var(--space-6)' }}>
      <h2 style={{
        fontSize: 'var(--text-lg)',
        fontWeight: 600,
        marginBottom: 'var(--space-6)',
        color: 'var(--color-text-primary)',
      }}>
        {t('sources.title')}
      </h2>

      {/* URL Stats */}
      <div style={{
        padding: 'var(--space-4)',
        background: 'hsla(220deg, 20%, 13%, 0.4)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border-glass)',
        marginBottom: 'var(--space-4)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-text-muted)' }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
              {t('sources.links', { count: data.urls.total })}
            </span>
          </div>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            {data.urls.total_size_kb} KB
          </span>
        </div>
      </div>

      {/* File Stats */}
      <div style={{
        padding: 'var(--space-4)',
        background: 'hsla(220deg, 20%, 13%, 0.4)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border-glass)',
        marginBottom: 'var(--space-4)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-text-muted)' }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
              {t('sources.fileItems', { count: data.files.total })}
            </span>
            {data.files.processing > 0 && (
              <span className="badge badge-warning" style={{ fontSize: 'var(--text-xs)' }}>
                {data.files.processing} {t('sources.processing')}
              </span>
            )}
          </div>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            {data.files.total_size_kb} KB
          </span>
        </div>
      </div>

      {/* Total Size */}
      <div style={{
        padding: 'var(--space-4)',
        background: 'hsla(220deg, 20%, 13%, 0.4)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border-glass)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
            {t('sources.totalSize')}
          </span>
          <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
            {totalSizeKb.toFixed(2)} KB
          </span>
        </div>
      </div>
    </div>
  );
}
