# Architecture Patterns

**Project:** Reso.AI (`reso-ai`)  
**Domain:** AI Native Relationship Intelligence — Project Bootstrap  
**Researched:** 2026-08-26  
**Overall confidence:** HIGH（产品边界与闭环来自项目规格；基础设施模式由官方文档交叉验证）

## Executive Architecture Decision

本里程碑应采用：

> **一个模块化 Product Backend（API + Worker）作为事实与规则权威，外加一个独立、默认无状态的 Python Agent Service 作为智能计算边界。**

它不是“全微服务”，也不是把 LLM 塞进 Node API。Stage 0 只有两个真正的服务边界：

1. **Product Backend**：Node.js/TypeScript API 加 Backend-owned Worker，共同拥有正式业务状态、事务、授权、规则和事件发布。
2. **Reso Agent Service**：Python/FastAPI，拥有 runtime、prompt、mode、policy、model/tool routing 和候选结果生成；没有业务数据库写权限。

Web 只能调用 Product API。Product API 与 Worker 只能通过 `IAgentClient` 使用 Agent。Agent 的任何输出必须先通过共享 Contract 校验，再由 Product Backend 决定是否保存为 candidate；只有用户动作或确定性业务规则能够把 candidate 提交为正式状态。

这使四条硬边界成为可执行约束，而不是文档口号：

```text
Memory != Persona
Agent != User
Persona != Truth
Agent Suggests, Service Commits
```

## Recommended System Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│ apps/web — React product experience                                 │
│ Journey / Persona review / Agent Chat / Relationships / Profile     │
│ Owns only ephemeral UI state; never owns product truth or secrets   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ public REST, shared contracts
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Product Backend                                                     │
│                                                                     │
│  apps/api — modular monolith                                        │
│  auth/users/journeys/personas/conversations/memory/relationships/   │
│  recommendations/consent + agent-client                             │
│      │                        │                                      │
│      │ transaction            └──── IAgentClient ───────────────┐   │
│      ▼                                                         │   │
│  PostgreSQL + pgvector                                          │   │
│  domain tables + immutable versions + candidate tables          │   │
│  + event_outbox                                                 │   │
│      │                                                         │   │
│      ▼ outbox relay                                             │   │
│  Redis Streams ─────► apps/worker                               │   │
│                       async orchestration, retry, idempotency     │   │
│                       writes domain results through API commands │   │
└─────────────────────────────────────────────────────────────────┼───┘
                                                                  │
                               internal HTTP, shared wire contract │
                                                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ apps/agent-service — FastAPI / reso_agent                           │
│ perception → context → retrieval strategy → mode → policy → plan →  │
│ tools → model → response → reflection/candidates → trace summary    │
│                                                                     │
│ No product DB writes; no formal Persona/Consent/Relationship commit │
└─────────────────────────────────────────────────────────────────────┘

packages/contracts ──► Web, API, Worker, tests, generated wire schemas
packages/design-tokens ──► packages/ui ──► Web
packages/test-fixtures ──► contract/integration/eval tests
evals + agent-lab ──► dev-only Agent experimentation, never prod truth
```

### Why this shape

- **Product facts need one transactional owner.** Persona version acceptance, consent revocation and relationship transitions often update multiple related rows and emit an event. Keeping them in one modular backend and PostgreSQL transaction avoids distributed transactions during Bootstrap.
- **Agent evolution needs an independent release boundary.** Python model libraries, prompts, policy and evals can change without forcing Web or database rules to change.
- **Worker is a process boundary, not a new domain owner.** It removes slow reflection/memory work from HTTP latency while continuing to obey Product API commit rules.
- **Redis is transport, not truth.** Durable domain facts and the canonical event outbox live in PostgreSQL. Redis Streams provides delivery, retry visibility and consumer coordination.
- **Monorepo is for coordination, not shared internals.** Share contracts, UI primitives, configuration and fixtures; do not share domain implementation across Web/API/Agent.

## Monorepo Component Boundaries

| Component                | Responsibility                                                                                                          | May depend on / call                                                                                                            | Must not do                                                                          | Owner                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------ |
| `apps/web`               | Mobile-first product UI, route state, forms, optimistic display                                                         | `packages/contracts`, `packages/ui`, public Product API                                                                         | Call LLM/Agent Service/DB; persist authoritative Persona; invent DTOs                | Frontend                 |
| `apps/api`               | Public REST, auth boundary, domain rules, persistence, consent/disclosure enforcement, `IAgentClient` factory           | contracts/config, PostgreSQL, Redis outbox relay, Agent client                                                                  | Expose prompt/model APIs; let model output bypass validation; import Web code        | Backend                  |
| `apps/worker`            | Consume events, orchestrate slow jobs, retry, dedupe, call Agent, submit validated candidates                           | contracts/config, Redis Streams, `IAgentClient`, internal API commands; DB access only to outbox/consumer bookkeeping if needed | Become a second domain owner; directly create Persona versions or consent            | Backend                  |
| `apps/agent-service`     | Agent runtime, context strategy, memory query/ranking strategy, four modes, policy, tools, model router, bounded traces | generated wire schemas, model providers, Product read/tool ports                                                                | Write domain DB; grant consent; commit relationship/persona; receive browser traffic | Agent                    |
| `apps/agent-lab`         | Local/dev inspection, replay, prompt/model comparison                                                                   | Agent Service and sanitized fixtures/traces                                                                                     | Ship as public production admin; mutate product state                                | Agent                    |
| `packages/contracts`     | Canonical runtime schemas, TS types, API/event schemas, generated cross-language artifacts                              | Minimal schema tooling only                                                                                                     | Import apps, business services, DB clients, React or model SDKs                      | Shared, change by review |
| `packages/ui`            | Accessible visual primitives, no domain behavior                                                                        | design tokens                                                                                                                   | Call APIs; own Journey/Persona rules                                                 | Frontend                 |
| `packages/design-tokens` | Brand color/type/spacing/motion tokens                                                                                  | Nothing app-specific                                                                                                            | Contain feature code                                                                 | Frontend                 |
| `packages/config`        | Shared lint/type/build configuration                                                                                    | Tooling only                                                                                                                    | Contain runtime secrets or domain rules                                              | Platform/shared          |
| `packages/test-fixtures` | Deterministic contract/domain examples, including first closed loop                                                     | contracts                                                                                                                       | Depend on live model/network/time                                                    | Shared                   |
| `database`               | Ordered migrations, schema documentation, seed/test data                                                                | PostgreSQL/pgvector                                                                                                             | Become an ORM/domain implementation package                                          | Backend                  |
| `evals`                  | Versioned datasets, scenarios, graders and reports                                                                      | Agent contracts + sanitized fixtures                                                                                            | Call paid models in default CI; store real private conversations                     | Agent                    |
| `tests/contract`         | Cross-runtime consumer/provider compatibility                                                                           | built artifacts and local stub services                                                                                         | Assert private implementation details                                                | Shared                   |
| `tests/integration`      | Product state transitions, outbox/worker flow                                                                           | API, DB, Redis, mock Agent                                                                                                      | Require real model key                                                               | Backend/shared           |
| `tests/e2e`              | Critical user-visible flow                                                                                              | Web + API + mock Agent                                                                                                          | Cover every branch during Bootstrap                                                  | Shared                   |
| `references/*`           | Independent read-only upstream prototypes and migration evidence                                                        | Their own isolated dependencies/Git history                                                                                      | Join the root workspace or be formatted/rewritten by root tooling                    | Migration-only           |

### Workspace dependency direction

```text
design-tokens ──► ui ──► web
contracts ──────► web
contracts ──────► api
contracts ──────► worker
contracts ──────► test-fixtures ──► tests / evals
contracts ──────► generated JSON Schema/OpenAPI ──► agent-service boundary
config ─────────► TS workspace packages

Forbidden:
web ─X─► api source
api ─X─► web
agent-service ─X─► TypeScript source or Product DB
contracts ─X─► any app
ui ─X─► domain/API code
```

Use explicit workspace dependencies (`workspace:*`) and fail CI on workspace cycles. pnpm documents that the `workspace:` protocol refuses to resolve to a registry package and warns that cycles prevent reliable topological execution; both properties support strict internal dependency direction.

## Product Backend Module Boundaries

`apps/api` should be a **modular monolith** with one-way layers per domain, not a folder of route handlers that import each other arbitrarily:

```text
transport (HTTP/event adapter)
       ↓
application (use cases, transaction orchestration)
       ↓
domain (entities, invariants, state transitions, ports)
       ↓
infrastructure (Postgres/Redis/Agent client adapters)
```

Cross-domain interaction happens through application use cases or domain events, never by importing another module's repository implementation. For Bootstrap, avoid a generic framework-heavy “domain kernel”; a small explicit module is easier to understand and test.

| Backend module  | Owns                                                            | Exposes to other modules                                            |
| --------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| Users/Auth      | user identity and access context                                | stable `userId`, actor context                                      |
| Journeys        | journey sessions, answers, completion                           | completion snapshot/evidence refs, events                           |
| Personas        | profiles, immutable versions, patch candidates, evidence links  | active version read, candidate review/commit commands               |
| Memory          | memories, memory evidence, correction priority, vector metadata | authorized read port and candidate commit command                   |
| Conversations   | conversations and immutable messages                            | ordered history/read snapshot, `message.created`                    |
| Relationships   | relationship records and append-only relationship events        | stage/familiarity/trust snapshot, deterministic transition commands |
| Consent         | grants, revocation, disclosure rules and decisions              | authoritative `ALLOW/DENY/ASK_USER`, policy snapshot                |
| Recommendations | recommendation candidates and user decisions                    | recommendation read/review commands                                 |
| Social          | mission facts, budgets, status and interaction records          | bounded mission snapshot/commit commands                            |
| Agent Client    | provider selection and wire translation                         | `IAgentClient`; no domain persistence                               |

## Data Ownership and Authority

### Ownership matrix

| Data                         | Authoritative owner                                             | Store                                         | Agent access                                                      | Commit rule                                                            |
| ---------------------------- | --------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| User/auth state              | Users/Auth module                                               | PostgreSQL                                    | minimum identity/context refs                                     | deterministic service action                                           |
| Journey and answers          | Journeys module                                                 | PostgreSQL                                    | sanitized completion snapshot                                     | user action through API                                                |
| Persona profile/version      | Personas module                                                 | PostgreSQL                                    | read-only active version snapshot                                 | user-confirmed service transaction only                                |
| Persona patch candidate      | Personas module                                                 | PostgreSQL                                    | Agent proposes payload                                            | Backend validates and stores candidate; user accepts/rejects           |
| Memory                       | Memory module                                                   | PostgreSQL + pgvector column/index            | read through authorized context port; Agent may propose candidate | Backend validates provenance and stores; never auto-convert to Persona |
| Correction memory            | Memory module                                                   | PostgreSQL                                    | included with higher retrieval priority                           | originates from explicit user correction; must preserve provenance     |
| Conversation/messages        | Conversations module                                            | PostgreSQL                                    | context snapshot/read port                                        | API commits user and assistant messages                                |
| Relationship state           | Relationships module                                            | PostgreSQL                                    | read-only snapshot; Agent proposes update candidate               | deterministic service rules/authorized user action                     |
| Consent/disclosure           | Consent module                                                  | PostgreSQL                                    | policy input only                                                 | explicit user grant/revoke; Agent can never override                   |
| Recommendation               | Recommendations module                                          | PostgreSQL                                    | Agent proposes candidate                                          | service policy + bilateral user decision                               |
| Agent prompts/runtime config | Agent Service repository                                        | Git/deployment config                         | native owner                                                      | reviewed Git change, not domain DB mutation                            |
| Agent trace                  | Product Backend trace module; Agent provides allowlisted record | PostgreSQL/telemetry sink                     | creates sanitized trace summary                                   | Backend validates allowlist/retention; never store private CoT         |
| Events                       | originating Product module                                      | PostgreSQL `event_outbox`, then Redis Streams | consumes only necessary events                                    | state + outbox written atomically                                      |
| Browser draft/cache          | Web                                                             | memory/session-local storage                  | none                                                              | explicitly non-authoritative, replaceable                              |

### Agent memory retrieval without Agent owning storage

“Agent 负责 Memory Retrieval”与“Service 负责事实”并不冲突，控制面应拆成两部分：

1. **Agent owns retrieval strategy**：决定查询意图、候选类型、排序、上下文预算和如何使用结果。
2. **Product Backend owns records and access**：执行 tenant/user/consent/disclosure filtering，返回允许读取的 Memory/Persona/Relationship records；Agent 不拿 SQL、数据库连接或跨用户任意查询工具。

Bootstrap 第一闭环优先采用 **API 预组装的 versioned context snapshot**，避免同步 turn 出现 API → Agent → API 的嵌套调用。Stage 2 再加入受限的 Product read/tool port 供多步检索；该 port 只能返回 allowlisted contract，且必须有用户范围、预算和 trace。

## Contract-First Boundary

`packages/contracts` 是跨团队和跨进程 wire contract 的唯一真源，但不能止于 TypeScript interface：

```text
runtime schema (canonical)
   ├── inferred TypeScript types
   ├── JSON Schema / OpenAPI artifacts
   ├── API request/response validators
   ├── EventEnvelope validators
   └── Python boundary models generated/verified from artifacts
```

推荐规则：

- Contract 名称使用业务意图，例如 `AgentTurnRequest`，不暴露 prompt/model provider。
- Transport DTO 与 committed entity 分开；`MemoryCandidate` 不能与 `Memory` 共用可误赋值的形状。
- 所有 contract 有显式版本；breaking change 新增版本，不能原地改坏消费者。
- API 入站、Agent client 出站/入站、Worker 事件消费都做运行时解析。
- Python 可以有 Pydantic boundary model，但其来源/兼容性必须由生成 artifact 和 contract tests 约束，禁止另创 Persona schema。
- CI 用同一组 golden fixtures 验证 Web/API/Mock/ResoAgent stub/Python endpoint。

OpenAPI 3.1 提供 JSON Schema dialect，可作为 TS runtime schemas 与 Python HTTP boundary 之间的语言中立产物；但代码生成不是业务真源，生成文件必须单向产生且禁止手工编辑。

## Synchronous Calls vs Events

### Use synchronous REST when

- 用户正在等待直接结果：health、读取状态、提交 Persona 编辑/接受、普通 Agent turn。
- 调用必须立即返回明确成功/失败，并且没有后续多消费者工作。
- Product API 需要在响应前执行确定性授权和 contract validation。

### Use events/worker when

- 工作可延迟：Memory extraction、Reflection、Persona patch suggestion、embedding、eval、后续 social job。
- 一个已提交事实需要触发零个或多个独立消费者。
- 模型延迟/重试不应占住用户请求。

不要使用 FastAPI 进程内 `BackgroundTasks` 承担关键 Memory/Reflection 工作。FastAPI 官方说明它适合响应后的小型任务；Reso.AI 的关键异步工作需要跨进程重试、pending inspection 和恢复，因此应由 Redis Streams + Worker 执行。

## Event Architecture

### Delivery path

```text
API application use case
   ↓ one PostgreSQL transaction
domain state change + event_outbox row
   ↓ after commit
outbox relay
   ↓ XADD
Redis Stream
   ↓ XREADGROUP
Worker handler
   ↓ idempotency check by event.id + handler name
Agent call / deterministic work
   ↓
internal Product API command validates and commits candidate
   ↓
XACK only after durable success
```

Do not perform `COMMIT PostgreSQL` followed by a best-effort `XADD`; that is a dual write and can lose an event during the gap. A transactional outbox writes state and event in one DB transaction, then a relay publishes committed events. AWS official guidance also requires idempotent consumers because at-least-once delivery may duplicate messages.

Redis Streams is preferred over Pub/Sub for this stage because Streams provides persisted entries, consumer groups, pending entries and explicit acknowledgment. It is still not the system of record: stream retention may be capped after outbox publication/processing state is durable.

### EventEnvelope minimum

```typescript
type EventEnvelope<TType extends string, TPayload> = {
  id: string; // UUID, global dedupe key
  type: TType; // e.g. "message.created"
  version: number; // payload schema version
  occurredAt: string; // RFC 3339 UTC
  producer: "api" | "worker";
  subject: { type: string; id: string; version?: number };
  actor?: { type: "user" | "service" | "agent"; id: string };
  correlationId: string; // whole user/job flow
  causationId?: string; // prior command/event
  payload: TPayload; // minimum necessary data or record refs
};
```

Events should carry IDs, versions and minimum necessary context, not full private prompts or entire conversation histories. Consumers load current authorized records when needed and reject stale aggregate versions. Every handler persists `event.id + handler` before acknowledging; retries must be safe.

### Initial consumers

| Event                                 | Consumer                         | Output                                                        |
| ------------------------------------- | -------------------------------- | ------------------------------------------------------------- |
| `journey.completed`                   | persona initialization job       | `PersonaDraftCandidate` submitted to Personas module          |
| `message.created` (user)              | memory/reflection job            | `MemoryCandidate`, optional reflection artifact               |
| `persona.created` / `persona.updated` | embedding/context projection job | updated non-authoritative retrieval projection                |
| `consent.revoked`                     | policy/cache invalidation job    | invalidate context/tool authorization; stop queued proxy work |
| `social_mission.created`              | future social orchestrator       | bounded result only; out of Bootstrap execution scope         |

## Agent / Service Isolation Contract

### Reso Agent Service owns

- identity/prompt assembly and prompt version references;
- perception and context-budgeting strategy;
- Companion/Mirror/Preprocessor/Proxy mode routing;
- relational strategy, model/tool routing and bounded planning;
- policy evaluation implementation using authoritative consent/disclosure input;
- response, reflection, Memory/Persona/Relationship candidates;
- allowlisted trace summary and eval result.

### Product Backend owns

- authentication, user/agent identity binding and tenant scope;
- authoritative Persona, Memory, Conversation, Relationship, Recommendation and Consent records;
- candidate lifecycle and all committed state transitions;
- disclosure facts, budgets, stop conditions and revocation enforcement;
- database transactions, outbox and audit retention;
- whether an Agent suggestion is accepted, rejected, queued or discarded.

### Hard technical controls

- Agent Service deployment receives **no Product PostgreSQL credentials** and no unrestricted Redis credentials.
- Browser receives no Agent Service URL intended for direct use and never receives an LLM key.
- Agent endpoints are internal, intent-based `/v1/...` routes; model and prompt names remain internal metadata.
- Every Agent response is untrusted input: validate schema, size, enum, referenced IDs, user scope and confidence before persistence.
- Proxy requires a fresh authoritative consent/disclosure snapshot, budget and stop conditions; revocation fails closed.
- Timeouts/cancellation propagate API → client → Agent/model. Retries require idempotency keys and are limited by budget.
- Trace is allowlist-based and excludes provider raw request, secrets and private Chain-of-Thought.
- Agent Lab is disabled from public production routing and uses sanitized data.

## Mock → Real Agent Switching

Only Product Backend composition roots know the provider:

```typescript
interface IAgentClient {
  turn(request: AgentTurnRequest): Promise<AgentTurnResponse>;
  reflect(request: AgentReflectRequest): Promise<AgentReflectResponse>;
  initializePersona(request: PersonaInitializeRequest): Promise<PersonaInitializeResponse>;
  suggestPersonaPatch(request: PersonaPatchSuggestionRequest): Promise<PersonaPatchSuggestionResponse>;
  runSocialAction(request: SocialActionRequest): Promise<SocialActionResponse>;
  evaluateSocialInteraction(request: SocialEvaluationRequest): Promise<SocialEvaluationResponse>;
}

AGENT_PROVIDER=mock       -> MockAgentClient
AGENT_PROVIDER=reso-agent -> ResoAgentClient (HTTP to agent-service)
```

### Required parity rules

| Concern             | Mock                                              | Real                                     | Required invariant                         |
| ------------------- | ------------------------------------------------- | ---------------------------------------- | ------------------------------------------ |
| Wire shape          | builds deterministic fixture then parses contract | parses HTTP response contract            | identical success shape                    |
| IDs/time            | injected deterministic factories                  | service/API generated, validated         | valid format and provenance                |
| Error model         | simulates timeout/unavailable/invalid response    | maps HTTP/network errors                 | same typed error taxonomy                  |
| Candidate semantics | never commits                                     | never commits                            | candidates only                            |
| Trace metadata      | `provider=mock`                                   | `provider=reso-agent`                    | provider visible without leaking internals |
| CI                  | no network/model key                              | local stub FastAPI server, no paid model | same parameterized contract suite          |

Switching provider must not change Web routes, API response shape, database commit logic or events. Do not silently fall back from real to mock in production: a plausible fake relationship response is more dangerous than an explicit unavailable state. Provider selection is startup configuration; invalid values fail fast.

## First Closed Loop Data Flow

The first vertical slice should prove data authority, not model sophistication:

```text
1. Web POST Journey choices
   -> API validates and stores journeys/journey_answers
   -> state + journey.choice_made outbox atomically

2. Web completes Journey
   -> API commits journey.completed
   -> Worker consumes event
   -> IAgentClient.initializePersona(completion snapshot)
   -> Agent returns PersonaDraftCandidate + evidence refs/confidence
   -> Worker submits candidate to Personas API command

3. Web loads draft, user edits and confirms
   -> API validates evidence/user ownership
   -> transaction creates persona_profile + immutable persona_version V1
   -> binds/creates agent identity
   -> emits persona.created (and agent.created if contract includes it)

4. Web sends Agent chat message
   -> API transaction stores user message + message.created outbox
   -> API builds versioned context snapshot (Persona V1 + authorized memory + relationship)
   -> IAgentClient.turn(snapshot, message)
   -> Agent policy/mode returns assistant message and trace summary
   -> API validates and stores assistant message

5. Worker consumes user message.created
   -> loads authorized conversation snapshot through Product read port
   -> calls reflect()/suggestPersonaPatch()
   -> submits MemoryCandidate and PersonaPatchCandidate
   -> API persists candidates only; active Persona remains V1

6. Web shows proposed patch with reason/evidence/confidence
   -> user accepts using expected fromVersion=1
   -> API transaction marks candidate accepted,
      creates immutable Persona V1.1, updates active pointer,
      writes persona.updated outbox

7. Next turn references Persona V1.1
   -> trace records persona_version_id, retrieved memory IDs,
      mode, policy decision, tools, model, latency, output and candidates
```

### Critical invariants to test

1. Rejecting the patch leaves active Persona at V1 and records `rejected`.
2. Accepting against a stale `fromVersion` returns a conflict and does not fork history silently.
3. A `MemoryCandidate` can never be assigned where a `PersonaVersion` is expected.
4. Agent/Worker database credentials cannot create a Persona version.
5. Replaying `message.created` does not create duplicate memories or candidates.
6. Switching Mock to local Agent stub produces the same API contract.
7. A correction memory that rejects “slow to warm up” appears in the next authorized context and suppresses the rejected simplification fixture.

## Existing-code migration status

The final repository audit found two independent Git repositories under `references/`: `Reso-AI-upstream` contains the vanilla Vite Journey/world implementation, Personal Manual/evidence behavior, tests and art assets; `Reso.Ai` contains a Next.js + FastAPI product prototype with Agent, Consent, Plaza and Human Relationship flows. Both remain read-only migration sources, are excluded from the root workspace/tooling, and must be absorbed through explicit adapters and behavior tests rather than copied wholesale.

## Build and Implementation Order

Architecture dependencies imply this order:

1. **Audit and quarantine reference code** — inventory reusable Journey/Persona/Consent behavior, tests and assets while keeping both nested Git worktrees clean.
2. **Root workspace and quality baseline** — pnpm workspace, TS/Python tooling, root commands; no domain feature yet.
3. **Contracts and generated artifacts** — core domain schemas, candidates, events and API errors; add golden fixtures and cross-language generation/validation.
4. **Database foundation** — ordered migrations, constraints, candidate/version separation, outbox and least-privilege roles.
5. **Product API modular skeleton** — health, modules, application/port/adapters, transaction boundary; no real model calls.
6. **`IAgentClient` + deterministic Mock** — parameterized provider tests and failure simulation.
7. **Agent Service skeleton** — six intent endpoints, runtime stages, policy/modes/prompts/tracing; return contract-valid stub behavior.
8. **Real HTTP adapter** — `ResoAgentClient` against local FastAPI stub; prove Mock/Real parity before adding an LLM.
9. **Outbox, Redis Streams and Worker** — idempotency, retry, pending inspection, candidate submission through Product commands.
10. **Web mobile shell** — consume generated client/contracts; Welcome/Journey/Persona/Chat/Patch Review placeholders.
11. **First closed-loop slice** — deterministic fixture from Journey to Persona V1.1, including reject/stale/replay tests.
12. **CI, docs and migration of one upstream Journey slice** — only then port additional assets/behavior.

The key gate is Step 3: Web, DB, API and Agent skeletons must not invent shapes before contracts exist. The second gate is Step 8: no real model integration until provider parity and deterministic error behavior are proven.

## Patterns to Follow

### 1. Candidate → Review → Commit

**What:** All probabilistic outputs are candidates with provenance, confidence and lifecycle state.  
**When:** Persona, Memory interpretation, Relationship observation and Recommendation.  
**Result:** Model reasoning is correctable without silently changing product truth.

```text
Agent output
  -> runtime contract validation
  -> Product policy + reference validation
  -> candidate(pending)
  -> user/service review
  -> accepted/rejected/superseded
  -> immutable committed version/event (only if accepted)
```

### 2. Versioned context snapshot

**What:** Every Agent call receives stable IDs/versions for Persona, memories and relationship state.  
**When:** All turn/reflection/social calls.  
**Result:** A trace can explain what the Agent knew, and concurrent Persona changes do not rewrite history.

### 3. Ports and adapters at volatile boundaries

**What:** `IAgentClient`, event bus, clock/ID factories, model router and context read ports are interfaces with Mock/local/real adapters.  
**When:** External services, nondeterminism or infrastructure can vary.  
**Result:** CI stays deterministic and provider replacement stays local.

### 4. Immutable history + active pointer

**What:** Persona versions, messages, relationship events and consent events are append-oriented; mutable profile rows point to the active/latest state.  
**When:** User-visible evolution and authorization changes.  
**Result:** Correction, rollback, audit and causal trace remain possible.

### 5. Least-privilege tool ports

**What:** Agent tools express a narrow intent (`get_authorized_memories`, `submit_candidate`) rather than exposing SQL or generic HTTP.  
**When:** Stage 2 retrieval and Stage 3 Proxy.  
**Result:** Consent/disclosure/user scope can be enforced centrally and evaluated.

## Anti-Patterns to Avoid

### Distributed monolith

**What:** API and Agent Service import each other's source/types or require coordinated deploys.  
**Why bad:** It gains network failures without team independence.  
**Instead:** Language-neutral versioned wire contracts and consumer/provider tests.

### Shared database “because monorepo”

**What:** Agent connects to Product tables or Worker writes arbitrary domain rows.  
**Why bad:** Ownership becomes unenforceable; generated output can mutate facts.  
**Instead:** restricted read/tool ports and Product commands; separate DB roles.

### Event-driven everything

**What:** Even simple reads and user confirmations become opaque async workflows.  
**Why bad:** Debugging and user feedback become harder with no scale benefit.  
**Instead:** synchronous REST for direct commands/queries, events for committed facts and slow fan-out.

### Redis as the source of truth

**What:** Queue payload is the only copy of a Memory/Persona change.  
**Why bad:** retention, retry and eviction can lose business history.  
**Instead:** PostgreSQL truth/outbox; Redis only delivery/cache.

### One giant `AgentTurnResponse`

**What:** response mixes user text, hidden reasoning, committed persona fields and arbitrary tool output.  
**Why bad:** privacy leaks and accidental commits become likely.  
**Instead:** explicit `message`, allowlisted `trace`, typed candidates and policy decision sections.

### Silent real → mock fallback

**What:** production Agent outage returns a convincing fixture response.  
**Why bad:** users cannot distinguish authentic behavior and generated test behavior.  
**Instead:** explicit typed unavailable/degraded state; Mock only under deliberate configuration.

## Scalability and Evolution

| Concern          | Bootstrap / ~100 users                          | ~10K users                                                                             | ~1M users / research trigger                                             |
| ---------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Product API      | one modular service instance                    | horizontal replicas; stateless HTTP                                                    | split a module only on measured team/load boundary                       |
| PostgreSQL       | one primary, migrations, indexes                | pooling, read replicas for heavy reads, partition large event/trace tables if measured | revisit sharding/managed scaling; preserve service ownership             |
| Vector retrieval | pgvector schema + small exact/approx fixture    | tune index/filters with recall eval                                                    | consider dedicated retrieval only if pgvector SLO/quality fails          |
| Events           | one outbox relay + Redis Stream consumer groups | scale consumers; monitor pending/lag/DLQ                                               | reassess broker only when retention/throughput/replay needs exceed Redis |
| Agent Service    | one/few stateless replicas, Mock default        | autoscale by latency/concurrency; provider budgets                                     | model routing/caching/regional privacy require phase research            |
| Trace/eval       | allowlisted relational rows + local reports     | retention tiers and sampled payloads                                                   | separate telemetry store only after volume/compliance evidence           |
| Contracts        | one current version + compatibility tests       | additive versions/deprecation window                                                   | formal schema registry if independent deploy cadence requires it         |

Do not pre-design the 1M-user architecture. The important Bootstrap property is that truth, transport and intelligence are already separated, so later scaling does not require changing product semantics.

## Failure Semantics and Observability

| Failure                            | User/system behavior                                                                   | Must record                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Agent timeout/unavailable          | typed retryable error; committed user message remains; async job retries within budget | correlation/causation IDs, endpoint, timeout class, no secret/raw prompt |
| Agent invalid contract             | reject response, no candidate commit, contract failure metric                          | schema version, safe validation path, provider/version                   |
| Redis unavailable after DB commit  | outbox remains pending; relay retries                                                  | outbox age/attempts                                                      |
| Duplicate event                    | idempotency record returns prior success; acknowledge                                  | event ID, handler, prior result ref                                      |
| Stale Persona patch                | `409` conflict or `superseded`; never overwrite active version                         | candidate/from/current versions                                          |
| Consent revoked during queued work | re-check before tool/action/commit; stop and mark denied                               | consent version, policy decision, stop reason                            |

Minimum observability uses the same `correlationId` from browser/API through outbox, worker and Agent trace. Metrics should include API latency/errors, Agent latency/contract failures, outbox age, Redis consumer lag/pending, worker retries, candidate accept/reject/supersede and policy denials. Content logging remains opt-in/allowlisted because conversations and memories are sensitive.

## Security and Privacy Boundary

- Treat Persona, Memory, Conversation and Relationship data as sensitive from the first migration; add explicit retention/deletion design before real users.
- Service-to-service credentials are distinct from browser auth; Agent gets only narrowly scoped internal access.
- Consent/disclosure is evaluated at read time and again immediately before Proxy/tool execution; cached authorization cannot outlive revocation.
- `L0`–`L5` is a domain classification, not by itself authorization. A policy decision also needs purpose, recipient, active grant, budget and stop conditions.
- Database foreign keys/checks enforce referential and lifecycle invariants in addition to application validation. PostgreSQL official documentation confirms constraints reject invalid data regardless of application source.
- pgvector stays in PostgreSQL under Memory module ownership; embeddings are derived indexes, never substitutes for original evidence/provenance.

## Roadmap Implications

1. **Foundation contracts before applications** — contract artifacts and fixtures unblock all three teams and prevent schema drift.
2. **Backend truth before Agent intelligence** — Persona version/candidate/consent invariants must exist before real reflection or Proxy work.
3. **Mock parity before model quality** — prove the integration seam, then improve intelligence behind it.
4. **First closed loop before World/Social** — validate Journey → correction → Persona evolution; Social would multiply privacy and state complexity prematurely.
5. **Retrieval/eval together in Stage 2** — do not optimize pgvector retrieval without datasets measuring meaningful recall, false recall and correction priority.
6. **Consent/disclosure implementation before Stage 3 Proxy** — enums and schemas are insufficient authorization.

### Phase research flags

| Future phase               | Research need | Reason                                                                                               |
| -------------------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| Stage 1 First Closed Loop  | MEDIUM        | optimistic Persona concurrency, deletion/retention and user correction UX need decisions             |
| Stage 2 Memory/Retrieval   | HIGH          | ranking, correction priority, embedding model, recall eval and privacy deletion are quality-critical |
| Stage 3 Social/Proxy       | VERY HIGH     | bilateral consent, disclosure, budget, abuse controls, legal/privacy and bounded orchestration       |
| Stage 4 Human Relationship | VERY HIGH     | safety, moderation, relationship state semantics and jurisdictional obligations                      |

## Confidence Assessment

| Area                               | Confidence | Notes                                                                                                  |
| ---------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| Service boundaries                 | HIGH       | Directly mandated by project principles and implementable with process/credential controls             |
| Monorepo dependency direction      | HIGH       | Standard workspace boundaries; official pnpm behavior supports explicit local links/cycle prevention   |
| Data ownership                     | HIGH       | Derived directly from “Agent Suggests, Service Commits” and first closed-loop invariants               |
| Event/outbox design                | HIGH       | Official AWS guidance verifies dual-write risk/outbox/idempotency; Redis docs verify Streams semantics |
| Cross-language contract generation | MEDIUM     | OpenAPI/JSON Schema is sound; exact generator/tooling must be validated by Stack implementation        |
| Existing-code migration            | MEDIUM-HIGH | Two runnable prototypes, 106 tests and 98 image assets are present; license/provenance and adapter cost still require per-slice review |
| 10K/1M scaling                     | LOW–MEDIUM | Presented as trigger-based evolution, not capacity promise; no workload measurements exist             |

## Sources

### Primary project evidence — HIGH confidence

- [`../PROJECT.md`](../PROJECT.md) — current milestone, stack, boundaries, First Closed Loop and explicit out-of-scope constraints.
- User-provided 《Reso.AI / reso-ai 项目初始化 Prompt》 — target tree, runtime pipeline, ownership, event list, Mock/Real methods and execution order.

### External authoritative sources

- [pnpm Workspace documentation](https://pnpm.io/workspaces) — built-in monorepo support, `workspace:` protocol, shared lockfile and cycle behavior. **Confidence: HIGH**
- [FastAPI Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/) — response-after background task capability; used here to distinguish small in-process tasks from durable cross-process jobs. **Confidence: HIGH**
- [Redis Streams documentation](https://redis.io/docs/latest/develop/data-types/streams/) — append-only stream, consumer groups, pending entries and explicit acknowledgment. **Confidence: HIGH**
- [Redis streaming use case](https://redis.io/docs/latest/develop/use-cases/streaming/) — persistence/replay/consumer tracking compared with Pub/Sub and at-least-once consumer behavior. **Confidence: HIGH**
- [AWS Transactional Outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) — dual-write failure, state + outbox atomicity, duplicate delivery and idempotent consumer guidance. **Confidence: HIGH**
- [PostgreSQL Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) — database-enforced check, uniqueness, primary/foreign-key constraints. **Confidence: HIGH**
- [PostgreSQL Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html) — transaction/concurrency semantics supporting versioned service commits. **Confidence: HIGH**
- [pgvector official repository](https://github.com/pgvector/pgvector) — vector similarity inside PostgreSQL, supporting a single truth store during early stages. **Confidence: HIGH**
- [OpenAPI 3.1 JSON Schema dialect](https://spec.openapis.org/oas/3.1/dialect/2024-11-10.html) — language-neutral schema basis for TS/Python HTTP boundary artifacts. **Confidence: HIGH**

## Gaps to Address

- Authentication and service-to-service authorization are intentionally skeletal; design before any public beta or real sensitive data.
- Data retention, export, deletion propagation into embeddings/traces/backups and target-jurisdiction privacy obligations need dedicated research.
- The exact TS runtime-schema → OpenAPI/JSON Schema → Pydantic toolchain should be proven with a small spike; do not assume every JSON Schema feature maps losslessly.
- Whether Persona initialization should remain fully asynchronous or offer a bounded synchronous fast path needs Stage 1 latency/product validation.
- Upstream content/assets appear reusable, but licensing/provenance and the cost of porting DOM/game code to React need a separate migration audit.
- Redis Stream retention, dead-letter representation and outbox relay implementation need concrete operational defaults in the implementation plan.
- Relationship trust/familiarity semantics and transitions are not yet defined; keep them explicit domain values rather than LLM-controlled scores until researched.
