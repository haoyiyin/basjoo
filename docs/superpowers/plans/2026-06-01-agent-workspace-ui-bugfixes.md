# Agent Workspace UI Bugfixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix agent lifecycle navigation, post-registration routing, KB onboarding actions, agent-scoped quick-start links, Chinese copy, agent-specific branding, and Playground naming/configuration.

**Architecture:** Keep all changes in the active Next.js frontend (`frontend-nextjs/`) because the reported issues are UI flow, route, and i18n problems. Preserve backend contracts; use existing `api.listAgents()`, `api.getAgent()`, `api.restoreAgent()`, and selected-agent localStorage helpers to keep restored/created agents navigable.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, react-router compatibility layer, i18next, Vitest + React Testing Library.

---

## Scope and requirement mapping

1. Hide the “打开” button for deactivated/deleted agents: Task 1 + Task 2.
2. Restored agents must open correctly: Task 1 + Task 2.
3. First super-admin creation should auto-login and enter “智能体面板”: Task 3.
4. Post-agent-create KB modal should show only “跳过” and “初始化知识库”; both enter that agent: Task 1 + Task 2.
5. Dashboard quick start must navigate within the current agent: Task 4.
6. Change “查看所有智能体的运行状态，并进入对应的独立后台。” to “查看所有智能体的运行状态，并进入对应的独立工作空间。”: Task 5.
7. Agent workspace top-left name should show the agent name, not Basjoo: Task 5.
8. Number 8 was not present in the user report; no implementation required.
9. Chinese “Playground” should become “调试区”; remove “Agent 名称” config from Playground: Task 6.
10. Agent dashboard navigation should be called “控制台”; “欢迎回到 Basjoo 控制台” should use the current agent name: Task 4 + Task 5.

---

## File structure

### Modify

- `frontend-nextjs/src/views/Agents.tsx`
  - Hide open actions for inactive/deleted agents.
  - Make restore set the selected agent storage and selected row.
  - Replace the embedded full `KBSetupWizard` onboarding with a two-button choice modal.
  - “跳过” navigates to `/agents/{id}/dashboard`; “初始化知识库” navigates to `/agents/{id}/knowledge`.

- `frontend-nextjs/src/services/api.ts`
  - Make `restoreAgent()` set the restored agent as selected.
  - Make `deleteAgent()` clear selected-agent storage if the deleted agent was selected.

- `frontend-nextjs/src/views/Register.tsx`
  - Keep automatic login through `useAuth().register()` and route the first super admin to `/` with `replace: true`, which renders `AgentPanel` for super admins.
  - Use `API_BASE_URL` for registration-settings so deployments behind a configured backend base URL behave consistently.

- `frontend-nextjs/src/views/Dashboard.tsx`
  - Store the loaded agent name.
  - Scope quick-start navigation to `/agents/{agentId}/...`.
  - Render welcome copy with the current agent name.

- `frontend-nextjs/src/components/AdminLayout.tsx`
  - Load the current route agent name when `agentId` exists.
  - Show that agent name in the top-left brand text for agent-scoped pages.
  - Keep Basjoo on root-level pages.

- `frontend-nextjs/src/components/AISettingsForm.tsx`
  - Remove the editable agent name field from the Playground settings form.
  - Stop sending `name` in the auto-save payload from this form.

- `frontend-nextjs/src/locales/zh-CN/common.json`
  - `navigation.dashboard`: `控制台`
  - `navigation.playground`: `调试区`
  - `agents.panelSubtitle`: `查看所有智能体的运行状态，并进入对应的独立工作空间。`
  - `agents.kbOnboardingSkip`: `跳过`
  - `agents.kbOnboardingContinue`: `初始化知识库`
  - `labels.welcome`: `欢迎回到 {{agentName}} 控制台`

- `frontend-nextjs/src/locales/en-US/common.json`
  - Keep English labels natural and add `{{agentName}}` interpolation for welcome text.
  - Change onboarding continue to “Initialize Knowledge Base” so both locales represent the same action.

### Tests

- `frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx`
  - Expand existing tests for the two-button modal, hidden open button, and restore selected-agent behavior.

- Create `frontend-nextjs/tests/unit/Dashboard.agentScope.test.tsx`
  - Test quick-start navigation is agent-scoped.
  - Test welcome text uses the current agent name.

- Create `frontend-nextjs/tests/unit/AdminLayout.agentBrand.test.tsx`
  - Test agent-scoped layout brand shows the agent name.

- Create `frontend-nextjs/tests/unit/Register.bootstrap.test.tsx`
  - Test successful bootstrap registration navigates to `/` and calls register.

- Create `frontend-nextjs/tests/unit/AISettingsForm.playground.test.tsx`
  - Test the agent name field is not rendered.
  - Test auto-save payload no longer contains `name`.

---

### Task 1: Lock agent creation/restore behavior with failing tests

**Files:**
- Modify: `frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx`

- [ ] **Step 1: Replace the existing Agents test file with failing coverage**

Use this complete file content:

```tsx
// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Agents from "../../src/views/Agents";
import { api } from "../../src/services/api";

vi.mock("../../src/services/api", () => ({
  api: {
    listAgents: vi.fn(),
    createAgent: vi.fn(),
    deleteAgent: vi.fn(),
    restoreAgent: vi.fn(),
    setSelectedAgentId: vi.fn(),
    clearSelectedAgentId: vi.fn(),
    getSelectedAgentId: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockedApi = vi.mocked(api);

const activeAgent = {
  id: "agt_active",
  name: "Active Agent",
  description: "",
  is_active: true,
  deleted_at: null,
};

const deletedAgent = {
  id: "agt_deleted",
  name: "Deleted Agent",
  description: "",
  is_active: false,
  deleted_at: "2026-06-01T00:00:00Z",
  purge_after: "2026-06-08T00:00:00Z",
};

const restoredAgent = {
  ...deletedAgent,
  is_active: true,
  deleted_at: null,
  purge_after: null,
};

const newAgent = {
  id: "agt_new",
  name: "New Agent",
  description: "",
  is_active: true,
  deleted_at: null,
};

function renderAgents(initialAgents = [activeAgent, deletedAgent]) {
  mockedApi.listAgents.mockResolvedValue({ agents: initialAgents, total: initialAgents.length } as any);

  const router = createMemoryRouter(
    [
      { path: "/agents", element: <Agents /> },
      { path: "/agents/:agentId/dashboard", element: <div>Dashboard</div> },
      { path: "/agents/:agentId/knowledge", element: <div>Knowledge</div> },
    ],
    { initialEntries: ["/agents"] },
  );

  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.createAgent.mockResolvedValue(newAgent as any);
  mockedApi.deleteAgent.mockResolvedValue({ success: true } as any);
  mockedApi.restoreAgent.mockResolvedValue(restoredAgent as any);
});

describe("Agents onboarding and lifecycle actions", () => {
  it("opens a two-button KB modal after creating an agent and skip enters that agent dashboard", async () => {
    const router = renderAgents([activeAgent]);
    await screen.findByText("Active Agent");

    fireEvent.change(screen.getByPlaceholderText("agents.namePlaceholder"), {
      target: { value: "New Agent" },
    });
    fireEvent.click(screen.getByText("agents.create"));

    const modal = await screen.findByTestId("kb-onboarding-modal");
    expect(within(modal).queryByTestId("kb-wizard")).not.toBeInTheDocument();
    expect(within(modal).getByRole("button", { name: "agents.kbOnboardingSkip" })).toBeInTheDocument();
    expect(within(modal).getByRole("button", { name: "agents.kbOnboardingContinue" })).toBeInTheDocument();
    expect(within(modal).queryByRole("button", { name: "buttons.cancel" })).not.toBeInTheDocument();

    fireEvent.click(within(modal).getByRole("button", { name: "agents.kbOnboardingSkip" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/agents/agt_new/dashboard");
    });
  });

  it("initializing knowledge base from the two-button modal enters the created agent knowledge page", async () => {
    const router = renderAgents([activeAgent]);
    await screen.findByText("Active Agent");

    fireEvent.change(screen.getByPlaceholderText("agents.namePlaceholder"), {
      target: { value: "New Agent" },
    });
    fireEvent.click(screen.getByText("agents.create"));

    const modal = await screen.findByTestId("kb-onboarding-modal");
    fireEvent.click(within(modal).getByRole("button", { name: "agents.kbOnboardingContinue" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/agents/agt_new/knowledge");
    });
  });

  it("hides open actions for deactivated agents", async () => {
    renderAgents();

    const activeRow = (await screen.findByText("Active Agent")).closest("div")!;
    expect(within(activeRow).getByRole("button", { name: "agents.open" })).toBeInTheDocument();

    const deletedRow = screen.getByText("Deleted Agent").closest("div")!;
    expect(within(deletedRow).queryByRole("button", { name: "agents.open" })).not.toBeInTheDocument();
    expect(within(deletedRow).getByRole("button", { name: "agents.restore" })).toBeInTheDocument();
  });

  it("restores an agent and stores it as the selected agent so opening works", async () => {
    mockedApi.listAgents
      .mockResolvedValueOnce({ agents: [activeAgent, deletedAgent], total: 2 } as any)
      .mockResolvedValueOnce({ agents: [activeAgent, restoredAgent], total: 2 } as any);

    const router = renderAgents();
    await screen.findByText("Deleted Agent");

    fireEvent.click(screen.getByRole("button", { name: "agents.restore" }));

    await waitFor(() => {
      expect(mockedApi.restoreAgent).toHaveBeenCalledWith("agt_deleted");
      expect(mockedApi.setSelectedAgentId).toHaveBeenCalledWith("agt_deleted");
    });

    await screen.findByText("Deleted Agent");
    fireEvent.click(screen.getAllByRole("button", { name: "agents.open" })[1]);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/agents/agt_deleted/dashboard");
    });
  });
});
```

- [ ] **Step 2: Run the failing Agents tests**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/Agents.kbOnboarding.test.tsx
```

Expected: FAIL. Failures should mention the old `kb-wizard`/extra buttons, hidden-open expectation, or missing `setSelectedAgentId` behavior.

- [ ] **Step 3: Commit the failing tests**

```bash
git add frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx
git commit -m "test: cover agent onboarding and lifecycle actions"
```

---

### Task 2: Implement agent lifecycle and two-button onboarding

**Files:**
- Modify: `frontend-nextjs/src/views/Agents.tsx`
- Modify: `frontend-nextjs/src/services/api.ts`
- Test: `frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx`

- [ ] **Step 1: Update `api.ts` selected-agent behavior**

In `frontend-nextjs/src/services/api.ts`, replace the `deleteAgent` and `restoreAgent` methods with:

```ts
  async deleteAgent(
    agentId: string,
  ): Promise<{ success: boolean; deleted_at?: string; purge_after?: string }> {
    const result = await this.request<{
      success: boolean;
      deleted_at?: string;
      purge_after?: string;
    }>(`/api/v1/agents/${agentId}`, {
      method: "DELETE",
    });

    if (this.getSelectedAgentId() === agentId) {
      this.clearSelectedAgentId();
    }

    return result;
  }

  async restoreAgent(agentId: string): Promise<Agent> {
    const agent = await this.request<Agent>(`/api/v1/agents/${agentId}:restore`, {
      method: "POST",
    });
    this.setSelectedAgentId(agent.id);
    return agent;
  }
```

- [ ] **Step 2: Update imports and derived selected agent in `Agents.tsx`**

At the top of `frontend-nextjs/src/views/Agents.tsx`, replace:

```ts
import { FormEvent, useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import AdminLayout from "../components/AdminLayout";
import { Agent, AgentCreateInput, AgentType, api } from "../services/api";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "../hooks/useMediaQuery";
import KBSetupWizard from "../components/KBSetupWizard";
import { useAgentKbStatus } from "../hooks/useAgentKbStatus";
```

with:

```ts
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AdminLayout from "../components/AdminLayout";
import { Agent, AgentCreateInput, AgentType, api } from "../services/api";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "../hooks/useMediaQuery";
```

Below `formatPurgeCountdown`, add:

```ts
function isOpenableAgent(agent: Agent | null) {
  return Boolean(agent && !agent.deleted_at && agent.is_active !== false);
}
```

Replace the `useAgentKbStatus` block and `selectedAgent` declaration with:

```ts
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) || null,
    [agents, selectedAgentId],
  );
  const selectedOpenableAgent = isOpenableAgent(selectedAgent) ? selectedAgent : null;
```

- [ ] **Step 3: Make list loading select only active, non-deleted agents**

In `loadAgents`, replace:

```ts
      const nextSelected =
        data.agents.find((agent) => !agent.deleted_at)?.id ||
        data.agents[0]?.id ||
        null;
      setSelectedAgentId(nextSelected);
```

with:

```ts
      setSelectedAgentId((current) => {
        if (current && data.agents.some((agent) => agent.id === current)) {
          return current;
        }
        return data.agents.find((agent) => isOpenableAgent(agent))?.id || data.agents[0]?.id || null;
      });
```

- [ ] **Step 4: Make restore select the restored agent in both API storage and UI state**

In `handleRestore`, replace:

```ts
      const restored = await api.restoreAgent(agent.id);
      await loadAgents();
      setSelectedAgentId(restored.id);
```

with:

```ts
      const restored = await api.restoreAgent(agent.id);
      api.setSelectedAgentId(restored.id);
      await loadAgents();
      setSelectedAgentId(restored.id);
```

- [ ] **Step 5: Replace the top “打开” guard**

Replace:

```tsx
          {selectedAgent && (
            <button
              onClick={() => navigate(`/agents/${selectedAgent.id}/dashboard`)}
```

with:

```tsx
          {selectedOpenableAgent && (
            <button
              onClick={() => navigate(`/agents/${selectedOpenableAgent.id}/dashboard`)}
```

- [ ] **Step 6: Hide row-level “打开” for inactive/deleted agents**

Replace the row open button block:

```tsx
                      <button
                        onClick={() =>
                          navigate(`/agents/${agent.id}/dashboard`)
                        }
                        style={{
                          padding: "var(--space-2) var(--space-3)",
                          borderRadius: "var(--radius-md)",
                          border: "1px solid var(--color-border)",
                          background: "transparent",
                          color: "var(--color-text-primary)",
                          cursor: "pointer",
                        }}
                      >
                        {t("agents.open")}
                      </button>
```

with:

```tsx
                      {isOpenableAgent(agent) && (
                        <button
                          onClick={() => navigate(`/agents/${agent.id}/dashboard`)}
                          style={{
                            padding: "var(--space-2) var(--space-3)",
                            borderRadius: "var(--radius-md)",
                            border: "1px solid var(--color-border)",
                            background: "transparent",
                            color: "var(--color-text-primary)",
                            cursor: "pointer",
                          }}
                        >
                          {t("agents.open")}
                        </button>
                      )}
```

- [ ] **Step 7: Replace full KB wizard onboarding with two action buttons**

Remove the `finishOnboarding` callback entirely.

Add these helpers before `return (`:

```ts
  const enterCreatedAgentDashboard = () => {
    if (!onboardingAgentId) return;
    const agentId = onboardingAgentId;
    api.setSelectedAgentId(agentId);
    setOnboardingAgentId(null);
    navigate(`/agents/${agentId}/dashboard`);
  };

  const enterCreatedAgentKnowledge = () => {
    if (!onboardingAgentId) return;
    const agentId = onboardingAgentId;
    api.setSelectedAgentId(agentId);
    setOnboardingAgentId(null);
    navigate(`/agents/${agentId}/knowledge`);
  };
```

Inside the onboarding modal, delete the `<KBSetupWizard ... />` block and the old button block. Replace them with:

```tsx
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "var(--space-3)",
                marginTop: "var(--space-4)",
              }}
            >
              <button className="btn-secondary" onClick={enterCreatedAgentDashboard}>
                {t("agents.kbOnboardingSkip")}
              </button>
              <button className="btn-primary" onClick={enterCreatedAgentKnowledge}>
                {t("agents.kbOnboardingContinue")}
              </button>
            </div>
```

- [ ] **Step 8: Run the Agents test**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/Agents.kbOnboarding.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit lifecycle and onboarding implementation**

```bash
git add frontend-nextjs/src/views/Agents.tsx frontend-nextjs/src/services/api.ts frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx
git commit -m "fix: repair agent lifecycle actions"
```

---

### Task 3: Lock and reinforce first super-admin registration routing

**Files:**
- Create: `frontend-nextjs/tests/unit/Register.bootstrap.test.tsx`
- Modify: `frontend-nextjs/src/views/Register.tsx`

- [ ] **Step 1: Create the failing registration routing test**

Create `frontend-nextjs/tests/unit/Register.bootstrap.test.tsx` with:

```tsx
// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Register } from "../../src/views/Register";

const registerMock = vi.fn();

vi.mock("../../src/context/AuthContext", () => ({
  useAuth: () => ({ register: registerMock }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  registerMock.mockResolvedValue(undefined);
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ bootstrap_required: true }),
  }) as any;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Register bootstrap flow", () => {
  it("registers the first super admin and enters the agent panel route", async () => {
    const router = createMemoryRouter(
      [
        { path: "/register", element: <Register /> },
        { path: "/", element: <div>agents.panelTitle</div> },
      ],
      { initialEntries: ["/register"] },
    );

    render(<RouterProvider router={router} />);

    await screen.findByText("initialSetup.name");
    fireEvent.change(screen.getByPlaceholderText("initialSetup.namePlaceholder"), {
      target: { value: "Owner" },
    });
    fireEvent.change(screen.getByPlaceholderText("initialSetup.emailPlaceholder"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("initialSetup.passwordPlaceholder"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("initialSetup.confirmPasswordPlaceholder"), {
      target: { value: "password123" },
    });

    fireEvent.click(screen.getByRole("button", { name: "initialSetup.createAdmin" }));

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith("owner@example.com", "password123", "Owner");
      expect(router.state.location.pathname).toBe("/");
    });
  });
});
```

- [ ] **Step 2: Run the new test to verify current behavior**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/Register.bootstrap.test.tsx
```

Expected: PASS if current code already logs in and routes to `/`; FAIL if placeholders or route behavior differ. If it passes, still complete Step 3 to make the code explicit and deployment-safe.

- [ ] **Step 3: Make registration-settings use the configured API base and replace history on success**

In `frontend-nextjs/src/views/Register.tsx`, add this import:

```ts
import { API_BASE_URL } from '../lib/env';
```

Replace:

```ts
        fetch('/api/admin/registration-settings')
```

with:

```ts
        fetch(`${API_BASE_URL}/api/admin/registration-settings`)
```

Replace:

```ts
            navigate('/');
```

with:

```ts
            navigate('/', { replace: true });
```

- [ ] **Step 4: Run the registration test**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/Register.bootstrap.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit registration routing**

```bash
git add frontend-nextjs/src/views/Register.tsx frontend-nextjs/tests/unit/Register.bootstrap.test.tsx
git commit -m "fix: enter agent panel after bootstrap registration"
```

---

### Task 4: Fix agent dashboard quick-start routes and welcome copy

**Files:**
- Create: `frontend-nextjs/tests/unit/Dashboard.agentScope.test.tsx`
- Modify: `frontend-nextjs/src/views/Dashboard.tsx`
- Modify: `frontend-nextjs/src/locales/zh-CN/common.json`
- Modify: `frontend-nextjs/src/locales/en-US/common.json`

- [ ] **Step 1: Create failing Dashboard tests**

Create `frontend-nextjs/tests/unit/Dashboard.agentScope.test.tsx` with:

```tsx
// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Dashboard from "../../src/views/Dashboard";
import { api } from "../../src/services/api";

vi.mock("../../src/components/AdminLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../src/context/AuthContext", () => ({
  useAuth: () => ({ admin: { id: 1, name: "Owner", email: "owner@example.com", role: "super_admin" } }),
}));

vi.mock("../../src/services/api", () => ({
  api: {
    getAgent: vi.fn(),
    getQuota: vi.fn(),
    getSourcesSummary: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "labels.welcome") return `欢迎回到 ${options?.agentName} 控制台`;
      return key;
    },
  }),
}));

const mockedApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.getAgent.mockResolvedValue({ id: "agt_1", name: "官网客服" } as any);
  mockedApi.getQuota.mockResolvedValue({
    used_urls: 0,
    max_urls: 100,
    used_files: 0,
    max_files: 100,
    used_messages_today: 0,
    max_messages_per_day: 100,
  } as any);
  mockedApi.getSourcesSummary.mockResolvedValue({
    urls: { total: 0, indexed: 0, pending: 0 },
    files: { total: 0, ready: 0, processing: 0 },
    has_pending: false,
  } as any);
});

describe("Dashboard agent scoped navigation", () => {
  it("uses the current agent name in the welcome copy", async () => {
    const router = createMemoryRouter(
      [{ path: "/agents/:agentId/dashboard", element: <Dashboard /> }],
      { initialEntries: ["/agents/agt_1/dashboard"] },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByText("欢迎回到 官网客服 控制台")).toBeInTheDocument();
    });
  });

  it("routes quick start actions inside the active agent workspace", async () => {
    const router = createMemoryRouter(
      [
        { path: "/agents/:agentId/dashboard", element: <Dashboard /> },
        { path: "/agents/:agentId/playground", element: <div>Scoped Playground</div> },
      ],
      { initialEntries: ["/agents/agt_1/dashboard"] },
    );

    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByText("navigation.playground"));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/agents/agt_1/playground");
    });
  });
});
```

- [ ] **Step 2: Run the failing Dashboard tests**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/Dashboard.agentScope.test.tsx
```

Expected: FAIL because quick start currently navigates to `/playground` and welcome text uses Basjoo.

- [ ] **Step 3: Update Dashboard agent state and data loading**

In `frontend-nextjs/src/views/Dashboard.tsx`, replace:

```ts
  const [agentId, setAgentId] = useState<string | null>(null)
```

with:

```ts
  const [agentId, setAgentId] = useState<string | null>(null)
  const [agentName, setAgentName] = useState<string>('')
```

Inside `loadData`, after `setAgentId(agent.id)`, add:

```ts
      setAgentName(agent.name)
```

- [ ] **Step 4: Update welcome text**

Replace:

```tsx
            {t('labels.welcome')}
```

with:

```tsx
            {t('labels.welcome', { agentName: agentName || t('appName') })}
```

- [ ] **Step 5: Scope quick-start links to the current agent**

Replace:

```tsx
                onClick={() => navigate(action.path)}
```

with:

```tsx
                onClick={() => navigate(routeAgentId ? `/agents/${routeAgentId}${action.path}` : action.path)}
```

- [ ] **Step 6: Update locale welcome strings**

In `frontend-nextjs/src/locales/zh-CN/common.json`, replace:

```json
    "welcome": "欢迎回到 Basjoo 控制台",
```

with:

```json
    "welcome": "欢迎回到 {{agentName}} 控制台",
```

In `frontend-nextjs/src/locales/en-US/common.json`, replace:

```json
    "welcome": "Welcome back to Basjoo",
```

with:

```json
    "welcome": "Welcome back to {{agentName}} Console",
```

- [ ] **Step 7: Run Dashboard tests**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/Dashboard.agentScope.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Dashboard fixes**

```bash
git add frontend-nextjs/src/views/Dashboard.tsx frontend-nextjs/src/locales/zh-CN/common.json frontend-nextjs/src/locales/en-US/common.json frontend-nextjs/tests/unit/Dashboard.agentScope.test.tsx
git commit -m "fix: scope dashboard quick start to agent workspace"
```

---

### Task 5: Update agent panel copy, dashboard naming, and agent-scoped sidebar brand

**Files:**
- Create: `frontend-nextjs/tests/unit/AdminLayout.agentBrand.test.tsx`
- Modify: `frontend-nextjs/src/components/AdminLayout.tsx`
- Modify: `frontend-nextjs/src/locales/zh-CN/common.json`
- Modify: `frontend-nextjs/src/locales/en-US/common.json`

- [ ] **Step 1: Create failing AdminLayout brand test**

Create `frontend-nextjs/tests/unit/AdminLayout.agentBrand.test.tsx` with:

```tsx
// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AdminLayout from "../../src/components/AdminLayout";
import { api } from "../../src/services/api";

vi.mock("../../src/context/AuthContext", () => ({
  useAuth: () => ({
    admin: { id: 1, name: "Owner", email: "owner@example.com", role: "super_admin" },
    logout: vi.fn(),
  }),
}));

vi.mock("../../src/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
}));

vi.mock("../../src/services/api", () => ({
  api: { getAgent: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockedApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.getAgent.mockResolvedValue({ id: "agt_1", name: "官网客服" } as any);
});

describe("AdminLayout agent brand", () => {
  it("shows the current agent name instead of Basjoo in agent workspaces", async () => {
    const router = createMemoryRouter(
      [{ path: "/agents/:agentId/dashboard", element: <AdminLayout><div>Body</div></AdminLayout> }],
      { initialEntries: ["/agents/agt_1/dashboard"] },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "官网客服" })).toBeInTheDocument();
    });
    expect(mockedApi.getAgent).toHaveBeenCalledWith("agt_1");
  });
});
```

- [ ] **Step 2: Run the failing AdminLayout test**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/AdminLayout.agentBrand.test.tsx
```

Expected: FAIL because the layout currently renders `Basjoo` in the top-left brand.

- [ ] **Step 3: Add agent-name loading to AdminLayout**

In `frontend-nextjs/src/components/AdminLayout.tsx`, add this import:

```ts
import { api } from '../services/api'
```

After `const agentBasePath = agentId ? ...`, add:

```ts
  const [agentName, setAgentName] = useState<string | null>(null)
```

After the `expandedGroups` effect, add:

```ts
  useEffect(() => {
    if (!agentId) {
      setAgentName(null)
      return
    }

    let cancelled = false
    setAgentName(null)

    api.getAgent(agentId)
      .then(agent => {
        if (!cancelled) {
          setAgentName(agent.name)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAgentName(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [agentId])
```

- [ ] **Step 4: Render agent name in the top-left brand**

Replace:

```tsx
                Basjoo
```

with:

```tsx
                {agentId ? (agentName || t('status.loading')) : t('appName')}
```

Keep the logo image unchanged.

- [ ] **Step 5: Update Chinese and English navigation/copy strings**

In `frontend-nextjs/src/locales/zh-CN/common.json`, replace these exact values:

```json
    "dashboard": "仪表盘",
    "playground": "Playground",
```

with:

```json
    "dashboard": "控制台",
    "playground": "调试区",
```

Replace:

```json
    "panelSubtitle": "查看所有智能体的运行状态，并进入对应的独立后台。",
```

with:

```json
    "panelSubtitle": "查看所有智能体的运行状态，并进入对应的独立工作空间。",
```

Replace:

```json
    "kbOnboardingSkip": "暂时跳过",
    "kbOnboardingContinue": "进入仪表盘"
```

with:

```json
    "kbOnboardingSkip": "跳过",
    "kbOnboardingContinue": "初始化知识库"
```

In `frontend-nextjs/src/locales/en-US/common.json`, replace:

```json
    "dashboard": "Dashboard",
```

with:

```json
    "dashboard": "Console",
```

Replace:

```json
    "kbOnboardingContinue": "Go to Dashboard"
```

with:

```json
    "kbOnboardingContinue": "Initialize Knowledge Base"
```

- [ ] **Step 6: Run AdminLayout test**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/AdminLayout.agentBrand.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit layout and locale fixes**

```bash
git add frontend-nextjs/src/components/AdminLayout.tsx frontend-nextjs/src/locales/zh-CN/common.json frontend-nextjs/src/locales/en-US/common.json frontend-nextjs/tests/unit/AdminLayout.agentBrand.test.tsx
git commit -m "fix: show agent workspace branding"
```

---

### Task 6: Remove Playground agent-name configuration

**Files:**
- Create: `frontend-nextjs/tests/unit/AISettingsForm.playground.test.tsx`
- Modify: `frontend-nextjs/src/components/AISettingsForm.tsx`

- [ ] **Step 1: Create failing AISettingsForm tests**

Create `frontend-nextjs/tests/unit/AISettingsForm.playground.test.tsx` with:

```tsx
// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AISettingsForm from "../../src/components/AISettingsForm";
import { api } from "../../src/services/api";

vi.mock("../../src/components/HelpTooltip", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("../../src/services/api", () => ({
  api: {
    getAgent: vi.fn(),
    getDefaultAgent: vi.fn(),
    updateAgent: vi.fn(),
    testAIApi: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockedApi = vi.mocked(api);

const agent = {
  id: "agt_1",
  name: "官网客服",
  system_prompt: "You are helpful.",
  model: "deepseek-chat",
  temperature: 0.7,
  max_tokens: 1024,
  api_key_set: true,
  api_base: "https://api.deepseek.com/v1",
  provider_type: "openai",
  api_format: "openai",
  top_k: 8,
  similarity_threshold: 0.01,
  enable_context: false,
  rate_limit_per_minute: 20,
  restricted_reply: "restricted",
  persona_type: "custom",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockedApi.getAgent.mockResolvedValue(agent as any);
  mockedApi.getDefaultAgent.mockResolvedValue(agent as any);
  mockedApi.updateAgent.mockResolvedValue(agent as any);
  mockedApi.testAIApi.mockResolvedValue({ success: true, message: "ok" } as any);
});

describe("AISettingsForm Playground fields", () => {
  it("does not render the Agent Name field", async () => {
    render(<AISettingsForm agentId="agt_1" compact />);

    await screen.findByDisplayValue("You are helpful.");

    expect(screen.queryByText("labels.agentName")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("官网客服")).not.toBeInTheDocument();
  });

  it("does not send name in auto-save payload", async () => {
    render(<AISettingsForm agentId="agt_1" compact />);

    const prompt = await screen.findByDisplayValue("You are helpful.");
    fireEvent.change(prompt, { target: { value: "Updated prompt" } });

    await vi.advanceTimersByTimeAsync(900);

    await waitFor(() => {
      expect(mockedApi.updateAgent).toHaveBeenCalled();
    });

    expect(mockedApi.updateAgent.mock.calls[0][1]).not.toHaveProperty("name");
  });
});
```

- [ ] **Step 2: Run the failing AISettingsForm tests**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/AISettingsForm.playground.test.tsx
```

Expected: FAIL because the Agent Name field exists and `name` is sent.

- [ ] **Step 3: Remove `name` from form state and fetch mapping**

In `frontend-nextjs/src/components/AISettingsForm.tsx`, remove this line from initial `formData`:

```ts
    name: '',
```

Remove this line from `setFormData({ ... })` inside `fetchAgent`:

```ts
        name: agentData.name || '',
```

- [ ] **Step 4: Remove `name` from save payload and auto-save dependencies**

In `handleSave`, remove:

```ts
        name: formData.name,
```

In the auto-save dependency array, remove:

```ts
    formData.name,
```

- [ ] **Step 5: Delete the Agent Name JSX field**

In `frontend-nextjs/src/components/AISettingsForm.tsx`, remove this whole block:

```tsx
        <div>
          <label style={{
            display: 'block',
            marginBottom: 'var(--space-2)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--color-text-secondary)',
          }}>
            {t('labels.agentName')}
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder={t('labels.aiAssistant')}
          />
        </div>
```

- [ ] **Step 6: Run AISettingsForm tests**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/AISettingsForm.playground.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Playground configuration cleanup**

```bash
git add frontend-nextjs/src/components/AISettingsForm.tsx frontend-nextjs/tests/unit/AISettingsForm.playground.test.tsx
git commit -m "fix: remove playground agent name editing"
```

---

### Task 7: Full frontend verification

**Files:**
- Verify: `frontend-nextjs/`

- [ ] **Step 1: Run LSP diagnostics before builds**

Run through Pi tool:

```text
lsp_diagnostics(filePath="frontend-nextjs", severity="all")
```

Expected: no TypeScript errors introduced by these changes.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
cd frontend-nextjs && npx vitest run \
  tests/unit/Agents.kbOnboarding.test.tsx \
  tests/unit/Register.bootstrap.test.tsx \
  tests/unit/Dashboard.agentScope.test.tsx \
  tests/unit/AdminLayout.agentBrand.test.tsx \
  tests/unit/AISettingsForm.playground.test.tsx
```

Expected: PASS for all listed test files.

- [ ] **Step 3: Run complete frontend tests**

Run:

```bash
cd frontend-nextjs && npm run test
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
cd frontend-nextjs && npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Run production build**

Run:

```bash
cd frontend-nextjs && npm run build
```

Expected: PASS and Next.js reports a successful production build.

- [ ] **Step 6: Manual smoke test in dev**

Run:

```bash
cd frontend-nextjs && npm run dev
```

Then verify in browser:

1. Register first super admin; after submit, the app lands on `/` and shows “智能体面板”.
2. On “智能体” page, a deactivated agent row does not show “打开”.
3. Restore that agent; “打开” appears and opens `/agents/{id}/dashboard`.
4. Create a new agent; modal shows only “跳过” and “初始化知识库”.
5. “跳过” opens `/agents/{newId}/dashboard`.
6. Create another new agent; “初始化知识库” opens `/agents/{newId}/knowledge`.
7. Inside `/agents/{id}/dashboard`, quick-start “调试区” opens `/agents/{id}/playground`.
8. The sidebar top-left name shows the current agent name.
9. Chinese navigation shows “控制台” and “调试区”.
10. Playground settings no longer shows “Agent 名称”.

- [ ] **Step 7: Commit verification-only updates if any were needed**

If Step 1-6 required code/test corrections, commit them:

```bash
git add frontend-nextjs
git commit -m "fix: address frontend verification issues"
```

If no files changed after verification, do not create an empty commit.

---

## Self-review

- **Spec coverage:** Each user requirement maps to a task in the “Scope and requirement mapping” section. The missing user number 8 is explicitly called out as absent.
- **Placeholder scan:** This plan contains no deferred-work markers, no “similar to”, and no undefined follow-up task language. Code changes and test files include concrete paths and concrete snippets.
- **Type consistency:** Agent IDs are strings throughout. The selected-agent helper methods match `APIService` names already present in `frontend-nextjs/src/services/api.ts`. Route patterns consistently use `/agents/${agentId}/dashboard`, `/agents/${agentId}/knowledge`, and `/agents/${agentId}/playground`.
