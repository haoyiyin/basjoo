'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../components/AdminLayout';
import { Icon } from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../lib/env';
import {
  MACRO_BODY_MAX_LENGTH,
  MACRO_NAME_MAX_LENGTH,
  api,
  parseErrorResponse,
} from '../services/api';
import type { Macro } from '../services/api';
import { useIsMobile } from '../hooks/useMediaQuery';

const LANGUAGES: Array<{ code: 'zh-CN' | 'en-US'; short: string; labelKey: string }> = [
  { code: 'zh-CN', short: 'ZH', labelKey: 'settings.account.languageZh' },
  { code: 'en-US', short: 'EN', labelKey: 'settings.account.languageEn' },
];

const MIN_PASSWORD_LENGTH = 8;

/** An empty macro draft: one shape for "create" and for "edit". */
interface MacroDraft {
  name: string;
  body: string;
}

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

  // ---------------------------------------------------- reply macros (#74)
  // The workspace's saved replies: the same list the session reply composer's
  // picker reads. Create/edit/delete all go straight to
  // `/api/v1/admin/macros*`; the caps below are the API's own (name 200, body
  // 2500) and are printed next to the inputs so a 422 is never a surprise.
  const [macros, setMacros] = useState<Macro[]>([]);
  const [macrosLoaded, setMacrosLoaded] = useState(false);
  const [macrosLoading, setMacrosLoading] = useState(false);
  const [macroError, setMacroError] = useState<string | null>(null);
  // `null` = the editor is closed; otherwise the id being edited (or '' for a
  // brand-new macro). One editor at a time keeps the page honest.
  const [editingMacroId, setEditingMacroId] = useState<string | null>(null);
  const [macroDraft, setMacroDraft] = useState<MacroDraft>({ name: '', body: '' });
  const [macroSaving, setMacroSaving] = useState(false);
  const [deletingMacroId, setDeletingMacroId] = useState<string | null>(null);

  const loadMacros = async () => {
    setMacrosLoading(true);
    setMacroError(null);
    try {
      const payload = await api.listMacros();
      setMacros(Array.isArray(payload.items) ? payload.items : []);
      setMacrosLoaded(true);
    } catch (err) {
      setMacroError(
        err instanceof Error ? err.message : t('macros.errors.loadFailed'),
      );
    } finally {
      setMacrosLoading(false);
    }
  };

  const openMacroEditor = (macro: Macro | null) => {
    setMacroError(null);
    setEditingMacroId(macro ? macro.id : '');
    setMacroDraft({ name: macro?.name ?? '', body: macro?.body ?? '' });
  };

  const closeMacroEditor = () => {
    setEditingMacroId(null);
    setMacroDraft({ name: '', body: '' });
  };

  const handleSaveMacro = async () => {
    if (macroSaving || editingMacroId === null) return;
    const name = macroDraft.name.trim();
    const body = macroDraft.body.trim();
    if (!name || !body) {
      setMacroError(t('macros.errors.required'));
      return;
    }
    if (name.length > MACRO_NAME_MAX_LENGTH || body.length > MACRO_BODY_MAX_LENGTH) {
      setMacroError(t('macros.errors.tooLong'));
      return;
    }

    setMacroSaving(true);
    setMacroError(null);
    try {
      if (editingMacroId) {
        const updated = await api.updateMacro(editingMacroId, { name, body });
        setMacros((current) =>
          current.map((macro) => (macro.id === updated.id ? updated : macro)),
        );
      } else {
        const created = await api.createMacro({ name, body });
        setMacros((current) => [...current, created]);
      }
      closeMacroEditor();
    } catch (err) {
      setMacroError(
        err instanceof Error ? err.message : t('macros.errors.saveFailed'),
      );
    } finally {
      setMacroSaving(false);
    }
  };

  const handleDeleteMacro = async (macro: Macro) => {
    if (deletingMacroId) return;
    setDeletingMacroId(macro.id);
    setMacroError(null);
    try {
      await api.deleteMacro(macro.id);
      setMacros((current) => current.filter((row) => row.id !== macro.id));
      if (editingMacroId === macro.id) closeMacroEditor();
    } catch (err) {
      setMacroError(
        err instanceof Error ? err.message : t('macros.errors.deleteFailed'),
      );
    } finally {
      setDeletingMacroId(null);
    }
  };

  const handleLanguageChange = (code: 'zh-CN' | 'en-US') => {
    // The i18n instance persists the choice in localStorage under
    // `basjoo_locale`, so no extra persistence is needed here.
    void i18n.changeLanguage(code);
  };

  // The macro list is workspace state, not form state: load it once when the
  // page opens so the operator sees what exists before writing a new one.
  // `loadMacros` is defined above and only reads `t`/`api`, so this runs once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void loadMacros();
  }, []);

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

        {/* Reply macros (#74) — the workspace's saved replies. The session
         * reply composer's picker reads the same list, so what is created here
         * is what an operator can insert there. */}
        <section className="card" data-testid="macro-settings-card">
          <div className="card-header">
            <h2 className="card-title">{t('macros.title')}</h2>
            <div className="page-actions">
              <button
                type="button"
                className="btn btn-primary"
                data-testid="macro-create-open"
                onClick={() => openMacroEditor(null)}
                disabled={editingMacroId !== null}
              >
                <Icon name="plus" size={16} />
                {t('macros.create')}
              </button>
            </div>
          </div>

          <p className="page-subtitle" style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>
            {t('macros.description')}
          </p>
          <p className="field-hint" data-testid="macro-variables-hint">
            {t('macros.variablesHint')}
          </p>

          {macroError && (
            <p role="alert" className="field-error" data-testid="macro-error">
              {macroError}
            </p>
          )}

          {macrosLoading ? (
            <p className="field-hint" aria-busy="true">
              {t('status.loading')}
            </p>
          ) : !macrosLoaded ? (
            <div className="empty">
              <p className="empty-title">{t('macros.loadHintTitle')}</p>
              <div className="empty-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="macro-reload"
                  onClick={() => void loadMacros()}
                >
                  {t('macros.reload')}
                </button>
              </div>
            </div>
          ) : macros.length === 0 ? (
            <div className="empty" data-testid="macro-empty">
              <p className="empty-title">{t('macros.emptyTitle')}</p>
              <p className="empty-description">{t('macros.emptyDescription')}</p>
            </div>
          ) : (
            <ul className="list" data-testid="macro-list">
              {macros.map((macro) => (
                <li
                  key={macro.id}
                  className="list-row"
                  data-testid={`macro-row-${macro.id}`}
                  style={{
                    flexDirection: isMobile ? 'column' : 'row',
                    alignItems: isMobile ? 'stretch' : 'center',
                  }}
                >
                  <span className="list-row-main">
                    <span className="list-row-title">{macro.name}</span>
                    <span className="list-row-description">{macro.body}</span>
                  </span>
                  <span className="page-actions" style={{ flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      data-testid={`macro-edit-${macro.id}`}
                      aria-label={t('macros.editLabel', { name: macro.name })}
                      title={t('macros.editLabel', { name: macro.name })}
                      disabled={macroSaving || deletingMacroId !== null}
                      onClick={() => openMacroEditor(macro)}
                    >
                      <Icon name="edit" size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      data-testid={`macro-delete-${macro.id}`}
                      aria-label={t('macros.deleteLabel', { name: macro.name })}
                      title={t('macros.deleteLabel', { name: macro.name })}
                      disabled={macroSaving || deletingMacroId !== null}
                      aria-busy={deletingMacroId === macro.id}
                      onClick={() => void handleDeleteMacro(macro)}
                    >
                      {deletingMacroId === macro.id ? (
                        <div className="spinner" style={{ width: '14px', height: '14px' }} />
                      ) : (
                        <Icon name="trash" size={16} />
                      )}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {editingMacroId !== null && (
            <form
              data-testid="macro-editor"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSaveMacro();
              }}
              style={{ marginTop: 'var(--space-4)' }}
            >
              <div className="field">
                <label className="field-label" htmlFor="macro_name">
                  {t('macros.nameLabel')}
                </label>
                <input
                  id="macro_name"
                  className="input"
                  data-testid="macro-name-input"
                  value={macroDraft.name}
                  maxLength={MACRO_NAME_MAX_LENGTH}
                  onChange={(e) =>
                    setMacroDraft((current) => ({ ...current, name: e.target.value }))
                  }
                />
                <p className="field-hint">
                  {t('macros.nameCap', {
                    count: macroDraft.name.length,
                    max: MACRO_NAME_MAX_LENGTH,
                  })}
                </p>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="macro_body">
                  {t('macros.bodyLabel')}
                </label>
                <textarea
                  id="macro_body"
                  className="input textarea"
                  data-testid="macro-body-input"
                  value={macroDraft.body}
                  rows={5}
                  maxLength={MACRO_BODY_MAX_LENGTH}
                  onChange={(e) =>
                    setMacroDraft((current) => ({ ...current, body: e.target.value }))
                  }
                />
                <p className="field-hint">
                  {t('macros.bodyCap', {
                    count: macroDraft.body.length,
                    max: MACRO_BODY_MAX_LENGTH,
                  })}
                </p>
              </div>

              <div className="page-actions" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="macro-editor-cancel"
                  onClick={closeMacroEditor}
                  disabled={macroSaving}
                >
                  {t('buttons.cancel')}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  data-testid="macro-editor-save"
                  disabled={macroSaving}
                  aria-busy={macroSaving}
                >
                  {macroSaving ? (
                    <div className="spinner" style={{ width: '14px', height: '14px' }} />
                  ) : null}
                  {t('macros.save')}
                </button>
              </div>
            </form>
          )}
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
