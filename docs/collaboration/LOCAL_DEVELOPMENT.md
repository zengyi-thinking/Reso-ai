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

根 `pnpm dev` 会先 build shared packages，再并行启动 Web/API/Worker/Agent Lab。默认 API 使用 Mock Agent；设置 `AGENT_PROVIDER=reso-agent` 才调用本地 FastAPI。

## 常见问题

- `.env` 不提交；浏览器不得出现 `LLM_API_KEY`。
- 新数据库卷只在首次初始化时自动执行 migration；已有卷需要显式 migration runner（Stage 1 待实现）。
- `references/` 包含两个独立 Git 参考仓库，不属于根 workspace；根格式化、安装和 CI 必须排除它们。
- 网络下载超时时可重试 `uv sync`，但不得通过提交 `.venv` 解决。
