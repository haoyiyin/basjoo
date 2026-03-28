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
- 面向公开聊天入口的可选 Cloudflare Turnstile 验证
- 管理员认证与后台管理流程
- Docker 化的开发和生产风格部署路径

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

## 快速开始

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
npm run lint
npm run typecheck
```

### Widget（`widget/`）

```bash
npm install
npm run dev
npm run build
npm run typecheck
```

### 后端（`backend/`）

```bash
pip install -r requirements.txt
python3 main.py
pytest
pytest tests/test_api.py
pytest tests/test_api.py::test_name
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
- `JINA_API_KEY`
- `DEEPSEEK_API_KEY`
- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `ALLOWED_ORIGINS`
- `ALLOWED_METHODS`
- `ALLOWED_HEADERS`
- `RATE_LIMIT_PER_MINUTE`
- `RATE_LIMIT_BURST_SIZE`
- `LOG_LEVEL`

说明：

- 如果 `SECRET_KEY` 缺失或被判定为不安全，后端会自动生成并写入 `SECRET_KEY_FILE`。
- Docker Compose 的开发环境默认启用宽松的 CORS 和本地 API 地址。
- 生产风格环境默认依赖挂载到 `/app/data` 的持久化数据目录。

## 架构概览

### 后端

`backend/main.py` 负责创建 FastAPI 应用，并接入：

- `/api/admin` 下的认证路由
- `/api/v1` 下的业务 API
- CORS 中间件
- i18n 中间件
- 限流中间件
- 非测试模式下的 Redis 和调度器启动逻辑
- `/sdk.js` 等 widget 静态资源路由

后端的主要业务域包括：

- **智能体配置**：服务商、模型、系统提示词、Widget 设置
- **知识源**：URL 与 Q&A 条目
- **索引**：内容切块与 Qdrant 重建
- **聊天**：会话创建、流式回复、来源引用、配额校验
- **管理认证**：后台登录与注册

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

- 自动检测或手动指定 `apiBase`
- 将访客 ID / 会话 ID 保存在 `localStorage`
- 从 `/api/v1/chat/stream` 流式接收回复
- 在人工接管场景后轮询新的助手消息
- 在发送消息前按需加载并执行 Cloudflare Turnstile

后端会直接提供与 widget 相关的资源，包括 `/sdk.js`。

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
- 当前有效前端服务是 `frontend-nextjs`，不是旧的 `frontend/`。
- nginx 已配置 `client_max_body_size 12m`，这样超大请求可以到达后端并返回 JSON 错误，而不是直接返回 nginx HTML 错误页。
- 只有当 `./ssl` 中存在可读证书和私钥时，才会启用可选 HTTPS。
- 如果后端存在绕过标准中间件链的提前返回，也应补齐 CORS 头，避免嵌入式 widget 出现跨域失败。

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
