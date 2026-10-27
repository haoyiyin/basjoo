'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../components/AdminLayout';
import { Icon } from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../lib/env';
import { parseErrorResponse } from '../services/api';
import { useIsMobile } from '../hooks/useMediaQuery';

const LANGUAGES: Array<{ code: 'zh-CN' | 'en-US'; short: string; labelKey: string }> = [
  { code: 'zh-CN', short: 'ZH', labelKey: 'settings.account.languageZh' },
  { code: 'en-US', short: 'EN', labelKey: 'settings.account.languageEn' },
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

  return (
    <AdminLayout>
      <div className="admin-page" data-testid="account-settings-page">
        <header className="page-header">
          <div style={{ minWidth: 0 }}>
            <h1 className="page-title">{t('settings.account.title')}</h1>
            <p className="page-subtitle">{t('settings.account.description')}</p>
          </div>
        </header>

        {/* Language */}
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">{t('settings.account.languageSection')}</h2>
          </div>
          <p className="page-subtitle" style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>
            {t('settings.account.languageDescription')}
          </p>
          <div
            role="group"
            aria-label={t('settings.account.languageSection')}
            style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 'var(--space-2)' }}
          >
            {LANGUAGES.map((lang) => {
              const active = i18n.language === lang.code;
              return (
                <button
                  key={lang.code}
                  type="button"
                  className={active ? 'btn btn-primary' : 'btn btn-secondary'}
                  onClick={() => handleLanguageChange(lang.code)}
                  aria-pressed={active}
                  aria-label={t(lang.labelKey)}
                  title={t(lang.labelKey)}
                  style={{ flex: 1 }}
                >
                  {lang.short}
                </button>
              );
            })}
          </div>
        </section>

        {/* Change password */}
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">{t('settings.account.passwordSection')}</h2>
          </div>
          <p className="page-subtitle" style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>
            {t('settings.account.passwordDescription')}
          </p>

          {error && (
            <div
              role="alert"
              style={{
                padding: 'var(--space-3) var(--space-4)',
                marginBottom: 'var(--space-4)',
                background: 'var(--color-error-bg)',
                border: '1px solid var(--color-error)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-error)',
                fontSize: 'var(--text-sm)',
                lineHeight: 'var(--leading-normal)',
              }}
            >
              {error}
            </div>
          )}

          {saved && (
            <div
              role="status"
              aria-live="polite"
              style={{
                padding: 'var(--space-3) var(--space-4)',
                marginBottom: 'var(--space-4)',
                background: 'var(--color-success-bg)',
                border: '1px solid var(--color-success)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-success)',
                fontSize: 'var(--text-sm)',
                lineHeight: 'var(--leading-normal)',
              }}
            >
              {t('settings.account.passwordChanged')}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label className="field-label" htmlFor="current_password">
                {t('settings.account.currentPassword')}
              </label>
              <input
                id="current_password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setError(null);
                }}
                disabled={saving}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="new_password">
                {t('settings.account.newPassword')}
              </label>
              <input
                id="new_password"
                className="input"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError(null);
                }}
                disabled={saving}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="confirm_password">
                {t('settings.account.confirmPassword')}
              </label>
              <input
                id="confirm_password"
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError(null);
                }}
                disabled={saving}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-6)' }}>
              <button
                type="submit"
                className="btn btn-primary btn-icon"
                disabled={saving}
                aria-label={t('settings.account.savePassword')}
                title={saving ? t('status.saving') : t('settings.account.savePassword')}
                aria-busy={saving}
              >
                {saving ? (
                  <div className="spinner" style={{ width: '14px', height: '14px' }} />
                ) : (
                  <Icon name="save" size={16} />
                )}
              </button>
            </div>
          </form>
        </section>

        {/* Account info */}
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">{t('settings.account.accountInfoSection')}</h2>
          </div>
          <dl
            style={{
              display: 'grid',
              gap: 'var(--space-4)',
              margin: 0,
              minWidth: 0,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <dt className="field-label">{t('settings.account.name')}</dt>
              <dd style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>
                {admin?.name || '-'}
              </dd>
            </div>
            <div style={{ minWidth: 0 }}>
              <dt className="field-label">{t('settings.account.email')}</dt>
              <dd style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>
                {admin?.email || '-'}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </AdminLayout>
  );
}
