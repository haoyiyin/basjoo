# Basjoo

Basjoo 是一个面向 AI 客服场景的平台，主要由三部分组成：

- `backend/` 中的 **FastAPI 后端**，负责智能体配置、聊天、索引、认证和定时任务
- `frontend-nextjs/` 中的 **Next.js 管理后台前端**
- `widget/` 中的 **可嵌入聊天组件**，通过 HTTP 和 SSE 与后端通信

当前技术栈还包括：

- **SQLite**：应用数据持久化
- **Redis**：限流、缓存相关能力
- **Qdrant**：向量检索
- **nginx**：Docker 部署下的反向代理

## 自动部署

对于一台全新的 Ubuntu 或 Debian 服务器，可直接执行：

```bash
curl -fsSL https://raw.githubusercontent.com/haoyiyin/basjoo/main/install-deploy.sh | sudo sh
```

如果你已经在本地检出了仓库，也可以直接运行：

```bash
sudo sh install-deploy.sh
```

## 仓库结构

- `backend/` — FastAPI 应用、数据模型、聊天 API、认证、数据导入、索引、测试
- `frontend-nextjs/` — 当前正在使用的管理后台 UI
- `widget/` — 可嵌入聊天组件的构建产物来源
- `nginx/` — Docker nginx 配置
- `docker-compose.yml` — 开发/生产风格环境编排入口
- `frontend/` — 旧版前端，仅作历史参考；当前有效前端是 `frontend-nextjs/`

## 核心功能

- 支持多种模型服务商配置的 AI 智能体
- URL 抓取与 Q&A 知识管理
- 基于 Qdrant 的检索与索引重建任务
- 基于 Server-Sent Events 的流式聊天回复
- 可嵌入网站的聊天组件，并带有会话持久化能力
- 根据访客语言自动翻译 widget 文案
- 面向公开聊天入口的按 Agent 配置的 Widget 域名白名单
- 离线智能体兜底回复与管理端错误告警
- 管理员认证与后台管理流程
- Docker 化的开发和生产风格部署路径

## 功能演示

### 管理后台总览

管理后台是配置智能体、查看知识覆盖情况、进入各个运营模块的统一入口。

![中文后台总览截图](resource/screenshots/admin/zh-CN/dashboard.png)

### Playground 与 AI 配置

Playground 页面可以测试回复效果、观察检索结果，并联动调整模型与服务商配置。

![中文 Playground 截图](resource/screenshots/admin/zh-CN/playground.png)

### 网站知识管理

网站管理页面用于添加 URL、执行抓取、配置自动抓取，并触发训练/索引更新流程。

![中文网站管理截图](resource/screenshots/admin/zh-CN/websites.png)

### Q&A 知识管理

Q&A 页面用于录入、批量导入、编辑问答条目，并在保存后重建知识索引。

![中文 Q&A 管理截图](resource/screenshots/admin/zh-CN/qa.png)

### 会话中心

会话中心展示实时对话列表，支持人工接管，并帮助运营人员统一查看访客会话状态。

![中文会话中心截图](resource/screenshots/admin/zh-CN/sessions.png)

### 系统设置与 Widget 外观

系统设置页面用于管理语言/主题偏好、Widget 外观、嵌入行为及其它后台配置。

![中文系统设置截图](resource/screenshots/admin/zh-CN/system-settings.png)

### 嵌入式 Widget 聊天窗口

Widget 提供访客侧聊天入口，支持会话持久化、多语言文案、流式回复和知识辅助回答。

![中文 Widget 截图](resource/screenshots/widget/zh-CN/widget-window.png)

## 技术栈

### 后端

- FastAPI
- SQLAlchemy async + SQLite
- Redis
- Qdrant
- APScheduler
- OpenAI 兼容接口、Anthropic、Google Gemini 等服务商 SDK

### 前端

- Next.js 14
- React 18
- TypeScript
- i18next

### Widget

- TypeScript
- esbuild
- 浏览器原生 fetch + SSE 处理

## 手动部署

### 方式一：使用 Docker Compose

启动开发环境：

```bash
docker compose --profile dev up -d
```

启动生产风格环境：

```bash
docker compose --profile prod up -d
```

常用 Docker 命令：

```bash
docker compose logs -f backend-dev frontend-dev nginx
docker compose --profile dev up -d --build backend-dev frontend-dev
bash scripts/prod_stability_check.sh
```

默认开发端口：

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`
- Qdrant: `http://localhost:6333`
- Redis: `127.0.0.1:6379`

### 方式二：本地分别运行服务

#### 后端

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 main.py
```

健康检查：

```bash
curl http://localhost:8000/health
```

#### 前端

```bash
cd frontend-nextjs
npm install
npm run dev
```

#### Widget

```bash
cd widget
npm install
npm run dev
```

## 常用开发命令

### 前端（`frontend-nextjs/`）

```bash
npm install
npm run dev
npm run build
npm run start        # 本地运行生产构建
npm run lint
npm run typecheck
npm run test         # vitest
```

### Widget（`widget/`）

```bash
npm install
npm run dev          # 开发打包 + 示例服务
npm run build        # 完整构建（类型检查 + 开发 + 生产打包）
npm run build:dev    # 未压缩 ESM 打包 (dist/basjoo-widget.js)
npm run build:prod   # 压缩 IIFE 打包 (dist/basjoo-widget.min.js)
npm run typecheck
npm run test         # vitest
```

### 后端（`backend/`）

```bash
pip install -r requirements.txt
python3 main.py
pytest
pytest tests/test_api.py
pytest tests/test_api.py::test_name
```

### 根目录 E2E 测试

```bash
npm run test:e2e        # smoke 测试（开发环境）
npm run test:e2e:all    # 所有 Playwright 测试项目
npm run test:e2e:prod   # 生产近似 E2E 测试
npm run test:e2e:widget # Widget 跨域嵌入测试
npm run sync-widget     # 同步 widget 打包产物到后端
```

### Docker Compose watch 模式（开发）

```bash
docker compose --profile dev up --watch
```

## 环境变量与配置

后端通过 `pydantic-settings` 从环境变量和 `.env` 中读取配置。

当前代码中重要的运行时配置包括：

- `DATABASE_URL`
- `REDIS_URL`
- `QDRANT_HOST`
- `QDRANT_PORT`
- `SECRET_KEY`
- `SECRET_KEY_FILE`
- `DEFAULT_AGENT_ID`
- `JINA_API_KEY`
- `DEEPSEEK_API_KEY`
- `ALLOWED_ORIGINS`
- `ALLOWED_METHODS`
- `ALLOWED_HEADERS`
- `RATE_LIMIT_PER_MINUTE`
- `RATE_LIMIT_BURST_SIZE`
- `LOG_LEVEL`
- `SERVER_DOMAIN`
- `ENCRYPTION_KEY`（可选；缺失时自动生成并持久化）
- `ENCRYPTION_KEY_FILE`（默认 `/app/data/.encryption_key`）
- `REQUIRE_SECRET_KEY`（生产环境设为 `true`，拒绝不安全的密钥）

说明：

- 如果 `SECRET_KEY` 缺失或被判定为不安全，后端会自动生成并写入 `SECRET_KEY_FILE`。
- `DEFAULT_AGENT_ID` 可用于迁移时恢复或固定已知的 widget agent ID；保留旧嵌入代码的完整流程见下方部署章节。
- 如果未设置 `ENCRYPTION_KEY`，后端会自动生成 Fernet 密钥并持久化到 `ENCRYPTION_KEY_FILE`；存储在数据库中的服务商 API 密钥会使用该密钥加密。
- `cors_allow_null_origin`（布尔值，默认 `false`）控制是否允许 `Origin: null`（如 `file://` widget 预览）获取通配符 CORS 头。出于安全考虑默认关闭。
- `SERVER_DOMAIN` 由生产环境中的 nginx 服务使用，用于限制规范域名并阻止直接 IP/其他 Host 访问。
- Docker Compose 的开发环境默认启用宽松的 CORS 和本地 API 地址。
- 生产风格环境默认依赖挂载到 `/app/data` 的持久化数据目录。

## 架构概览

### 后端

`backend/main.py` 负责创建 FastAPI 应用，并接入：

- `/api/admin` 下的认证路由
- `/api/v1` 下的业务 API（聊天、智能体配置、会话、配额、任务状态）
- admin-only 路由：`url_endpoints.py`（URL 导入、Q&A 管理、抓取）和 `index_endpoints.py`（索引重建任务）在 router 级别通过 `Depends(get_current_admin)` 进行管理员鉴权保护
- public v1 路由：`/api/v1/chat`、`/api/v1/chat/stream`、`/api/v1/contexts`、`/api/v1/config:public`
- CORS 中间件，早返回响应（限流 429、请求体 413）通过共享 `apply_cors_headers()` 处理
- i18n 中间件
- 限流中间件
- 非测试模式下的 Redis 和调度器启动逻辑
- `/sdk.js` 等 widget 静态资源路由
- 10MB 请求体保护：超过限制时直接返回 JSON 413，不再进入下游处理

后端的主要业务域包括：

- **智能体配置**：服务商、模型、系统提示词、Widget 设置
- **知识源**：URL 与 Q&A 条目，URL 导入经过 `backend/services/url_safety.py` 的 SSRF 防护校验
- **索引**：内容切块与 Qdrant 重建；重建会替换整个集合（清空 + 重新添加）
- **聊天**：会话创建、流式回复、来源引用、配额校验
- **管理认证**：后台登录与注册
- **定时任务**：URL 抓取调度、历史清理、会话自动关闭（30 分钟无活动超时）

`backend/models.py` 中的主要持久化实体包括：

- `Workspace`
- `Agent`
- `URLSource`
- `QAItem`
- `DocumentChunk`
- `ChatSession`
- `ChatMessage`
- `WorkspaceQuota`
- `IndexJob`
- `AdminUser`

### 检索与模型服务层

检索与索引流程主要分布在：

- `backend/api/v1/url_endpoints.py`
- `backend/api/v1/index_endpoints.py`
- `backend/services/qdrant_store.py`
- `backend/services/rag_qdrant.py`
- `backend/services/scraper.py`
- `backend/services/crawler.py`

模型服务抽象位于 `backend/services/llm_service.py`。服务商选择由 `Agent.provider_type` 决定。当前代码支持多种 OpenAI 兼容服务商，以及专门的 OpenAI Native 和 Google 路径。

### 前端

当前有效前端是 `frontend-nextjs/` 中的 Next.js 应用。

- App Router 路由位于 `frontend-nextjs/app/`
- 大多数页面逻辑位于 `frontend-nextjs/src/views/`
- 共享组件位于 `frontend-nextjs/src/components/`
- 管理员认证状态位于 `frontend-nextjs/src/context/AuthContext.tsx`
- API 请求与 SSE 解析集中在 `frontend-nextjs/src/services/api.ts`

### Widget

`widget/src/BasjooWidget.tsx` 是一个自包含的可嵌入聊天组件，支持：

- 从脚本 src URL 自动检测 `apiBase`，开发环境下 3000 端口自动推断后端 8000，或回退到 `window.location.origin`
- 初始化时请求 `/api/v1/config:public` 获取 `default_agent_id`、widget 标题/颜色和欢迎语
- 将访客 ID / 会话 ID 保存在 `localStorage`
- 从 `/api/v1/chat/stream` 通过 SSE 流式接收回复，90 秒读取超时，网络错误时自动重试一次
- 人工接管场景下以 3 秒间隔轮询 `/api/v1/chat/messages?role=assistant`
- 在配置时依赖服务端的 Widget 来源白名单校验

后端会直接提供与 widget 相关的资源，包括 `/sdk.js`。

### 安全模型

- **SSRF 防护**：`backend/services/url_safety.py` 校验所有用户提供的 URL。阻止 `localhost`、直接 IP 字面量、含嵌入凭据的 URL，以及解析到私有/特殊用途 IP 的主机名（环回、RFC1918、链路本地、云元数据）。DNS 解析结果缓存 512 条 LRU，避免抓取时重复查询。
- **Widget 来源白名单**：公开聊天路由强制执行按 agent 配置的来源白名单。管理员用户可绕过白名单用于测试。
- **CORS 策略**：早返回响应（限流 429、请求体 413）通过 `backend/middleware/rate_limit.py` 中的共享 helper 处理 CORS 头。`Origin: null` 仅在显式启用 `cors_allow_null_origin` 时获得通配符 CORS。缺少 `Origin` 头的请求不会获得 CORS 头。
- **密钥持久化**：`SECRET_KEY`、`DEFAULT_AGENT_ID` 和 `ENCRYPTION_KEY` 在首次启动时自动生成并持久化，确保 widget 嵌入行为稳定以及 API 密钥加密存储在重新部署后保持一致。
- **任务并发控制**：共享 `TaskLock` 服务防止同一 agent 上的冲突操作（如重建阻塞抓取、抓取阻塞重建）。

## 测试

后端测试位于 `backend/tests/`。

根据 `backend/tests/conftest.py`，当前测试具有以下特点：

- 设置 `BASJOO_TEST_MODE=1`
- 使用 `backend/.pytest_dbs/` 下的隔离 SQLite 数据库
- 对很多测试场景下的 Qdrant/Jina/LLM 依赖进行 monkeypatch
- Redis/Qdrant 主机名在 Docker 和 localhost 之间自动回退

运行全部测试：

```bash
cd backend
pytest
```

运行单个测试文件：

```bash
pytest tests/test_api.py
```

运行单个测试：

```bash
pytest tests/test_api.py::test_name
```

## 部署说明

- `docker-compose.yml` 是当前的主要编排入口。
- `install-deploy.sh` 是面向 Ubuntu/Debian 的一键生产部署脚本。可自动安装 Docker/Compose、clone 仓库、强制同步远端分支，并在部署前完成 `.env` 初始化。
- 当前有效前端服务是 `frontend-nextjs`，不是旧的 `frontend/`。
- nginx 已配置 `client_max_body_size 12m`，这样超大请求可以到达后端并返回 JSON 错误，而不是直接返回 nginx HTML 错误页。
- 只有当 `./ssl` 中存在可读证书和私钥时，才会启用可选 HTTPS。
- 当证书存在时，nginx 会在 443 提供 HTTPS，并将 80 上的 HTTP 请求自动重定向到 HTTPS。
- 可以为 nginx 设置 `SERVER_DOMAIN` 作为规范域名。设置后，nginx 只响应该域名；直接 IP 访问或其他 Host 请求会被 nginx 以 444 丢弃，同时保留 `/health` 供负载均衡探活使用。
- 如果未设置 `SERVER_DOMAIN`，nginx 会保持当前按请求 Host 正常响应的行为。
- 如果后端存在绕过标准中间件链的提前返回，也应补齐 CORS 头，避免嵌入式 widget 出现跨域失败。
- 后端会将默认 widget agent ID 持久化到 `/app/data/.agent_id`。只要保留 backend 数据卷，重新部署后旧的 widget 嵌入代码仍然可用。
- 如果你知道历史上已上线 widget 的旧 `agentId`，可在新部署首次启动前设置 `DEFAULT_AGENT_ID=agt_xxxxxxxxxxxx`，以保持旧嵌入代码兼容。
- 除非你明确想重置 widget 身份，否则不要执行 `docker compose down -v`，也不要删除 backend 数据卷。
- 一键部署脚本只会强制重置仓库代码文件，不会删除 Docker 命名卷，因此 `/app/data` 中的持久化数据在重新部署后依然保留。

### 重新部署时保留旧 widget 的推荐流程

1. 保留挂载到 `/app/data` 的 backend 数据卷。
2. 使用 `docker compose --profile prod up -d --build` 重新部署。
3. 如果是在新机器迁移且你知道旧 widget 的 `agentId`，请在启动前设置 `DEFAULT_AGENT_ID`。
4. 至少备份 `/app/data/basjoo.db` 和 `/app/data/.agent_id`。

迁移时的 `.env` 示例：

```bash
SECRET_KEY=
DEFAULT_AGENT_ID=agt_123456789abc
```

如果旧数据卷已经丢失，且旧 `agentId` 也无法获取，则无法自动恢复旧 widget，因为嵌入代码里直接引用了之前的 agent ID。

## API 概览

代码中可见的一些接口示例：

- `/health`
- `/api/admin/login`
- `/api/admin/register`
- `/api/v1/chat`
- `/api/v1/chat/stream`
- `/api/v1/agent:default`
- `/api/v1/urls:create`
- `/api/v1/urls:list`
- `/api/v1/urls:refetch`
- `/api/v1/index:rebuild`
- `/api/v1/index:status`

## 当前说明

本 README 基于当前仓库状态编写。如果后续修改了部署流程、模型服务商支持、或包脚本，请同步更新此文档。
