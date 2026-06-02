# Agent Settings Route 404 Fix Implementation Plan

**Status:** Draft
**Date:** 2026-06-02
**Source Spec:** User bug report in current conversation: “智能体工作空间下的 `/settings/agent` 路径显示 404，请查明原因，并制定一个修复计划。”
**Goal:** Make Agent Settings reachable from both `/agents/{agentId}/settings/agent` and `/settings/agent`, with a real agent/widget settings page instead of a Next.js 404.
**Architecture:** The sidebar already generates `/agents/{agentId}/settings/agent` from `AdminLayout.tsx`, and `RequireAuth.tsx` already whitelists `/settings/agent`; the missing pieces are App Router page files and a backing `AgentSettings` view. Add small, tested pure helpers for widget-origin validation and embed-code generation, then create the view and finally wire both Next route files. Keep backend APIs unchanged; use existing `api.getAgent`, `api.getDefaultAgent`, and `api.updateAgent`.
**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Vitest + Testing Library, FastAPI v1 agent config API.

## Debugging Report

**Symptom:** In an agent workspace, the sidebar Agent Settings destination resolves to `/agents/{agentId}/settings/agent`, but opening it renders Next.js 404. The root route `/settings/agent` also renders 404.

**Reproduction:**

```bash
cd frontend-nextjs
PORT=3101
LOG=/tmp/basjoo-next-route-debug.log
rm -f "$LOG"
(npm run dev -- -p "$PORT" >"$LOG" 2>&1) &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT
python3 - <<'PY'
import urllib.request, urllib.error, time
port=3101
for _ in range(60):
    try:
        urllib.request.urlopen(f'http://localhost:{port}/', timeout=1).read(100)
        break
    except Exception:
        time.sleep(0.5)
for path in ['/agents/agt_1/dashboard','/agents/agt_1/settings/agent','/settings/agent']:
    try:
        resp=urllib.request.urlopen(f'http://localhost:{port}{path}', timeout=10)
        code=resp.status
    except urllib.error.HTTPError as e:
        code=e.code
    print(f'{path} -> HTTP {code}')
PY
```

Observed during investigation:

```text
/agents/agt_1/dashboard -> HTTP 200
/agents/agt_1/settings/agent -> HTTP 404
/settings/agent -> HTTP 404
```

**Root Cause:** `frontend-nextjs/src/components/AdminLayout.tsx` already links Agent Settings to `/settings/agent`, which becomes `/agents/{agentId}/settings/agent` inside agent workspaces. `frontend-nextjs/src/components/RequireAuth.tsx` also already includes `/settings/agent` in the root super-admin whitelist. However, the App Router has no `frontend-nextjs/app/(dashboard)/settings/agent/page.tsx` and no `frontend-nextjs/app/(dashboard)/agents/[agentId]/settings/agent/page.tsx`, so Next.js has no route to render. There is also no `frontend-nextjs/src/views/AgentSettings.tsx` backing view; only locale strings and a helper-only unit test remain. This came from the earlier rename plan (`doc/plan/agent-settings-rename-plan.md`) explicitly excluding “补齐缺失 settings page,” leaving navigation renamed but page files absent.

**Fix Direction:** Add the missing route wrappers and backing view. Do not change backend contracts. Preserve the existing route names and sidebar behavior.

## Planning Notes

- Existing patterns to follow:
  - Agent-scoped App Router pages import views from `frontend-nextjs/src/views/`, e.g. `frontend-nextjs/app/(dashboard)/agents/[agentId]/dashboard/page.tsx` imports `../../../../../src/views/Dashboard`.
  - Views wrap content with `AdminLayout`, use `useParams<{ agentId?: string }>()`, and call `api.getAgent(routeAgentId)` for agent-scoped data.
  - Frontend API updates agent config through `api.updateAgent(agentId, updates)` in `frontend-nextjs/src/services/api.ts`.
  - Origin normalization should match backend `backend/api/v1/schemas.py::normalize_widget_origin`: require `http://` or `https://`, reject credentials, normalize scheme and host to lowercase, drop path/query/fragment by returning origin only.
- Constraints:
  - Do not add backend routes or migrations.
  - Do not reintroduce `/settings/system`.
  - Do not change `AISettingsForm` semantics; Agent Settings is for widget/embed/operational settings, not model/provider settings.
  - Support users cannot access this page in agent scope because `RequireAuth.tsx` already redirects support users to sessions; do not loosen that permission.
- Assumptions:
  - `/settings/agent` should also be a valid route because the previous rename decision and `RequireAuth.tsx` both include it; when no `agentId` route param exists, the page should load `api.getDefaultAgent()`.
  - The minimum non-404 page should expose the settings already represented by API fields and locale strings: `widget_title`, `widget_color`, `welcome_message`, `history_days`, `allowed_widget_origins`, and a generated `/sdk.js?agent_id=...` embed code.
- Open questions that do not block starting:
  - Whether future UX should add a live widget preview. This plan intentionally does not add preview beyond displaying the saved values and embed code.

## File Map

- Create: `frontend-nextjs/src/lib/widgetOrigins.ts` — shared parser/validator for `allowed_widget_origins` text input.
- Create: `frontend-nextjs/src/lib/widgetEmbedCode.ts` — shared helper to resolve widget SDK base URL and generate embed snippet.
- Create: `frontend-nextjs/src/views/AgentSettings.tsx` — Agent Settings page content and form.
- Create: `frontend-nextjs/app/(dashboard)/settings/agent/page.tsx` — root App Router page wrapper for `/settings/agent`.
- Create: `frontend-nextjs/app/(dashboard)/agents/[agentId]/settings/agent/page.tsx` — agent-scoped App Router page wrapper for `/agents/{agentId}/settings/agent`.
- Create: `frontend-nextjs/tests/unit/widget-embed-code.test.ts` — helper tests for embed snippet generation.
- Create: `frontend-nextjs/tests/unit/AgentSettings.test.tsx` — view behavior tests for load, invalid origin validation, and save payload.
- Create: `frontend-nextjs/tests/unit/agent-settings-next-routes.test.ts` — filesystem guard that both Next route files exist and import `AgentSettings`.
- Modify: `frontend-nextjs/tests/unit/agent-settings-origin-parser.test.ts` — import real helper functions instead of duplicating extracted test-only functions.
- Read: `frontend-nextjs/src/components/AdminLayout.tsx` — confirm existing sidebar route remains `/settings/agent`.
- Read: `frontend-nextjs/src/components/RequireAuth.tsx` — confirm existing auth behavior remains unchanged.
- Read: `frontend-nextjs/src/services/api.ts` — use existing `Agent`, `api.getAgent`, `api.getDefaultAgent`, and `api.updateAgent`.
- Read: `backend/api/v1/schemas.py` — mirror frontend origin validation behavior to backend normalization.

## Parallelization Strategy

Preferred execution model: pure helper contracts first, then page behavior, then route wiring, then final verification.

| Batch | Tasks | Can Run in Parallel? | Reason |
|-------|-------|----------------------|--------|
| 0 | Task 1, Task 2 | yes | disjoint helper files and tests; both depend only on existing contracts |
| 1 | Task 3 | no | creates shared `AgentSettings` view and consumes both helper contracts |
| 2 | Task 4 | no | wires shared Next route entry points to the view |
| 3 | Task 5 | no | final integrated diagnostics, build/test, and manual route reproduction |

## Verification Commands

Run these before declaring the bug fixed:

```bash
cd frontend-nextjs && npx vitest run tests/unit/agent-settings-origin-parser.test.ts tests/unit/widget-embed-code.test.ts tests/unit/AgentSettings.test.tsx tests/unit/agent-settings-next-routes.test.ts
cd frontend-nextjs && npm run typecheck
cd frontend-nextjs && npm run test
cd frontend-nextjs && npm run build
```

Expected: all commands pass with no new warnings or errors. Also run `lsp_diagnostics` for the changed frontend files before the build.

Manual reproduction after implementation:

```bash
cd frontend-nextjs
PORT=3101
LOG=/tmp/basjoo-next-route-debug.log
rm -f "$LOG"
(npm run dev -- -p "$PORT" >"$LOG" 2>&1) &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT
python3 - <<'PY'
import urllib.request, urllib.error, time
port=3101
for _ in range(60):
    try:
        urllib.request.urlopen(f'http://localhost:{port}/', timeout=1).read(100)
        break
    except Exception:
        time.sleep(0.5)
for path in ['/agents/agt_1/settings/agent','/settings/agent']:
    try:
        resp=urllib.request.urlopen(f'http://localhost:{port}{path}', timeout=10)
        code=resp.status
    except urllib.error.HTTPError as e:
        code=e.code
    print(f'{path} -> HTTP {code}')
PY
```

Expected after implementation: both paths return HTTP 200 or an auth redirect response, but not HTTP 404. In an authenticated browser session, `/agents/{realAgentId}/settings/agent` renders Agent Settings.

---

### Task 1: Extract Agent Settings Origin Helpers

**Purpose:** Move `allowed_widget_origins` parsing/validation out of a test-only copy into production code so the future settings form and existing parser tests share one implementation.

**Execution Metadata:**
- Dependencies: `none`
- Parallelizable: `yes`
- Batch: `0/helpers`
- Owns:
  - `frontend-nextjs/src/lib/widgetOrigins.ts`
  - `frontend-nextjs/tests/unit/agent-settings-origin-parser.test.ts`
- Reads:
  - `backend/api/v1/schemas.py`
  - `frontend-nextjs/src/services/api.ts`
- Must not edit:
  - `frontend-nextjs/src/views/AgentSettings.tsx`
  - `frontend-nextjs/app/(dashboard)/settings/agent/page.tsx`
  - `frontend-nextjs/app/(dashboard)/agents/[agentId]/settings/agent/page.tsx`

**Files:**
- Create: `frontend-nextjs/src/lib/widgetOrigins.ts`
- Modify/Test: `frontend-nextjs/tests/unit/agent-settings-origin-parser.test.ts`

**Context for implementer:**
- Backend normalization is in `backend/api/v1/schemas.py::normalize_widget_origin`.
- Existing tests in `frontend-nextjs/tests/unit/agent-settings-origin-parser.test.ts` currently define duplicate local helper functions; replace those local definitions with imports from the new production helper.
- Keep the current behavior: split on newline or comma, trim, filter empty entries, require `http:` or `https:`, reject credentials, normalize to lowercase origin, drop path, deduplicate after normalization.

- [ ] **Step 1: Write the failing test**

Modify `frontend-nextjs/tests/unit/agent-settings-origin-parser.test.ts` by deleting the local `parseAllowedWidgetOriginsText` and `validateAllowedWidgetOriginsText` function definitions and importing the real functions:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseAllowedWidgetOriginsText,
  validateAllowedWidgetOriginsText,
} from '../../src/lib/widgetOrigins';
```

Keep the existing test cases unchanged. Add this case to document query/fragment stripping:

```ts
it('strips query and fragment from origin', () => {
  const result = validateAllowedWidgetOriginsText('https://example.com/path?x=1#top');
  expect(result.normalizedOrigins).toEqual(['https://example.com']);
  expect(result.invalidOrigins).toEqual([]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/agent-settings-origin-parser.test.ts
```

Expected: FAIL because `../../src/lib/widgetOrigins` does not exist.

- [ ] **Step 3: Implement the minimal code**

Create `frontend-nextjs/src/lib/widgetOrigins.ts`:

```ts
export interface WidgetOriginValidationResult {
  normalizedOrigins: string[];
  invalidOrigins: string[];
}

export function parseAllowedWidgetOriginsText(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function validateAllowedWidgetOriginsText(
  value: string,
): WidgetOriginValidationResult {
  const normalizedOrigins: string[] = [];
  const invalidOrigins: string[] = [];
  const seenOrigins = new Set<string>();

  for (const origin of parseAllowedWidgetOriginsText(value)) {
    try {
      const url = new URL(origin);
      const protocol = url.protocol.toLowerCase();
      if (
        (protocol !== 'http:' && protocol !== 'https:') ||
        !url.host ||
        url.username ||
        url.password
      ) {
        invalidOrigins.push(origin);
        continue;
      }

      const normalizedOrigin = `${protocol}//${url.host.toLowerCase()}`;
      if (!seenOrigins.has(normalizedOrigin)) {
        seenOrigins.add(normalizedOrigin);
        normalizedOrigins.push(normalizedOrigin);
      }
    } catch {
      invalidOrigins.push(origin);
    }
  }

  return { normalizedOrigins, invalidOrigins };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/agent-settings-origin-parser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Refactor while staying green**

Only improve local names or formatting if needed. Do not change validation semantics.

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/agent-settings-origin-parser.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run relevant broader verification**

Run:

```bash
cd frontend-nextjs && npm run typecheck
```

Expected: PASS with no new TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add frontend-nextjs/src/lib/widgetOrigins.ts frontend-nextjs/tests/unit/agent-settings-origin-parser.test.ts
git commit -m "fix: extract widget origin validation"
```

---

### Task 2: Add Widget Embed Code Helper

**Purpose:** Provide a tested pure helper that generates the script snippet shown on Agent Settings without coupling tests to browser globals or component rendering.

**Execution Metadata:**
- Dependencies: `none`
- Parallelizable: `yes`
- Batch: `0/helpers`
- Owns:
  - `frontend-nextjs/src/lib/widgetEmbedCode.ts`
  - `frontend-nextjs/tests/unit/widget-embed-code.test.ts`
- Reads:
  - `widget/src/BasjooWidget.tsx`
  - `backend/main.py`
  - `frontend-nextjs/src/lib/env.ts`
- Must not edit:
  - `frontend-nextjs/src/lib/widgetOrigins.ts`
  - `frontend-nextjs/src/views/AgentSettings.tsx`
  - `frontend-nextjs/app/(dashboard)/settings/agent/page.tsx`
  - `frontend-nextjs/app/(dashboard)/agents/[agentId]/settings/agent/page.tsx`

**Files:**
- Create: `frontend-nextjs/src/lib/widgetEmbedCode.ts`
- Create/Test: `frontend-nextjs/tests/unit/widget-embed-code.test.ts`

**Context for implementer:**
- `backend/main.py` serves `/sdk.js`.
- `widget/src/BasjooWidget.tsx` auto-bootstraps from script query params and recognizes `agent_id` / `agentId`, `api_base` / `apiBase`, `theme_color` / `themeColor`, and `welcome_message` / `welcomeMessage`.
- Use `agent_id` in generated snippets to match backend snake_case API naming.

- [ ] **Step 1: Write the failing test**

Create `frontend-nextjs/tests/unit/widget-embed-code.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildWidgetEmbedCode, resolveWidgetScriptBaseUrl } from '../../src/lib/widgetEmbedCode';

describe('resolveWidgetScriptBaseUrl', () => {
  it('uses explicit API base when provided', () => {
    expect(resolveWidgetScriptBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
  });

  it('falls back to current origin when API base is empty', () => {
    expect(resolveWidgetScriptBaseUrl('', 'https://admin.example.com/settings/agent')).toBe(
      'https://admin.example.com',
    );
  });
});

describe('buildWidgetEmbedCode', () => {
  it('generates sdk.js script with encoded agent_id', () => {
    expect(buildWidgetEmbedCode('agt 1', 'https://api.example.com')).toBe(
      '<script src="https://api.example.com/sdk.js?agent_id=agt+1" async></script>',
    );
  });

  it('includes api_base when the SDK origin differs from the runtime API base', () => {
    expect(
      buildWidgetEmbedCode('agt_1', 'https://admin.example.com', {
        apiBase: 'https://api.example.com',
      }),
    ).toBe(
      '<script src="https://admin.example.com/sdk.js?agent_id=agt_1&api_base=https%3A%2F%2Fapi.example.com" async></script>',
    );
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/widget-embed-code.test.ts
```

Expected: FAIL because `../../src/lib/widgetEmbedCode` does not exist.

- [ ] **Step 3: Implement the minimal code**

Create `frontend-nextjs/src/lib/widgetEmbedCode.ts`:

```ts
export interface WidgetEmbedCodeOptions {
  apiBase?: string;
}

export function resolveWidgetScriptBaseUrl(
  configuredApiBase: string | undefined,
  currentHref?: string,
): string {
  const trimmed = configuredApiBase?.trim().replace(/\/$/, '');
  if (trimmed) return trimmed;

  if (currentHref) {
    return new URL(currentHref).origin;
  }

  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return '';
}

export function buildWidgetEmbedCode(
  agentId: string,
  scriptBaseUrl: string,
  options: WidgetEmbedCodeOptions = {},
): string {
  const sdkUrl = new URL('/sdk.js', `${scriptBaseUrl.replace(/\/$/, '')}/`);
  sdkUrl.searchParams.set('agent_id', agentId);
  if (options.apiBase?.trim()) {
    sdkUrl.searchParams.set('api_base', options.apiBase.trim().replace(/\/$/, ''));
  }
  return `<script src="${sdkUrl.toString()}" async></script>`;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/widget-embed-code.test.ts
```

Expected: PASS.

- [ ] **Step 5: Refactor while staying green**

Only improve helper names or formatting if needed. Do not change snippet format without updating tests.

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/widget-embed-code.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run relevant broader verification**

Run:

```bash
cd frontend-nextjs && npm run typecheck
```

Expected: PASS with no new TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add frontend-nextjs/src/lib/widgetEmbedCode.ts frontend-nextjs/tests/unit/widget-embed-code.test.ts
git commit -m "fix: add widget embed code helper"
```

---

### Task 3: Create Agent Settings View

**Purpose:** Add the actual React view that loads an agent, edits widget/embed settings, validates origins before save, and displays the generated embed code.

**Execution Metadata:**
- Dependencies: `Task 1`, `Task 2`
- Parallelizable: `no`
- Batch: `1/view`
- Owns:
  - `frontend-nextjs/src/views/AgentSettings.tsx`
  - `frontend-nextjs/tests/unit/AgentSettings.test.tsx`
- Reads:
  - `frontend-nextjs/src/views/Dashboard.tsx`
  - `frontend-nextjs/src/views/Playground.tsx`
  - `frontend-nextjs/src/components/AdminLayout.tsx`
  - `frontend-nextjs/src/services/api.ts`
  - `frontend-nextjs/src/locales/en-US/common.json`
  - `frontend-nextjs/src/locales/zh-CN/common.json`
  - `frontend-nextjs/src/lib/widgetOrigins.ts`
  - `frontend-nextjs/src/lib/widgetEmbedCode.ts`
- Must not edit:
  - `frontend-nextjs/app/(dashboard)/settings/agent/page.tsx`
  - `frontend-nextjs/app/(dashboard)/agents/[agentId]/settings/agent/page.tsx`
  - `frontend-nextjs/src/components/RequireAuth.tsx`
  - `frontend-nextjs/src/components/AdminLayout.tsx`

**Files:**
- Create: `frontend-nextjs/src/views/AgentSettings.tsx`
- Create/Test: `frontend-nextjs/tests/unit/AgentSettings.test.tsx`

**Context for implementer:**
- Use `AdminLayout` at the top level, like `Dashboard`, `Sessions`, and `Playground`.
- Use `useParams<{ agentId?: string }>()` from `react-router-dom`.
- If `routeAgentId` exists, call `api.getAgent(routeAgentId)`. If it does not exist, call `api.getDefaultAgent()` so `/settings/agent` is not a dead route.
- Save only these fields: `widget_title`, `widget_color`, `welcome_message`, `history_days`, `allowed_widget_origins`.
- Keep inputs controlled and typed; do not use `any`.
- Use existing locale keys where possible: `navigation.agentSettings`, `labels.configAgentSettings`, `labels.widgetTitle`, `labels.themeColor`, `labels.welcomeMessage`, `labels.historyRetention`, `labels.embedWhitelist`, `labels.widgetEmbedCode`, `buttons.save`, `buttons.copy`, `status.loading`, `errors.loadFailed`, `errors.saveFailed`, `labels.settingsSaved`, `labels.embedWhitelistInvalid`.

- [ ] **Step 1: Write the failing test**

Create `frontend-nextjs/tests/unit/AgentSettings.test.tsx`:

```tsx
// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentSettings from '../../src/views/AgentSettings';
import { api } from '../../src/services/api';

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    admin: { id: 1, name: 'Owner', email: 'owner@example.com', role: 'super_admin' },
    logout: vi.fn(),
  }),
}));

vi.mock('../../src/hooks/useMediaQuery', () => ({
  useIsMobile: () => false,
}));

vi.mock('../../src/services/api', () => ({
  api: {
    getAgent: vi.fn(),
    getDefaultAgent: vi.fn(),
    updateAgent: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params?.origins ? `${key}: ${params.origins}` : key,
  }),
}));

const mockedApi = vi.mocked(api);

const agent = {
  id: 'agt_1',
  name: 'Support Bot',
  widget_title: 'Helpdesk',
  widget_color: '#00aaff',
  welcome_message: 'Hello there',
  history_days: 30,
  allowed_widget_origins: ['https://example.com'],
  system_prompt: 'prompt',
  model: 'deepseek-chat',
  temperature: 0.7,
  max_tokens: 1024,
  embedding_model: 'jina-embeddings-v3',
  top_k: 8,
  similarity_threshold: 0.01,
  enable_context: true,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
};

function renderAgentSettings(initialEntry = '/agents/agt_1/settings/agent') {
  const router = createMemoryRouter(
    [{ path: '/agents/:agentId/settings/agent', element: <AgentSettings /> }],
    { initialEntries: [initialEntry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.getAgent.mockResolvedValue(agent as never);
  mockedApi.getDefaultAgent.mockResolvedValue(agent as never);
  mockedApi.updateAgent.mockResolvedValue(agent as never);
});

describe('AgentSettings', () => {
  it('loads the route agent and renders saved widget settings', async () => {
    renderAgentSettings();

    await waitFor(() => expect(mockedApi.getAgent).toHaveBeenCalledWith('agt_1'));
    expect(screen.getByRole('heading', { name: 'navigation.agentSettings' })).toBeInTheDocument();
    expect(screen.getByLabelText('labels.widgetTitle')).toHaveValue('Helpdesk');
    expect(screen.getByLabelText('labels.themeColor')).toHaveValue('#00aaff');
    expect(screen.getByLabelText('labels.welcomeMessage')).toHaveValue('Hello there');
    expect(screen.getByLabelText('labels.historyRetention')).toHaveValue(30);
    expect(screen.getByLabelText('labels.embedWhitelist')).toHaveValue('https://example.com');
    expect(screen.getByText(/sdk\.js\?agent_id=agt_1/)).toBeInTheDocument();
  });

  it('blocks save and shows invalid origin message for malformed whitelist entries', async () => {
    const user = userEvent.setup();
    renderAgentSettings();

    const origins = await screen.findByLabelText('labels.embedWhitelist');
    await user.clear(origins);
    await user.type(origins, 'example.com');
    await user.click(screen.getByRole('button', { name: 'buttons.save' }));

    expect(mockedApi.updateAgent).not.toHaveBeenCalled();
    expect(screen.getByText('labels.embedWhitelistInvalid: example.com')).toBeInTheDocument();
  });

  it('saves normalized widget settings', async () => {
    const user = userEvent.setup();
    renderAgentSettings();

    await user.clear(await screen.findByLabelText('labels.widgetTitle'));
    await user.type(screen.getByLabelText('labels.widgetTitle'), 'New title');
    await user.clear(screen.getByLabelText('labels.embedWhitelist'));
    await user.type(screen.getByLabelText('labels.embedWhitelist'), 'HTTPS://Example.COM/path');
    await user.click(screen.getByRole('button', { name: 'buttons.save' }));

    await waitFor(() => {
      expect(mockedApi.updateAgent).toHaveBeenCalledWith('agt_1', {
        widget_title: 'New title',
        widget_color: '#00aaff',
        welcome_message: 'Hello there',
        history_days: 30,
        allowed_widget_origins: ['https://example.com'],
      });
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/AgentSettings.test.tsx
```

Expected: FAIL because `../../src/views/AgentSettings` does not exist.

- [ ] **Step 3: Implement the minimal code**

Create `frontend-nextjs/src/views/AgentSettings.tsx` with this structure:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../components/AdminLayout';
import { api } from '../services/api';
import type { Agent } from '../services/api';
import { API_BASE_URL } from '../lib/env';
import { validateAllowedWidgetOriginsText } from '../lib/widgetOrigins';
import { buildWidgetEmbedCode, resolveWidgetScriptBaseUrl } from '../lib/widgetEmbedCode';
import { useIsMobile } from '../hooks/useMediaQuery';

interface AgentSettingsFormData {
  widget_title: string;
  widget_color: string;
  welcome_message: string;
  history_days: number;
  allowedOriginsText: string;
}

const DEFAULT_WIDGET_COLOR = '#3B82F6';
const DEFAULT_HISTORY_DAYS = 30;

function formDataFromAgent(agent: Agent): AgentSettingsFormData {
  return {
    widget_title: agent.widget_title || agent.name || '',
    widget_color: agent.widget_color || DEFAULT_WIDGET_COLOR,
    welcome_message: agent.welcome_message || '',
    history_days: agent.history_days ?? DEFAULT_HISTORY_DAYS,
    allowedOriginsText: (agent.allowed_widget_origins || []).join('\n'),
  };
}

export default function AgentSettings() {
  const { t } = useTranslation('common');
  const { agentId: routeAgentId } = useParams<{ agentId?: string }>();
  const isMobile = useIsMobile();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [formData, setFormData] = useState<AgentSettingsFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadAgent() {
      setLoading(true);
      setError(null);
      try {
        const nextAgent = routeAgentId ? await api.getAgent(routeAgentId) : await api.getDefaultAgent();
        if (!cancelled) {
          setAgent(nextAgent);
          setFormData(formDataFromAgent(nextAgent));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('errors.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadAgent();
    return () => {
      cancelled = true;
    };
  }, [routeAgentId, t]);

  const embedCode = useMemo(() => {
    if (!agent) return '';
    const scriptBaseUrl = resolveWidgetScriptBaseUrl(API_BASE_URL);
    return buildWidgetEmbedCode(agent.id, scriptBaseUrl);
  }, [agent]);

  async function handleSave() {
    if (!agent || !formData) return;
    const originResult = validateAllowedWidgetOriginsText(formData.allowedOriginsText);
    if (originResult.invalidOrigins.length > 0) {
      setError(t('labels.embedWhitelistInvalid', { origins: originResult.invalidOrigins.join(', ') }));
      return;
    }

    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const updated = await api.updateAgent(agent.id, {
        widget_title: formData.widget_title.trim(),
        widget_color: formData.widget_color.trim(),
        welcome_message: formData.welcome_message,
        history_days: Number(formData.history_days),
        allowed_widget_origins: originResult.normalizedOrigins,
      });
      setAgent(updated);
      setFormData(formDataFromAgent(updated));
      setSaveMessage(t('labels.settingsSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminLayout>
      <div style={{ padding: isMobile ? 'var(--space-4)' : 'var(--space-8)', maxWidth: 960, margin: '0 auto' }}>
        <h1>{t('navigation.agentSettings')}</h1>
        <p>{t('labels.configAgentSettings')}</p>

        {loading && <div>{t('status.loading')}</div>}
        {error && <div role="alert">{error}</div>}
        {saveMessage && <div role="status">{saveMessage}</div>}

        {!loading && formData && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <label htmlFor="agent-widget-title">{t('labels.widgetTitle')}</label>
            <input
              id="agent-widget-title"
              value={formData.widget_title}
              onChange={(event) => setFormData({ ...formData, widget_title: event.target.value })}
            />

            <label htmlFor="agent-widget-color">{t('labels.themeColor')}</label>
            <input
              id="agent-widget-color"
              type="text"
              value={formData.widget_color}
              onChange={(event) => setFormData({ ...formData, widget_color: event.target.value })}
            />

            <label htmlFor="agent-welcome-message">{t('labels.welcomeMessage')}</label>
            <textarea
              id="agent-welcome-message"
              value={formData.welcome_message}
              onChange={(event) => setFormData({ ...formData, welcome_message: event.target.value })}
            />

            <label htmlFor="agent-history-days">{t('labels.historyRetention')}</label>
            <input
              id="agent-history-days"
              type="number"
              min={1}
              max={365}
              value={formData.history_days}
              onChange={(event) => setFormData({ ...formData, history_days: Number(event.target.value) })}
            />

            <label htmlFor="agent-embed-whitelist">{t('labels.embedWhitelist')}</label>
            <textarea
              id="agent-embed-whitelist"
              value={formData.allowedOriginsText}
              onChange={(event) => setFormData({ ...formData, allowedOriginsText: event.target.value })}
            />

            <h2>{t('labels.widgetEmbedCode')}</h2>
            <pre>{embedCode}</pre>
            <button type="submit" disabled={saving}>{t('buttons.save')}</button>
          </form>
        )}
      </div>
    </AdminLayout>
  );
}
```

Do not add API fields outside the tested payload in this task.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/AgentSettings.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Refactor while staying green**

Improve only local JSX structure, card styling, and helper extraction inside `AgentSettings.tsx`. Do not add new behavior. Keep all labels accessible.

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/AgentSettings.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run relevant broader verification**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/agent-settings-origin-parser.test.ts tests/unit/widget-embed-code.test.ts tests/unit/AgentSettings.test.tsx
cd frontend-nextjs && npm run typecheck
```

Expected: PASS with no new warnings or errors.

- [ ] **Step 7: Commit**

```bash
git add frontend-nextjs/src/views/AgentSettings.tsx frontend-nextjs/tests/unit/AgentSettings.test.tsx
git commit -m "fix: add agent settings view"
```

---

### Task 4: Wire Next App Router Pages

**Purpose:** Add the exact App Router page files missing from the root cause so `/agents/{agentId}/settings/agent` and `/settings/agent` no longer 404.

**Execution Metadata:**
- Dependencies: `Task 3`
- Parallelizable: `no`
- Batch: `2/routes`
- Owns:
  - `frontend-nextjs/app/(dashboard)/settings/agent/page.tsx`
  - `frontend-nextjs/app/(dashboard)/agents/[agentId]/settings/agent/page.tsx`
  - `frontend-nextjs/tests/unit/agent-settings-next-routes.test.ts`
- Reads:
  - `frontend-nextjs/app/(dashboard)/agents/[agentId]/dashboard/page.tsx`
  - `frontend-nextjs/app/(dashboard)/agents/[agentId]/playground/page.tsx`
  - `frontend-nextjs/src/views/AgentSettings.tsx`
  - `frontend-nextjs/src/components/AdminLayout.tsx`
- Must not edit:
  - `frontend-nextjs/src/components/AdminLayout.tsx`
  - `frontend-nextjs/src/components/RequireAuth.tsx`
  - `frontend-nextjs/src/views/AgentSettings.tsx`

**Files:**
- Create: `frontend-nextjs/app/(dashboard)/settings/agent/page.tsx`
- Create: `frontend-nextjs/app/(dashboard)/agents/[agentId]/settings/agent/page.tsx`
- Create/Test: `frontend-nextjs/tests/unit/agent-settings-next-routes.test.ts`

**Context for implementer:**
- This is the direct 404 fix. Without these files, Next.js cannot match the routes even if the sidebar link exists.
- Do not modify sidebar route generation; `AdminLayout.tsx` already has `path: "/settings/agent"` and agent workspace prefix logic already creates `/agents/{agentId}/settings/agent`.

- [ ] **Step 1: Write the failing test**

Create `frontend-nextjs/tests/unit/agent-settings-next-routes.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '../..');

const routes = [
  {
    file: 'app/(dashboard)/settings/agent/page.tsx',
    importPath: '../../../../src/views/AgentSettings',
  },
  {
    file: 'app/(dashboard)/agents/[agentId]/settings/agent/page.tsx',
    importPath: '../../../../../../src/views/AgentSettings',
  },
];

describe('Agent Settings Next.js routes', () => {
  it.each(routes)('$file exists and imports AgentSettings', ({ file, importPath }) => {
    const absolutePath = path.join(projectRoot, file);
    expect(fs.existsSync(absolutePath), `${file} should exist`).toBe(true);
    const content = fs.readFileSync(absolutePath, 'utf8');
    expect(content).toContain(importPath);
    expect(content).toContain('<AgentSettingsPage />');
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/agent-settings-next-routes.test.ts
```

Expected: FAIL because both `page.tsx` files are missing.

- [ ] **Step 3: Implement the minimal code**

Create `frontend-nextjs/app/(dashboard)/settings/agent/page.tsx`:

```tsx
import AgentSettingsPage from '../../../../src/views/AgentSettings';

export default function Page() {
  return <AgentSettingsPage />;
}
```

Create `frontend-nextjs/app/(dashboard)/agents/[agentId]/settings/agent/page.tsx`:

```tsx
import AgentSettingsPage from '../../../../../../src/views/AgentSettings';

export default function Page() {
  return <AgentSettingsPage />;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/agent-settings-next-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Refactor while staying green**

No refactor expected. Keep wrappers minimal and consistent with existing App Router page files.

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/agent-settings-next-routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run relevant broader verification**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/AgentSettings.test.tsx tests/unit/agent-settings-next-routes.test.ts
cd frontend-nextjs && npm run typecheck
```

Expected: PASS with no new warnings or errors.

- [ ] **Step 7: Commit**

```bash
git add 'frontend-nextjs/app/(dashboard)/settings/agent/page.tsx' 'frontend-nextjs/app/(dashboard)/agents/[agentId]/settings/agent/page.tsx' frontend-nextjs/tests/unit/agent-settings-next-routes.test.ts
git commit -m "fix: wire agent settings routes"
```

---

### Task 5: Integrated Verification and 404 Reproduction Check

**Purpose:** Verify that the route bug is fixed across type checking, unit tests, Next build, and the original HTTP reproduction.

**Execution Metadata:**
- Dependencies: `Task 1`, `Task 2`, `Task 3`, `Task 4`
- Parallelizable: `no`
- Batch: `3/final-verification`
- Owns:
  - No source files expected
- Reads:
  - All files changed by Tasks 1-4
  - `frontend-nextjs/package.json`
  - `AGENTS.md`
  - `CLAUDE.md`
- Must not edit:
  - Any source file unless verification finds a concrete failure; if it does, return to the task that owns the failing file and repeat RED/GREEN there.

**Files:**
- Verification only.

**Context for implementer:**
- Run LSP diagnostics before build per repository instructions.
- The original symptom is not considered fixed until `/agents/{agentId}/settings/agent` no longer returns Next 404.

- [ ] **Step 1: Run proactive LSP diagnostics**

Run `lsp_diagnostics` on:

```text
frontend-nextjs/src/lib/widgetOrigins.ts
frontend-nextjs/src/lib/widgetEmbedCode.ts
frontend-nextjs/src/views/AgentSettings.tsx
frontend-nextjs/tests/unit/agent-settings-origin-parser.test.ts
frontend-nextjs/tests/unit/widget-embed-code.test.ts
frontend-nextjs/tests/unit/AgentSettings.test.tsx
frontend-nextjs/tests/unit/agent-settings-next-routes.test.ts
```

Expected: no TypeScript errors.

- [ ] **Step 2: Run focused tests**

Run:

```bash
cd frontend-nextjs && npx vitest run tests/unit/agent-settings-origin-parser.test.ts tests/unit/widget-embed-code.test.ts tests/unit/AgentSettings.test.tsx tests/unit/agent-settings-next-routes.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full frontend tests**

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

Expected: PASS.

- [ ] **Step 5: Run production build**

Run:

```bash
cd frontend-nextjs && npm run build
```

Expected: PASS. This should catch broken App Router imports and invalid client/server boundaries.

- [ ] **Step 6: Re-run the original route reproduction**

Run:

```bash
cd frontend-nextjs
PORT=3101
LOG=/tmp/basjoo-next-route-debug.log
rm -f "$LOG"
(npm run dev -- -p "$PORT" >"$LOG" 2>&1) &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT
python3 - <<'PY'
import urllib.request, urllib.error, time
port=3101
for _ in range(60):
    try:
        urllib.request.urlopen(f'http://localhost:{port}/', timeout=1).read(100)
        break
    except Exception:
        time.sleep(0.5)
for path in ['/agents/agt_1/dashboard','/agents/agt_1/settings/agent','/settings/agent']:
    try:
        resp=urllib.request.urlopen(f'http://localhost:{port}{path}', timeout=10)
        code=resp.status
    except urllib.error.HTTPError as e:
        code=e.code
    print(f'{path} -> HTTP {code}')
PY
```

Expected: `/agents/agt_1/settings/agent` and `/settings/agent` are not HTTP 404. If a route redirects or shows auth loading because no backend/auth state exists, verify the page no longer has the title `404: This page could not be found.`

- [ ] **Step 7: Commit verification notes if needed**

No commit is normally needed for verification. If a small test-only correction was required during verification, first inspect the changed files and then commit only those concrete files separately:

```bash
git status --short
git add frontend-nextjs/tests/unit/agent-settings-next-routes.test.ts
git commit -m "test: verify agent settings route"
```

Use the `git add` path above only if that route test file is the actual corrected file; otherwise replace it with the concrete file shown by `git status --short`.

## Self-Review Checklist

- [x] The root cause maps to a concrete missing App Router surface: two absent `page.tsx` files and absent `AgentSettings` view.
- [x] The plan does not edit backend contracts, migrations, or auth permissions.
- [x] `/settings/system` is not reintroduced.
- [x] The plan includes RED tests for helper extraction, embed helper, page behavior, and route file existence.
- [x] Task order is dependency-safe: helpers → view → route wrappers → final verification.
- [x] Parallel batch safety is explicit: Task 1 and Task 2 own disjoint files.
- [x] Non-parallel tasks touch shared view/route entry points or final verification.
- [x] File paths are exact and match current repo layout.
- [x] Verification commands match `frontend-nextjs/package.json` scripts.
- [x] The original symptom has a manual reproduction command and expected post-fix result.
- [x] The plan does not start implementation.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| Root `/settings/agent` semantics are less important than agent-scoped settings | Low | Use `api.getDefaultAgent()` when no route `agentId` exists; this keeps the route valid without changing navigation. |
| Frontend origin validation diverges from backend | Medium | Mirror `normalize_widget_origin` behavior and keep tests covering scheme, credentials, path stripping, lowercase, and dedupe. |
| Embed snippet chooses the wrong base URL in split frontend/backend deployments | Medium | Centralize snippet generation in `widgetEmbedCode.ts` and include an explicit `api_base` query parameter option for future split-origin use. |
| Unit route-file guard is implementation-aware | Low | It intentionally protects the Next App Router files that caused this exact 404. The final manual reproduction remains the behavior-level check. |
| Saving blank `widget_title` might be accepted but poor UX | Low | Current plan trims and sends the value; backend max-length validation remains source of truth. Future UX validation can be a separate enhancement. |

## Implementation Boundary Summary

- This plan fixes a frontend route/view gap only.
- Backend API and database schema remain unchanged.
- `AdminLayout.tsx` and `RequireAuth.tsx` should remain unchanged unless verification proves a mismatch; current investigation shows they already reference `/settings/agent` correctly.
- Do not add redirects for `/settings/system`.
- Do not expand Agent Settings into model/provider settings; `AISettingsForm` remains the model/provider settings surface.
