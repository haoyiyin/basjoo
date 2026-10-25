import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { AuthLanguageSwitcher } from './components/AuthLanguageSwitcher';

import { Login } from './views/Login';
import { Register } from './views/Register';
import { Setup } from './views/Setup';
import AgentSelector from './views/AgentSelector';
import AgentPanel from './views/AgentPanel';
import Agents from './views/Agents';
import Dashboard from './views/Dashboard';
import FileUploadManagement from './views/FileUploadManagement';
import KnowledgeBaseSetup from './views/KnowledgeBaseSetup';
import KnowledgeBases from './views/KnowledgeBases';
import Playground from './views/Playground';
import Sessions from './views/Sessions';
import AgentSettings from './views/AgentSettings';
import URLManagement from './views/URLManagement';
import { AdminUsers } from './views/AdminUsers';
import Chat from './views/Chat';

/** Mirrors the former `app/(auth)/layout.tsx`. */
function AuthLayout() {
  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <AuthLanguageSwitcher />
      <Outlet />
    </div>
  );
}

/** Mirrors the former `app/(dashboard)/layout.tsx`. */
function DashboardLayout() {
  return (
    <RequireAuth>
      <Outlet />
    </RequireAuth>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/setup" element={<Setup />} />
      </Route>

      <Route element={<DashboardLayout />}>
        <Route path="/agent-selector" element={<AgentSelector />} />
        <Route path="/" element={<AgentPanel />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/agents/:agentId/dashboard" element={<Dashboard />} />
        <Route path="/agents/:agentId/files" element={<FileUploadManagement />} />
        <Route path="/agents/:agentId/knowledge" element={<KnowledgeBaseSetup />} />
        <Route path="/agents/:agentId/playground" element={<Playground />} />
        <Route path="/agents/:agentId/sessions" element={<Sessions />} />
        <Route path="/agents/:agentId/settings/agent" element={<AgentSettings />} />
        <Route path="/agents/:agentId/urls" element={<URLManagement />} />
        <Route path="/agents/:agentId/users" element={<AdminUsers />} />
        <Route path="/chat/:sessionId" element={<Chat />} />
        <Route path="/files" element={<FileUploadManagement />} />
        <Route path="/settings/agent" element={<AgentSettings />} />

        <Route path="/knowledge-bases" element={<KnowledgeBases />} />
        <Route path="/sessions" element={<Redirect to="/" />} />
        <Route path="/knowledge" element={<Redirect to="/knowledge-bases" />} />
        <Route path="/playground" element={<Redirect to="/" />} />
        <Route path="/urls" element={<Redirect to="/" />} />
        <Route path="/users" element={<Redirect to="/" />} />
        <Route path="/qa" element={<Redirect to="/files" />} />
      </Route>
    </Routes>
  );
}

function Redirect({ to }: { to: string }) {
  return <Navigate to={to} replace />;
}
