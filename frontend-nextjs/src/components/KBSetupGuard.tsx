'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useIsMobile } from '../hooks/useMediaQuery';

interface KBSetupGuardProps {
  agentId: string;
  children: React.ReactNode;
}

export default function KBSetupGuard({ agentId, children }: KBSetupGuardProps) {
  const { t } = useTranslation('common');
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [kbSetupCompleted, setKbSetupCompleted] = useState<boolean | null>(null);

  useEffect(() => {
    const checkKBStatus = async () => {
      try {
        const kbStatus = await api.kbStatus(agentId);
        setKbSetupCompleted(kbStatus.kb_setup_completed);
      } catch {
        setKbSetupCompleted(false);
      }
    };
    checkKBStatus();
  }, [agentId]);

  if (kbSetupCompleted === false) {
    return (
      <div style={{
        padding: isMobile ? 'var(--space-4)' : 'var(--space-8)',
        maxWidth: '600px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
      }}>
        <div className="glass-card" style={{ padding: 'var(--space-8)', textAlign: 'center', width: '100%' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" strokeWidth="1.5" style={{ marginBottom: 'var(--space-4)' }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 'var(--space-3)' }}>
            {t('kb.setupRequired')}
          </h2>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-6)', lineHeight: 1.6 }}>
            {t('kb.setupDescription')}
          </p>
          <button
            onClick={() => navigate('/knowledge')}
            style={{
              padding: '10px 24px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: 'var(--color-accent-primary)',
              color: 'var(--color-text-inverse)',
              fontWeight: 600,
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
            }}
          >
            {t('kb.goToSetup')}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
