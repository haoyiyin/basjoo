'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { useIsMobile } from '../hooks/useMediaQuery';
import KBSetupWizard from './KBSetupWizard';

interface KBSetupGuardProps {
  agentId: string;
  children: React.ReactNode;
}

export default function KBSetupGuard({ agentId, children }: KBSetupGuardProps) {
  const { t } = useTranslation('common');
  const isMobile = useIsMobile();
  const [kbSetupCompleted, setKbSetupCompleted] = useState<boolean | null>(null);

  const checkKBStatus = useCallback(async () => {
    try {
      const kbStatus = await api.kbStatus(agentId);
      setKbSetupCompleted(kbStatus.kb_setup_completed);
    } catch {
      setKbSetupCompleted(false);
    }
  }, [agentId]);

  useEffect(() => {
    checkKBStatus();
  }, [checkKBStatus]);

  if (kbSetupCompleted === false) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobile ? 'var(--space-4)' : 'var(--space-6)',
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
              {t('kb.setup.title', '知识库设置')}
            </h1>
            <p style={{
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--text-base)',
            }}>
              {t('kb.setup.desc', '配置 Embedding 提供商以初始化知识库。')}
            </p>
          </div>

          <KBSetupWizard
            agentId={agentId}
            onSetupComplete={() => checkKBStatus()}
          />
        </div>
      </div>
    );
  }

  if (kbSetupCompleted === null) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '60vh',
      }}>
        <div className="spinner" />
      </div>
    );
  }

  return <>{children}</>;
}
