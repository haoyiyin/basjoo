# Auto KB Setup Onboarding After Agent Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After creating a new agent, automatically open the Knowledge Base setup modal and then navigate to the agent dashboard once setup is completed.

**Architecture:** Modify the Agents list view to detect new-agent creation, open a modal embedding the existing `KBSetupWizard`, block background interactions until setup finishes or is skipped, then route to `/agents/{id}/dashboard`. Extend API/translation/test utilities only as needed; reuse existing modal/wizard patterns to minimize surface area.

**Tech Stack:** React 18, TypeScript, react-router-dom, existing KBSetupWizard component, Vitest, Playwright, React Testing Library, i18next

---

### Task 1: Extend API client with `kbStatus` helper

**Files:**
- Modify: `frontend-nextjs/src/services/api.ts:430-480`
- Test: `frontend-nextjs/tests/unit/api.kbStatus.test.ts`

- [ ] **Step 1: Write failing unit test for `kbStatus`**

```ts
// frontend-nextjs/tests/unit/api.kbStatus.test.ts
import { describe, it, expect, vi } from 'vitest'
import { api } from '../../src/services/api'

describe('api.kbStatus', () => {
  it('returns kb status payload', async () => {
    const payload = { kb_setup_completed: false }
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
    const result = await api.kbStatus('agt_test')
    expect(result).toEqual(payload)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/kb/status?agent_id=agt_test'),
      expect.objectContaining({ headers: expect.any(Object) })
    )
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend-nextjs && npx vitest run tests/unit/api.kbStatus.test.ts`
Expected: FAIL with `api.kbStatus is not a function`

- [ ] **Step 3: Implement `kbStatus` in API client**

```ts
// add inside class ApiClient near other KB methods
async kbStatus(agentId: string): Promise<{ kb_setup_completed: boolean; embedding_provider?: string; embedding_model?: string; embedding_api_key_set?: boolean }> {
  const url = `${this.baseUrl}/api/v1/kb/status?agent_id=${encodeURIComponent(agentId)}`
  const response = await fetch(url, { headers: this.getHeaders() })
  if (!response.ok) throw new Error(`kbStatus failed: ${response.status}`)
  return response.json()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend-nextjs && npx vitest run tests/unit/api.kbStatus.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend-nextjs/src/services/api.ts frontend-nextjs/tests/unit/api.kbStatus.test.ts
git commit -m "feat(api): expose kbStatus helper for agent onboarding"
```

---

### Task 2: Add agent-onboarding modal strings to locales

**Files:**
- Modify: `frontend-nextjs/src/locales/en.json:120-220`
- Modify: `frontend-nextjs/src/locales/zh.json:120-220`

- [ ] **Step 1: Add English strings inside `agents` section**

```jsonc
// frontend-nextjs/src/locales/en.json
{
  "agents": {
    // ...existing keys...
    "kbOnboardingTitle": "Set up your Knowledge Base",
    "kbOnboardingDescription": "Configure embeddings to let your agent answer from your data. You can finish this later from Knowledge settings.",
    "kbOnboardingSkip": "Skip for now",
    "kbOnboardingContinue": "Go to Dashboard"
  }
}
```

- [ ] **Step 2: Add matching Simplified Chinese strings**

```jsonc
// frontend-nextjs/src/locales/zh.json
{
  "agents": {
    // ...existing keys...
    "kbOnboardingTitle": "设置知识库",
    "kbOnboardingDescription": "配置嵌入服务，让智能体基于你的数据回答问题。稍后也可以在知识库设置中完成。",
    "kbOnboardingSkip": "暂时跳过",
    "kbOnboardingContinue": "进入仪表盘"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend-nextjs/src/locales/en.json frontend-nextjs/src/locales/zh.json
git commit -m "feat(i18n): add strings for post-create KB onboarding modal"
```

---

### Task 3: Add `useAgentKbStatus` hook for modal state control

**Files:**
- Create: `frontend-nextjs/src/hooks/useAgentKbStatus.ts`
- Test: `frontend-nextjs/tests/unit/useAgentKbStatus.test.ts`

- [ ] **Step 1: Write failing tests for the hook**

```ts
// frontend-nextjs/tests/unit/useAgentKbStatus.test.ts
import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAgentKbStatus } from '../../src/hooks/useAgentKbStatus'
import { api } from '../../src/services/api'

vi.mock('../../src/services/api', () => ({
  api: {
    kbStatus: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

describe('useAgentKbStatus', () => {
  beforeEach(() => {
    mockedApi.kbStatus.mockReset()
  })

  it('returns loading=true initially and resolves data', async () => {
    mockedApi.kbStatus.mockResolvedValueOnce({ kb_setup_completed: false })
    const { result } = renderHook(() => useAgentKbStatus('agt_1'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.kbSetupCompleted).toBe(false)
  })

  it('rechecks when recheck() is called', async () => {
    mockedApi.kbStatus.mockResolvedValue({ kb_setup_completed: false })
    const { result } = renderHook(() => useAgentKbStatus('agt_1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    mockedApi.kbStatus.mockResolvedValueOnce({ kb_setup_completed: true })
    await act(() => result.current.recheck())
    expect(result.current.kbSetupCompleted).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend-nextjs && npx vitest run tests/unit/useAgentKbStatus.test.ts`
Expected: FAIL with module resolution error for hook

- [ ] **Step 3: Implement hook**

```ts
// frontend-nextjs/src/hooks/useAgentKbStatus.ts
import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api'

interface AgentKbStatusState {
  loading: boolean
  error: string | null
  kbSetupCompleted: boolean
  raw: Awaited<ReturnType<typeof api.kbStatus>> | null
  recheck: () => Promise<void>
}

export function useAgentKbStatus(agentId: string | null): AgentKbStatusState {
  const [loading, setLoading] = useState<boolean>(Boolean(agentId))
  const [error, setError] = useState<string | null>(null)
  const [kbSetupCompleted, setKbSetupCompleted] = useState(false)
  const [raw, setRaw] = useState<Awaited<ReturnType<typeof api.kbStatus>> | null>(null)

  const fetchStatus = useCallback(async () => {
    if (!agentId) return
    setLoading(true)
    setError(null)
    try {
      const status = await api.kbStatus(agentId)
      setRaw(status)
      setKbSetupCompleted(Boolean(status.kb_setup_completed))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load KB status')
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    if (!agentId) {
      setLoading(false)
      return
    }
    fetchStatus()
  }, [agentId, fetchStatus])

  return { loading, error, kbSetupCompleted, raw, recheck: fetchStatus }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend-nextjs && npx vitest run tests/unit/useAgentKbStatus.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend-nextjs/src/hooks/useAgentKbStatus.ts frontend-nextjs/tests/unit/useAgentKbStatus.test.ts
git commit -m "feat(hooks): add useAgentKbStatus for onboarding flow"
```

---

### Task 4: Extend Agents view to manage onboarding modal lifecycle

**Files:**
- Modify: `frontend-nextjs/src/views/Agents.tsx:1-260`

- [ ] **Step 1: Write failing component test for onboarding trigger**

```ts
// frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Agents from '../../src/views/Agents'
import { api } from '../../src/services/api'

vi.mock('../../src/services/api', () => ({
  api: {
    listAgents: vi.fn(),
    createAgent: vi.fn(),
    kbStatus: vi.fn(),
    deleteAgent: vi.fn(),
    restoreAgent: vi.fn(),
  },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('../../src/components/KBSetupWizard', () => ({
  __esModule: true,
  default: ({ onSetupComplete }: { onSetupComplete: () => void }) => (
    <div data-testid="kb-wizard">
      <button onClick={onSetupComplete}>complete</button>
    </div>
  ),
}))

const mockedApi = vi.mocked(api)

const existingAgent = { id: 'agt_old', name: 'Old Agent', description: '', deleted_at: null }
const newAgent = { id: 'agt_new', name: 'New Agent', description: '', deleted_at: null }

beforeEach(() => {
  mockedApi.listAgents.mockResolvedValue({ agents: [existingAgent] } as any)
  mockedApi.createAgent.mockResolvedValue(newAgent as any)
  mockedApi.kbStatus.mockResolvedValue({ kb_setup_completed: false } as any)
  mockedApi.deleteAgent.mockResolvedValue(undefined as any)
  mockedApi.restoreAgent.mockResolvedValue(newAgent as any)
})

it('opens KB modal after creating agent and navigates on completion', async () => {
  render(
    <MemoryRouter initialEntries={["/agents"]}>
      <Agents />
    </MemoryRouter>
  )
  await screen.findByText('Old Agent')

  fireEvent.change(screen.getByPlaceholderText('agents.namePlaceholder'), { target: { value: 'New Agent' } })
  fireEvent.click(screen.getByText('agents.create'))

  await waitFor(() => expect(screen.getByTestId('kb-wizard')).toBeInTheDocument())
  fireEvent.click(screen.getByText('complete'))

  await waitFor(() => expect(window.location.pathname).toBe('/agents/agt_new/dashboard'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend-nextjs && npx vitest run tests/unit/Agents.kbOnboarding.test.tsx`
Expected: FAIL because modal never appears / no navigation occurs

- [ ] **Step 3: Implement Agents view changes**

```tsx
// frontend-nextjs/src/views/Agents.tsx (key changes)

// add imports at top
import { useNavigate } from 'react-router-dom'
import { useCallback, useMemo, useState, FormEvent, useEffect } from 'react'
import KBSetupWizard from '../components/KBSetupWizard'
import { useAgentKbStatus } from '../hooks/useAgentKbStatus'
import { useTranslation } from 'react-i18next'
import { api, AgentCreateInput, AgentType } from '../services/api'
// ...existing layout imports...

// replace state declarations inside component with:
const [agents, setAgents] = useState<Agent[]>([])
const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
const [loading, setLoading] = useState(true)
const [saving, setSaving] = useState(false)
const [error, setError] = useState<string | null>(null)
const [onboardingAgentId, setOnboardingAgentId] = useState<string | null>(null)
const { kbSetupCompleted, loading: kbLoading, recheck } = useAgentKbStatus(onboardingAgentId)

// modify handleCreate
const handleCreate = async (event: FormEvent) => {
  event.preventDefault()
  const name = form.name.trim()
  const description = form.description?.trim() || undefined
  if (!name || name.length > AGENT_NAME_MAX_LENGTH || (description?.length || 0) > AGENT_DESCRIPTION_MAX_LENGTH) return

  setSaving(true)
  setError(null)
  try {
    const created = await api.createAgent({ ...form, name, description, widget_title: name })
    setAgents(prev => [created, ...prev])
    setSelectedAgentId(created.id)
    setForm({ name: '', description: '', agent_type: 'website_support', channel_mode: 'web_widget' })
    setOnboardingAgentId(created.id)
  } catch (err) {
    setError(err instanceof Error ? err.message : t('errors.networkError'))
  } finally {
    setSaving(false)
  }
}

// add handler to close modal once setup completes
const finishOnboarding = useCallback(async () => {
  await recheck()
  if (kbSetupCompleted || !onboardingAgentId) {
    navigate(`/agents/${onboardingAgentId}/dashboard`)
    setOnboardingAgentId(null)
  }
}, [kbSetupCompleted, navigate, onboardingAgentId, recheck])

// inside JSX, after main list section, add modal portal:
{onboardingAgentId && (
  <div
    data-testid="kb-onboarding-modal"
    style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}
    role="dialog"
    aria-modal="true"
    aria-label={t('agents.kbOnboardingTitle')}
  >
    <div className="liquid-glass-card" style={{ maxWidth: 680, width: '100%', padding: 'var(--space-6)', position: 'relative' }}>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--color-text-primary)' }}>{t('agents.kbOnboardingTitle')}</h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{t('agents.kbOnboardingDescription')}</p>
      </div>
      <KBSetupWizard agentId={onboardingAgentId} onSetupComplete={finishOnboarding} onCancel={() => { setOnboardingAgentId(null) }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-4)' }}>
        <button className="btn-secondary" onClick={() => { setOnboardingAgentId(null) }}>{t('agents.kbOnboardingSkip')}</button>
        <button className="btn-primary" onClick={finishOnboarding}>{t('agents.kbOnboardingContinue')}</button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend-nextjs && npx vitest run tests/unit/Agents.kbOnboarding.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend-nextjs/src/views/Agents.tsx frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx
git commit -m "feat(agents): auto-open KB onboarding after agent creation"
```

---

### Task 5: Extend KnowledgeBaseSetup to accept modal props and emit completion events

**Files:**
- Modify: `frontend-nextjs/src/views/KnowledgeBaseSetup.tsx:1-120`

- [ ] **Step 1: Write failing unit test for modal props**

```ts
// frontend-nextjs/tests/unit/KnowledgeBaseSetup.modal.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import KnowledgeBaseSetup from '../../src/views/KnowledgeBaseSetup'
import { api } from '../../src/services/api'

vi.mock('../../src/services/api', () => ({
  api: {
    kbStatus: vi.fn(),
    kbReset: vi.fn(),
  },
}))
vi.mock('../../src/components/AdminLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('react-router-dom', () => ({
  useParams: () => ({ agentId: 'agt_1' }),
}))

const mockedApi = vi.mocked(api)

it('fires onSetupComplete when wizard completes', async () => {
  mockedApi.kbStatus.mockResolvedValue({ kb_setup_completed: false } as any)
  const onSetupComplete = vi.fn()
  render(<KnowledgeBaseSetup agentId="agt_1" onSetupComplete={onSetupComplete} />)
  await waitFor(() => expect(screen.getByTestId('kb-wizard')).toBeInTheDocument())
  fireEvent.click(screen.getByText('complete'))
  await waitFor(() => expect(onSetupComplete).toHaveBeenCalled())
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend-nextjs && npx vitest run tests/unit/KnowledgeBaseSetup.modal.test.tsx`
Expected: FAIL due to missing test-id or missing callback wiring

- [ ] **Step 3: Implement support for modal layout + completion propagation**

```tsx
// frontend-nextjs/src/views/KnowledgeBaseSetup.tsx
// ...existing imports...

export default function KnowledgeBaseSetup({ agentId: agentIdProp, onSetupComplete }: KnowledgeBaseSetupProps) {
  // ...existing state...

  // inside "not set up" branch:
  return (
    <AdminLayout>
      <div style={{ padding: 'var(--space-8)', maxWidth: '1400px', margin: '0 auto' }}>
        <KBSetupWizard
          agentId={agentId!}
          onSetupComplete={() => {
            fetchKBStatus()
            onSetupComplete?.()
          }}
          onCancel={() => onSetupComplete?.()}
        />
      </div>
    </AdminLayout>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend-nextjs && npx vitest run tests/unit/KnowledgeBaseSetup.modal.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend-nextjs/src/views/KnowledgeBaseSetup.tsx frontend-nextjs/tests/unit/KnowledgeBaseSetup.modal.test.tsx
git commit -m "fix(kb): emit onSetupComplete from KB wizard when used as modal"
```

---

### Task 6: Add Playwright coverage for full onboarding journey

**Files:**
- Modify: `tests/e2e/specs/agent-onboarding.spec.ts`
- Test: `tests/e2e/specs/agent-onboarding.spec.ts`

- [ ] **Step 1: Write failing Playwright test**

```ts
// tests/e2e/specs/agent-onboarding.spec.ts
import { test, expect } from '@playwright/test'

test('new agent opens KB modal then navigates to dashboard', async ({ page }) => {
  await page.goto('http://localhost:3000/agents')
  await page.waitForResponse(resp => resp.url().includes('/api/v1/agents') && resp.status() === 200)

  await page.fill('input[placeholder="agents.namePlaceholder"]', 'Auto QA Agent')
  await page.click('button:text("agents.create")')

  await expect(page.locator('[data-testid="kb-onboarding-modal"]')).toBeVisible()
  await page.click('button:text("agents.kbOnboardingContinue")')

  await expect(page).toHaveURL(/\/agents\/.*\/dashboard/)
  await expect(page.locator('[data-testid="kb-onboarding-modal"]')).toHaveCount(0)
})
```

- [ ] **Step 2: Run Playwright to verify it fails**

Run: `npm run test:e2e -- --grep "new agent opens KB modal"`
Expected: FAIL because modal is absent

- [ ] **Step 3: Ensure backend fixture seeds at least one workspace & admin session**

```bash
# rely on existing global setup; no code change unless failures occur
```

- [ ] **Step 4: Run Playwright to verify it passes**

Run: `npm run test:e2e -- --grep "new agent opens KB modal"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/specs/agent-onboarding.spec.ts
git commit -m "test(e2e): cover auto KB onboarding flow after agent creation"
```

---

## Self-Review Checklist

1. **Spec coverage:** Every requested behavior—modal auto-open after agent creation, embedded KB wizard, dashboard navigation post-setup—is addressed across Tasks 1-6, including unit + E2E coverage and i18n support.
2. **Placeholder scan:** No TBD/TODO markers. Each step includes concrete code, commands, and expected outputs.
3. **Type consistency:** Shared types (`Agent`, `AgentCreateInput`, `EmbeddingProvider`, hook return shape) are referenced consistently. Wizard callback names align between Agents view and KnowledgeBaseSetup component.
