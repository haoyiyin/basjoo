# Basjoo 测试指南

## 快速开始

### 运行所有后端测试

```bash
cd backend
pytest
```

### 运行单个测试文件

```bash
cd backend
pytest tests/test_api.py
```

### 运行单个测试

```bash
cd backend
pytest tests/test_api.py::test_name
```

### 常用 pytest 选项

```bash
pytest -v                     # 详细输出
pytest -x                     # 首次失败即停止
pytest --tb=short             # 精简 traceback
pytest -k "pattern"           # 按名称过滤测试
pytest -v -x --tb=short       # 组合使用
```

## 测试分层

| 层级 | 位置 | 框架 | 运行命令 |
|------|------|------|----------|
| 后端单元测试 | `backend/tests/unit/` | pytest | `cd backend && pytest tests/unit/` |
| 后端契约测试 | `backend/tests/contracts/` | pytest | `cd backend && pytest tests/contracts/` |
| 后端集成测试 | `backend/tests/integration/` | pytest | `cd backend && pytest tests/integration/` |
| 后端安全/压力/健壮性 | `backend/tests/` 根目录 | pytest | `cd backend && pytest tests/test_*.py` |
| 前端类型检查 + 测试 | `frontend-nextjs/` | tsc + vitest | `npm run typecheck && npm run test` |
| Widget 类型检查 + 测试 | `widget/` | tsc + vitest | `npm run typecheck && npm run test` |
| E2E 测试（根目录） | `tests/e2e/` | Playwright | `npm run test:e2e` |

## 后端测试特点

后端测试配置（`backend/pytest.ini` + `backend/tests/conftest.py`）：

- 自动设置 `BASJOO_TEST_MODE=1`
- 每次测试使用隔离的 SQLite 数据库（`backend/.pytest_dbs/`）
- 对 Qdrant/Jina/LLM 集成进行 monkeypatch，大多数 API 测试无需外部服务
- Redis/Qdrant 主机名在 Docker 容器名与 localhost 之间自动回退
- 使用 `client` fixture 进行管理员认证请求，`public_client` fixture 进行未认证/公开路由测试

## E2E 测试环境

### 快速 Smoke（默认）

```bash
# 启动 dev 环境
docker compose --profile dev up -d

# 运行 smoke 测试
npm run test:e2e
# 或等价于：
npx playwright test --config=tests/e2e/playwright.config.ts --project=smoke
```

### 生产近似 E2E

```bash
# 启动生产环境
docker compose --profile prod up -d

# 运行 prod-like 测试
npm run test:e2e:prod
# 或等价于：
E2E_ENV=prod npx playwright test --config=tests/e2e/playwright.config.ts --project=prod-like
```

### 跨域 Widget 测试

```bash
# 需要配置宿主页 (allowed-host, blocked-host)
npm run test:e2e:widget
# 或等价于：
HOST_ALLOWED_URL=http://allowed.local \
HOST_BLOCKED_URL=http://blocked.local \
npx playwright test --config=tests/e2e/playwright.config.ts --project=widget-cross-origin
```

### 运行所有 E2E 测试

```bash
npm run test:e2e:all
# 或等价于：
npx playwright test --config=tests/e2e/playwright.config.ts
```

## E2E 测试目录结构

```
tests/
├── e2e/
│   ├── playwright.config.ts    # Playwright 配置
│   ├── global.setup.ts         # 全局 setup（创建 admin、种子数据）
│   ├── fixtures/
│   │   ├── admin.fixture.ts    # Admin 登录辅助
│   │   └── widget.fixture.ts   # Widget 交互辅助
│   └── specs/
│       ├── admin-auth.spec.ts           # 管理员认证流程
│       ├── playground-streaming.spec.ts # Playground 自动保存 + 流式聊天
│       ├── knowledge-indexing.spec.ts   # 知识库导入 -> 索引 -> 检索
│       ├── sessions-takeover.spec.ts    # 会话中心 + 人工接管
│       └── widget-cross-origin.spec.ts  # Widget 跨域嵌入
├── environments/
│   ├── host-pages/
│   │   ├── allowed-host/       # 允许嵌入的宿主页
│   │   └── blocked-host/       # 被阻止的宿主页
│   └── stubs/
│       └── crawl-target/       # URL 抓取的测试站点
└── README.md
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `BASE_URL` | Admin dashboard URL | `http://localhost:3000` |
| `API_BASE_URL` | Backend API URL | `http://localhost:8000` |
| `ADMIN_EMAIL` | 测试 admin 邮箱 | `test@example.com` |
| `ADMIN_PASSWORD` | 测试 admin 密码 | `testpassword123` |
| `E2E_ENV` | 测试环境 (`dev`/`prod`) | `dev` |
| `HOST_ALLOWED_URL` | 允许嵌入的宿主页 URL | - |
| `HOST_BLOCKED_URL` | 被阻止的宿主页 URL | - |
| `CRAWL_TARGET_URL` | URL 抓取测试站点 | `http://host.docker.internal:8081` |
