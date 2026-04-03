'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from '../router/react-router-dom';
import { useAuth } from '../context/AuthContext';

export const RequireAuth = ({ children }: { children: React.ReactNode }) => {
    const { t } = useTranslation('common');
    const { token, isLoading } = useAuth();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (isLoading) {
        return <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100vh'
        }}>{mounted ? t('status.loading') : 'Loading...'}</div>;
    }

    if (!token) {
        return <Navigate to="/login" replace />;
    }

    return <>{children}</>;
};
