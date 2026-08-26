# Project Research Summary

**Project:** Reso.AI (`reso-ai`)  
**Domain:** AI Native Relationship Intelligence — Stage 0 Foundation / Project Bootstrap  
**Researched:** 2026-08-26  
**Confidence:** MEDIUM-HIGH

## Executive Summary

Reso.AI 当前里程碑不是交付完整社交产品，而是建立一个可运行、可替换、可测试的 Foundation，并用一条确定性的 First Closed Loop 证明最关键的产品语义：Journey 形成可解释的 Persona Draft，用户确认 Persona V1，Agent 对话只产生 Memory/Reflection/Persona Patch Candidate，只有用户接受后 Product Backend 才提交不可变的 Persona V1.1。专家级实现应把“智能计算”和“业务事实”彻底分开：Web 只访问 Product API；Node.js Product Backend 独占正式状态、事务、授权与事件；Python Agent Service 只生成候选结果，且没有产品数据库写权限。

推荐以 Node.js 24 LTS、pnpm 11、Turborepo 2、TypeScript 6、React 19 + Vite 8、Fastify 5、Zod 4 为 TypeScript 主线，以 Python 3.13 + uv + FastAPI/Pydantic 为 Agent 边界，以 PostgreSQL 18 + pgvector 为唯一持久事实源、Redis 8/BullMQ 或 Redis Streams 为异步传输。所有跨语言与跨进程边界都由运行时 Contract、版本化事件和 golden fixtures 约束；CI 默认使用确定性 Mock，不依赖模型密钥或付费调用。

最大的风险不是模型能力不足，而是边界失守：Agent 直接提交事实、Memory 与 Persona 混同、只写 TypeScript interface 而缺少运行时校验、Mock/Real 漂移、异步双写丢事件，以及 trace 泄漏敏感数据或私有 Chain-of-Thought。路线图必须按“工作区与规范 → 契约 → 数据权威 → Mock/服务边界 → 异步接缝与 Web → 闭环验证”的依赖顺序推进。最终审计确认 `references/` 中有两套独立 Git 原型，包含 Journey、Persona、Consent、World、测试与美术资产；它们应作为只读行为/迁移证据，按纵切审计来源和适配成本，不能整包并入新 workspace。

## Key Findings

### Recommended Stack

Foundation 采用一个 TypeScript monorepo 协调 Web、Product API、Worker 与共享包；Python Agent Service 同仓但由 uv 独立锁定依赖。版本应写入工具链文件、manifest、lockfile、CI action 与容器镜像，应用依赖可使用兼容范围，但安装结果必须由 `pnpm-lock.yaml` 和 `uv.lock` 决定。Drizzle、BullMQ、FastAPI 等 pre-1.0 或运行条件敏感组件要精确 pin 并通过 migration、contract 和 smoke test 升级。

**Core technologies:**

- **Node.js 24 LTS + pnpm 11 + Turborepo 2**：统一 TypeScript 工作区、任务图与可重复构建；Python 仅通过根脚本参与编排，不作为 npm workspace。
- **TypeScript 6.0 + Zod 4**：严格类型与运行时 schema 的共同真源；导出 JSON Schema/OpenAPI 给 Python 校验，避免双份手写 DTO。
- **React 19 + Vite 8 + React Router/TanStack Query**：构建 mobile-first SPA；不引入 Next.js、RSC 或无证据的全局状态库。
- **Fastify 5 + Drizzle + `pg`**：Product API 的 schema 驱动 REST、模块化领域服务、可审查 SQL migration 与事务边界。
- **Python 3.13 + uv + FastAPI/Pydantic**：独立 Agent Service；运行时、mode、policy、prompt、provider/tool routing 可独立演进。
- **PostgreSQL 18 + pgvector 0.8.6**：唯一持久事实源；向量只是派生检索索引，不是真相、授权或 Persona 推断引擎。
- **Redis 8.2 + BullMQ/Redis Streams**：队列、重试、缓存和短期协调；不得保存唯一业务事实。
- **Vitest/Testing Library/MSW/Playwright、pytest/Ruff/mypy**：本地与 CI 的静态、单元、契约、集成和最小 E2E 门禁；CI 永远可在 Mock 模式免费运行。

关键版本约束：Node 使用 24 LTS 而非 Current；TypeScript 固定在 `6.0.3` 以满足 `typescript-eslint` 的 `<6.1.0` peer 范围；Python 使用 3.13 而非立即升级 3.14；PostgreSQL/pgvector/Redis 容器使用精确 patch tag。具体版本与升级观察项见 [STACK.md](./STACK.md)。

### Expected Features

**Must have (Foundation table stakes):**

- 根仓库与两套 reference 原型审计、目标目录、ownership、scoped `AGENTS.md`、README/ADR/贡献规范与统一 Definition of Done。
- 可执行的根级 install/dev/build/format/lint/typecheck/test 命令，以及 committed lockfiles 和 deterministic CI。
- 覆盖 User、Journey、Persona、Agent、Memory、Conversation、Relationship、Recommendation、Consent/Social 等领域的运行时 Contract、稳定错误 envelope、版本化 `EventEnvelope` 和跨语言生成物。
- consumer/provider contract tests；`MockAgentClient`、`ResoAgentClient` 与本地 Agent stub 的相同成功/失败语义。
- Product API 模块化骨架、PostgreSQL migration/schema/seed/fixture、不可变 Persona version、candidate 状态机、outbox 与最小权限角色。
- 独立 FastAPI Agent Service 的六个意图端点与 perception → context → mode → policy → plan/tools/model → candidate/trace 的 typed pipeline 骨架。
- Worker/event 接缝、幂等/retry 约定、trace allowlist、Consent/Disclosure contract、环境变量与 secret/logging 基线。
- Welcome、Journey、Persona、Agent Chat、Patch Review 的 mobile-first Web shell，真实消费共享 client/contracts。
- 一条自动化 First Closed Loop：Journey fixture → Persona V1 → mock turn → Memory/Reflection/Patch Candidate → accept/reject/stale/replay → Persona V1.1。

**Should have (next competitive capabilities):**

- 可解释、可编辑、版本化且带 evidence/confidence 的 Living Persona。
- `Memory != Persona` 的候选与确认流水线，以及 Correction Memory 回归行为。
- Companion、Mirror、Preprocessor、Proxy 四种 mode 的明确 policy/eval 边界。
- 用户可治理的 Consent/Disclosure、可撤销授权与 bounded Agent action。
- Trace + Eval 驱动的 Persona Fidelity、Boundary Compliance、Scaffold Behavior 等质量演进。
- Relationship Memory/Timeline 与帮助用户走向真人关系的 scaffold，而不是优化 AI 聊天依赖。

**Defer (v2+ / measured need only):**

- 完整 World/Plaza、推荐系统、Agent-to-Agent Social Mission 执行与 Human Relationship 产品化。
- 生产级长期向量检索、ANN 参数优化或独立向量数据库；必须先有 Stage 2 数据集与 recall/privacy eval。
- Proxy Mode 执行；必须先实现 Consent、Disclosure、Budget、Stop Conditions、审计与撤销。
- 生产级 Auth/Payment/复杂 RBAC、完整流式/多媒体聊天、Kubernetes/Kafka/Neo4j/Pinecone/Elastic。
- 未经 eval 基线约束的 prompt/model 优化，或默认 CI 中的真实付费模型调用。
- 任何尚未完成输入审计的所谓“上游资产迁移”。

详见 [FEATURES.md](./FEATURES.md)。

### Architecture Approach

采用“模块化 Product Backend + 独立无状态 Agent Service”，而非全微服务或把 LLM 嵌入 API。同步 REST 处理用户等待的读取、确认和普通 Agent turn；PostgreSQL transaction + outbox + Redis Stream/Worker 处理 Memory extraction、Reflection、embedding 和后续 fan-out。共享仅限 contracts、config、UI primitives、design tokens 与 deterministic fixtures；各应用不得共享业务实现或数据库权限。

**Major components:**

1. **`apps/web`** — mobile-first 产品界面与临时 UI 状态；只调用 public Product API，不接触 Agent/DB/模型密钥。
2. **`apps/api`** — 模块化事实权威；拥有领域规则、授权、事务、持久化、candidate lifecycle、outbox 与 `IAgentClient` composition root。
3. **`apps/worker`** — 消费 committed events、重试与去重、调用 Agent 并通过 Product commands 提交 candidate；不是第二个领域 owner。
4. **`apps/agent-service`** — runtime、mode、policy、model/tool routing、候选生成和 allowlisted trace；无产品 DB 写权限且不接收浏览器流量。
5. **`packages/contracts`** — Zod runtime schemas、TS types、API/event schemas、版本化错误与生成的语言中立 artifacts；不可依赖应用层。
6. **PostgreSQL + pgvector** — authoritative records、immutable history、active pointers 与 transactional outbox；embedding 仅为派生 projection。
7. **Redis + Worker transport** — at-least-once delivery、pending、retry 与协调；handler 用 `event.id + handler` 幂等，durable success 后才 ACK。
8. **tests/evals/fixtures** — Mock/Real parity、跨语言 contract、迁移、闭环和安全边界的可重复证据。

**Required patterns:** Candidate → Review → Commit；versioned context snapshot；ports/adapters；immutable history + active pointer；transactional outbox + idempotent consumer；least-privilege Product read/tool ports；trace allowlist。详细边界见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

### Critical Pitfalls

1. **Agent 成为事实拥有者** — Agent 只输出 typed candidate；Product API 校验、授权并提交，部署层不给 Agent 产品数据库写凭证。
2. **Memory 与 Persona 混同** — 分表、分模块、分 contract；必须经过 Evidence → Patch Candidate → User Review → immutable Persona Version，Correction Memory 保留来源并优先检索。
3. **“共享类型”但无运行时契约** — 用 Zod/Pydantic 在 HTTP、event、Mock 和真实 adapter 每个边界解析，golden fixtures 同时验证 consumer/provider。
4. **Mock 与真实 Agent 漂移或静默降级** — 两者实现同一 `IAgentClient` 和错误 taxonomy；真实服务异常返回明确 degraded/unavailable，生产不得伪装成 Mock 成功。
5. **数据库与 Redis 双写/重复消费** — 状态与 outbox 在一个 PostgreSQL transaction 提交；consumer 幂等、成功持久化后 ACK；Redis 永远不是唯一事实源。
6. **Trace 泄露敏感内容或 Chain-of-Thought** — 仅记录引用、版本、mode、policy、tool、provider/model、latency、output/candidate ID 等 allowlist 字段，默认脱敏并设计保留/删除策略。
7. **Foundation 过度平台化或范围膨胀** — 拒绝 Kafka/Kubernetes/多数据库/完整 World/Social；只建设支撑第一闭环的最小稳定边界。
8. **无边界复用旧资产/代码** — 两套 reference 原型可提供行为、测试和资产证据，但必须保持 nested Git 干净，逐项检查来源、许可、旧 DTO/状态耦合和迁移成本。

详见 [PITFALLS.md](./PITFALLS.md)。

## Implications for Roadmap

### Phase 1: Workspace, Governance and Quality Baseline

**Rationale:** 所有后续组件依赖统一目录、版本、命令与 ownership；先消除“已有资产/可迁移代码”的错误假设。  
**Delivers:** pnpm/Turbo 与 uv 工作区、精确工具链版本、根命令、基础目录、scoped `AGENTS.md`、README/ADR/PR/DoD、Docker Compose、format/lint/typecheck/test 骨架。  
**Addresses:** 根仓库/reference 审计、单仓多包、一套根命令、贡献规范。  
**Avoids:** 虚构上游资产、仓库规范漂移、Bootstrap 过度平台化。

### Phase 2: Runtime Contracts and Data Authority

**Rationale:** Contract 是 Web/API/Worker/Agent/DB 的共同依赖，事实边界必须早于任何模型行为。  
**Delivers:** Zod canonical schemas、TS types、JSON Schema/OpenAPI artifacts、Pydantic compatibility checks、golden fixtures、typed errors、versioned `EventEnvelope`；PostgreSQL migrations、candidate/version 分离、constraints、seed、outbox 与最小权限角色。  
**Addresses:** Contract First、consumer/provider contract tests、数据库基础、Persona V1/V1.1 与 candidate 状态机。  
**Avoids:** 仅 TypeScript interface、Memory/Persona 混表、Agent 直接写正式状态、stale patch 静默覆盖。

### Phase 3: Product and Agent Service Seams

**Rationale:** 在引入模型和异步复杂度前，先证明两个服务可独立启动、边界可替换、错误一致。  
**Delivers:** Fastify modular API、`IAgentClient`、deterministic Mock、FastAPI 六端点与 typed runtime stage 骨架、`ResoAgentClient` 对本地 stub、health/smoke/contract parity tests、trace allowlist。  
**Addresses:** Product API 权威、独立 Agent Service、Mock-first provider、可观测 runtime。  
**Avoids:** distributed monolith、浏览器直连模型、Mock/Real 漂移、静默 fallback、trace/CoT 泄漏。

### Phase 4: Async Boundary, Web Shell and Deterministic Closed Loop

**Rationale:** 服务契约稳定后再接 outbox/Worker 与 UI，最后用一条垂直闭环验证跨层状态归属，而不是模型质量。  
**Delivers:** outbox relay、Redis Stream/BullMQ adapter、幂等/retry/pending 行为、Worker skeleton、mobile-first 路由与状态、Journey → Persona V1 → mock chat → candidates → accept/reject/stale/replay → V1.1 的集成/E2E smoke，以及完整 CI。  
**Addresses:** 异步事件、Web shell、First Closed Loop fixture、免费确定性 CI。  
**Avoids:** PostgreSQL/Redis 双写丢事件、重复 candidate、Redis 作为真相、事件驱动一切、没有闭环的空壳脚手架。

### Phase 5: Stage 1 Productized First Closed Loop

**Rationale:** Foundation 通过后，才把 fixture 变成真实用户体验；仍保持 bounded provider 与用户确认权。  
**Delivers:** Journey 内容/保存恢复、可解释 Persona Draft 编辑确认、Agent Birth、真实但受控的 Agent Chat、Memory/Reflection Candidate、Patch Review、version history 与 Correction Memory regression。  
**Addresses:** Stage 1 全部用户可见 table stakes、Living Persona、前三种 mode 的渐进实现。  
**Avoids:** Persona 被当成真相、未验证模型直接改变状态、以消息量替代连接质量。

### Phase 6: Stage 2 Memory, Retrieval and Eval

**Rationale:** 检索优化只有在闭环状态与可评估数据存在后才有意义；retrieval 与 eval 必须同阶段设计。  
**Delivers:** 授权 read/tool ports、embedding/provider 选择、pgvector query/index、correction priority、retention/deletion propagation、trace/eval datasets 与 Persona Fidelity/Boundary Compliance 指标。  
**Addresses:** 生产级 Memory retrieval、Correction Memory、Relationship Memory 基础、质量驱动演进。  
**Avoids:** 向量等同事实、无测量的 ANN 优化、删除不完整、私密数据进入 eval。

### Phase 7: Stage 3+ Social, Proxy and Human Relationships

**Rationale:** 这是权限、隐私、安全与产品语义最不确定的能力，必须建立在可执行 consent/disclosure 和成熟审计上。  
**Delivers:** bounded SocialMission、Proxy、Recommendation、World/Story 和后续 Human Relationship flows；每个 action 具备 purpose、recipient、budget、stop conditions、双边 consent、revocation 与 moderation。  
**Addresses:** 四 mode 完整形态、用户治理披露、受限 Agent-to-Agent、人际关系 scaffold。  
**Avoids:** excessive agency、冒充用户、无限 Agent 对话、授权缓存越过撤销、社交/法律风险被 UI demo 掩盖。

### Phase Ordering Rationale

- Contract 必须先于 DB、Web 与 Agent，否则三个实现面会独立发明不兼容形状。
- 数据权威与 candidate 状态机必须先于 Reflection/Proxy，否则概率输出会静默变成事实。
- Mock parity 必须先于真实 LLM，以保持前后端并行、CI 确定性和 provider-neutral。
- Outbox/Worker 必须建立在 committed facts 上；用户确认与普通同步查询不应被强行事件化。
- 第一闭环必须先于 World/Social；先证明系统能学习、被纠正、保持 provenance，再放大关系复杂度。
- Retrieval 与 eval 同步建设；Consent/Disclosure 的可执行策略必须早于 Proxy/Social action。
- “迁移上游 Journey/UI”不是当前依赖，也不是路线图阶段；只有新输入审计通过后才可插入独立迁移工作。

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 2:** 做一个小型 spike 验证 Zod → JSON Schema/OpenAPI → Pydantic 的生成与兼容性，尤其是 union、optional/null、format 与错误路径。
- **Phase 4:** 明确 Redis Stream/BullMQ 二选一或职责划分、outbox relay、retention、DLQ、重试预算和 CI/Testcontainers 策略。
- **Phase 5:** 研究 optimistic Persona concurrency、删除/保留、Journey 长度、用户纠正 UX、真实 provider 的成本/延迟/降级。
- **Phase 6:** 必须执行 `/gsd-research-phase`；embedding、ranking、correction priority、recall/false-recall eval、数据删除传播均为质量与隐私关键。
- **Phase 7:** 必须执行深入安全/法律/产品研究；涉及未成年人、地区隐私、bilateral consent、abuse/moderation、budget 与 bounded orchestration。

Phases with standard patterns (may skip dedicated research phase):

- **Phase 1:** pnpm/Turbo/uv 工作区、lint/typecheck/test 与基础文档是成熟标准模式。
- **Phase 3:** Fastify/FastAPI health、ports/adapters、Mock/client parity 与依赖注入有充分官方文档；按现有契约实施即可。

## Confidence Assessment

| Area         | Confidence  | Notes                                                                                                                                |
| ------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Stack        | HIGH        | 主要版本与兼容性来自官方 release/support 文档和 registry metadata；Drizzle/BullMQ 为 MEDIUM，需精确 pin 和集成验证。                 |
| Features     | HIGH        | Foundation P0、First Closed Loop 与延期项直接来自项目规格，并由 OWASP/NIST/contract-testing 资料验证边界取舍。                       |
| Architecture | MEDIUM-HIGH | 模块化后端、独立 Agent、outbox、幂等与 DB ownership 是成熟模式；跨语言生成链和运营参数仍需 spike。关于上游资产的推断已从事实中移除。 |
| Pitfalls     | HIGH        | 风险与架构不变量直接对应，并有 OWASP、AWS、Redis、PostgreSQL 等权威资料支持。                                                        |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Reference/upstream evidence:** 最终文件系统审计确认 `references/Reso-AI-upstream` 与 `references/Reso.Ai` 存在且可运行，合计 514 个文件、106 个测试和 98 个图片资产。可复用性是“行为/内容/测试优先”的判断；具体资产许可、安全、依赖和 DOM/game/Next-to-React 迁移成本仍需逐项审计。
- **Cross-language contracts:** Zod/JSON Schema/OpenAPI 到 Pydantic 的特性映射未实证；Phase 2 先用最小 round-trip fixture 做兼容性 gate。
- **Auth and service identity:** Foundation 只有 dev identity/接口骨架；接入真实敏感数据或公网 beta 前必须设计用户 auth、service-to-service auth、tenant scope 与 secret rotation。
- **Privacy lifecycle:** retention、export、deletion、backup、embedding/trace propagation 和目标地区合规尚未定义。
- **Event operations:** Redis Stream/BullMQ 的职责、persistence/noeviction、retention、DLQ、outbox relay 和灾难恢复需要实施期默认值。
- **Product metrics:** Journey 最佳长度、Persona Correction Rate、Meaningful Connection Rate、Felt Understood 与 Scaffold Behavior 的事件口径和阈值未验证。
- **Model runtime:** provider、预算、SLO、流式策略、content safety 和降级语义尚未选择；Foundation 保持 provider-neutral。
- **Relationship semantics:** familiarity/trust/stage 的状态含义与转换规则未定义，不能交给 LLM 自行打分或提交。

## Sources

### Primary (HIGH confidence)

- [PROJECT.md](../PROJECT.md) — 当前里程碑、First Closed Loop、Active/Out of Scope、技术与架构硬约束。
- 用户提供的《Reso.AI / reso-ai 项目初始化 Prompt》— 产品原则、目标目录、事件、Mock/Real 方法、执行顺序与 Definition of Done。
- [STACK.md](./STACK.md)、[FEATURES.md](./FEATURES.md)、[ARCHITECTURE.md](./ARCHITECTURE.md)、[PITFALLS.md](./PITFALLS.md) — 本汇总的四份直接研究输入，并以最终 nested repository inventory 校正早期空目录判断。
- [Node.js Releases](https://nodejs.org/en/about/previous-releases)、[Vite 8](https://vite.dev/blog/announcing-vite8)、[Fastify Validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)、[Zod JSON Schema](https://zod.dev/json-schema)、[FastAPI Versions](https://fastapi.tiangolo.com/deployment/versions/)、[uv Projects](https://docs.astral.sh/uv/guides/projects/) — runtime/framework 与版本策略。
- [PostgreSQL Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)、[pgvector](https://github.com/pgvector/pgvector)、[Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/)、[AWS Transactional Outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) — 数据权威、检索、事件与幂等模式。
- [OWASP LLM Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)、[OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)、[NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) — 最小权限、人工监督、预算、边界与持续评估。

### Secondary (MEDIUM confidence)

- [Microsoft Research: Risks, Rewards, and Roles for AI in Relationship Advice](https://www.microsoft.com/en-us/research/publication/chat-should-i-leave-him-risks-rewards-and-roles-for-ai-in-relationship-advice/) — 关系建议中的 sycophancy/overreliance 风险；对 Reso.AI 目标用户的适配仍需用户研究。

---

_Research completed: 2026-08-26_  
_Ready for roadmap: yes_
