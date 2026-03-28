'use client';

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';

export const Register = () => {
    const { t } = useTranslation('auth');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { register } = useAuth();
    const navigate = useNavigate();

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password !== confirmPassword) {
            setError(t('errors.passwordMismatch'));
            return;
        }

        if (password.length < 6) {
            setError(t('errors.passwordTooShort'));
            return;
        }

        setLoading(true);
        try {
            await register(email, password, name);
            navigate('/');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t('errors.registerFailed');
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-6)',
            position: 'relative',
        }}>
            <div style={{
                position: 'absolute',
                top: '10%',
                right: '20%',
                width: '350px',
                height: '350px',
                background: 'radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 70%)',
                borderRadius: '50%',
                filter: 'blur(60px)',
                animation: 'float 9s ease-in-out infinite',
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
                animation: 'float 11s ease-in-out infinite reverse',
            }} />

            <div style={{
                width: '100%',
                maxWidth: '420px',
                animation: 'fadeIn 0.6s ease-out forwards',
            }}>
                <div style={{
                    textAlign: 'center',
                    marginBottom: 'var(--space-8)',
                }}>
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '80px',
                        height: '80px',
                        marginBottom: 'var(--space-6)',
                    }}>
                        <img
                            src="/logo.png"
                            alt="Basjoo Logo"
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain',
                            }}
                        />
                    </div>
                    <h1 style={{
                        fontSize: 'var(--text-3xl)',
                        fontWeight: 700,
                        marginBottom: 'var(--space-3)',
                        background: 'linear-gradient(135deg, #0EA5E9 0%, #F97316 100%)',
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                    }}>
                        Basjoo
                    </h1>
                    <p style={{
                        color: 'var(--color-text-secondary)',
                        fontSize: 'var(--text-base)',
                    }}>
                        {t('register.subtitle')}
                    </p>
                </div>

                <div className="glass-card" style={{
                    padding: 'var(--space-8)',
                }}>
                    {error && (
                        <div style={{
                            background: 'var(--color-error-bg)',
                            color: 'var(--color-error)',
                            padding: 'var(--space-4)',
                            borderRadius: 'var(--radius-md)',
                            marginBottom: 'var(--space-6)',
                            fontSize: 'var(--text-sm)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-3)',
                        }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleRegister}>
                        <div style={{ marginBottom: 'var(--space-5)' }}>
                            <label style={{
                                display: 'block',
                                marginBottom: 'var(--space-2)',
                                fontSize: 'var(--text-sm)',
                                fontWeight: 500,
                                color: 'var(--color-text-secondary)',
                            }}>
                                {t('register.name')}
                            </label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder={t('register.namePlaceholder')}
                                    required
                                    disabled={loading}
                                    style={{ paddingLeft: 'var(--space-12)' }}
                                />
                                <svg 
                                    width="18" 
                                    height="18" 
                                    viewBox="0 0 24 24" 
                                    fill="none" 
                                    stroke="currentColor" 
                                    strokeWidth="2"
                                    style={{
                                        position: 'absolute',
                                        left: 'var(--space-4)',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        color: 'var(--color-text-muted)',
                                    }}
                                >
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                    <circle cx="12" cy="7" r="4" />
                                </svg>
                            </div>
                        </div>

                        <div style={{ marginBottom: 'var(--space-5)' }}>
                            <label style={{
                                display: 'block',
                                marginBottom: 'var(--space-2)',
                                fontSize: 'var(--text-sm)',
                                fontWeight: 500,
                                color: 'var(--color-text-secondary)',
                            }}>
                                {t('register.email')}
                            </label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder={t('register.emailPlaceholder')}
                                    required
                                    disabled={loading}
                                    style={{ paddingLeft: 'var(--space-12)' }}
                                />
                                <svg 
                                    width="18" 
                                    height="18" 
                                    viewBox="0 0 24 24" 
                                    fill="none" 
                                    stroke="currentColor" 
                                    strokeWidth="2"
                                    style={{
                                        position: 'absolute',
                                        left: 'var(--space-4)',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        color: 'var(--color-text-muted)',
                                    }}
                                >
                                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                    <polyline points="22,6 12,13 2,6" />
                                </svg>
                            </div>
                        </div>

                        <div style={{ marginBottom: 'var(--space-5)' }}>
                            <label style={{
                                display: 'block',
                                marginBottom: 'var(--space-2)',
                                fontSize: 'var(--text-sm)',
                                fontWeight: 500,
                                color: 'var(--color-text-secondary)',
                            }}>
                                {t('register.password')}
                            </label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder={t('register.passwordPlaceholder')}
                                    required
                                    disabled={loading}
                                    style={{ paddingLeft: 'var(--space-12)' }}
                                />
                                <svg 
                                    width="18" 
                                    height="18" 
                                    viewBox="0 0 24 24" 
                                    fill="none" 
                                    stroke="currentColor" 
                                    strokeWidth="2"
                                    style={{
                                        position: 'absolute',
                                        left: 'var(--space-4)',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        color: 'var(--color-text-muted)',
                                    }}
                                >
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                </svg>
                            </div>
                        </div>

                        <div style={{ marginBottom: 'var(--space-6)' }}>
                            <label style={{
                                display: 'block',
                                marginBottom: 'var(--space-2)',
                                fontSize: 'var(--text-sm)',
                                fontWeight: 500,
                                color: 'var(--color-text-secondary)',
                            }}>
                                {t('register.confirmPassword')}
                            </label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder={t('register.confirmPasswordPlaceholder')}
                                    required
                                    disabled={loading}
                                    style={{ paddingLeft: 'var(--space-12)' }}
                                />
                                <svg 
                                    width="18" 
                                    height="18" 
                                    viewBox="0 0 24 24" 
                                    fill="none" 
                                    stroke="currentColor" 
                                    strokeWidth="2"
                                    style={{
                                        position: 'absolute',
                                        left: 'var(--space-4)',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        color: 'var(--color-text-muted)',
                                    }}
                                >
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                </svg>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                width: '100%',
                                padding: 'var(--space-4)',
                                fontSize: 'var(--text-base)',
                                fontWeight: 600,
                                background: 'var(--color-accent-gradient)',
                                color: 'var(--color-text-inverse)',
                                border: 'none',
                                borderRadius: 'var(--radius-md)',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                opacity: loading ? 0.7 : 1,
                                transition: 'all var(--transition-fast)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 'var(--space-2)',
                            }}
                        >
                            {loading ? (
                                <>
                                    <div className="spinner" />
                                    {t('register.registerInProgress')}
                                </>
                            ) : (
                                <>
                                    {t('register.registerButton')}
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M5 12h14M12 5l7 7-7 7" />
                                    </svg>
                                </>
                            )}
                        </button>
                    </form>
                </div>

                <p style={{
                    textAlign: 'center',
                    marginTop: 'var(--space-6)',
                    color: 'var(--color-text-secondary)',
                    fontSize: 'var(--text-sm)',
                }}>
                    {t('register.haveAccount')}{' '}
                    <Link
                        to="/login"
                        style={{
                            color: 'var(--color-accent-primary)',
                            fontWeight: 500,
                            textDecoration: 'none',
                            transition: 'color var(--transition-fast)',
                        }}
                    >
                        {t('register.loginLink')}
                    </Link>
                </p>

                <div style={{
                    textAlign: 'center',
                    marginTop: 'var(--space-10)',
                    paddingTop: 'var(--space-6)',
                    borderTop: '1px solid var(--color-border)',
                }}>
                    <p style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-muted)',
                    }}>
                        {t('register.footer')}
                    </p>
                </div>
            </div>
        </div>
    );
};
