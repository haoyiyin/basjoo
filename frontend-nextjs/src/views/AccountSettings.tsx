'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../components/AdminLayout';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../lib/env';
import { parseErrorResponse } from '../services/api';
import { useIsMobile } from '../hooks/useMediaQuery';

const LANGUAGES: Array<{ code: 'zh-CN' | 'en-US'; labelKey: string }> = [
  { code: 'zh-CN', labelKey: 'settings.account.languageZh' },
  { code: 'en-US', labelKey: 'settings.account.languageEn' },
];

const MIN_PASSWORD_LENGTH = 8;

export default function AccountSettings() {
  const { t, i18n } = useTranslation('common');
  const { admin, token } = useAuth();
  const isMobile = useIsMobile();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleLanguageChange = (code: 'zh-CN' | 'en-US') => {
    // The i18n instance persists the choice in localStorage under
    // `basjoo_locale`, so no extra persistence is needed here.
    void i18n.changeLanguage(code);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;

    setError(null);
    setSaved(false);

    if (!currentPassword) {
      setError(t('settings.account.currentPasswordRequired'));
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(t('settings.account.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('settings.account.passwordMismatch'));
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/me/password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      if (!response.ok) {
        const message = await parseErrorResponse(response);
        throw new Error(
          message || t('settings.account.currentPasswordIncorrect'),
        );
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : t('settings.account.currentPasswordIncorrect'),
      );
    } finally {
      setSaving(false);
    }
  };

  const sectionTitleStyle = {
    fontSize: 'var(--text-lg)',
    fontWeight: 600,
    marginBottom: 'var(--space-1)',
    color: 'var(--color-text-primary)',
  } as const;

  const sectionDescStyle = {
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-muted)',
    marginBottom: 'var(--space-4)',
  } as const;

  const labelStyle = {
    display: 'block',
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
    marginBottom: 'var(--space-2)',
    color: 'var(--color-text-primary)',
  } as const;

  const inputStyle = {
    width: '100%',
    padding: 'var(--space-3)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--text-base)',
    background: 'var(--color-bg-secondary)',
    color: 'var(--color-text-primary)',
  } as const;

  const cardStyle = {
    padding: isMobile ? 'var(--space-4)' : 'var(--space-6)',
    marginBottom: 'var(--space-6)',
  } as const;

  return (
    <AdminLayout>
      <div style={{ padding: isMobile ? 'var(--space-4)' : 'var(--space-8)', maxWidth: '800px', margin: '0 auto' }}>
        <h1 style={{
          fontSize: isMobile ? 'var(--text-2xl)' : 'var(--text-3xl)',
          fontWeight: 700,
          marginBottom: 'var(--space-6)',
          color: 'var(--color-text-primary)',
        }}>
          {t('settings.account.title')}
        </h1>

        <p style={{
          fontSize: 'var(--text-base)',
          color: 'var(--color-text-secondary)',
          marginBottom: 'var(--space-6)',
        }}>
          {t('settings.account.description')}
        </p>

        {/* Language */}
        <div className="liquid-glass-card" style={cardStyle}>
          <h2 style={sectionTitleStyle}>{t('settings.account.languageSection')}</h2>
          <p style={sectionDescStyle}>{t('settings.account.languageDescription')}</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {LANGUAGES.map((lang) => {
              const active = i18n.language === lang.code;
              return (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => handleLanguageChange(lang.code)}
                  aria-pressed={active}
                  style={{
                    flex: 1,
                    padding: 'var(--space-3)',
                    background: active
                      ? 'var(--color-accent-primary)'
                      : 'var(--color-bg-tertiary)',
                    color: active
                      ? 'var(--color-text-inverse)'
                      : 'var(--color-text-secondary)',
                    border: active ? 'none' : '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-sm)',
                    fontWeight: 500,
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  {t(lang.labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Change password */}
        <div className="liquid-glass-card" style={cardStyle}>
          <h2 style={sectionTitleStyle}>{t('settings.account.passwordSection')}</h2>
          <p style={sectionDescStyle}>{t('settings.account.passwordDescription')}</p>

          {error && (
            <div style={{
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-4)',
              background: 'hsla(350deg, 85%, 58%, 0.1)',
              border: '1px solid hsla(350deg, 85%, 58%, 0.3)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-error)',
              fontSize: 'var(--text-sm)',
            }}>
              {error}
            </div>
          )}

          {saved && (
            <div style={{
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-4)',
              background: 'hsla(150deg, 80%, 45%, 0.1)',
              border: '1px solid hsla(150deg, 80%, 45%, 0.3)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-success)',
              fontSize: 'var(--text-sm)',
            }}>
              {t('settings.account.passwordChanged')}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
              <div>
                <label htmlFor="current_password" style={labelStyle}>
                  {t('settings.account.currentPassword')}
                </label>
                <input
                  id="current_password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    setError(null);
                  }}
                  disabled={saving}
                  style={inputStyle}
                />
              </div>

              <div>
                <label htmlFor="new_password" style={labelStyle}>
                  {t('settings.account.newPassword')}
                </label>
                <input
                  id="new_password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setError(null);
                  }}
                  disabled={saving}
                  style={inputStyle}
                />
              </div>

              <div>
                <label htmlFor="confirm_password" style={labelStyle}>
                  {t('settings.account.confirmPassword')}
                </label>
                <input
                  id="confirm_password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setError(null);
                  }}
                  disabled={saving}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ marginTop: 'var(--space-6)' }}>
              <button
                type="submit"
                disabled={saving}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-3) var(--space-6)',
                  background: saving ? 'var(--color-bg-tertiary)' : 'var(--color-accent-primary)',
                  color: 'var(--color-text-inverse)',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-base)',
                  fontWeight: 500,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  transition: 'all var(--transition-fast)',
                }}
              >
                {saving ? t('status.saving') : t('settings.account.savePassword')}
              </button>
            </div>
          </form>
        </div>

        {/* Account info */}
        <div className="liquid-glass-card" style={cardStyle}>
          <h2 style={sectionTitleStyle}>{t('settings.account.accountInfoSection')}</h2>
          <div style={{ display: 'grid', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
            <div>
              <div style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                marginBottom: 'var(--space-1)',
                color: 'var(--color-text-secondary)',
              }}>
                {t('settings.account.name')}
              </div>
              <div style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-primary)' }}>
                {admin?.name || '-'}
              </div>
            </div>
            <div>
              <div style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                marginBottom: 'var(--space-1)',
                color: 'var(--color-text-secondary)',
              }}>
                {t('settings.account.email')}
              </div>
              <div style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-primary)' }}>
                {admin?.email || '-'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
