# Reso.AI

Reso.AI 是一个 AI Native Relationship Intelligence / 关系智能产品。它通过互动 Journey、Living Persona、长期 Memory、Reflection 与受控的 Reso Agent，帮助用户认识自己、被长期理解、表达自己，并逐步建立值得投入的真实关系。

它不是普通 Chatbot、Dating App、Tinder Clone 或静态人格测试。核心原则是：理解必须可解释、可纠正、可版本化，并始终由用户确认。

## Core Loop

```text
Journey → Persona Draft → User Edit → Persona V1 → Agent Birth
       → Agent Chat → Memory → Reflection → Persona Patch Candidate
       → User Confirmation → Persona V1.1
```

长期飞轮：`Experience → Memory → Reflection → Persona → Agent Action → Relationship → New Experience`。

## Architecture

```text
Web ──REST/Contracts──> Product API ──IAgentClient──> Reso Agent ──> MiniMax
                              │                            │
                              │ owns truth                 │ proposes candidates
                              ▼                            ▼
                       PostgreSQL + Redis          FastAPI Runtime / Eval
                              │
                              └── Events ──> Worker
```

- Product 负责体验。
- Backend Service 负责事实、状态、规则和执行。
- Reso Agent 负责理解、判断、表达、反思和受控代理。
- Contracts 让 Frontend、Backend、Agent 可以并行开发。

硬规则：`Memory != Persona`、`Persona != Truth`、`Agent != User`、`Recommendation != Decision`、`Agent Suggests, Service Commits`。

## Repository

```text
apps/
  web/             React + TypeScript + Vite
  api/             Node.js + TypeScript + Fastify REST API
  agent-service/   Python + FastAPI (reso_agent)
  worker/          memory/reflection/persona/social jobs
  agent-lab/       internal trace/eval skeleton
packages/
  contracts/       Zod runtime schemas and shared types
  ui/              shared UI primitives
  design-tokens/   Reso.AI visual tokens
  config/          runtime config validation
  test-fixtures/   deterministic fixtures
database/          PostgreSQL + pgvector migrations and seeds
evals/             Agent scenarios, graders and reports
tests/             contract, integration and E2E boundaries
docs/              architecture, product, agent, API, DB and collaboration
infra/             Docker, CI and deployment boundaries
```

## Quick Start

要求：Node.js 22.16+、pnpm 10.8+、Python 3.13、uv、Docker。

```bash
cp .env.example .env
pnpm install
uv sync --project apps/agent-service
docker compose up --build
```

访问：Web `http://localhost:5173`、API `http://localhost:3000/v1/health`、Reso Agent `http://localhost:8000/v1/health`。

默认全程使用真实 MiniMax 模型：在 `.env` 配置 `LLM_API_KEY`（其余 LLM 变量保持默认），
Product API 与 Agent Service 都直接走 Reso Agent。模型配置缺失或调用失败会直接报错，
不会静默降级到 Mock。测试与 CI 通过 `RESO_MODEL_ROUTE=deterministic` 保持无密钥运行。

也可以只用 Docker 启动数据依赖，在宿主机运行开发服务：

```bash
docker compose up postgres redis
pnpm dev
uv run --project apps/agent-service uvicorn reso_agent.app:app --reload --port 8000
```

## Quality Commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm python:format:check
pnpm python:lint
pnpm python:typecheck
pnpm python:test
pnpm eval:smoke
pnpm test:database
pnpm check
```

CI 使用确定性测试桩和 deterministic eval，不调用付费模型；产品运行路径始终使用真实 Reso Agent。

## Team Ownership

- Frontend：`apps/web`、`packages/ui`、`packages/design-tokens`。
- Backend：`apps/api`、`apps/worker`、`database`。
- Agent：`apps/agent-service`、`apps/agent-lab`、`evals`。
- Shared：`packages/contracts`、`packages/test-fixtures`，通过 review 共同维护。

详细规则见 [AGENTS.md](AGENTS.md) 和 [CONTRIBUTING.md](CONTRIBUTING.md)。

## Documentation

- [Current State](docs/architecture/CURRENT_STATE.md)
- [Foundation Verification](docs/architecture/FOUNDATION_VERIFICATION.md)
- [Target Architecture](docs/architecture/TARGET_ARCHITECTURE.md)
- [Service Boundaries](docs/architecture/SERVICE_BOUNDARIES.md)
- [Product Vision](docs/product/PRODUCT_VISION.md)
- [First User Flow](docs/product/USER_FLOW.md)
- [Agent Architecture](docs/agent/AGENT_ARCHITECTURE.md)
- [Memory and Persona](docs/agent/MEMORY_AND_PERSONA.md)
- [API Contracts](docs/api/API_CONTRACTS.md)
- [Database Design](docs/database/DATABASE_DESIGN.md)
- [Local Development](docs/collaboration/LOCAL_DEVELOPMENT.md)
- [ADR Index](docs/adr/README.md)
