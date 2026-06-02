# Implementation Plan: “系统设置 / System Settings” 全量改名为 “智能体设置 / Agent Settings”

## Overview

本计划用于把 Basjoo 智能体工作空间中的“系统设置 / System Settings”全量改名为“智能体设置 / Agent Settings”。范围包括用户可见中英文文案、前端路由引用、权限白名单、相关 README 文案、测试文件名与注释。按已确认边界，本次不补齐缺失页面、不保留旧路由跳转、不重命名或重截截图资产、不合并或重命名现有 “AI Settings / AI 设置”。

## Confirmed Decisions

- 中文显示名：`智能体设置`
- 英文显示名：`Agent Settings`
- 中文描述：`配置智能体设置和嵌入代码`
- 英文描述：`Configure agent settings and embed code`
- 新路由：`/settings/agent`
- 智能体工作空间路由：`/agents/{agentId}/settings/agent`
- 旧路由 `/settings/system`：直接移除，不保留 redirect/compat shim
- 现有 `AI Settings / AI 设置`：保持不变，用于模型/API/提示词配置
- README：只改文案，截图文件暂不重命名、不重截
- 页面补齐：不做；若当前 settings route 缺少实际 page，另开任务处理

## Current Findings

当前代码中已发现的相关位置：

- `frontend-nextjs/src/locales/en-US/common.json`
  - `navigation.systemSettings`: `System Settings`
  - `labels.configSystemParams`: `Configure system settings and embed code`
- `frontend-nextjs/src/locales/zh-CN/common.json`
  - `navigation.systemSettings`: `系统设置`
  - `labels.configSystemParams`: `配置系统参数和嵌入代码`
- `frontend-nextjs/src/components/AdminLayout.tsx`
  - 侧边栏路径：`/settings/system`
  - i18n key：`navigation.systemSettings`
- `frontend-nextjs/src/components/RequireAuth.tsx`
  - super admin root whitelist：`/settings/system`
- `frontend-nextjs/tests/unit/system-settings-origin-parser.test.ts`
  - 文件名、测试说明、注释中包含 `SystemSettings` / `system-settings`
- `README.md`
  - `System settings and widget appearance`
  - `System Settings covers ...`
  - 图片 alt text 中包含 `system settings`
- `README.zh-CN.md`
  - `系统设置与 Widget 外观`
  - `系统设置页面用于...`
  - 图片 alt text 中包含 `系统设置`

## Architecture Decisions

- **使用新 i18n key：** 将 `navigation.systemSettings` 改为 `navigation.agentSettings`，避免内部 key 与新含义不一致。
- **保留路由分组风格：** 将 `/settings/system` 改为 `/settings/agent`，保持 `/settings/...` 信息架构。
- **不引入兼容跳转：** 删除旧路径引用；若旧地址被访问，按现有应用行为处理，不新增 redirect。
- **测试命名同步：** 测试文件改名为 `agent-settings-origin-parser.test.ts`，注释同步为 `AgentSettings`。
- **文档只改文案：** README 图片路径仍保留 `system-settings.png`，但标题、描述、alt text 改为 Agent Settings 口径。

## Dependency Graph

```text
i18n key/value
  │
  ├── AdminLayout nav config
  │     └── sidebar label + route generation
  │
  ├── RequireAuth route whitelist
  │     └── access control for renamed route
  │
  ├── tests/unit filename + comments
  │     └── frontend test command consistency
  │
  └── README docs
        └── public documentation consistency
```

实施顺序：先改 i18n 基础命名，再改路由引用和权限白名单，然后同步测试命名，最后改文档并验证。

## Task List

### Phase 1: Frontend naming foundation

## Task 1: Rename navigation i18n key and visible labels

**Description:** 将前端中英文 locale 里的 `navigation.systemSettings` 改为 `navigation.agentSettings`，并把显示值改成 “Agent Settings / 智能体设置”。同时把相关描述 `configSystemParams` 的值改为已确认的新描述；是否重命名 `configSystemParams` key 可在实施时根据引用范围决定，推荐同步改为 `configAgentSettings` 以满足全量命名。

**Acceptance criteria:**

- [ ] `frontend-nextjs/src/locales/en-US/common.json` 中菜单显示为 `Agent Settings`
- [ ] `frontend-nextjs/src/locales/zh-CN/common.json` 中菜单显示为 `智能体设置`
- [ ] 英文描述为 `Configure agent settings and embed code`
- [ ] 中文描述为 `配置智能体设置和嵌入代码`
- [ ] 不改动 `navigation.aiSettings` / `AI Settings` / `AI 设置`

**Verification:**

- [ ] `rg -n 'systemSettings|System Settings|系统设置|system settings|系统参数' frontend-nextjs/src/locales` 不再命中本次目标旧称
- [ ] `rg -n 'agentSettings|Agent Settings|智能体设置|Configure agent settings|配置智能体设置' frontend-nextjs/src/locales` 命中新称

**Dependencies:** None

**Files likely touched:**

- `frontend-nextjs/src/locales/en-US/common.json`
- `frontend-nextjs/src/locales/zh-CN/common.json`

**Estimated scope:** Small: 2 files

---

### Phase 2: Route and access-control rename

## Task 2: Rename sidebar route and i18n reference

**Description:** 更新 `AdminLayout` 中侧边栏设置入口：路径从 `/settings/system` 改为 `/settings/agent`，i18n key 从 `navigation.systemSettings` 改为 `navigation.agentSettings`。在 agent-scoped context 下，现有 path prefix 逻辑会自动生成 `/agents/{agentId}/settings/agent`。

**Acceptance criteria:**

- [ ] 侧边栏设置入口 base path 为 `/settings/agent`
- [ ] agent workspace 内入口解析为 `/agents/{agentId}/settings/agent`
- [ ] 侧边栏 label 读取 `navigation.agentSettings`
- [ ] `AdminLayout.tsx` 中不再出现 `settings/system` 或 `systemSettings`

**Verification:**

- [ ] `rg -n 'settings/system|systemSettings' frontend-nextjs/src/components/AdminLayout.tsx` 无结果
- [ ] `rg -n 'settings/agent|agentSettings' frontend-nextjs/src/components/AdminLayout.tsx` 命中新引用

**Dependencies:** Task 1

**Files likely touched:**

- `frontend-nextjs/src/components/AdminLayout.tsx`

**Estimated scope:** XS: 1 file

## Task 3: Rename auth whitelist route

**Description:** 更新 `RequireAuth` 中 super admin root route whitelist，将 `/settings/system` 替换为 `/settings/agent`，确保新路由权限判断与侧边栏一致。按已确认决策，不保留旧路由白名单。

**Acceptance criteria:**

- [ ] `SUPER_ADMIN_ONLY_ROOT_PATHS` 包含 `/settings/agent`
- [ ] `SUPER_ADMIN_ONLY_ROOT_PATHS` 不再包含 `/settings/system`
- [ ] 不新增旧路由 redirect 或兼容逻辑

**Verification:**

- [ ] `rg -n 'settings/system' frontend-nextjs/src/components/RequireAuth.tsx` 无结果
- [ ] `rg -n 'settings/agent' frontend-nextjs/src/components/RequireAuth.tsx` 命中新路由

**Dependencies:** Task 2

**Files likely touched:**

- `frontend-nextjs/src/components/RequireAuth.tsx`

**Estimated scope:** XS: 1 file

### Checkpoint: Frontend route/name consistency

- [ ] `rg -n 'settings/system|systemSettings' frontend-nextjs/src frontend-nextjs/app` 无结果，除非发现与本次范围无关的历史注释且已确认保留
- [ ] `rg -n 'settings/agent|agentSettings' frontend-nextjs/src frontend-nextjs/app` 命中新路由和新 key
- [ ] 不存在对 `AI Settings / AI 设置` 的误改

---

### Phase 3: Test naming synchronization

## Task 4: Rename system-settings unit test file and comments

**Description:** 将 `frontend-nextjs/tests/unit/system-settings-origin-parser.test.ts` 重命名为 `agent-settings-origin-parser.test.ts`。同步文件顶部说明和内部注释，将 `SystemSettings` / `system-settings` 改为 `AgentSettings` / `agent-settings`。测试逻辑本身不改。

**Acceptance criteria:**

- [ ] 测试文件名为 `frontend-nextjs/tests/unit/agent-settings-origin-parser.test.ts`
- [ ] 旧文件名 `system-settings-origin-parser.test.ts` 不再存在
- [ ] 文件注释中的运行命令使用新文件名
- [ ] 注释中的 `SystemSettings.tsx` 改为 `AgentSettings.tsx` 或等价新称
- [ ] 测试用例逻辑保持不变

**Verification:**

- [ ] `test -f frontend-nextjs/tests/unit/agent-settings-origin-parser.test.ts`
- [ ] `test ! -f frontend-nextjs/tests/unit/system-settings-origin-parser.test.ts`
- [ ] `cd frontend-nextjs && npx vitest run tests/unit/agent-settings-origin-parser.test.ts`

**Dependencies:** None, but should run after route naming decisions are applied

**Files likely touched:**

- `frontend-nextjs/tests/unit/agent-settings-origin-parser.test.ts`

**Estimated scope:** XS: 1 file rename + comments

### Checkpoint: Targeted frontend validation

- [ ] `cd frontend-nextjs && npm run typecheck`
- [ ] `cd frontend-nextjs && npm run test -- tests/unit/agent-settings-origin-parser.test.ts` 或等价 Vitest 命令
- [ ] 若测试命令格式不支持按文件传参，则运行 `cd frontend-nextjs && npm run test`

---

### Phase 4: Documentation text update

## Task 5: Update English README wording

**Description:** 更新 `README.md` 中 “System settings and widget appearance” 相关标题、描述和图片 alt text，使公开文档使用 “Agent Settings”。按已确认边界，不改图片路径 `resource/screenshots/admin/en-US/system-settings.png`。

**Acceptance criteria:**

- [ ] 标题改为 `Agent settings and widget appearance` 或 `Agent Settings and widget appearance`
- [ ] 描述中使用 `Agent Settings covers ...`，不再使用 `System Settings covers ...`
- [ ] 图片 alt text 改为 `English agent settings screenshot`
- [ ] 图片路径仍保持现有 `system-settings.png`

**Verification:**

- [ ] `rg -n 'System settings|System Settings|system settings' README.md` 不再命中该章节旧称
- [ ] `rg -n 'Agent settings|Agent Settings|agent settings' README.md` 命中新称

**Dependencies:** None

**Files likely touched:**

- `README.md`

**Estimated scope:** XS: 1 file

## Task 6: Update Chinese README wording

**Description:** 更新 `README.zh-CN.md` 中 “系统设置与 Widget 外观” 相关标题、描述和图片 alt text，使中文文档使用 “智能体设置”。按已确认边界，不改图片路径 `resource/screenshots/admin/zh-CN/system-settings.png`。

**Acceptance criteria:**

- [ ] 标题改为 `智能体设置与 Widget 外观`
- [ ] 描述中使用 `智能体设置页面用于...`
- [ ] 图片 alt text 改为 `中文智能体设置截图`
- [ ] 图片路径仍保持现有 `system-settings.png`

**Verification:**

- [ ] `rg -n '系统设置' README.zh-CN.md` 不再命中该章节旧称
- [ ] `rg -n '智能体设置' README.zh-CN.md` 命中新称

**Dependencies:** None

**Files likely touched:**

- `README.zh-CN.md`

**Estimated scope:** XS: 1 file

---

### Phase 5: Global audit and final verification

## Task 7: Run global stale-name audit

**Description:** 全仓库搜索旧命名，确认除截图路径等已明确保留项外，不再存在本次范围内的旧称。对每个剩余命中判断是否允许保留，并记录原因。

**Acceptance criteria:**

- [ ] `frontend-nextjs/src` 中不再出现 `settings/system`、`systemSettings`、用户可见 `System Settings`、`系统设置`
- [ ] `frontend-nextjs/tests` 中不再出现旧测试文件名和旧注释命名
- [ ] README 文案不再使用旧称
- [ ] 允许保留项仅限截图文件路径 `resource/screenshots/admin/*/system-settings.png`，因为已确认不重命名截图资产

**Verification:**

- [ ] `rg -n 'settings/system|systemSettings|System Settings|System settings|system settings|系统设置|系统参数|system-settings' frontend-nextjs README.md README.zh-CN.md tests resource`
- [ ] 对上述命令剩余命中逐条确认；截图路径命中可接受，其他命中需修正或说明

**Dependencies:** Tasks 1-6

**Files likely touched:** None expected; audit may reveal missed files

**Estimated scope:** XS

## Task 8: Run required frontend verification

**Description:** 按项目规范对前端改动进行验证。因为本次涉及 frontend-nextjs 文案、路由和测试命名，需至少运行 LSP diagnostics、typecheck、unit tests；若时间允许运行 build。

**Acceptance criteria:**

- [ ] LSP diagnostics 无新增错误
- [ ] TypeScript typecheck 通过
- [ ] Frontend tests 通过
- [ ] Frontend build 通过，或明确记录未运行原因

**Verification:**

- [ ] `lsp_diagnostics` against `frontend-nextjs/src` and renamed test file
- [ ] `cd frontend-nextjs && npm run typecheck`
- [ ] `cd frontend-nextjs && npm run test`
- [ ] `cd frontend-nextjs && npm run build`

**Dependencies:** Tasks 1-7

**Files likely touched:** None expected

**Estimated scope:** XS verification only

## Checkpoint: Complete

- [ ] 所有用户可见中英文文案符合最终命名
- [ ] `/settings/agent` 替代 `/settings/system`
- [ ] 不保留旧路由兼容跳转
- [ ] `AI Settings / AI 设置` 未被误改
- [ ] 测试文件名和注释同步为 agent-settings
- [ ] README 文案同步，但截图路径保留旧文件名
- [ ] 全局 audit 仅剩已确认允许的截图路径旧命名
- [ ] 前端 typecheck/test/build 通过或记录阻塞原因

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| 当前 `/settings/system` 目录缺少实际 page，改名后仍可能没有页面 | Medium | 本计划只做命名；若验证发现导航 404，另开“补齐 Agent Settings 页面”任务 |
| 重命名 i18n key 后漏改引用 | Medium | 使用 `rg 'systemSettings|agentSettings'` 和 typecheck 双重验证 |
| README 图片路径仍含 `system-settings.png`，与全量命名不完全一致 | Low | 已由需求确认“只改 README 文案”；在最终说明中标注为刻意保留 |
| 不保留旧路由导致旧链接失效 | Medium | 已由需求确认；发布说明中提示 `/settings/system` 已移除 |
| 误把 `AI Settings` 改成 `Agent Settings` | Medium | 在 audit 中单独检查 `navigation.aiSettings` 仍保持不变 |

## Open Questions

当前无开放问题。以下事项已明确不在本次范围：

- 是否补齐 `/settings/agent` 实际页面
- 是否重截 README 截图
- 是否重命名截图文件路径
- 是否为 `/settings/system` 增加 redirect
- 是否调整 `AI Settings / AI 设置` 信息架构

## Suggested Implementation Order Summary

1. 改 locale key/value：`systemSettings` → `agentSettings`，描述文案同步。
2. 改 `AdminLayout.tsx`：路径 `/settings/system` → `/settings/agent`，i18n key 同步。
3. 改 `RequireAuth.tsx`：权限白名单路径同步。
4. 重命名测试文件并同步注释。
5. 改 `README.md` 和 `README.zh-CN.md` 文案，保留图片路径。
6. 全局 stale-name audit。
7. 运行 LSP diagnostics、typecheck、test、build。

## Human Approval Gate

实施前请确认：

- [ ] 认可本计划的范围和排除项
- [ ] 接受旧路由直接失效
- [ ] 接受 README 图片路径暂保留 `system-settings.png`
- [ ] 接受当前不补齐缺失 settings page
