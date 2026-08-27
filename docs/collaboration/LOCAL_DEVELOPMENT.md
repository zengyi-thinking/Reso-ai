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

服务：Web `5173`、API `3000`、Agent `8000`、PostgreSQL `5432`、Redis `6379`。

## 混合开发

```bash
docker compose up postgres redis
pnpm dev
uv run --project apps/agent-service uvicorn reso_agent.app:app --reload --port 8000
```

根 `pnpm dev` 会先 build shared packages，再并行启动 Web/API/Worker/Agent Lab。API 始终调用本地 FastAPI（Reso Agent），需要在 `.env` 配置可用的 MiniMax `LLM_API_KEY`；Python 测试通过 `RESO_MODEL_ROUTE=deterministic` 保持无密钥运行。

## 数据库与事件接缝验证

```bash
pnpm test:database
```

该命令使用独立 Compose project 创建临时 PostgreSQL/pgvector 与 Redis，依次验证追加式 migration、合成 seed、event outbox/消费/死信表和 Redis 健康状态，并在结束时删除该临时 project 的 volume。它不会复用或删除日常开发的 `reso-ai` volume。

## 常见问题

- `.env` 不提交；浏览器不得出现 `LLM_API_KEY`。
- 新数据库卷只在首次初始化时自动执行 migration；`pnpm test:database` 用于验证干净 schema。对已有开发/生产卷执行增量 migration 的发布 runner 属于 Stage 1。
- `references/` 包含两个独立 Git 参考仓库，不属于根 workspace；根格式化、安装和 CI 必须排除它们。
- 网络下载超时时可重试 `uv sync`，但不得通过提交 `.venv` 解决。
