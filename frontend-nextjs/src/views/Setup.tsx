'use client';

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import { API_BASE_URL } from '../lib/env';

export const Setup = () => {
    const { t } = useTranslation('common');
    const [apiKey, setApiKey] = useState('');
    const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
    const [modelName, setModelName] = useState('gpt-3.5-turbo');
    const [systemPrompt, setSystemPrompt] = useState(t('settings.defaultSystemPrompt'));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const { token } = useAuth();
    const navigate = useNavigate();

    const handleSetup = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            // Update AI Settings for App ID 1
            const res = await fetch(`${API_BASE_URL}/api/admin/settings/ai?app_id=1`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    api_key: apiKey,
                    base_url: baseUrl,
                    model_name: modelName,
                    system_prompt: systemPrompt,
                    enable_context: false,
                    rate_limit: 100,
                    default_reply: t('settings.defaultReply')
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.detail || t('settings.setupFailed'));
            }

            // Redirect to dashboard
            navigate('/');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t('settings.setupFailedRetry'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            height: '100vh', background: '#f1f5f9'
        }}>
            <div style={{
                background: 'white', padding: '40px', borderRadius: '12px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', width: '100%', maxWidth: '600px'
            }}>
                <h1 style={{ textAlign: 'center', marginBottom: '12px', color: '#1e293b' }}>{t('settings.aiConfigWizard')}</h1>
                <p style={{ textAlign: 'center', marginBottom: '32px', color: '#64748b' }}>
                    {t('settings.aiConfigWizardDesc')}
                </p>

                {error && <div style={{
                    background: '#fee2e2', color: '#991b1b', padding: '12px',
                    borderRadius: '8px', marginBottom: '16px', fontSize: '14px'
                }}>{error}</div>}

                <form onSubmit={handleSetup} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px' }}>
                            {t('settings.apiKey')} <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="sk-..."
                            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }}
                            required
                            disabled={loading}
                        />
                        <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                            {t('settings.apiKeyDesc')}
                        </p>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px' }}>
                                {t('settings.baseUrl')}
                            </label>
                            <input
                                type="text"
                                value={baseUrl}
                                onChange={(e) => setBaseUrl(e.target.value)}
                                placeholder="https://api.openai.com/v1"
                                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }}
                                disabled={loading}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px' }}>
                                {t('settings.modelName')}
                            </label>
                            <input
                                type="text"
                                value={modelName}
                                onChange={(e) => setModelName(e.target.value)}
                                placeholder="gpt-3.5-turbo"
                                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }}
                                disabled={loading}
                            />
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px' }}>
                            {t('labels.presetPersona')}
                        </label>
                        <textarea
                            value={systemPrompt}
                            onChange={(e) => setSystemPrompt(e.target.value)}
                            rows={4}
                            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontFamily: 'inherit' }}
                            disabled={loading}
                        />
                        <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                            {t('settings.definePersona')}
                        </p>
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !apiKey}
                        style={{
                            background: '#2563eb', color: 'white', padding: '12px',
                            borderRadius: '8px', border: 'none', cursor: 'pointer',
                            fontWeight: 600, marginTop: '12px',
                            opacity: (loading || !apiKey) ? 0.5 : 1
                        }}
                    >
                        {loading ? t('settings.saving') : t('settings.completeSetup')}
                    </button>

                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        style={{
                            background: 'transparent', color: '#64748b', padding: '12px',
                            borderRadius: '8px', border: '1px solid #cbd5e1', cursor: 'pointer',
                            fontWeight: 500, marginTop: '4px'
                        }}
                        disabled={loading}
                    >
                        {t('settings.skipSetup')}
                    </button>
                </form>
            </div>
        </div>
    );
};
