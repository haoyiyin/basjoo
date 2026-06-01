# Agent Workspace Bugfixes Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five still-failing acceptance items: hide open access for deactivated agents, make bootstrap registration enter the agent panel without a second login, reduce the post-create KB prompt to exactly two buttons, use “调试区” everywhere in Chinese UI, and remove the Agent Name setting from the debug page AI settings panel.

**Architecture:** Keep fixes narrow and aligned with existing frontend/backend boundaries. Frontend route and display bugs are fixed in focused view/component files with unit coverage. The bootstrap auto-login bug is made robust by having the backend return the same authenticated session shape as login and by persisting that session directly in `AuthContext`.

**Tech Stack:** FastAPI, SQLAlchemy async, React 18, Next.js App Router wrapper pages, React Router, TypeScript, i18next, Vitest, pytest.

---

## Scope and File Map

- Modify `frontend-nextjs/src/views/AgentPanel.tsx`
  - Responsibility: root “智能体面板” cards. It must not show clickable cards for inactive or soft-deleted agents.
- Modify `frontend-nextjs/src/views/Agents.tsx`
  - Responsibility: super-admin agent management list and post-create KB prompt. It must treat only `is_active === true` and `deleted_at == null` agents as openable, and the onboarding modal must render exactly two buttons.
- Modify `frontend-nextjs/src/views/Register.tsx`
  - Responsibility: bootstrap registration screen. It should navigate to `/` after `register()` has persisted an authenticated session.
- Modify `frontend-nextjs/src/context/AuthContext.tsx`
  - Responsibility: auth session persistence. `register()` must persist the returned session directly when `/api/admin/register` returns an access token.
- Modify `backend/api/endpoints/auth.py`
  - Responsibility: admin auth endpoints. Bootstrap `/api/admin/register` should return `LoginResponse` with `access_token`, `token_type`, and `admin`, matching `/login`.
- Modify `frontend-nextjs/src/locales/zh-CN/common.json`
  - Responsibility: Chinese copy. No Chinese string should show the English word `Playground`; use “调试区”.
- Modify `frontend-nextjs/src/components/AISettingsForm.tsx`
  - Responsibility: debug page AI settings. It must not render or submit an agent name field.
- Create `frontend-nextjs/tests/unit/AgentPanel.inactiveAgents.test.tsx`
  - Covers root agent panel hiding inactive/deleted agents.
- Modify `frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx`
  - Covers open-button visibility and exactly two onboarding buttons.
- Modify `frontend-nextjs/tests/unit/Register.bootstrap.test.tsx`
  - Covers bootstrap registration navigating to `/` after session persistence.
- Create `frontend-nextjs/tests/unit/zhCN.debugCopy.test.ts`
  - Covers Chinese debug-page copy using “调试区” and not `Playground`.
- Modify `frontend-nextjs/tests/unit/AISettingsForm.playground.test.tsx`
  - Covers no Agent Name field and no `name` in autosave payload.
- Modify `backend/tests/test_api.py`
  - Covers bootstrap register response returning auth session.

---

### Task 1: Hide open access for inactive/deactivated agents

**Files:**
- Modify: `frontend-nextjs/src/views/AgentPanel.tsx`
- Modify: `frontend-nextjs/src/views/Agents.tsx`
- Create: `frontend-nextjs/tests/unit/AgentPanel.inactiveAgents.test.tsx`
- Modify: `frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx`

- [ ] **Step 1: Add root agent panel test for inactive and deleted agents**

Create `frontend-nextjs/tests/unit/AgentPanel.inactiveAgents.test.tsx`:

```tsx
// @ts-nocheck
// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import AgentPanel from "../../src/views/AgentPanel";
import { api } from "../../src/services/api";

vi.mock("../../src/services/api", () => ({
  api: {
    listAgents: vi.fn(),
    getAgent: vi.fn(),
  },
}));

vi.mock("../../src/context/AuthContext", () => ({
  useAuth: () => ({
    admin: {
      id: 1,
      name: "Owner",
      email: "owner@example.com",
      role: "super_admin",
    },
    token: null,
    logout: vi.fn(),
  }),
}));

vi.mock("../../src/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockedApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.getAgent.mockResolvedValue({ id: "agt_active", name: "Active Agent" } as any);
  mockedApi.listAgents.mockResolvedValue({
    agents: [
      {
        id: "agt_active",
        name: "Active Agent",
        description: "Available",
        agent_type: "website_support",
        channel_mode: "web_widget",
        is_active: true,
        deleted_at: null,
        last_error_code: null,
      },
      {
        id: "agt_inactive",
        name: "Inactive Agent",
        description: "Stopped",
        agent_type: "website_support",
        channel_mode: "web_widget",
        is_active: false,
        deleted_at: null,
        last_error_code: null,
      },
      {
        id: "agt_deleted",
        name: "Deleted Agent",
        description: "Soft deleted",
        agent_type: "website_support",
        channel_mode: "web_widget",
        is_active: false,
        deleted_at: "2026-06-01T00:00:00Z",
        last_error_code: null,
      },
    ],
    total: 3,
  } as any);
});

describe("AgentPanel inactive agent visibility", () => {
  it("only renders active non-deleted agents as openable workspace cards", async () => {
    const router = createMemoryRouter(
      [
        { path: "/", element: <AgentPanel /> },
        { path: "/agents/:agentId/dashboard", element: <div>Scoped Dashboard</div> },
      ],
      { initialEntries: ["/"] },
    );

    render(<RouterProvider router={router} />);

    await screen.findByText("Active Agent");

    expect(screen.queryByText("Inactive Agent")).not.toBeInTheDocument();
    expect(screen.queryByText("Deleted Agent")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Active Agent/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the new root panel test to verify it fails before the fix**

Run:

```bash
cd frontend-nextjs && npm run test -- --run tests/unit/AgentPanel.inactiveAgents.test.tsx
```

Expected before implementation: FAIL because `Inactive Agent` is rendered by `AgentPanel.tsx` when `deleted_at` is null.

- [ ] **Step 3: Filter root panel cards to active and non-deleted agents**

In `frontend-nextjs/src/views/AgentPanel.tsx`, replace the current list loading effect:

```tsx
  useEffect(() => {
    api.listAgents()
      .then(data => setAgents(data.agents.filter(agent => !agent.deleted_at)))
      .catch(err => setError(err instanceof Error ? err.message : t('errors.networkError')))
      .finally(() => setLoading(false))
  }, [t])
```

with:

```tsx
  useEffect(() => {
    api.listAgents()
      .then(data => setAgents(data.agents.filter(agent => agent.is_active === true && !agent.deleted_at)))
      .catch(err => setError(err instanceof Error ? err.message : t('errors.networkError')))
      .finally(() => setLoading(false))
  }, [t])
```

- [ ] **Step 4: Add management-list test for inactive selected agent with no open button**

Append this test case inside `describe("Agents onboarding and lifecycle actions", () => { ... })` in `frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx`:

```tsx
  it("does not show top-level or row open buttons for inactive agents", async () => {
    const inactiveAgent = {
      id: "agt_inactive",
      name: "Inactive Agent",
      description: "Stopped",
      is_active: false,
      deleted_at: null,
      purge_after: null,
    };

    renderAgents([inactiveAgent]);

    await screen.findByText("Inactive Agent");

    expect(screen.queryByRole("button", { name: "agents.open" })).not.toBeInTheDocument();
  });
```

- [ ] **Step 5: Make openability strict in agent management**

In `frontend-nextjs/src/views/Agents.tsx`, replace:

```tsx
function isOpenableAgent(agent: Agent | null) {
	return Boolean(agent && !agent.deleted_at && agent.is_active !== false);
}
```

with:

```tsx
function isOpenableAgent(agent: Agent | null) {
	return Boolean(agent && agent.is_active === true && !agent.deleted_at);
}
```

- [ ] **Step 6: Run task tests**

Run:

```bash
cd frontend-nextjs && npm run test -- --run tests/unit/AgentPanel.inactiveAgents.test.tsx tests/unit/Agents.kbOnboarding.test.tsx
```

Expected after implementation: both test files pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add frontend-nextjs/src/views/AgentPanel.tsx frontend-nextjs/src/views/Agents.tsx frontend-nextjs/tests/unit/AgentPanel.inactiveAgents.test.tsx frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx
git commit -m "fix: hide inactive agents from workspace entry"
```

---

### Task 2: Make bootstrap registration persist an authenticated session and enter the agent panel

**Files:**
- Modify: `backend/api/endpoints/auth.py`
- Modify: `backend/tests/test_api.py`
- Modify: `frontend-nextjs/src/context/AuthContext.tsx`
- Modify: `frontend-nextjs/tests/unit/Register.bootstrap.test.tsx`

- [ ] **Step 1: Update backend register test to require login-shaped response**

In `backend/tests/test_api.py`, replace `test_register_first_admin` with:

```python
@pytest.mark.asyncio
async def test_register_first_admin(public_client):
    response = await public_client.post(
        "/api/admin/register",
        json={
            "email": "test@example.com",
            "password": "testpassword123",
            "name": "Test Admin",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["admin"]["email"] == "test@example.com"
    assert data["admin"]["name"] == "Test Admin"
    assert data["admin"]["role"] == "super_admin"
```

- [ ] **Step 2: Run backend test to verify it fails before the backend change**

Run:

```bash
cd backend && pytest tests/test_api.py::test_register_first_admin -q
```

Expected before implementation: FAIL because `/api/admin/register` does not return `access_token` yet.

- [ ] **Step 3: Return a login session from bootstrap register**

In `backend/api/endpoints/auth.py`, change the decorator above `register` from:

```python
@router.post("/register", response_model=AdminResponse)
```

to:

```python
@router.post("/register", response_model=LoginResponse)
```

Then replace the final return block in `register`:

```python
    return AdminResponse(
        id=admin.id, email=admin.email, name=admin.name, role=admin.role
    )
```

with:

```python
    access_token = auth_service.create_access_token(data={"sub": str(admin.id)})
    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        admin={
            "id": admin.id,
            "email": admin.email,
            "name": admin.name,
            "role": admin.role,
        },
    )
```

- [ ] **Step 4: Update frontend bootstrap test to prove no second login route appears**

In `frontend-nextjs/tests/unit/Register.bootstrap.test.tsx`, keep the existing test body but make the mocked auth call represent a session-persisting register call. Replace:

```tsx
const registerMock = vi.fn();
```

with:

```tsx
const registerMock = vi.fn();
```

Keep this line in `beforeEach`:

```tsx
registerMock.mockResolvedValue(undefined);
```

Then make the route table include `/login` so the test fails if registration redirects there. Replace the router creation in the test with:

```tsx
    const router = createMemoryRouter(
      [
        { path: "/register", element: <Register /> },
        { path: "/", element: <div>agents.panelTitle</div> },
        { path: "/login", element: <div>login page</div> },
      ],
      { initialEntries: ["/register"] },
    );
```

Leave the final assertion as:

```tsx
      expect(router.state.location.pathname).toBe("/");
```

- [ ] **Step 5: Add direct session persistence helper in AuthContext**

In `frontend-nextjs/src/context/AuthContext.tsx`, add this type below the storage key constants:

```tsx
interface LoginResponseData {
  access_token: string
  admin: Admin
}
```

Inside `AuthProvider`, above `logout`, add:

```tsx
  const persistSession = useCallback((data: LoginResponseData) => {
    setToken(data.access_token)
    setAdmin(data.admin)
    localStorage.setItem(TOKEN_STORAGE_KEY, data.access_token)
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(data.admin))
  }, [])
```

Replace the duplicated persistence block in `login`:

```tsx
    setToken(data.access_token)
    setAdmin(data.admin)

    localStorage.setItem(TOKEN_STORAGE_KEY, data.access_token)
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(data.admin))
```

with:

```tsx
    persistSession(data)
```

Replace the current `register` function:

```tsx
  const register = async (email: string, password: string, name: string) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    })

    if (!response.ok) {
      const message = await parseErrorResponse(response)
      throw new Error(message || '注册失败')
    }

    // 注册后自动登录
    await login(email, password)
  }
```

with:

```tsx
  const register = async (email: string, password: string, name: string) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    })

    if (!response.ok) {
      const message = await parseErrorResponse(response)
      throw new Error(message || '注册失败')
    }

    const data = await response.json()
    if (data.access_token && data.admin) {
      persistSession(data)
      return
    }

    await login(email, password)
  }
```

Update the dependency list for `login` and `register` is not needed because they are function declarations inside the provider, but `persistSession` must be in scope before both functions.

- [ ] **Step 6: Run backend and frontend bootstrap tests**

Run:

```bash
cd backend && pytest tests/test_api.py::test_register_first_admin tests/test_api.py::test_login tests/test_api.py::test_registration_settings_before_and_after_bootstrap -q
```

Expected after implementation: all selected backend tests pass.

Run:

```bash
cd frontend-nextjs && npm run test -- --run tests/unit/Register.bootstrap.test.tsx
```

Expected after implementation: the bootstrap frontend test passes and the final route is `/`.

- [ ] **Step 7: Commit Task 2**

```bash
git add backend/api/endpoints/auth.py backend/tests/test_api.py frontend-nextjs/src/context/AuthContext.tsx frontend-nextjs/tests/unit/Register.bootstrap.test.tsx
git commit -m "fix: authenticate bootstrap registration"
```

---

### Task 3: Ensure post-create KB onboarding has exactly two buttons

**Files:**
- Modify: `frontend-nextjs/src/views/Agents.tsx`
- Modify: `frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx`

- [ ] **Step 1: Strengthen the modal test to count buttons**

In `frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx`, inside the test named `opens a two-button KB modal after creating an agent and skip enters that agent dashboard`, replace the assertions after `const modal = await screen.findByTestId("kb-onboarding-modal");` with:

```tsx
    const modalButtons = within(modal).getAllByRole("button");
    expect(modalButtons).toHaveLength(2);
    expect(within(modal).queryByTestId("kb-wizard")).not.toBeInTheDocument();
    expect(
      within(modal).getByRole("button", { name: "agents.kbOnboardingSkip" }),
    ).toBeInTheDocument();
    expect(
      within(modal).getByRole("button", {
        name: "agents.kbOnboardingContinue",
      }),
    ).toBeInTheDocument();
    expect(within(modal).queryByRole("button", { name: "buttons.cancel" })).not.toBeInTheDocument();
    expect(within(modal).queryByRole("button", { name: "kb.initButton" })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the modal test to verify it fails if the wizard is still nested**

Run:

```bash
cd frontend-nextjs && npm run test -- --run tests/unit/Agents.kbOnboarding.test.tsx
```

Expected before implementation if the nested wizard is still present: FAIL because the modal has four buttons or contains the wizard.

- [ ] **Step 3: Remove KBSetupWizard from the create-agent modal**

In `frontend-nextjs/src/views/Agents.tsx`, make sure there is no import like this:

```tsx
import KBSetupWizard from "../components/KBSetupWizard";
```

If it exists, delete that import.

Replace the `onboardingAgentId` modal content with this exact two-button content:

```tsx
      {onboardingAgentId && (
        <div
          data-testid="kb-onboarding-modal"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--space-4)",
          }}
          role="dialog"
          aria-modal="true"
          aria-label={t("agents.kbOnboardingTitle")}
        >
          <div
            className="liquid-glass-card"
            style={{
              maxWidth: 680,
              width: "100%",
              padding: "var(--space-6)",
              position: "relative",
            }}
          >
            <div style={{ marginBottom: "var(--space-4)" }}>
              <h2
                style={{
                  fontSize: "var(--text-xl)",
                  fontWeight: 700,
                  marginBottom: "var(--space-2)",
                  color: "var(--color-text-primary)",
                }}
              >
                {t("agents.kbOnboardingTitle")}
              </h2>
              <p
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--color-text-secondary)",
                }}
              >
                {t("agents.kbOnboardingDescription")}
              </p>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "var(--space-3)",
                marginTop: "var(--space-4)",
              }}
            >
              <button
                type="button"
                className="btn-secondary"
                onClick={enterCreatedAgentDashboard}
              >
                {t("agents.kbOnboardingSkip")}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={enterCreatedAgentKnowledge}
              >
                {t("agents.kbOnboardingContinue")}
              </button>
            </div>
          </div>
        </div>
      )}
```

The modal must not render `<KBSetupWizard />` and must not render `buttons.cancel` or `kb.initButton`.

- [ ] **Step 4: Run task tests**

Run:

```bash
cd frontend-nextjs && npm run test -- --run tests/unit/Agents.kbOnboarding.test.tsx
```

Expected after implementation: all tests in `Agents.kbOnboarding.test.tsx` pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add frontend-nextjs/src/views/Agents.tsx frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx
git commit -m "fix: simplify agent knowledge onboarding prompt"
```

---

### Task 4: Use “调试区” everywhere in Chinese mode

**Files:**
- Modify: `frontend-nextjs/src/locales/zh-CN/common.json`
- Create: `frontend-nextjs/tests/unit/zhCN.debugCopy.test.ts`

- [ ] **Step 1: Add locale regression test**

Create `frontend-nextjs/tests/unit/zhCN.debugCopy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import zhCN from "../../src/locales/zh-CN/common.json";

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(collectStrings);
  }
  return [];
}

describe("zh-CN debug area copy", () => {
  it("uses 调试区 instead of Playground in Chinese copy", () => {
    const allStrings = collectStrings(zhCN);

    expect(zhCN.navigation.playground).toBe("调试区");
    expect(allStrings.filter((text) => text.includes("Playground"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the locale test to verify it fails before copy changes**

Run:

```bash
cd frontend-nextjs && npm run test -- --run tests/unit/zhCN.debugCopy.test.ts
```

Expected before implementation: FAIL with the three strings that still contain `Playground`.

- [ ] **Step 3: Replace remaining Chinese Playground strings**

In `frontend-nextjs/src/locales/zh-CN/common.json`, replace these three entries:

```json
    "jinaKeyRequired": "请先在Playground中填写Jina Embedding API Key后再使用知识库功能。可在上方Embedding API下拉框中选择Jina或SiliconFlow。",
    "siliconflowKeyRequired": "请先在Playground中填写SiliconFlow Embedding API Key后再使用知识库功能。可在上方Embedding API下拉框中选择Jina或SiliconFlow。",
    "modelNameThinkingAdvice": "如需使用自带思考模型，请先在 Playground 中充分测试后再用于正式场景。",
```

with:

```json
    "jinaKeyRequired": "请先在调试区中填写Jina Embedding API Key后再使用知识库功能。可在上方Embedding API下拉框中选择Jina或SiliconFlow。",
    "siliconflowKeyRequired": "请先在调试区中填写SiliconFlow Embedding API Key后再使用知识库功能。可在上方Embedding API下拉框中选择Jina或SiliconFlow。",
    "modelNameThinkingAdvice": "如需使用自带思考模型，请先在调试区中充分测试后再用于正式场景。",
```

Keep this existing navigation entry unchanged because it is already correct:

```json
    "playground": "调试区",
```

- [ ] **Step 4: Run task test**

Run:

```bash
cd frontend-nextjs && npm run test -- --run tests/unit/zhCN.debugCopy.test.ts
```

Expected after implementation: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add frontend-nextjs/src/locales/zh-CN/common.json frontend-nextjs/tests/unit/zhCN.debugCopy.test.ts
git commit -m "fix: localize playground as debug area in Chinese"
```

---

### Task 5: Remove Agent Name from 调试区 AI settings

**Files:**
- Modify: `frontend-nextjs/src/components/AISettingsForm.tsx`
- Modify: `frontend-nextjs/tests/unit/AISettingsForm.playground.test.tsx`

- [ ] **Step 1: Strengthen AI settings test with Chinese label text**

In `frontend-nextjs/tests/unit/AISettingsForm.playground.test.tsx`, replace the i18n mock:

```tsx
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
```

with:

```tsx
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "labels.agentName": "Agent 名称",
        "labels.presetPersona": "预设人设",
        "labels.aiProvider": "AI 服务商",
      };
      return translations[key] || key;
    },
  }),
}));
```

Then replace the first test with:

```tsx
  it("does not render the Agent Name field in 调试区 AI settings", async () => {
    render(<AISettingsForm agentId="agt_1" compact />);

    await screen.findByDisplayValue("You are helpful.");

    expect(screen.queryByText("labels.agentName")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent 名称")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("官网客服")).not.toBeInTheDocument();
  });
```

Keep the existing second test that asserts autosave payload does not include `name`.

- [ ] **Step 2: Run AI settings test to verify it fails if the field is still present**

Run:

```bash
cd frontend-nextjs && npm run test -- --run tests/unit/AISettingsForm.playground.test.tsx
```

Expected before implementation if the Agent Name field still exists: FAIL because `Agent 名称` or the agent name input is present.

- [ ] **Step 3: Remove name state, field, and payload from AISettingsForm**

In `frontend-nextjs/src/components/AISettingsForm.tsx`, ensure the `formData` state does not contain `name`. The state must start like this:

```tsx
  const [formData, setFormData] = useState({
    system_prompt: "",
    model: "",
    temperature: 0.7,
    api_key: "",
    api_base: "",
    provider_type: "openai" as ProviderType,
    api_format: "openai" as ApiFormatType,
    top_k: 8,
    similarity_threshold: 0.01,
    enable_context: false,
    rate_limit_per_minute: 20,
    restricted_reply: "",
  });
```

In `fetchAgent`, ensure `setFormData` does not assign `name`. It must start like this:

```tsx
      setFormData({
        system_prompt: agentData.system_prompt || "",
        model: agentData.model || "deepseek-chat",
        temperature: agentData.temperature ?? 0.7,
        api_key: "",
        api_base: agentData.api_base || "https://api.deepseek.com/v1",
        provider_type: agentData.provider_type || "openai",
        api_format: (agentData.api_format as ApiFormatType) || "openai",
        top_k: agentData.top_k ?? 8,
        similarity_threshold: agentData.similarity_threshold ?? 0.01,
        enable_context: agentData.enable_context ?? false,
        rate_limit_per_minute:
          agentData.rate_limit_per_minute ??
          agentData.rate_limit_per_hour ??
          20,
        restricted_reply:
          agentData.restricted_reply ?? t("labels.restrictedReplyPlaceholder"),
      });
```

In `handleSave`, ensure `updateData` does not include `name`. It must be:

```tsx
      const updateData: Partial<Agent> = {
        system_prompt: formData.system_prompt,
        model: formData.model,
        temperature: formData.temperature,
        api_base: formData.api_base,
        provider_type: formData.provider_type,
        api_format: formData.api_format,
        top_k: formData.top_k,
        similarity_threshold: formData.similarity_threshold,
        enable_context: formData.enable_context,
        rate_limit_per_minute: formData.rate_limit_per_minute,
        restricted_reply: formData.restricted_reply,
        persona_type: selectedPersona,
      };
```

Delete any JSX block in `AISettingsForm.tsx` that renders `t("labels.agentName")`, `formData.name`, or an input whose value is `agent.name`.

- [ ] **Step 4: Prove the source no longer references the field in AISettingsForm**

Run:

```bash
grep -nE "labels\.agentName|formData\.name|name:" frontend-nextjs/src/components/AISettingsForm.tsx || true
```

Expected after implementation: no output.

- [ ] **Step 5: Run task test**

Run:

```bash
cd frontend-nextjs && npm run test -- --run tests/unit/AISettingsForm.playground.test.tsx
```

Expected after implementation: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add frontend-nextjs/src/components/AISettingsForm.tsx frontend-nextjs/tests/unit/AISettingsForm.playground.test.tsx
git commit -m "fix: remove agent name from debug settings"
```

---

### Task 6: Full verification

**Files:**
- Verify: `frontend-nextjs/src`
- Verify: `backend/api/endpoints/auth.py`
- Verify: `backend/tests/test_api.py`

- [ ] **Step 1: Run LSP diagnostics before build/test commands**

Run through the Pi tool, not shell:

```text
lsp_diagnostics filePath="frontend-nextjs/src" severity="error"
lsp_diagnostics filePaths=["backend/api/endpoints/auth.py","backend/tests/test_api.py"] severity="error"
```

Expected: no TypeScript or Python LSP errors introduced by these changes.

- [ ] **Step 2: Run targeted frontend tests**

Run:

```bash
cd frontend-nextjs && npm run test -- --run tests/unit/AgentPanel.inactiveAgents.test.tsx tests/unit/Agents.kbOnboarding.test.tsx tests/unit/Register.bootstrap.test.tsx tests/unit/zhCN.debugCopy.test.ts tests/unit/AISettingsForm.playground.test.tsx
```

Expected: all listed frontend test files pass.

- [ ] **Step 3: Run targeted backend tests**

Run:

```bash
cd backend && pytest tests/test_api.py::test_register_first_admin tests/test_api.py::test_login tests/test_api.py::test_register_second_admin_fails tests/test_api.py::test_registration_settings_before_and_after_bootstrap -q
```

Expected: all selected backend tests pass.

- [ ] **Step 4: Run required frontend verification**

Run:

```bash
cd frontend-nextjs && npm run build && npm run typecheck && npm run test
```

Expected: build succeeds, typecheck succeeds, all frontend tests pass.

- [ ] **Step 5: Run affected backend test module**

Run:

```bash
cd backend && pytest tests/test_api.py -q
```

Expected: `tests/test_api.py` passes.

- [ ] **Step 6: Manual acceptance checklist**

Start the dev stack or local services, then verify:

```bash
docker compose --profile dev up -d --build backend-dev frontend-dev
```

Expected manual UI results:

1. Deactivate an agent. In the root “智能体面板”, that agent is not shown as an openable card. In `/agents`, that agent has no “打开” button.
2. Create the first super admin on a clean database. After submit, the app enters `/` and shows “智能体面板”; it does not stop at `/login`.
3. Create a new agent. The KB prompt has exactly two buttons: “跳过” and “初始化知识库”. No inner “取消” button appears.
4. Switch to Chinese. The navigation and warning/help copy use “调试区”; no Chinese text shows `Playground`.
5. Open `/agents/{agentId}/playground`. In AI settings, there is no “Agent 名称” configuration field.

- [ ] **Step 7: Commit verification notes if any test files changed during fixes**

If verification required small test corrections, commit them:

```bash
git status --short
git add frontend-nextjs backend
git commit -m "test: cover agent workspace bugfix followup"
```

If there are no additional changes after Task 5 commits, skip this commit and keep the working tree clean.

---

## Self-Review Notes

- Spec coverage: Task 1 covers bug 1, Task 2 covers bug 3, Task 3 covers bug 4, Task 4 covers Chinese “调试区” copy in bug 9, Task 5 covers removing Agent Name from the debug page AI settings in bug 9.
- Placeholder scan: Every code-changing step includes concrete code or exact deletion/search instructions. Every test step includes an exact command and expected result.
- Type consistency: `Agent.is_active`, `Agent.deleted_at`, `LoginResponse`, `access_token`, `admin`, `formData`, and existing i18n keys match the inspected code paths.
