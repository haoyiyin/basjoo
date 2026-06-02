'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from '../router/react-router-dom';
import { useAuth } from '../context/AuthContext';

// Helper functions for role checking
function isWorkspaceSuperAdmin(admin: { role: string } | null): boolean {
    return admin?.role === 'super_admin';
}

function isAgentScopedUser(admin: { role: string } | null): boolean {
    // admin and support roles are agent-scoped (require AgentMember for access)
    return admin?.role === 'admin' || admin?.role === 'support';
}

function isSupportRole(admin: { role: string } | null): boolean {
    return admin?.role === 'support';
}

// Path pattern matching for agent-specific routes
function isAgentScopedPath(pathname: string): boolean {
    // Matches /agents/{agentId}/... pattern
    const agentPathMatch = /^\/agents\/[^\/]+/.exec(pathname);
    return agentPathMatch !== null;
}

function extractAgentIdFromPath(pathname: string): string | null {
    const match = /^\/agents\/([^\/]+)/.exec(pathname);
    return match ? match[1] : null;
}

// Root management routes that only workspace super admins can access
const SUPER_ADMIN_ONLY_ROOT_PATHS = [
    '/',
    '/agents',
    '/users',
    '/playground',
    '/knowledge',
    '/urls',
    '/files',
    '/settings/agent',
];

function isSuperAdminOnlyRootPath(pathname: string): boolean {
    return SUPER_ADMIN_ONLY_ROOT_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

// Routes that support (customer service) users can access within agent context
const SUPPORT_ALLOWED_AGENT_PATHS = [
    '/sessions',
    '/chat',
];

function isSupportAllowedAgentPath(pathname: string): boolean {
    const agentId = extractAgentIdFromPath(pathname);
    if (!agentId) return false;
    const restPath = pathname.slice(`/agents/${agentId}`.length);
    return SUPPORT_ALLOWED_AGENT_PATHS.some(p => restPath === p || restPath.startsWith(p + '/'));
}

export const RequireAuth = ({ children }: { children: React.ReactNode }) => {
    const { t } = useTranslation('common');
    const { token, admin, isLoading } = useAuth();
    const location = useLocation();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const loadingView = (
        <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100vh'
        }}>{mounted ? t('status.loading') : 'Loading...'}</div>
    );

    if (isLoading || (token && !admin)) {
        return loadingView;
    }

    if (!token) {
        return <Navigate to="/login" replace />;
    }

    // Workspace super admins can access everything
    if (isWorkspaceSuperAdmin(admin)) {
        return <>{children}</>;
    }

    // Agent-scoped users (admin or support)
    if (isAgentScopedUser(admin)) {
        // Allow the agent-selector page itself (avoid self-redirect)
        if (location.pathname === '/agent-selector') {
            return <>{children}</>;
        }

        // Cannot access root management routes
        if (isSuperAdminOnlyRootPath(location.pathname) && !isAgentScopedPath(location.pathname)) {
            // Redirect to agent discovery - will be handled by AgentPanel or a selector
            return <Navigate to="/agent-selector" replace />;
        }

        // Can access agent-specific routes, but need membership check (handled by backend)
        if (isAgentScopedPath(location.pathname)) {
            // Support users are further restricted to sessions/chat within agent context
            if (isSupportRole(admin) && !isSupportAllowedAgentPath(location.pathname)) {
                const agentId = extractAgentIdFromPath(location.pathname);
                if (agentId) {
                    return <Navigate to={`/agents/${agentId}/sessions`} replace />;
                }
                return <Navigate to="/agent-selector" replace />;
            }
            return <>{children}</>;
        }

        // For root-level sessions/chat, redirect to agent selector
        if (location.pathname === '/sessions' || location.pathname === '/chat') {
            return <Navigate to="/agent-selector" replace />;
        }

        // Unknown path - redirect to agent selector
        return <Navigate to="/agent-selector" replace />;
    }

    // Unknown / legacy roles - deny access
    return <Navigate to="/login" replace />;
};