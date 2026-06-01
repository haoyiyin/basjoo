# Agent Name Length and Dashboard Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limit newly created and updated agent names to a display width of 10 units (10 ASCII characters or 5 Chinese/full-width characters) and rename the Chinese sidebar item `控制台` to `仪表盘` on the agent dashboard menu.

**Architecture:** Enforce the rule in two layers: backend Pydantic schemas are the source of truth and reject invalid API payloads; frontend mirrors the same display-width logic for immediate UX feedback and submit disabling. The sidebar label is controlled by the existing i18n key `navigation.dashboard`, so no route or layout structure changes are needed.

**Tech Stack:** FastAPI, Pydantic v2, SQLAlchemy, Next.js 14, React, TypeScript, Vitest, pytest.

---

## Assumptions and scope

- Interpret “最多10个字符（五个汉字）” as display width, not Unicode code-point count:
  - ASCII / half-width characters count as `1`.
  - Chinese / full-width East Asian characters count as `2`.
  - Maximum display width is `10`.
  - Examples: `AgentName1` passes, `AgentName12` fails, `客服助手一` passes, `客服助手一二` fails.
- Apply this limit to both agent creation and agent name updates. This prevents bypassing the creation limit via `PUT /api/v1/agent`.
- Do not migrate or truncate existing long agent names already stored in the database; only validate incoming create/update payloads.
- Only change the Chinese sidebar copy by updating `frontend-nextjs/src/locales/zh-CN/common.json` `navigation.dashboard` from `控制台` to `仪表盘`. Keep routes such as `/agents/:agentId/dashboard` unchanged. Keep unrelated copy such as `labels.welcome` unchanged unless the product owner explicitly asks for a global wording change.

## Files to modify

- Create: `frontend-nextjs/src/lib/agentNameLength.ts`
  - Shared frontend display-width constants and helper functions.
- Modify: `frontend-nextjs/src/views/Agents.tsx`
  - Replace code-unit length limit with display-width limit in the create-agent form.
- Modify: `frontend-nextjs/src/locales/zh-CN/common.json`
  - Change sidebar label and add/update helper copy for the new name length rule.
- Modify: `frontend-nextjs/src/locales/en-US/common.json`
  - Add English helper copy for the frontend form, if a new i18n key is added.
- Modify: `frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx`
  - Add tests for display-width validation and keep existing onboarding tests green.
- Modify: `frontend-nextjs/tests/unit/zhCN.debugCopy.test.ts`
  - Add assertion for `navigation.dashboard === "仪表盘"`.
- Modify: `backend/api/v1/schemas.py`
  - Add backend display-width validation to `AgentCreateRequest.name` and `AgentUpdateRequest.name`.
- Modify: `backend/tests/test_agents_api.py`
  - Add API validation tests for ASCII, Chinese, and over-limit names. Update existing long create payloads.
- Modify if needed: `backend/tests/test_api.py`, `backend/tests/test_agent_membership_endpoints.py`
  - Replace over-limit test payloads such as `Unauthorized Update` with short names so auth tests still test auth, not validation.

---

### Task 1: Add backend validation tests first

**Files:**
- Modify: `backend/tests/test_agents_api.py`
- Modify if needed: `backend/tests/test_api.py`
- Modify if needed: `backend/tests/test_agent_membership_endpoints.py`

- [ ] **Step 1: Update existing create-agent payloads that would exceed the new limit**

In `backend/tests/test_agents_api.py`, change the existing first test payload name from a long display-width string to a passing one:

```python
json={
    "name": "WA Clone",
    "description": "Answers as a personal assistant",
    "agent_type": "ai_clone",
    "channel_mode": "whatsapp",
},
```

Update the assertion in the same test:

```python
assert created["name"] == "WA Clone"
```

If permission tests use long names, change them to short names. For example in `backend/tests/test_api.py`:

```python
("PUT", "/api/v1/agent?agent_id={agent_id}", {"name": "NoAuth"}),
```

- [ ] **Step 2: Add backend create validation tests**

Append these tests to `backend/tests/test_agents_api.py`:

```python
@pytest.mark.asyncio
async def test_agent_name_accepts_ten_ascii_display_units(client):
    response = await client.post(
        "/api/v1/agents",
        json={"name": "AgentName1", "agent_type": "ai_clone"},
    )

    assert response.status_code == 201
    assert response.json()["name"] == "AgentName1"


@pytest.mark.asyncio
async def test_agent_name_accepts_five_chinese_characters(client):
    response = await client.post(
        "/api/v1/agents",
        json={"name": "客服助手一", "agent_type": "ai_clone"},
    )

    assert response.status_code == 201
    assert response.json()["name"] == "客服助手一"


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["AgentName12", "客服助手一二"])
async def test_agent_name_rejects_more_than_ten_display_units(client, name):
    response = await client.post(
        "/api/v1/agents",
        json={"name": name, "agent_type": "ai_clone"},
    )

    assert response.status_code == 422
    assert "10" in response.text
```

- [ ] **Step 3: Add backend update validation test**

Append this test to `backend/tests/test_agents_api.py`:

```python
@pytest.mark.asyncio
async def test_agent_update_rejects_over_limit_display_width_name(client):
    create_response = await client.post(
        "/api/v1/agents",
        json={"name": "AgentName1", "agent_type": "ai_clone"},
    )
    assert create_response.status_code == 201
    agent_id = create_response.json()["id"]

    update_response = await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={"name": "客服助手一二"},
    )

    assert update_response.status_code == 422
    assert "10" in update_response.text
```

- [ ] **Step 4: Run backend tests and confirm the new tests fail before implementation**

Run:

```bash
cd backend && pytest tests/test_agents_api.py tests/test_api.py tests/test_agent_membership_endpoints.py -q
```

Expected before implementation: new over-limit validation tests fail because names longer than display width 10 are still accepted.

---

### Task 2: Implement backend source-of-truth validation

**Files:**
- Modify: `backend/api/v1/schemas.py`

- [ ] **Step 1: Add constants and helper functions near the Agent schemas**

Add above `class AgentCreateRequest(BaseModel):`:

```python
AGENT_NAME_MAX_DISPLAY_WIDTH = 10


def _agent_name_display_width(value: str) -> int:
    import unicodedata

    return sum(
        2 if unicodedata.east_asian_width(char) in {"W", "F"} else 1
        for char in value
    )


def _validate_agent_name(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    stripped = value.strip()
    if not stripped:
        raise ValueError("Agent name cannot be empty")
    width = _agent_name_display_width(stripped)
    if width > AGENT_NAME_MAX_DISPLAY_WIDTH:
        raise ValueError(
            f"Agent name must be at most {AGENT_NAME_MAX_DISPLAY_WIDTH} display units "
            "(10 ASCII characters or 5 Chinese characters)"
        )
    return stripped
```

- [ ] **Step 2: Update create/update schema fields and validators**

Change `AgentCreateRequest.name`:

```python
name: str = Field(..., min_length=1, max_length=10)
```

Add inside `AgentCreateRequest`:

```python
@field_validator("name")
@classmethod
def validate_name(cls, value: str) -> str:
    validated = _validate_agent_name(value)
    assert validated is not None
    return validated
```

Change `AgentUpdateRequest.name`:

```python
name: Optional[str] = Field(None, min_length=1, max_length=10)
```

Add inside `AgentUpdateRequest`:

```python
@field_validator("name")
@classmethod
def validate_name(cls, value: Optional[str]) -> Optional[str]:
    return _validate_agent_name(value)
```

- [ ] **Step 3: Run targeted backend tests**

Run:

```bash
cd backend && pytest tests/test_agents_api.py tests/test_api.py tests/test_agent_membership_endpoints.py -q
```

Expected after implementation: all targeted tests pass.

---

### Task 3: Add frontend display-width helper and tests

**Files:**
- Create: `frontend-nextjs/src/lib/agentNameLength.ts`
- Modify: `frontend-nextjs/src/views/Agents.tsx`
- Modify: `frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx`

- [ ] **Step 1: Create frontend helper**

Create `frontend-nextjs/src/lib/agentNameLength.ts`:

```ts
export const AGENT_NAME_MAX_DISPLAY_WIDTH = 10;

function isFullWidthCodePoint(codePoint: number): boolean {
	return (
		(codePoint >= 0x1100 && codePoint <= 0x115f) ||
		(codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
		(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
		(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
		(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
		(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
		(codePoint >= 0xff00 && codePoint <= 0xff60) ||
		(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
		(codePoint >= 0x20000 && codePoint <= 0x3fffd)
	);
}

export function getAgentNameDisplayWidth(value: string): number {
	return Array.from(value).reduce((total, char) => {
		const codePoint = char.codePointAt(0) ?? 0;
		return total + (isFullWidthCodePoint(codePoint) ? 2 : 1);
	}, 0);
}

export function trimToAgentNameMaxDisplayWidth(value: string): string {
	let width = 0;
	let result = "";

	for (const char of Array.from(value)) {
		const codePoint = char.codePointAt(0) ?? 0;
		const charWidth = isFullWidthCodePoint(codePoint) ? 2 : 1;
		if (width + charWidth > AGENT_NAME_MAX_DISPLAY_WIDTH) break;
		width += charWidth;
		result += char;
	}

	return result;
}
```

- [ ] **Step 2: Update `Agents.tsx` to use display width**

Replace the local constant import/use:

```ts
import {
	AGENT_NAME_MAX_DISPLAY_WIDTH,
	getAgentNameDisplayWidth,
	trimToAgentNameMaxDisplayWidth,
} from "../lib/agentNameLength";
```

Remove:

```ts
const AGENT_NAME_MAX_LENGTH = 50;
```

Add derived state inside `Agents()`:

```ts
const agentNameDisplayWidth = getAgentNameDisplayWidth(form.name.trim());
const isAgentNameValid =
	Boolean(form.name.trim()) &&
	agentNameDisplayWidth <= AGENT_NAME_MAX_DISPLAY_WIDTH;
```

Update create validation:

```ts
if (
	!isAgentNameValid ||
	(description?.length || 0) > AGENT_DESCRIPTION_MAX_LENGTH
)
	return;
```

Update name input change handler:

```ts
onChange={(event) =>
	setForm((prev) => ({
		...prev,
		name: trimToAgentNameMaxDisplayWidth(event.target.value),
	}))
}
```

Update `maxLength`:

```tsx
maxLength={AGENT_NAME_MAX_DISPLAY_WIDTH}
```

Update character count:

```tsx
{t("agents.characterCount", {
	count: getAgentNameDisplayWidth(form.name),
	max: AGENT_NAME_MAX_DISPLAY_WIDTH,
})}
```

Add a helper hint below the count if desired:

```tsx
<div style={{ color: "var(--color-text-muted)", fontSize: "var(--text-xs)", marginBottom: "var(--space-4)" }}>
	{t("agents.nameLengthHint")}
</div>
```

If adding the helper hint, remove the count div's `marginBottom: "var(--space-4)"` or reduce it to avoid doubled spacing.

Update submit disabled logic:

```tsx
disabled={
	saving ||
	!isAgentNameValid ||
	(form.description?.trim().length || 0) > AGENT_DESCRIPTION_MAX_LENGTH
}
```

Update cursor/opacity logic to use `!isAgentNameValid` instead of `!form.name?.trim()`.

- [ ] **Step 3: Add frontend tests for display-width trimming**

Append to `frontend-nextjs/tests/unit/Agents.kbOnboarding.test.tsx` inside the existing describe block:

```tsx
it("limits created agent names to ten display units", async () => {
	renderAgents([activeAgent]);
	await screen.findByText("Active Agent");

	const input = screen.getByPlaceholderText("agents.namePlaceholder");
	fireEvent.change(input, { target: { value: "客服助手一二" } });

	expect(input).toHaveValue("客服助手一");
	expect(screen.getByText("10/10")).not.toBeNull();
});

it("submits a ten ASCII character agent name", async () => {
	renderAgents([activeAgent]);
	await screen.findByText("Active Agent");

	fireEvent.change(screen.getByPlaceholderText("agents.namePlaceholder"), {
		target: { value: "AgentName1" },
	});
	fireEvent.click(screen.getByText("agents.create"));

	await waitFor(() => {
		expect(mockedApi.createAgent).toHaveBeenCalledWith(
			expect.objectContaining({ name: "AgentName1", widget_title: "AgentName1" }),
		);
	});
});
```

- [ ] **Step 4: Run frontend tests and confirm failures before final implementation, then pass after implementation**

Run:

```bash
cd frontend-nextjs && npm run test -- Agents.kbOnboarding.test.tsx
```

Expected after implementation: targeted test file passes.

---

### Task 4: Update sidebar copy and locale tests

**Files:**
- Modify: `frontend-nextjs/src/locales/zh-CN/common.json`
- Modify: `frontend-nextjs/src/locales/en-US/common.json` if adding `agents.nameLengthHint`
- Modify: `frontend-nextjs/tests/unit/zhCN.debugCopy.test.ts`

- [ ] **Step 1: Change Chinese dashboard navigation copy**

In `frontend-nextjs/src/locales/zh-CN/common.json`:

```json
"navigation": {
  "dashboard": "仪表盘"
}
```

Do not change the route path `/dashboard`.

- [ ] **Step 2: Add helper copy if `Agents.tsx` uses `agents.nameLengthHint`**

In `frontend-nextjs/src/locales/zh-CN/common.json` under `agents`:

```json
"nameLengthHint": "最多 10 个英文字符或 5 个汉字"
```

In `frontend-nextjs/src/locales/en-US/common.json` under `agents`:

```json
"nameLengthHint": "Up to 10 English characters or 5 Chinese characters"
```

- [ ] **Step 3: Add locale test**

Extend `frontend-nextjs/tests/unit/zhCN.debugCopy.test.ts`:

```ts
it("uses 仪表盘 for the Chinese dashboard navigation label", () => {
	expect(zhCN.navigation.dashboard).toBe("仪表盘");
});
```

- [ ] **Step 4: Run locale test**

Run:

```bash
cd frontend-nextjs && npm run test -- zhCN.debugCopy.test.ts
```

Expected: test passes.

---

### Task 5: Full verification before completion

**Files:**
- No code changes unless verification finds issues.

- [ ] **Step 1: Run LSP diagnostics before builds**

Run diagnostics on changed source/test areas:

```text
lsp_diagnostics frontend-nextjs/src
lsp_diagnostics backend/api/v1/schemas.py
```

Expected: no new errors in changed files.

- [ ] **Step 2: Run backend targeted tests**

Run:

```bash
cd backend && pytest tests/test_agents_api.py tests/test_api.py tests/test_agent_membership_endpoints.py -q
```

Expected: all pass.

- [ ] **Step 3: Run frontend required verification**

Per project instructions, frontend changes require:

```bash
cd frontend-nextjs && npm run build && npm run typecheck && npm run test
```

Expected: build succeeds, typecheck succeeds, Vitest suite passes.

- [ ] **Step 4: Manual UI smoke check**

Start frontend if needed:

```bash
cd frontend-nextjs && npm run dev
```

Check in browser:

1. Navigate to `/agents`.
2. Enter `客服助手一二` in the create-agent name field.
3. Confirm the field is limited to `客服助手一` and shows the max indicator.
4. Create agent with `客服助手一`.
5. Navigate to the agent workspace.
6. Confirm left sidebar first item shows `仪表盘`, not `控制台`.

- [ ] **Step 5: Final audit**

Confirm:

- Backend rejects invalid names even if frontend is bypassed.
- Frontend prevents over-limit input and shows a clear limit.
- Existing long names from old data are displayed, not broken.
- Sidebar label changed only in Chinese i18n and routes remain unchanged.
- No unrelated copy or route behavior changed.
