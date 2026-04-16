'use client';

import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';

const languages = [
  { code: 'zh-CN', name: '中文' },
  { code: 'en-US', name: 'English' },
];

export function AuthLanguageSwitcher() {
  const { i18n, t } = useTranslation('auth');
  const pathname = usePathname();

  if (pathname !== '/login' && pathname !== '/register') {
    return null;
  }

  return (
    <div style={{
      position: 'absolute',
      top: 'var(--space-6)',
      right: 'var(--space-6)',
      zIndex: 10,
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
    }}>
      <span style={{
        fontSize: 'var(--text-sm)',
        color: 'var(--color-text-muted)',
      }}>
        {t('language')}
      </span>
      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
        {languages.map((lang) => (
          <button
            key={lang.code}
            type="button"
            onClick={() => i18n.changeLanguage(lang.code)}
            aria-pressed={i18n.language === lang.code}
            style={{
              padding: '4px 12px',
              fontSize: 'var(--text-sm)',
              fontWeight: i18n.language === lang.code ? 600 : 400,
              background: i18n.language === lang.code
                ? 'var(--color-accent-primary)'
                : 'transparent',
              color: i18n.language === lang.code
                ? 'var(--color-text-inverse)'
                : 'var(--color-text-muted)',
              border: '1px solid',
              borderColor: i18n.language === lang.code
                ? 'var(--color-accent-primary)'
                : 'var(--color-border)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
            }}
          >
            {lang.name}
          </button>
        ))}
      </div>
    </div>
  );
}
