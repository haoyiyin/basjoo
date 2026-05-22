'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import KBSetupWizard from './KBSetupWizard';

interface SourcesSummaryProps {
  agentId: string;
  onRetrain: () => void;
  isRetraining: boolean;
  refreshTrigger?: number;
  embeddingBatchSize?: number;
  onEmbeddingBatchSizeChange?: (value: number) => void;
  onReset?: () => void;
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
  onRetrain,
  isRetraining,
  refreshTrigger = 0,
  embeddingBatchSize = 4,
  onEmbeddingBatchSizeChange,
  onReset,
}: SourcesSummaryProps) {
  const { t } = useTranslation('common');
  const [data, setData] = useState<SourcesSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);

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

  const handleResetConfirm = async () => {
    if (!agentId) return;
    setResetting(true);
    try {
      await api.kbReset(agentId);
      setShowResetConfirm(false);
      setShowSetupWizard(true);
    } catch (error) {
      console.error('Failed to reset KB:', error);
      alert(t('sources.resetFailed', '重置知识库失败'));
    } finally {
      setResetting(false);
    }
  };

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
  const totalSizeKb = data.urls.total_size_kb + data.files.total_size_kb;

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

      {/* File Stats */}
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
      {onEmbeddingBatchSizeChange && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label style={{
            display: 'block',
            marginBottom: 'var(--space-2)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--color-text-secondary)',
          }}>
            {t('sources.embeddingBatchSize')}
          </label>
            <input
              type="number"
              value={embeddingBatchSize}
              onChange={(e) => {
                const rawValue = e.target.value;
                if (rawValue === '') {
                  return;
                }
            
                const nextValue = Number(rawValue);
                if (!Number.isFinite(nextValue)) {
                  return;
                }
            
                onEmbeddingBatchSizeChange?.(Math.max(1, Math.min(64, nextValue)));
              }}
              min={1}
              max={64}
              style={{ width: '100%' }}
            />
          <p style={{
            marginTop: 'var(--space-2)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}>
            {t('sources.embeddingBatchSizeHint')}
          </p>
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
          marginBottom: 'var(--space-3)',
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

      {/* Reset Knowledge Base Button */}
      <button
        onClick={() => setShowResetConfirm(true)}
        disabled={isRetraining || resetting}
        style={{
          width: '100%',
          padding: 'var(--space-3)',
          background: 'transparent',
          color: '#ef4444',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 'var(--radius-md)',
          cursor: (isRetraining || resetting) ? 'not-allowed' : 'pointer',
          opacity: (isRetraining || resetting) ? 0.5 : 1,
          fontWeight: 500,
          fontSize: 'var(--text-sm)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-2)',
          transition: 'all 0.2s ease',
        }}
      >
        {resetting ? (
          <div className="spinner" style={{ width: '16px', height: '16px' }} />
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        )}
        {resetting ? t('sources.resetting', '重置中...') : t('sources.resetKnowledgeBase', '重置知识库')}
      </button>

      {/* Reset Confirmation Dialog */}
      {showResetConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)',
          }}
          onClick={() => setShowResetConfirm(false)}
        >
          <div
            className="glass-card"
            style={{
              maxWidth: '420px',
              width: '100%',
              padding: 'var(--space-6)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div>
                <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 'var(--space-2)' }}>
                  {t('sources.resetConfirmTitle', '重置知识库')}
                </h3>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  {t('sources.resetConfirmMessage', '重置后需要重新配置 Embedding 提供商。确定要重置吗？')}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="btn-secondary"
                disabled={resetting}
              >
                {t('buttons.cancel', '取消')}
              </button>
              <button
                onClick={handleResetConfirm}
                disabled={resetting}
                style={{
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: '#ef4444',
                  color: 'white',
                  fontWeight: 500,
                  fontSize: 'var(--text-sm)',
                  cursor: resetting ? 'not-allowed' : 'pointer',
                  opacity: resetting ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                {resetting && <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />}
                {t('buttons.confirm', '确定')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KB Setup Wizard Modal */}
      {showSetupWizard && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 3000,
          background: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-4)',
          overflowY: 'auto',
        }}>
          {/* Decorative blur blobs */}
          <div style={{
            position: 'absolute',
            top: '10%',
            right: '20%',
            width: '350px',
            height: '350px',
            background: 'radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 70%)',
            borderRadius: '50%',
            filter: 'blur(60px)',
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute',
            bottom: '15%',
            left: '10%',
            width: '280px',
            height: '280px',
            background: 'radial-gradient(circle, rgba(6, 182, 212, 0.12) 0%, transparent 70%)',
            borderRadius: '50%',
            filter: 'blur(60px)',
            pointerEvents: 'none',
          }} />

          <div style={{
            width: '100%',
            maxWidth: '480px',
            position: 'relative',
            zIndex: 1,
            animation: 'fadeIn 0.5s ease-out forwards',
          }}>
            {/* Logo and heading */}
            <div style={{
              textAlign: 'center',
              marginBottom: 'var(--space-6)',
            }}>
              <img
                src="/logo.png"
                alt="Basjoo Logo"
                style={{
                  width: '64px',
                  height: '64px',
                  objectFit: 'contain',
                  marginBottom: 'var(--space-4)',
                }}
              />
              <h1 style={{
                fontSize: 'var(--text-2xl)',
                fontWeight: 700,
                marginBottom: 'var(--space-2)',
                background: 'linear-gradient(135deg, #0EA5E9 0%, #F97316 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                {t('sources.setupKnowledgeBase', '配置知识库')}
              </h1>
            </div>

            <KBSetupWizard
              agentId={agentId}
              onSetupComplete={() => {
                setShowSetupWizard(false);
                loadSummary();
                onReset?.();
              }}
              onCancel={() => setShowSetupWizard(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
