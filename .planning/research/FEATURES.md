# Feature Landscape

**Domain:** AI Native Relationship Intelligence — Project Bootstrap / Foundation  
**Project:** Reso.AI (`reso-ai`)  
**Researched:** 2026-08-26  
**Overall confidence:** HIGH（范围与优先级直接来自项目规格；外部资料仅用于验证工程与安全取舍）

## Scope Definition

本里程碑的交付物不是完整产品，而是一组**可运行、可替换、可测试的工程能力**。判断某个功能是否属于本轮，采用以下规则：

- 能让 Web、API、Reso Agent 三条线不互相等待，属于 Foundation。
- 能证明 First Closed Loop 的契约和状态归属正确，可做 Mock 或骨架。
- 只有真实模型质量、规模化检索或真人社交上线后才产生价值的功能，必须延期。
- 所有智能输出在本轮都只能是 candidate；正式 Persona、Consent、Relationship 状态只能由 Product Backend 提交。

因此，本轮的“First Closed Loop 优先”意味着先打通：

```text
Journey fixture
  -> Persona Draft contract
  -> user edit + Persona V1 commit boundary
  -> Agent Birth contract
  -> mock Agent Chat
  -> Memory Candidate
  -> Reflection Candidate
  -> Persona Patch Candidate review
  -> accepted Persona V1.1 fixture
```

它不意味着本轮要实现生产级 Journey 内容、长期记忆召回或真实 LLM 反思。

## Table Stakes — Foundation

缺少任一 P0 项，Bootstrap 都不能被视为完成。

| Feature / Capability                      | Why Expected                                                             | Priority | Complexity | Bootstrap Deliverable                                                                                             | Confidence |
| ----------------------------------------- | ------------------------------------------------------------------------ | -------: | ---------- | ----------------------------------------------------------------------------------------------------------------- | ---------- |
| 根仓库与 reference 原型审计               | 识别已有 Journey、Persona、Consent、UI、测试与资产，并给渐进迁移建立基线 |       P0 | Med        | `CURRENT_STATE`、资产/行为清单、目标结构与迁移判断                                                                | HIGH       |
| 单仓多包与清晰 ownership                  | 三条开发线需要共享契约、统一命令、隔离职责                               |       P0 | Med        | `apps/*`、`packages/*`、`database/`、`evals/`、`tests/` 骨架及 scoped `AGENTS.md`                                 | HIGH       |
| 一套根级开发命令                          | 新成员必须能安装、开发、构建和测试；CI 与本地行为应一致                  |       P0 | Med        | install/dev/build/format/lint/typecheck/test 命令可执行                                                           | HIGH       |
| Contract First 共享真源                   | Web、API、Agent 若各猜字段，第一次联调就会产生破坏性返工                 |       P0 | High       | 领域类型 + 运行时校验 + API DTO + `EventEnvelope`，覆盖规格列出的九个领域                                         | HIGH       |
| Consumer/provider contract tests          | “有共享类型”不足以证明 HTTP 边界兼容；Mock 与真实 provider 必须可互换    |       P0 | Med        | 至少验证 `AgentTurnRequest/Response` 及 Persona patch 关键场景；测试真实 client 而非直接 `fetch`                  | HIGH       |
| Mock-first Agent provider                 | 前后端不应等待模型、Prompt 或密钥；CI 不应产生模型费用                   |       P0 | Med        | `IAgentClient`、确定性的 `MockAgentClient`、`ResoAgentClient`、环境变量切换和等价错误语义                         | HIGH       |
| Product API 事实/状态边界                 | 正式 Persona、Consent、Relationship、Conversation 必须有唯一 owner       |       P0 | High       | REST 模块骨架、应用服务边界、candidate -> validate -> commit 接缝；Agent 无 DB 写权限                             | HIGH       |
| 数据库 migration/schema/seed/fixture 骨架 | 闭环必须能表达版本、证据、事件与确认状态；可重复测试需要稳定 fixture     |       P0 | High       | PostgreSQL + pgvector + Redis 配置；规格实体的初始 migration、索引原则、seed/test fixture                         | HIGH       |
| 独立 Agent Service API                    | 智能运行时必须独立迭代，且不能把模型/Prompt 细节泄漏成产品 API           |       P0 | High       | FastAPI health + 六个 `/v1` 内部端点骨架，typed request/response 与 smoke tests                                   | HIGH       |
| Agent runtime 可观测骨架                  | 后续无法重放“使用哪个 Persona/Memory/Policy”就无法安全调试或评估         |       P0 | Med        | mode/policy/prompt/model router 接缝；只记录允许字段，不记录私有 CoT                                              | HIGH       |
| First Closed Loop 跨层 fixture            | 单独生成目录不能证明架构能支持核心价值                                   |       P0 | High       | 一条确定性的 Journey -> Persona V1 -> mock turn -> candidate -> user accept -> V1.1 contract/integration scenario | HIGH       |
| Mobile-first Web shell                    | 产品线需要真实消费 contracts/client 的最小入口，而非空 React 模板        |       P0 | Med        | Welcome、Journey、Persona、Agent Chat、Patch Review 路由/占位状态；不要求完整视觉和内容                           | HIGH       |
| 隐私与配置基线                            | 关系、记忆和对话属于敏感数据；浏览器持有模型 Key 是不可接受的架构缺陷    |       P0 | Med        | `.env.example`、secret 边界、日志脱敏原则、Consent/Disclosure contracts、撤销事件                                 | HIGH       |
| 异步事件与 Worker 接缝                    | Memory/Reflection 不应阻塞消息提交，但本轮无需生产队列平台               |       P1 | Med        | Redis-backed 或 in-memory 可替换接口、幂等 event handler 约定、worker skeleton                                    | HIGH       |
| 文档、ADR 与贡献规范                      | 多团队并行时，约束若只存在于口头约定会迅速漂移                           |       P0 | Med        | README、架构/产品/Agent/API/DB/协作文档、ADR、PR 模板和 DoD                                                       | HIGH       |
| 免费且确定性的 CI                         | 每次提交必须证明工程仍可运行，不依赖外部模型波动                         |       P0 | Med        | JS/TS 与 Python 全门禁、contract test、build、mock agent smoke eval                                               | HIGH       |

## Table Stakes — First Closed Loop (Next Product Phase)

这些是 Stage 1 的用户可见 table stakes。本轮必须为其建立 contracts、fixtures 和边界，但除明确的 smoke slice 外不应假装已经产品化。

| Feature                              | Why Expected                                 | Complexity | Foundation Obligation                                          | Production Work Deferred                        | Confidence |
| ------------------------------------ | -------------------------------------------- | ---------- | -------------------------------------------------------------- | ----------------------------------------------- | ---------- |
| Journey start / choices / completion | Persona Draft 必须有透明的用户输入来源       | Med        | 状态与事件 contract、fixture、API/web route skeleton           | 约 8 轮内容、分支逻辑、保存恢复、分析埋点       | HIGH       |
| 可解释 Persona Draft                 | “说得准”来自可读的理解，不是黑箱标签         | High       | Persona schema、evidence/confidence 字段、mock draft           | 生成质量、内容策略、用户研究                    | HIGH       |
| 用户修改并确认 Persona V1            | Persona != Truth；用户必须拥有修正权         | High       | draft/edit/commit contract、版本和 optimistic concurrency 规则 | 完整编辑 UX、冲突处理、审计体验                 | HIGH       |
| Agent Birth                          | 将确认后的 Persona 绑定到独立 Agent identity | Med        | `agents` entity、初始化 endpoint/client method、fixture        | 仪式化体验、视觉动画、真实初始化推理            | HIGH       |
| User <-> Agent conversation          | 让用户验证“它是否开始理解我”                 | High       | conversation/message contracts、mock turn、错误/超时形态       | 流式输出、真实 provider、质量调优、内容安全完善 | HIGH       |
| Memory Candidate                     | 对话事实不能自动变成人格结论                 | High       | memory type、source/evidence/provenance、candidate event       | 生产级抽取、向量召回、保留/删除策略             | HIGH       |
| Reflection Candidate                 | 将经历归纳为可质疑的观察，而非确定性诊断     | High       | reflection endpoint/worker boundary、trace/eval fixture        | 真实异步推理、批处理策略、质量阈值              | HIGH       |
| Persona Patch review                 | Living Persona 的最小可信闭环                | High       | patch status machine、accept/reject/supersede、evidence refs   | 通知、批量 review、复杂冲突/合并 UX             | HIGH       |
| Persona V1.1 commit                  | 证明 Persona 可版本化、可追溯、可回滚        | High       | immutable version fixture 与 service commit test               | 完整 history UI、diff/rollback product UX       | HIGH       |
| Correction Memory                    | 用户否定错误理解后不能持续重复同一标签       | High       | 独立类型、优先级和 regression fixture                          | 召回排序、跨会话验证、衰减策略                  | HIGH       |

## Differentiators

差异化功能不应都在 Bootstrap 实现，但 Foundation 必须避免把它们在数据模型或边界上“设计死”。

| Feature                             | Value Proposition                                                                | Complexity | Bootstrap Treatment                                           | Earliest Full Phase | Confidence                                 |
| ----------------------------------- | -------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------- | ------------------- | ------------------------------------------ |
| Living Persona + versioned evidence | 从静态人格测试升级为可解释、可纠正、随经历演进的用户模型                         | High       | **实现 schema/contract/fixture 与 commit 规则**               | Stage 1             | HIGH                                       |
| Memory != Persona pipeline          | 阻止单次事件直接固化为人格标签，是可信长期理解的核心                             | High       | **实现实体分离、candidate pipeline 和 contract tests**        | Stage 1–2           | HIGH                                       |
| Correction Memory                   | 让系统优先记住“用户说我理解错了什么”，降低持续冒犯和标签漂移                     | High       | **实现类型与回归场景，不实现真实检索**                        | Stage 2             | HIGH                                       |
| 四种关系 Mode                       | Companion 不过度分析、Mirror 保持假设语气、Preprocessor 帮助表达、Proxy 受控行动 | High       | **预留 enum/router/policy/prompt 目录与 eval case**           | Stage 1–3 分批      | HIGH                                       |
| Agent Suggests, Service Commits     | 将生成能力与事实权威分离，支持确认、拒绝、审计与撤销                             | High       | **本轮强制落实**                                              | Foundation          | HIGH                                       |
| Relationship Memory / Timeline      | 不只记用户属性，也记不同关系如何演进                                             | High       | 仅 contract/schema skeleton                                   | Stage 2 / 4         | HIGH                                       |
| Scaffold toward human relationships | 目标是帮助真人表达和连接，而非最大化对 AI 的依赖                                 | High       | 写入 mode/policy/eval 指标；不做增长机制                      | Stage 2–4           | MEDIUM（产品差异明确，长期效果需用户验证） |
| World + Story                       | “天空、群岛、旅行、手记”形成区别于 AI Dashboard 和刷卡 Dating App 的体验         | High       | design tokens / route boundary /文档占位，**不建 World 系统** | Stage 3             | HIGH                                       |
| Bounded Agent-to-Agent missions     | 有目标、回合、话题、预算、停止条件的社交探索比自由聊天更安全可控                 | Very High  | SocialMission contracts + policy types only                   | Stage 3             | HIGH                                       |
| User-governed disclosure            | 逐字段披露级别、ASK_USER、可撤销 consent，使 Proxy 能被信任                      | Very High  | contracts/schema/policy interface only                        | Stage 3–4           | HIGH                                       |
| Trace + Eval driven evolution       | Prompt/模型变更能用 Persona Fidelity、Boundary Compliance 等指标比较，而非凭感觉 | High       | smoke dataset、grader interface、deterministic eval           | Stage 2             | HIGH                                       |

外部生态验证了两个关键取舍：成熟 AI companion 已把“用户可查看/编辑记忆”作为产品能力；同时 OWASP 将无边界工具权限和缺少人工审批归为 excessive agency。Reso.AI 应把“可修正”与“受控代理”做成系统边界，而不是后补 UI。

## Anti-Features

这些不是“暂时没时间”，而是本里程碑应主动拒绝的范围或设计方向。

| Anti-Feature                                  | Why Avoid                                                | What to Do Instead                                                                      | Revisit                  |
| --------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------ |
| 一次性完成全部 Reso.AI                        | 会制造大量未经验证的业务代码并掩盖边界错误               | 交付可运行 Foundation + 一条 mock closed-loop slice                                     | Never as a single phase  |
| 完整 Reso World / 社交广场                    | 与核心闭环无直接验证关系，且世界状态与推荐会显著扩张模型 | 只保留 `explore` 边界和 Social contracts                                                | Stage 3                  |
| 无限 Agent <-> Agent 自由聊天                 | 无预算、披露和停止条件会导致费用、隐私与安全风险         | 未来只允许 bounded `SocialMission` 经 orchestrator 执行                                 | Stage 3                  |
| 生产级长期向量记忆                            | 召回质量、删除语义、隐私和评估尚未验证                   | pgvector schema/interface + deterministic fixture                                       | Stage 2                  |
| Agent 直接写 Persona/Relationship/Consent     | 生成模型不应拥有正式事实和授权状态                       | candidate -> policy/validation -> service commit                                        | Never                    |
| 将 Persona 当“真相”或心理诊断                 | 会把不确定推断固化成标签，也越过产品定位                 | evidence、confidence、uncertain hypotheses、用户确认                                    | Never                    |
| 未授权冒充用户或替用户承诺                    | 破坏信任，属于 excessive agency                          | 明示 Agent 身份；Proxy 必须 Consent + Disclosure + Budget + Stop Conditions             | Never                    |
| 以聊天时长/消息量驱动依赖                     | 与“走向真实人际关系”的产品目标冲突                       | 优先 Felt Understood、Correction Rate、Meaningful Connection、Relationship Continuation | Never                    |
| 浏览器直连模型或保存模型 Key                  | 密钥泄漏、无法集中实施政策/预算/审计                     | Web -> Product API -> Agent client/service                                              | Never                    |
| CI 调用付费/非确定性模型                      | 造成费用、flaky test 和密钥依赖                          | 默认 Mock；真实模型 eval 作为显式、隔离流程                                             | Later opt-in only        |
| 暴露 `/prompt-v8`、`/gpt-x` 等 API            | 让产品 contract 与内部实现绑定，替换模型会破坏消费者     | 使用意图导向 `/v1/agent/turn` 等稳定端点                                                | Never                    |
| Kafka/Kubernetes/Neo4j/Pinecone/Elasticsearch | Bootstrap 尚无吞吐或查询证据支持复杂基础设施             | PostgreSQL + pgvector + Redis，记录未来触发条件                                         | Only after measured need |
| 生产级 Auth、Payment、复杂 RBAC               | 不验证闭环架构，且容易占据里程碑                         | dev identity / fixture；在公网或真实用户测试前单独设计                                  | Before external beta     |
| 完整实时流式聊天与多媒体                      | 会提前引入取消、重连、背压、存储等复杂度                 | 本轮先稳定同步 turn contract；必要时预留 message status                                 | Stage 1 after contracts  |
| 过早共享业务逻辑 package                      | 容易把 API、Web、Agent 强耦合成“分布式单体”              | 共享 contracts/config/ui；业务规则留在 owning service                                   | Never by default         |

## Feature Dependencies

### Foundation dependency chain

```text
Repository Audit
  -> Workspace + ownership + root commands
      -> Shared runtime contracts
          -> Test fixtures
          -> Product API module boundaries
          -> IAgentClient + MockAgentClient
          -> Agent Service request/response adapters
              -> Consumer/provider contract tests
                  -> First Closed Loop integration fixture

Shared contracts
  -> Database schema/migrations
      -> Service commit rules
          -> Persona V1 / V1.1 version tests

Shared contracts
  -> EventEnvelope
      -> Worker interface
          -> Memory/Reflection candidate skeleton

All executable surfaces
  -> root quality commands
      -> CI
          -> Bootstrap Definition of Done
```

### Product loop dependencies

```text
Journey completion
  -> Persona Draft
      -> user edit/confirmation
          -> immutable Persona V1
              -> Agent Birth
                  -> Agent Chat
                      -> Memory Candidate
                          -> Reflection Candidate
                              -> Persona Patch Candidate
                                  -> user accept/reject
                                      -> immutable Persona V1.1
```

### Hard ordering rules

1. Contracts precede database, UI and Agent implementation; otherwise three teams create incompatible schemas.
2. Mock client precedes real Agent integration; otherwise frontend delivery depends on model readiness and secrets.
3. Persona versioning and candidate states precede reflection logic; otherwise Agent output can silently mutate truth.
4. Trace schema and eval fixture precede prompt tuning; otherwise behavior changes cannot be compared or reproduced.
5. Consent/disclosure policy precedes Proxy or Agent-to-Agent execution; a social demo is not permission to leak user context.
6. First Closed Loop precedes World/Recommendation; the product must first prove it can learn, be corrected and preserve provenance.

## MVP Recommendation

### Build now — Stage 0 Foundation

Prioritize in this exact sequence:

1. Repository audit, naming, ownership, workspace and root commands.
2. Domain contracts with runtime validation, then shared fixtures and contract tests.
3. Database schema/migration skeleton with explicit ownership and immutable Persona versions.
4. `IAgentClient` + deterministic Mock + thin real-service adapter.
5. API, Agent Service, Worker and Web shells that consume the same contracts.
6. One automated First Closed Loop smoke scenario ending in Persona V1.1.
7. CI, mock smoke eval, tracing schema, documentation and scoped agent rules.

### Build next — Stage 1 First Closed Loop

Convert the smoke scenario into the first real vertical slice:

1. Journey content and resume state.
2. Persona Draft explanation/edit/confirmation UX.
3. Agent Birth and real but bounded Agent Chat.
4. Memory/Reflection candidate generation.
5. Persona Patch review and version history.
6. Correction Memory regression behavior.

### Must defer

- **Full World, Social Mission execution, Recommendation:** no value until the product proves user understanding and correction.
- **Production vector retrieval:** defer until a Stage 2 eval dataset can measure meaningful recall, false recall and correction priority.
- **Proxy Mode:** defer until Consent, Disclosure, Budget, audit and revocation are executable policies rather than enums.
- **Human-to-human chat and Relationship Timeline:** defer until recommendations and bilateral consent exist.
- **Production auth/payment/deployment orchestration:** defer until external beta requirements are known.
- **Prompt/model optimization:** defer beyond a minimal smoke prompt until eval baselines exist.

## Acceptance Signals for Bootstrap

Bootstrap should be considered feature-complete only when all of the following are demonstrable:

- Web、API 与 Agent Service independently start，且默认无需模型 Key。
- 更换 `AGENT_PROVIDER=mock` / `reso-agent` 不改变 Web contract。
- Contract test 能发现 consumer/provider breaking change。
- Migration、seed 和 fixture 可从空数据库重复执行。
- Mock 闭环能产生 Persona Patch Candidate；只有显式 accept 才创建 V1.1。
- rejected correction fixture 能阻止后续回归到已被用户否定的简单标签。
- Agent trace 不含私有 Chain-of-Thought，且包含 mode、policy、inputs/outputs 与 candidate identifiers。
- CI 在无付费模型、无浏览器模型密钥时通过全部门禁。
- 文档与 scoped `AGENTS.md` 能让三条开发线清楚知道“能改什么、不能改什么、如何联调”。

## Sources

### Primary project evidence — HIGH confidence

- [`../PROJECT.md`](../PROJECT.md) — Reso.AI 当前里程碑、核心闭环、Active/Out of Scope、技术和架构约束。
- 用户提供的《Reso.AI / reso-ai 项目初始化 Prompt》— 产品原则、目标目录、First Closed Loop、执行顺序与 Definition of Done；本文的 P0/P1 与延期判断均以此为最高优先级。

### External validation

- [Replika: What does my Replika remember about me?](https://help.replika.com/hc/en-us/articles/360000874712-What-does-my-Replika-remember-about-me) — 官方产品文档确认记忆对用户可查看和编辑，支持 Reso.AI 将“可见、可修正”视为 table stakes。**Confidence: HIGH**
- [OWASP LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) — 支持最小权限、人工审批、限制自主行动和工具范围。**Confidence: HIGH**
- [OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html) — 支持限制 agent loop、预算、工具权限和 human oversight。**Confidence: HIGH**
- [Pact: Writing Consumer Tests](https://docs.pact.io/consumer) — 官方文档将 contract testing 定义为消费者/提供者对请求响应的共享理解，并强调测试真实 consumer client。**Confidence: HIGH**
- [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) — 支持明确人机职责、知识边界、文档、人工监督、持续评估和 fail-safe。**Confidence: HIGH**
- [OpenAI Evals API](https://platform.openai.com/docs/api-reference/evals) — 官方能力证明结构化数据集、grader、run 与逐样本结果是可执行 eval 的常见基础。Reso.AI 不因此绑定 OpenAI，只借鉴评估形态。**Confidence: HIGH**
- [Microsoft Research: Risks, Rewards, and Roles for AI in Relationship Advice](https://www.microsoft.com/en-us/research/publication/chat-should-i-leave-him-risks-rewards-and-roles-for-ai-in-relationship-advice/) — 2026 CHI 研究指出关系建议场景中的 sycophancy 与 overreliance 风险，支持 Scaffold、非诊断和 human decision ownership。**Confidence: MEDIUM**（研究结论可靠，但 Reso.AI 用户群尚未验证）

## Research Gaps

- 尚无真实 Reso.AI 用户数据证明“8 轮 Journey”是最佳长度；Stage 1 应通过 completion、correction 与 felt-understood 数据验证。
- Persona Correction Rate、Meaningful Connection Rate 的事件口径与成功阈值尚未定义，需要产品/数据专项设计。
- Correction Memory 的优先级、衰减、删除和跨版本传播策略属于 Stage 2 深研项。
- Proxy/Disclosure 涉及目标市场法律、未成年人、敏感数据分类和双边 consent；进入 Stage 3 前必须做地区化隐私与安全研究。
- 真实模型 provider、成本预算、延迟目标和降级策略仍未确定；Foundation 应保持 provider-neutral。
