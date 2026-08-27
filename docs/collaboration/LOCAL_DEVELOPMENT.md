# Local Development

## 安装

```bash
cp .env.example .env
pnpm install
uv sync --project apps/agent-service
```

## 全 Docker

```bash
docker compose up --build
```

服务：Web `5173`、API `3000`、Agent `8000`、PostgreSQL `5432`、Redis `6379`，以及不暴露端口的 Migration 和 Worker 服务。API/Worker 只会在 Migration 成功后启动。

## 混合开发

```bash
docker compose up postgres redis
pnpm --filter @reso/api db:migrate
pnpm dev
uv run --project apps/agent-service uvicorn reso_agent.app:app --reload --port 8000
```

根 `pnpm dev` 会先 build shared packages，再并行启动 Web/API/Worker/Agent Lab。API 始终调用本地 FastAPI（Reso Agent），需要在 `.env` 配置可用的 MiniMax `LLM_API_KEY`；Python 测试通过 `RESO_MODEL_ROUTE=deterministic` 保持无密钥运行。

邮箱验证码联调还需要在本地 `.env` 配置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_AUTH_CODE`、`SMTP_FROM` 与独立的 `AUTH_CODE_HASH_SECRET`。QQ 邮箱通常使用 `smtp.qq.com:465`；`SMTP_AUTH_CODE` 是授权码而不是登录密码。任何命令、日志或截图都不得打印这些值。

成长闭环相关环境变量：`LLM_EMBEDDING_MODEL` 可选，未设置时全链路保持纯 lexical 检索基线；设置后 docker compose 的 agent-service 与 API 调用路径启用 MiniMax embeddings（统一写入固定 1536 维向量）。Worker 另支持 `WORKER_REFLECTION_THRESHOLD`（默认 `4`）：同一会话水位之后累计的用户消息达到阈值才触发一次 Reflection。

## 数据库与事件接缝验证

```bash
pnpm test:database
```

该命令使用独立 Compose project 创建临时 PostgreSQL/pgvector 与 Redis，依次验证追加式 migration、合成 seed、event outbox/消费/死信表和 Redis 健康状态，并在结束时删除该临时 project 的 volume。它不会复用或删除日常开发的 `reso-ai` volume。

## 常见问题

- `.env` 不提交；浏览器不得出现 `LLM_API_KEY`。
- 主 `compose.yaml` 由一次性 `migrate` 服务统一执行 migration，不再同时使用 PostgreSQL entrypoint 重复初始化。`pnpm test:database` 的隔离测试库仍使用 entrypoint 验证干净 schema。手动和正式环境执行 `pnpm --filter @reso/api db:migrate`，Migration Runner 提供重复执行、并发锁和校验和保护。
- 正式 API 使用 `PRODUCT_REPOSITORY=postgres` 与 `SESSION_PROVIDER=postgres`；生产环境配置成内存 Repository 或 Demo Session 时会拒绝启动。
- `apps/worker` 使用 PostgreSQL Outbox 持久化领取、`FOR UPDATE SKIP LOCKED` 并发锁、指数退避和最多 5 次处理；它不是 Agent Runtime。
- `references/` 包含两个独立 Git 参考仓库，不属于根 workspace；根格式化、安装和 CI 必须排除它们。
- 网络下载超时时可重试 `uv sync`，但不得通过提交 `.venv` 解决。
