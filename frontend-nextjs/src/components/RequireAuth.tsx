'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from '../router/react-router-dom';
import { useAuth } from '../context/AuthContext';

const SUPPORT_ALLOWED_PATHS = ['/sessions', '/chat'];

function isSupportAllowed(pathname: string): boolean {
    return SUPPORT_ALLOWED_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export const RequireAuth = ({ children }: { children: React.ReactNode }) => {
    const { t } = useTranslation('common');
    const { token, admin, isLoading } = useAuth();
    const location = useLocation();
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

    // Support users can only access session-related pages.
    // Unknown / legacy roles are treated as restricted.
    if (admin && admin.role !== 'super_admin' && admin.role !== 'admin') {
        if (!isSupportAllowed(location.pathname)) {
            return <Navigate to="/sessions" replace />;
        }
    }

    return <>{children}</>;
};
