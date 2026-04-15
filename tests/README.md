# Basjoo Test Suite

## 测试分层

| 层级 | 位置 | 框架 | 运行命令 |
|------|------|------|----------|
| 单元测试 (backend) | `backend/tests/unit/` | pytest | `cd backend && pytest tests/unit/` |
| 契约测试 (backend) | `backend/tests/contracts/` | pytest | `cd backend && pytest tests/contracts/` |
| 集成测试 (backend) | `backend/tests/integration/` | pytest | `cd backend && pytest tests/integration/` |
| 压力测试 (backend) | `backend/tests/performance/` | pytest | `cd backend && pytest tests/performance/` |
| 前端单元测试 | `frontend-nextjs/tests/unit/` | vitest/jest | `cd frontend-nextjs && vitest run` |
| Widget 单元测试 | `widget/tests/unit/` | vitest/jest | `cd widget && vitest run` |
| E2E 测试 | `tests/e2e/specs/` | Playwright | `playwright test` |

## E2E 测试环境

### 快速 Smoke（默认）
```bash
# 启动 dev 环境
docker compose --profile dev up -d

# 运行 smoke 测试
npx playwright test --project=smoke
```

### 生产近似 E2E
```bash
# 启动生产环境
docker compose --profile prod up -d

# 运行 prod-like 测试
E2E_ENV=prod npx playwright test --project=prod-like
```

### 跨域 Widget 测试
```bash
# 需要配置宿主页 (allowed-host, blocked-host)
HOST_ALLOWED_URL=http://allowed.local \
HOST_BLOCKED_URL=http://blocked.local \
npx playwright test --project=widget-cross-origin
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
