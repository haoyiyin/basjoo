'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';

interface SourcesSummaryProps {
  agentId: string;
  onRetrain: () => void;
  isRetraining: boolean;
  refreshTrigger?: number;
}

interface SourcesSummaryData {
  urls: {
    total: number;
    indexed: number;
    pending: number;
    total_size_kb: number;
  };
  qa: {
    total: number;
    indexed: number;
    pending: number;
    total_size_kb: number;
  };
  has_pending: boolean;
}

export default function SourcesSummary({ 
  agentId, 
  onRetrain, 
  isRetraining,
  refreshTrigger = 0
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

  // Poll every 5 seconds when retraining
  useEffect(() => {
    if (isRetraining) {
      const interval = setInterval(loadSummary, 5000);
      return () => clearInterval(interval);
    }
  }, [isRetraining, loadSummary]);

  if (loading || !data) {
    return (
      <div className="glass-card" style={{ padding: 'var(--space-6)' }}>
        <div style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      </div>
    );
  }

  const hasPending = data.has_pending;
  const totalSizeKb = data.urls.total_size_kb + data.qa.total_size_kb;

  return (
    <div className="glass-card" style={{ padding: 'var(--space-6)' }}>
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
        background: 'var(--color-bg-tertiary)',
        borderRadius: 'var(--radius-md)',
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
            {data.urls.pending > 0 && (
              <span className="badge badge-warning" style={{ fontSize: 'var(--text-xs)' }}>
                {data.urls.pending} {t('sources.pending')}
              </span>
            )}
          </div>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            {data.urls.total_size_kb} KB
          </span>
        </div>
      </div>

      {/* QA Stats */}
      <div style={{
        padding: 'var(--space-4)',
        background: 'var(--color-bg-tertiary)',
        borderRadius: 'var(--radius-md)',
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
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
              {t('sources.qaItems', { count: data.qa.total })}
            </span>
            {data.qa.pending > 0 && (
              <span className="badge badge-warning" style={{ fontSize: 'var(--text-xs)' }}>
                {data.qa.pending} {t('sources.pending')}
              </span>
            )}
          </div>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            {data.qa.total_size_kb} KB
          </span>
        </div>
      </div>

      {/* Total Size */}
      <div style={{
        padding: 'var(--space-4)',
        background: 'var(--color-bg-tertiary)',
        borderRadius: 'var(--radius-md)',
        marginBottom: 'var(--space-6)',
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

      {/* Pending hint */}
      {hasPending && (
        <div style={{
          padding: 'var(--space-3)',
          background: 'rgba(245, 158, 11, 0.1)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          marginBottom: 'var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          color: 'var(--color-warning)',
          fontSize: 'var(--text-sm)',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {t('sources.hasPendingHint')}
        </div>
      )}

      {/* Retrain Button */}
      <button
        onClick={onRetrain}
        disabled={isRetraining}
        style={{
          width: '100%',
          padding: 'var(--space-4)',
          background: hasPending
            ? 'linear-gradient(135deg, #F59E0B, #F97316)'
            : 'linear-gradient(135deg, #06b6d4, #0891b2)',
          color: 'white',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          cursor: isRetraining ? 'not-allowed' : 'pointer',
          opacity: isRetraining ? 0.7 : 1,
          fontWeight: 600,
          fontSize: 'var(--text-base)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-2)',
          boxShadow: hasPending ? '0 4px 14px rgba(245, 158, 11, 0.4)' : 'none',
          transition: 'all 0.2s ease',
        }}
      >
        {isRetraining ? (
          <div className="spinner" style={{ width: '18px', height: '18px' }} />
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        )}
        {isRetraining ? t('sources.retraining') : t('sources.retrainAgent')}
      </button>
    </div>
  );
}
