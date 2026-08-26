# Technology Stack

**Project:** Reso.AI (`reso-ai`)  
**Milestone:** Project Bootstrap / Stage 0 Foundation  
**Researched:** 2026-08-26  
**Overall confidence:** HIGH for the platform and core framework choices; MEDIUM for pre-1.0 libraries whose APIs require lockfile pinning

## Recommendation in One Sentence

Use a **Node.js 24 LTS + pnpm 11 + Turborepo 2** TypeScript workspace for Web/API/Worker/shared packages, a separately locked **Python 3.13 + uv + FastAPI** Agent Service, and local **PostgreSQL 18 + pgvector 0.8.6 + Redis 8.2 Extended Support** infrastructure. Use Zod 4 contracts as the TypeScript runtime/type source, export JSON Schema/OpenAPI artifacts for Python, and keep all Stage 0 tests on deterministic mock providers.

## Version Policy

The versions below are the latest registry or official patch releases verified on 2026-08-26 unless a compatibility reason is stated. The repository should:

- Declare exact toolchain versions in `packageManager`, `.node-version`, `.python-version`, CI actions, and container image tags.
- Commit `pnpm-lock.yaml` and `uv.lock`; CI uses `pnpm install --frozen-lockfile` and `uv sync --locked`.
- Allow ordinary application dependencies to use compatible ranges in manifests, but let lockfiles determine the installed version.
- Use Renovate/Dependabot in grouped, reviewed updates; do not float container tags such as `latest`, `pg18`, or `redis:8`.
- Upgrade FastAPI only after contract and smoke tests pass. FastAPI's own versioning guidance notes that minor `0.x` updates may break APIs.

## Recommended Stack

### Runtime and Monorepo

| Technology |                                       Baseline version | Purpose                                            | Why this version/choice                                                                                                                                                                                | Confidence |
| ---------- | -----------------------------------------------------: | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Node.js    | **24 LTS** (pin current 24.x patch in `.node-version`) | Web build, Product API, Worker, repository tooling | Node 24 is the active LTS line in 2026. Do not use Node 26 Current for a production baseline. Vite 8, Vitest 4, ESLint 10, Fastify 5, and pnpm 11 all support Node 24.                                 | HIGH       |
| pnpm       |                                            **11.24.0** | JavaScript package manager and workspace linking   | Native monorepo support, strict declared-dependency access, one lockfile, `workspace:` protocol, and catalogs. Set `packageManager: "pnpm@11.24.0"`; use `workspace:*` for internal packages.          | HIGH       |
| Turborepo  |                                            **2.10.12** | Task graph, parallel execution, local/CI cache     | pnpm owns dependency installation; Turbo owns `build`, `lint`, `typecheck`, and test task orchestration. It fits the independent Web/API/package graph without imposing release tooling.               | HIGH       |
| TypeScript |                                              **6.0.3** | Shared language and strict type checking           | This is the newest release compatible with `typescript-eslint@8.68.0` (`>=4.8.4 <6.1.0`). Registry-latest TypeScript 7.0.2 is deliberately deferred. Configure modern ESM and strictness from day one. | HIGH       |
| tsx        |                                            **4.23.12** | Local execution/watch for API and scripts          | Small, ESM-friendly TypeScript runner. Build production API artifacts with `tsc`/a bundler only if deployment later requires it; do not use `ts-node`.                                                 | HIGH       |

**Monorepo rule:** JavaScript packages live in pnpm workspaces. `apps/agent-service` remains in the same Git repository and participates in root commands through Turbo scripts, but its dependencies and virtual environment are owned by uv, not pnpm. Do not try to model Python packages as npm workspaces.

### Web

| Technology                  | Baseline version | Purpose                             | Why                                                                                                                                                                                | Confidence |
| --------------------------- | ---------------: | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| React / React DOM           |       **19.2.8** | Mobile-first Web UI                 | Current stable React line. Patch 19.2.8 is above the fixed React Server Components security releases; this Vite SPA should not add an RSC runtime.                                 | HIGH       |
| Vite                        |        **8.2.2** | Web dev server and production build | Current stable major, uses Rolldown and requires Node 20.19+/22.12+; Node 24 satisfies this. It directly matches the project requirement and keeps the first release a simple SPA. | HIGH       |
| `@vitejs/plugin-react`      |        **6.1.0** | React transform/HMR                 | Official Vite React integration, with a peer dependency on Vite 8.                                                                                                                 | HIGH       |
| React Router                |        **8.3.0** | Route and layout boundaries         | Use declarative/data routing for Welcome → Journey → Persona → Agent flows. Keep loaders thin; Product API remains the source of truth.                                            | MEDIUM     |
| TanStack Query              |      **5.102.4** | Server-state fetching/cache         | Keeps remote state, retries, invalidation, and cancellation out of ad-hoc hooks. It is not a business-state store.                                                                 | HIGH       |
| React Hook Form             |       **7.86.0** | Journey/Persona editing forms       | Good fit for multi-step mobile forms and can consume Zod validation through `@hookform/resolvers@5.9.1`.                                                                           | HIGH       |
| CSS Modules + design tokens |    Vite built-in | Styling                             | Best fit for the bespoke warm, illustrated Reso.AI design. Put primitives in `packages/design-tokens` and reusable components in `packages/ui`; avoid a generic dashboard theme.   | HIGH       |

Do **not** add Redux/Zustand at bootstrap. React local state plus TanStack Query is sufficient until a concrete cross-route client-state problem appears. Do **not** add Next.js: SSR/RSC is not required for the first closed loop, and the explicit Vite requirement is simpler to operate.

### Product API and Worker

| Technology                      |     Baseline version | Purpose                                               | Why                                                                                                                                                                                                                              | Confidence |
| ------------------------------- | -------------------: | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Fastify                         |           **5.12.1** | Node.js REST API                                      | Recommended over Express 5. Fastify provides schema-driven request/response validation, typed providers, Pino logging, plugin encapsulation, and `inject()` testing. Those features reinforce Contract First and domain modules. | HIGH       |
| Zod                             |            **4.4.3** | Runtime validation + TypeScript contract source       | Put schemas in `packages/contracts`; infer TS types from schemas. Zod 4 has first-party JSON Schema generation, enabling checked artifacts for Python without maintaining a second hand-written contract.                        | HIGH       |
| `fastify-type-provider-zod`     |            **7.0.0** | Bind Zod contracts to Fastify routes                  | Current version supports Fastify `^5.5` and Zod `>=4.1.5`; validates both handler input and output against shared schemas.                                                                                                       | HIGH       |
| `@fastify/swagger` / Swagger UI |    **9.8.1 / 6.1.1** | Internal OpenAPI artifact and local docs              | Generate an internal API description from route schemas. Commit or validate the generated artifact in contract tests; do not make OpenAPI a separately edited truth.                                                             | HIGH       |
| Drizzle ORM / Kit               | **0.45.2 / 0.31.10** | Typed PostgreSQL queries and SQL migration generation | SQL-forward, lightweight, supports pgvector column/index helpers, and keeps migrations reviewable. Because Drizzle is pre-1.0, pin exact versions and never use `drizzle-kit push` outside disposable local databases.           | MEDIUM     |
| `pg` / `@types/pg`              |  **8.23.1 / 8.23.0** | PostgreSQL connection pool                            | Mature driver suited to a long-running Fastify service. Keep one service-owned pool and explicit transaction boundaries.                                                                                                         | HIGH       |
| `redis` (node-redis)            |            **6.2.1** | Cache, ephemeral coordination, queue transport        | Official high-performance Redis client, supports Redis URLs/TLS and BullMQ's node-redis adapter. Redis is never the source of truth for Persona, Consent, or Relationship state.                                                 | HIGH       |
| BullMQ                          |            **6.2.2** | Stage 0 event/job queue boundary                      | Provides bounded retries, job IDs, worker isolation, and Redis-backed queues for memory/reflection candidates. Start with one queue deployment; no Kafka.                                                                        | MEDIUM     |

Recommended Fastify support packages: `@fastify/cors@11.3.0`, `@fastify/helmet@13.1.1`, `@fastify/sensible@6.0.5`, `fastify-plugin@6.0.0`, and `pino@10.3.1`. Validate all request inputs **and responses**; define a stable error envelope in `packages/contracts` rather than returning Fastify's default validation body as the public contract.

**Fastify over Express:** Express 5.2.1 is viable and mature, but it requires assembling validation, typed route inference, logging, serialization, and plugin conventions separately. That flexibility is not valuable for this greenfield Contract First service. Fastify's schema lifecycle reduces opportunities for undocumented response drift.

### Agent Service

| Technology          |    Baseline version | Purpose                                                             | Why                                                                                                                                                                                                                           | Confidence |
| ------------------- | ------------------: | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| CPython             |         **3.13.15** | Agent Service runtime                                               | Deliberately one feature line behind Python 3.14.7 for broader model/telemetry SDK wheel compatibility. Python 3.13 remains in bugfix support through 2029. Add a 3.14 CI compatibility job later, then upgrade deliberately. | HIGH       |
| uv                  |          **0.12.6** | Python interpreter/dependency/project management                    | Fast cross-platform sync, universal lockfile, dependency groups, and `uv run`. Commit `uv.lock`; use `uv sync --locked --all-groups` in CI.                                                                                   | HIGH       |
| FastAPI             |         **0.141.1** | Internal Agent Service REST boundary                                | Strong Pydantic integration, automatic OpenAPI, dependency overrides, and straightforward deterministic tests. Pin the minor version because FastAPI remains pre-1.0.                                                         | HIGH       |
| Uvicorn             |          **0.52.4** | ASGI development/production server                                  | Standard FastAPI ASGI server. Use `uvicorn[standard]` for local performance extras; production process topology is a deployment decision, not an application concern.                                                         | HIGH       |
| Pydantic / Settings | **2.13.4 / 2.15.0** | Request/response models and environment config                      | Enforces Agent Service input/output boundaries and validates settings. Generated schemas must be checked against TypeScript contract fixtures.                                                                                | HIGH       |
| HTTPX               |          **0.28.1** | Calls from Agent Service to Product API/model adapters; async tests | Async client and ASGI test transport integrate well with FastAPI. All external model calls live behind provider interfaces.                                                                                                   | HIGH       |
| structlog           |          **26.1.0** | Structured runtime/tracing logs                                     | Keep explicit trace fields (mode, policy decision, model, latency, candidates) without recording private chain-of-thought.                                                                                                    | HIGH       |

Stage 0 should **not** adopt LangChain, LangGraph, an OpenAI-specific SDK, or a vector-store framework. Implement the documented runtime pipeline as small typed components and provider ports. Add a provider SDK only with the first real provider integration, behind `LLM_PROVIDER`; CI remains `AGENT_PROVIDER=mock` and does not need an API key.

### Data and Local Infrastructure

| Technology        | Exact local/CI baseline | Purpose                              | Why                                                                                                                                                                                                                                 | Confidence |
| ----------------- | ----------------------: | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| PostgreSQL        |                **18.6** | Transactional source of truth        | Current supported major and patch. PostgreSQL 18 includes native UUIDv7 generation and remains the sole durable store for users, Persona versions, Consent, Relationships, messages, traces, and events.                            | HIGH       |
| pgvector          |               **0.8.6** | Optional vector columns/search       | Current release and supports PostgreSQL 18. Pin `pgvector/pgvector:0.8.6-pg18-bookworm` locally. Create the extension in a migration, but defer HNSW/IVFFlat indexes until embeddings, dimensions, and query patterns are measured. | HIGH       |
| Redis Open Source |               **8.2.8** | Queue/cache/short-lived coordination | Redis 8.2 is an Extended Support line through 2030; 8.2.8 contains July 2026 security fixes. Pin `redis:8.2.8-bookworm`. Enable persistence only if queue recovery requirements justify it.                                         | HIGH       |
| Docker Compose    |       Docker Compose v2 | Local dependencies                   | One checked-in compose file should start PostgreSQL/pgvector and Redis with health checks, named volumes, and non-secret development credentials. Web/API/Agent may run on the host for fast reload.                                | HIGH       |

Do not use pgvector as a shortcut that collapses Memory into Persona. Store evidence and metadata relationally first. Vector search is a retrieval mechanism, not truth, authorization, or a personality inference engine.

## Quality Toolchain

### TypeScript / Web / API

| Tool                |                            Version | Gate                       | Notes                                                                                                                        |
| ------------------- | ---------------------------------: | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| ESLint              |                         **10.9.1** | `pnpm lint`                | Flat config only; shared presets live in `packages/config`.                                                                  |
| `typescript-eslint` |                         **8.68.0** | typed lint rules           | Its `<6.1.0` TypeScript peer range is the reason to pin TS 6.0.3 and reject TS 7 for now.                                    |
| Prettier            |                          **3.9.6** | `pnpm format:check`        | Formatting only; do not duplicate stylistic rules in ESLint.                                                                 |
| Vitest              |                         **4.1.11** | unit + contract tests      | One runner for TS packages, Web, Fastify routes, and Worker logic; supports Vite 8 and Node 24.                              |
| V8 coverage         | **4.1.11** (`@vitest/coverage-v8`) | coverage reporting         | Start with meaningful module thresholds rather than a repository-wide vanity percentage.                                     |
| Testing Library     | **16.3.2** + user-event **14.6.6** | Web behavior tests         | Assert accessible user behavior, not component internals. Use `jsdom@30.0.1`.                                                |
| MSW                 |                         **2.15.0** | Web API mocks              | Mock at HTTP boundaries using shared contract fixtures; avoid mocking implementation modules.                                |
| Playwright          |                         **1.62.1** | minimal E2E smoke          | Stage 0 only: Web boot, Journey shell, mock Agent turn, Persona candidate confirmation path. Do not duplicate unit coverage. |
| Testcontainers      |                         **12.1.0** | DB/Redis integration tests | Use PostgreSQL/Redis modules for migration and repository integration tests where Docker is available.                       |

Use `tsc --noEmit` as the authoritative TypeScript typecheck. Vite transpiles TypeScript but does not replace type checking. Enable at least `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, and project references for buildable packages.

### Python

| Tool           |    Version | Gate                                 | Notes                                                                                                                  |
| -------------- | ---------: | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Ruff           | **0.16.4** | `ruff check` + `ruff format --check` | One linter/import sorter/formatter; do not add Black, isort, and Flake8 in parallel.                                   |
| mypy           |  **2.3.1** | `mypy reso_agent tests`              | Start strict on this greenfield service; use narrow per-module exceptions rather than global `ignore_missing_imports`. |
| pytest         |  **9.1.1** | Python unit/contract/smoke tests     | Test policy/mode/context components independently, then FastAPI endpoints.                                             |
| pytest-asyncio |  **1.4.0** | async service tests                  | Use explicit async mode/configuration. HTTPX ASGI transport covers endpoints without a live server.                    |

Python contract tests should load the exported JSON Schema/OpenAPI fixtures produced from `packages/contracts`, validate representative payloads with Pydantic, and verify both `MockAgentClient` and `ResoAgentClient` return equivalent envelopes.

## CI Baseline

Use GitHub Actions with immutable action versions or commit SHAs. Current suitable majors are `actions/checkout@v6`, `pnpm/setup@v1` (pnpm 11 + Node 24 + cache), and `astral-sh/setup-uv@v9.0.0`/its published SHA. Prefer SHAs with a version comment for third-party actions.

Required jobs, ordered for fast feedback:

1. **Repository policy:** lockfile present, generated contracts not dirty, no secrets, migration naming/ordering checks.
2. **TypeScript static:** `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`.
3. **TypeScript tests/build:** unit + contract tests, then Turbo build; upload coverage/build artifacts only when useful.
4. **Python static:** `uv sync --locked --all-groups`, `uv run ruff format --check`, `uv run ruff check`, `uv run mypy`.
5. **Python tests/eval:** `uv run pytest`, then deterministic `AGENT_PROVIDER=mock` smoke eval.
6. **Integration:** service containers pinned to `pgvector/pgvector:0.8.6-pg18-bookworm` and `redis:8.2.8-bookworm`; apply migrations from zero and run contract/repository tests.
7. **E2E smoke:** only after build/static/unit gates pass; never require `LLM_API_KEY` or a paid call.

Turbo should cache pure tasks (`lint`, `typecheck`, unit tests, builds) with declared inputs/outputs. Do not cache DB integration, E2E, or smoke-eval tasks that depend on services unless their environment is explicitly modeled.

## Installation Blueprint

Exact dependency declarations should be produced through pnpm/uv so both lockfiles are generated, rather than copied blindly from this research file.

```bash
# Root tooling
pnpm add -Dw turbo@2.10.12 typescript@6.0.3 tsx@4.23.12 \
  eslint@10.9.1 @eslint/js@10.0.1 typescript-eslint@8.68.0 prettier@3.9.6 \
  vitest@4.1.11 @vitest/coverage-v8@4.1.11

# Web
pnpm --filter @reso-ai/web add react@19.2.8 react-dom@19.2.8 \
  react-router@8.3.0 @tanstack/react-query@5.102.4 \
  react-hook-form@7.86.0 @hookform/resolvers@5.9.1 zod@4.4.3
pnpm --filter @reso-ai/web add -D vite@8.2.2 @vitejs/plugin-react@6.1.0 \
  @testing-library/react@16.3.2 @testing-library/user-event@14.6.6 \
  jsdom@30.0.1 msw@2.15.0

# Product API / Worker / contracts
pnpm --filter @reso-ai/contracts add zod@4.4.3
pnpm --filter @reso-ai/api add fastify@5.12.1 zod@4.4.3 \
  fastify-type-provider-zod@7.0.0 @fastify/swagger@9.8.1 \
  @fastify/swagger-ui@6.1.1 @fastify/cors@11.3.0 @fastify/helmet@13.1.1 \
  @fastify/sensible@6.0.5 fastify-plugin@6.0.0 pino@10.3.1 \
  drizzle-orm@0.45.2 pg@8.23.1 redis@6.2.1
pnpm --filter @reso-ai/api add -D drizzle-kit@0.31.10 @types/pg@8.23.0
pnpm --filter @reso-ai/worker add bullmq@6.2.2 redis@6.2.1

# Python Agent Service (run inside apps/agent-service)
uv add "fastapi==0.141.1" "uvicorn[standard]==0.52.4" \
  "pydantic==2.13.4" "pydantic-settings==2.15.0" \
  "httpx==0.28.1" "structlog==26.1.0"
uv add --group dev "ruff==0.16.4" "mypy==2.3.1" \
  "pytest==9.1.1" "pytest-asyncio==1.4.0"
```

Package names such as `@reso-ai/web` are recommended internal names; the user-visible brand remains **Reso.AI**, the repository remains `reso-ai`, and the Python package remains `reso_agent`.

## Alternatives Considered and Not Adopted

| Category               | Recommended             | Not adopted now                           | Reason                                                                                                                                                                           |
| ---------------------- | ----------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node runtime           | Node 24 LTS             | Node 26 Current                           | Current releases have a shorter/stability-oriented lifecycle; use the active LTS baseline.                                                                                       |
| TypeScript             | 6.0.3                   | 7.0.2                                     | `typescript-eslint@8.68.0` declares `<6.1.0`; adopting TS 7 would require ignoring peer compatibility or dropping typed lint. Revisit when supported.                            |
| Node API               | Fastify 5               | Express 5.2.1                             | Express is sound but needs separate validation, typed-schema, logging, and serialization conventions. Fastify better enforces Contract First.                                    |
| Full-stack Web         | React + Vite            | Next.js/Remix                             | No Stage 0 SSR/RSC requirement; adding a second server runtime increases coupling and deployment surface.                                                                        |
| Package manager        | pnpm 11                 | npm/Yarn/Bun                              | pnpm has the desired strict workspace semantics and one lockfile; changing package/runtime simultaneously adds avoidable risk.                                                   |
| Monorepo orchestration | Turborepo 2             | Nx/Bazel                                  | Turbo supplies the task graph/cache needed here with less framework and plugin surface. Bazel is far beyond Stage 0 needs.                                                       |
| Contract library       | Zod 4                   | TypeBox or TypeScript interfaces only     | Zod provides runtime validation, inferred TS types, and first-party JSON Schema export. Interfaces alone disappear at runtime.                                                   |
| Database access        | Drizzle + `pg`          | Prisma / raw SQL only                     | Drizzle preserves visible SQL and supports pgvector. Prisma's generated client is heavier; raw SQL alone loses useful schema/query typing. Keep raw SQL available in migrations. |
| Python manager         | uv                      | Poetry/pip-tools/Conda                    | uv gives interpreter management, dependency groups, reproducible locking, and fast CI in one tool. Scientific Conda isolation is not needed.                                     |
| Python lint/format     | Ruff + mypy             | Black + isort + Flake8 + multiple plugins | Ruff consolidates formatting/import/lint work; mypy remains the separate semantic type checker.                                                                                  |
| Queue                  | BullMQ + Redis          | Kafka/RabbitMQ                            | Stage 0 requires bounded background jobs, not a distributed event platform. Preserve `EventEnvelope` so transport can change later.                                              |
| Vector store           | PostgreSQL + pgvector   | Pinecone/Weaviate/Elasticsearch           | Transactional records and vectors can coexist for the first closed loop; a separate vector service adds cost and consistency problems before scale evidence.                     |
| Agent orchestration    | Typed in-house pipeline | LangChain/LangGraph/AutoGen               | The requested Agent modes/policies/commit boundary are domain-specific. Add a framework only after a concrete capability gap is measured.                                        |
| Caching/state          | Redis                   | Redis as primary store                    | Redis is operational infrastructure, never authoritative Persona, Consent, Relationship, or message history.                                                                     |

## Compatibility and Upgrade Watchlist

- **TypeScript 7:** Re-evaluate only after `typescript-eslint` officially supports it and all packages pass typecheck. This is the most immediate version-pressure point.
- **Drizzle pre-1.0:** Pin exact versions, review generated migrations, and test a clean migration on every PR. Never infer production schema from application startup.
- **FastAPI pre-1.0:** Upgrade one minor at a time with endpoint and contract tests; do not separately pin Starlette against FastAPI's resolver guidance.
- **Python 3.14:** Add a non-blocking compatibility job after all actual model/telemetry providers are selected. Promote it only when wheels and integration tests are clean.
- **React/Vite:** Keep React Server Components out of the Vite SPA. Apply React patch releases promptly and preserve Vite's documented browser baseline or explicitly configure `build.target`.
- **pgvector indexing:** Do not choose vector dimensions or HNSW parameters until the embedding provider and measured retrieval workload exist. A table column can be present without an ANN index in Stage 0.
- **Redis durability:** BullMQ reliability depends on Redis persistence and eviction configuration. Use `noeviction` for queue-bearing Redis in production; do not share it casually with unbounded cache keys.

## Sources

### Official runtime/framework documentation

- Node.js release lines and LTS status: https://nodejs.org/en/about/previous-releases
- React versions and 19.2 release: https://react.dev/versions and https://react.dev/blog/2025/10/01/react-19-2
- Vite 8 announcement and Node support: https://vite.dev/blog/announcing-vite8 and https://vite.dev/guide/
- TypeScript 6.0 release notes: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html
- Fastify v5 migration, validation, and type providers: https://fastify.dev/docs/v5.0.x/Guides/Migration-Guide-V5/ , https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/ , https://fastify.dev/docs/latest/Reference/Type-Providers/
- Zod 4 JSON Schema support: https://zod.dev/json-schema
- FastAPI version pinning and testing: https://fastapi.tiangolo.com/deployment/versions/ and https://fastapi.tiangolo.com/tutorial/testing/
- Python support lifecycle and 3.13.15: https://devguide.python.org/versions/ and https://www.python.org/downloads/release/python-31315/
- uv projects/workspaces/locking: https://docs.astral.sh/uv/guides/projects/ , https://docs.astral.sh/uv/concepts/projects/workspaces/ , https://docs.astral.sh/uv/concepts/projects/sync/
- Ruff formatter/linter: https://docs.astral.sh/ruff/formatter/ and https://docs.astral.sh/ruff/linter/

### Official data/tooling documentation

- PostgreSQL releases and PostgreSQL 18: https://www.postgresql.org/docs/release/ and https://www.postgresql.org/docs/18/release-18.html
- pgvector release/tags and capabilities: https://github.com/pgvector/pgvector and https://github.com/pgvector/pgvector/blob/master/CHANGELOG.md
- Redis 8.2 support and 8.2.8 notes: https://redis.io/docs/latest/operate/oss_and_stack/install/version-mgmt/ and https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/release-notes/redisce/redisos-8.2-release-notes/
- pnpm workspaces: https://pnpm.io/workspaces
- pnpm 11 CI action migration: https://github.com/pnpm/action-setup
- Drizzle pgvector and PostgreSQL driver support: https://orm.drizzle.team/docs/extensions and https://orm.drizzle.team/docs/get-started-postgresql
- BullMQ Redis connections/adapters: https://docs.bullmq.io/guide/connections
- Vitest 4 current docs: https://vitest.dev/
- GitHub Actions: https://github.com/actions/checkout , https://github.com/actions/setup-node , https://github.com/astral-sh/setup-uv

### Registry verification

- npm package metadata was checked with `npm view <package> version engines peerDependencies` against https://registry.npmjs.org/ on 2026-08-26.
- Python package versions were checked with `python -m pip index versions <package>` against https://pypi.org/ on 2026-08-26.

## Confidence Notes

| Area                      | Confidence | Basis                                                                                                                                          |
| ------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Node/React/Vite/Fastify   | HIGH       | Official release docs plus live npm metadata and peer ranges.                                                                                  |
| pnpm/Turbo                | HIGH       | Official workspace docs plus live npm versions; conventional fit for this repository shape.                                                    |
| TypeScript 6 pin          | HIGH       | Direct peer-dependency evidence from `typescript-eslint`; TS 7 rejection is compatibility-driven.                                              |
| Python/FastAPI/uv         | HIGH       | Official lifecycle/versioning docs plus live PyPI versions. Python 3.13 is a conservative compatibility choice.                                |
| PostgreSQL/pgvector/Redis | HIGH       | Official August 2026 releases, explicit supported tags, and Redis support policy.                                                              |
| Drizzle                   | MEDIUM     | Official pgvector/driver support is strong, but the library remains pre-1.0; exact pinning and migration tests are mandatory.                  |
| BullMQ                    | MEDIUM     | Appropriate for Stage 0 and current Redis adapters, but production durability/configuration must be revisited with real workload requirements. |
