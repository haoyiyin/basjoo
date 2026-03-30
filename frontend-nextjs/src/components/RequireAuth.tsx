'use client';

import React from 'react';
import { Navigate } from '../router/react-router-dom';
import { useAuth } from '../context/AuthContext';

export const RequireAuth = ({ children }: { children: React.ReactNode }) => {
    const { token, isLoading } = useAuth();

    if (isLoading) {
        return <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100vh'
        }}>加载中...</div>;
    }

    if (!token) {
        return <Navigate to="/login" replace />;
    }

    return <>{children}</>;
};
