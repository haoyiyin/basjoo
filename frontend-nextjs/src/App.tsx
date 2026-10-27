import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { AuthLanguageSwitcher } from './components/AuthLanguageSwitcher';

import { Login } from './views/Login';
import { Register } from './views/Register';
import AgentSelector from './views/AgentSelector';
import Agents from './views/Agents';
import Home from './views/Home';
import Dashboard from './views/Dashboard';
import KnowledgeBaseDetail from './views/KnowledgeBaseDetail';
import KnowledgeBaseSetup from './views/KnowledgeBaseSetup';
import KnowledgeBases from './views/KnowledgeBases';
import Playground from './views/Playground';
import Sessions from './views/Sessions';
import AgentSettings from './views/AgentSettings';
import AccountSettings from './views/AccountSettings';
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
      </Route>

      <Route element={<DashboardLayout />}>
        <Route path="/agent-selector" element={<AgentSelector />} />
        <Route path="/" element={<Home />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/agents/:agentId/dashboard" element={<Dashboard />} />
        {/*
         * `KnowledgeBaseSetup` resolves `agent.kb_id` from
         * `/api/v1/agent:kb-status`. `/knowledge` renders the bind prompt when
         * the agent has no KB; `/urls` and `/files` are legacy bookmarks and
         * keep the plain redirect to the bound KB / bind sheet.
         */}
        <Route path="/agents/:agentId/files" element={<KnowledgeBaseSetup />} />
        <Route path="/agents/:agentId/urls" element={<KnowledgeBaseSetup />} />
        <Route path="/agents/:agentId/knowledge" element={<KnowledgeBaseSetup />} />
        <Route path="/agents/:agentId/playground" element={<Playground />} />
        <Route path="/agents/:agentId/sessions" element={<Sessions />} />
        <Route path="/agents/:agentId/settings/agent" element={<AgentSettings />} />
        <Route path="/chat/:sessionId" element={<Chat />} />
        <Route path="/settings/agent" element={<AgentSettings />} />
        <Route path="/settings/account" element={<AccountSettings />} />

        <Route path="/knowledge-bases" element={<KnowledgeBases />} />
        <Route path="/knowledge-bases/:kbId" element={<KnowledgeBaseDetail />} />
        <Route path="/knowledge" element={<Redirect to="/knowledge-bases" />} />
        <Route path="/files" element={<Redirect to="/knowledge-bases" />} />
        <Route path="/qa" element={<Redirect to="/knowledge-bases" />} />
        <Route path="/playground" element={<Redirect to="/" />} />
        <Route path="/urls" element={<Redirect to="/knowledge-bases" />} />
      </Route>
    </Routes>
  );
}

function Redirect({ to }: { to: string }) {
  return <Navigate to={to} replace />;
}
