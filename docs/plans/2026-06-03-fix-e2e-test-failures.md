# E2E 测试失败修复计划

**Status:** Draft  
**Date:** 2026-06-03  
**Source:** `E2E smoke 测试执行结果 - 6个测试失败`  
**Goal:** 修复6个失败的E2E测试，使smoke测试套件达到100%通过率  
**Architecture:** 更新过时的测试选择器，移除/重写已不存在的QA功能测试，添加缺失的data-testid属性以提高测试稳定性  

## Planning Notes

- **关键模式**: 使用 `data-testid` 替代易变的CSS选择器，确保测试稳定
- **约束**: 不改变应用核心功能，只修复测试代码和添加测试属性
- **i18n处理**: 选择器需要同时匹配中英文，或直接使用 `data-testid` 绕过本地化问题
- **QA功能**: 已完全迁移到多租户KB系统，相关API端点已移除，需要相应更新测试

## Exploration Summary

- **Project memory files read:** AGENTS.md, tests/e2e/playwright.config.ts, .env.example
- **Key files explored:**
  - `tests/e2e/specs/knowledge-indexing.spec.ts` - QA导入测试（API已不存在）
  - `tests/e2e/specs/playground-streaming.spec.ts` - Playground UI选择器过时
  - `tests/e2e/specs/sessions-takeover.spec.ts` - Sessions页面heading条件渲染
  - `backend/api/v1/endpoints.py` - API端点确认
  - `frontend-nextjs/src/views/Sessions.tsx` - 确认heading仅在选中session时显示
  - `frontend-nextjs/src/components/ChatPanel.tsx` - 确认chat input aria-label
- **关键发现:**
  1. QA API端点（`qa:batch_import`, `qa:list`）已从后端完全移除（OpenAPI spec验证0个QA路径）
  2. Sessions页面`<h1>`仅在`selectedSession`为真时渲染（条件渲染问题）
  3. Playground测试选择器与实际UI结构不匹配

## Debugging Findings

### Bug 1-2: QA导入测试失败
- **Symptom:** `POST /api/v1/qa:batch_import` 返回 404，预期 200/201
- **Reproduction:** `npm run test:e2e` - knowledge-indexing.spec.ts 第29和92行
- **Root Cause:** QA功能已迁移至多租户KB文档系统，旧API端点已删除
- **Fix Strategy:** 移除这两个过时的QA测试，用KB文档上传测试替代
- **Verification:** 运行 `npm run test:e2e` 不再出现QA相关404错误
- **Confidence:** High

### Bug 3: Playground auto-save测试失败
- **Symptom:** 找不到 `input[type="range"]` 元素，超时10秒
- **Reproduction:** playground-streaming.spec.ts 第28行
- **Root Cause:** Playground页面使用ChatPanel组件，temperature控制可能在AISettingsForm中，但选择器过于宽泛
- **Fix Strategy:** 添加 `data-testid="temperature-slider"` 到AISettingsForm，更新测试使用该稳定选择器
- **Verification:** 测试能找到temperature输入并与其交互
- **Confidence:** High

### Bug 4-5: Playground chat输入测试失败
- **Symptom:** 找不到 `getByRole('textbox', { name: /输入您的问题|your question/i })`，超时10秒
- **Reproduction:** playground-streaming.spec.ts 第50和66行
- **Root Cause:** 
  - 选择器使用 `name` 属性匹配，但实际aria-label是 `playground.inputPlaceholder`
  - 中文i18n值为"输入您的问题..."（带省略号），测试正则未包含省略号
- **Fix Strategy:** 
  - 选项A: 更新正则匹配 `/输入您的问题|your question|Enter your question/i`
  - 选项B: 添加 `data-testid="chat-input"` 并更新测试使用它
  - **推荐选项B** - 更稳定，不受i18n变化影响
- **Verification:** 测试能找到chat输入并发送消息
- **Confidence:** High

### Bug 6: Sessions页面heading测试失败
- **Symptom:** 找不到 `getByRole('heading', { name: /会话中心|sessions/i })`，超时10秒
- **Reproduction:** sessions-takeover.spec.ts 第144行
- **Root Cause:** Sessions.tsx中`<h1>`仅在`selectedSession`存在时渲染（第287行），初始页面加载时不显示heading
- **Fix Strategy:** 
  - 修改测试：在访问/sessions后，先点击一个会话来触发heading显示
  - 或添加 `data-testid="sessions-page"` 到容器，测试检查页面加载而非特定heading
  - **推荐选项B** - 更健壮，不依赖具体会话数据
- **Verification:** 测试能通过页面结构验证
- **Confidence:** High

## File Map

### 需要修改的测试文件
- `tests/e2e/specs/knowledge-indexing.spec.ts` — 移除QA测试，用KB文档测试替代
- `tests/e2e/specs/playground-streaming.spec.ts` — 更新选择器，添加data-testid支持
- `tests/e2e/specs/sessions-takeover.spec.ts` — 更新Sessions页面验证逻辑

### 需要修改的UI组件（添加data-testid）
- `frontend-nextjs/src/components/AISettingsForm.tsx` — temperature slider添加data-testid
- `frontend-nextjs/src/components/ChatPanel.tsx` — chat input添加data-testid
- `frontend-nextjs/src/views/Sessions.tsx` — 主容器添加data-testid

### 不需要修改的文件
- `backend/api/v1/endpoints.py` — API行为正确，问题在测试端
- `frontend-nextjs/src/locales/` — i18n字符串正确，测试不应依赖精确匹配

## Parallelization Strategy

**Preferred execution model:** single-agent sequential（简单修改，适合单人顺序执行）

| Batch | Tasks | Can Run in Parallel? | Reason |
|-------|-------|----------------------|--------|
| 1 | Task 1-3 | No | UI组件修改必须在测试更新前完成，存在依赖关系 |
| 2 | Task 4-6 | No | 测试文件相互独立，但顺序执行更安全，便于验证 |

## Verification Commands

运行以下命令验证修复：

```bash
# 1. 运行修复后的E2E smoke测试
cd /Users/yi/Documents/Projects/basjoo
npm run test:e2e

# 期望：全部16个测试通过，0失败，0跳过（假设提供了SiliconFlow key）
# 或：14个通过，2个跳过（SiliconFlow相关）

# 2. 验证前端构建无错误
cd frontend-nextjs && npm run build

# 期望：构建成功，无新警告
```

---

## Task 1: 为AISettingsForm temperature添加data-testid

**Purpose:** 为temperature slider添加稳定的测试选择器

**Execution Metadata:**
- Dependencies: `none`
- Parallelizable: `no`
- Batch: `1`
- Owns:
  - `frontend-nextjs/src/components/AISettingsForm.tsx`
- Reads:
  - `tests/e2e/specs/playground-streaming.spec.ts`

**Context:**
AISettingsForm.tsx第660行有`type="range"`的temperature输入，测试当前用`input[type="range"]`选择器不可靠。

- [ ] **Step 1: 添加data-testid到temperature输入**

修改 `frontend-nextjs/src/components/AISettingsForm.tsx` 第660-680行附近：

```tsx
<input
  type="range"
  data-testid="temperature-slider"
  min={0}
  max={2}
  step={0.1}
  value={formData.temperature}
  onChange={(e) =>
    setFormData((prev) => ({
      ...prev,
      temperature: parseFloat(e.target.value),
    }))
  }
/>
```

- [ ] **Step 2: 运行前端类型检查**

```bash
cd /Users/yi/Documents/Projects/basjoo/frontend-nextjs
npm run typecheck
```

**期望：**无类型错误，data-testid属性有效

- [ ] **Step 3: 提交**

```bash
git add frontend-nextjs/src/components/AISettingsForm.tsx
git commit -m "test(e2e): add data-testid to temperature slider in AISettingsForm"
```

---

## Task 2: 为ChatPanel chat输入添加data-testid

**Purpose:** 为chat输入框添加稳定的测试选择器

**Execution Metadata:**
- Dependencies: `Task 1`
- Parallelizable: `no`
- Batch: `1`
- Owns:
  - `frontend-nextjs/src/components/ChatPanel.tsx`
- Reads:
  - `tests/e2e/specs/playground-streaming.spec.ts`

**Context:**
ChatPanel.tsx第455行有aria-label使用i18n `playground.inputPlaceholder`，测试用`getByRole('textbox', { name: ... })`匹配不稳定。

- [ ] **Step 1: 添加data-testid到chat输入**

修改 `frontend-nextjs/src/components/ChatPanel.tsx` 第455-470行附近：

```tsx
<input
  data-testid="chat-input"
  aria-label={t('playground.inputPlaceholder')}
  placeholder={isSettingsSaving ? t('status.saving') : t('playground.inputPlaceholder')}
  value={input}
  onChange={(e) => setInput(e.target.value)}
  onKeyDown={(e) => {
    if (e.key === 'Enter' && !e.shiftKey && input.trim()) {
      e.preventDefault()
      void handleSend()
    }
  }}
/>
```

- [ ] **Step 2: 运行前端类型检查**

```bash
cd /Users/yi/Documents/Projects/basjoo/frontend-nextjs
npm run typecheck
```

**期望：**无类型错误

- [ ] **Step 3: 提交**

```bash
git add frontend-nextjs/src/components/ChatPanel.tsx
git commit -m "test(e2e): add data-testid to chat input in ChatPanel"
```

---

## Task 3: 为Sessions页面添加data-testid

**Purpose:** 为Sessions页面主容器添加稳定的测试选择器，用于验证页面加载

**Execution Metadata:**
- Dependencies: `Task 2`
- Parallelizable: `no`
- Batch: `1`
- Owns:
  - `frontend-nextjs/src/views/Sessions.tsx`
- Reads:
  - `tests/e2e/specs/sessions-takeover.spec.ts`

**Context:**
Sessions.tsx第42行开始是组件定义，主容器需要data-testid以便测试验证页面已加载，而非依赖条件渲染的heading。

- [ ] **Step 1: 查找Sessions主容器**

读取Sessions.tsx找到最外层容器（约第50-80行附近的主容器div）。

- [ ] **Step 2: 添加data-testid**

在Sessions.tsx主容器添加：

```tsx
<div data-testid="sessions-page" ...>
  {/* 现有内容 */}
</div>
```

或如果最外层是AdminLayout，在内容区域添加：

```tsx
<div style={{ ... }} data-testid="sessions-page">
  {/* sessions列表内容 */}
</div>
```

- [ ] **Step 3: 运行前端类型检查**

```bash
cd /Users/yi/Documents/Projects/basjoo/frontend-nextjs
npm run typecheck
```

**期望：**无类型错误

- [ ] **Step 4: 提交**

```bash
git add frontend-nextjs/src/views/Sessions.tsx
git commit -m "test(e2e): add data-testid to Sessions page container"
```

---

## Task 4: 移除/重写knowledge-indexing.spec.ts中的QA测试

**Purpose:** 移除已不存在的QA功能测试，或重写为KB文档测试

**Execution Metadata:**
- Dependencies: `Task 3`
- Parallelizable: `no`
- Batch: `2`
- Owns:
  - `tests/e2e/specs/knowledge-indexing.spec.ts`
- Reads:
  - `backend/api/v1/endpoints.py`（确认新API）
  - `tests/e2e/specs/recent-commits.spec.ts`（参考现有测试模式）

**Context:**
QA batch_import和list端点已从后端移除（
OpenAPI验证0个QA路径）。需要移除这两个测试，或用多租户KB文档API重写。

**决策点：** 用户需要决定是：
- **选项A**：完全移除QA测试（简单，推荐）
- **选项B**：重写为KB文档上传测试（更完整，但需要额外探索）

假设选择选项A（完全移除）：

- [ ] **Step 1: 删除过时测试**

修改 `tests/e2e/specs/knowledge-indexing.spec.ts`，删除两个QA相关测试。

- [ ] **Step 2: 提交**

```bash
git add tests/e2e/specs/knowledge-indexing.spec.ts
git commit -m "test(e2e): remove obsolete QA import tests"
```

---

## 计划总结

| 任务 | 描述 | 预估时间 |
|------|------|----------|
| 1-3 | 添加data-testid到UI组件 | 30分钟 |
| 4 | 移除QA测试 | 15分钟 |
| 5-6 | 更新测试选择器 | 30分钟 |
| 7 | 最终验证 | 10分钟 |
| **总计** | | **约1.5小时** |

**下一步：** 请审阅此计划，确认选项选择，然后可执行。
