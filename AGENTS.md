# Reso.AI Engineering Guide for Coding Agents

本文件是所有 Coding Agent 进入仓库后必须优先阅读的约束。目录内存在 scoped `AGENTS.md` 时，必须同时遵守更具体的规则。

## Vision

Reso.AI 是 AI Native Relationship Intelligence 产品，目标是长期理解用户，帮助用户认识自己、表达自己、建立真实关系，并随着真实经历持续成长。

核心飞轮：`Understand → Remember → Reflect → Connect → Experience → Grow`。

Reso.AI 不是普通 Chatbot、Dating App、Tinder Clone、静态人格测试或纯 AI 陪伴产品。产品体验必须让用户感觉“进入了一个温暖的世界”，而不是打开冷冰冰的 AI Dashboard。

## Naming

- 产品品牌：`Reso.AI`
- 仓库：`reso-ai`
- Agent：`Reso Agent`
- Agent 服务：`agent-service`
- Python package：`reso_agent`

禁止引入其他项目名。

## Repository Structure

- `apps/web`：Mobile First React 产品体验。
- `apps/api`：Product API；正式业务事实、状态、规则和命令入口。
- `apps/agent-service`：FastAPI 智能运行时；只读上下文、推理、候选建议。
- `apps/worker`：Backend-owned 异步任务和事件消费。
- `apps/agent-lab`：仅供开发/评估的隐私安全 trace 工具。
- `packages/contracts`：跨团队、跨服务的运行时 schema 与 TypeScript 类型真源。
- `packages/ui`、`packages/design-tokens`：共享 UI 与品牌语言。
- `packages/config`、`packages/test-fixtures`：共享配置校验和确定性 fixtures。
- `database`：有序 migration、seed、schema 说明。
- `evals`：去标识化数据集、场景、grader 和报告。
- `docs`：架构、产品、Agent、API、数据库和协作文档。
- `infra`：Docker、CI 和部署边界。

依赖方向：Web → Product API → `IAgentClient` → Mock/Reso Agent。Web 不直接访问 Agent、数据库或模型。Agent 不直接写 Product DB。

## Non-negotiable Architecture Rules

- `UI != Agent`
- `LLM != Agent`
- `Prompt != Agent`
- `Memory != Persona`
- `Persona != Truth`
- `Agent != User`
- `Recommendation != Decision`
- `Agent Suggests, Service Commits`

Product 负责体验；Backend Service 负责事实、状态、规则和执行；Reso Agent 负责理解、判断、表达、反思和受控代理；Contracts 负责团队并行。

## Service Boundaries

Product API 拥有 User、Journey、Conversation、Persona Version、Relationship、Recommendation 和 Consent 正式状态。Worker 只能通过受控 repository/command 更新这些状态。Agent Service 只读取授权后的 Persona/Memory/Relationship Context，返回 Memory Candidate、Persona Patch Candidate 或 Recommendation Candidate。

禁止 Agent：

- 直接修改业务数据库或创建正式 Persona Version。
- 擅自改变 Relationship、Recommendation 或 Consent 状态。
- 冒充用户、替用户承诺或暴露未授权信息。
- 让两个 LLM 无限自由聊天。
- 向用户或 trace 暴露私有 Chain-of-Thought。

## Contract First

所有 HTTP、事件和跨包边界先修改 `packages/contracts`。Schema 使用 Zod 运行时校验并导出 inferred type。字段变化必须同步：契约测试、fixture、API adapter、Python model/OpenAPI 与文档。

禁止前端猜字段、Backend 返回 undocumented 字段、Agent 另建 Persona schema。破坏性变更必须版本化，不允许静默改变语义。

## Real Model First

产品路径全程使用真实 MiniMax 模型：Product API 只装配 `ResoAgentClient`，Agent Service 入口默认 `RESO_MODEL_ROUTE=real`，配置缺失或模型失败直接报错，禁止 silent fallback。`DeterministicModelProvider` 仅作为测试/CI 夹具存在（测试显式注入或经 `RESO_MODEL_ROUTE=deterministic`），任何产品代码路径不得引用它。

## Memory and Persona

Memory 记录发生过什么；Persona 记录 Reso 当前如何理解用户。事件必须经过 Evidence → Pattern/Hypothesis → Persona Patch Candidate → User Confirmation → Persona Version。Correction Memory 具有高优先级，用户明确否认的解释不能继续作为简单标签输出。

Persona 是可解释、可修正、可版本化的当前模型，不是真理。每个 Patch 必须含 from version、path、old/proposed value、reason、evidence、confidence 和 status。

## Privacy and Consent

- 浏览器永远不得持有模型 API Key。
- L0–L5 disclosure 默认 fail closed。
- Proxy 必须有明确、未撤销的 Consent、预算和停止条件。
- trace 只允许保存 allowlist 字段；不得记录密钥、完整 provider 原始响应或 Chain-of-Thought。
- 测试和 eval 只使用合成、去标识化或明确授权的数据。

## Testing

每个变更按影响运行：

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
```

Contract 或 provider 变化必须增加契约测试；数据库状态变化必须增加 migration/integration test；Agent 行为变化必须增加 deterministic eval，默认不得调用付费模型。

## Prompt Versioning

Prompt 位于 `apps/agent-service/reso_agent/prompts/<mode>/vN.md`，必须进入 Git、可 review、可测试、可回滚。禁止在线修改生产 Prompt 而不提交版本。修改 Prompt 时必须说明行为影响并更新相关 eval。

## Agent UX — Breathing Conversation

Reso Agent 不应表现为“等待计算 → 输出答案”的机器，而应表现为一个会听、会想起、会犹豫、会修正并继续理解用户的 Agent。所有用户可见的“思考”必须是经过设计、可审计的 Public Reflection，绝不是模型隐藏推理过程。

- 普通聊天直接回应；只有复杂度和真实证据需要时才增加状态、公开反思或重新考虑。
- `status` 只能描述 Runtime 已发生或正在发生的公开阶段，不得伪造检索、记忆或工具行为。
- `public_reflection` 必须引用授权 evidence，并对 Persona hypothesis 与弱证据保留不确定性。
- `reconsidered` 必须由证据冲突或真实不确定性触发，不得随机制造“人味”或戏剧效果。
- 浏览器、Session、Trace 与日志均不得接收或保存 Chain-of-Thought、`reasoning_details` 或 provider 原始响应。
- 深度关系长链路必须由用户主动选择；阶段标签可以受控固定，但正文必须基于本轮授权上下文动态生成。证据不足时公开说明不足，不得伪造检索、匹配、沙盘或对方信息。

## Database Migration

- 数据库只通过 `database/migrations/` 的追加式、有序 migration 变化。
- 已合并/已部署 migration 不得改写；用新 migration 修正。
- 使用 UUID、外键、必要索引和 `created_at`/`updated_at`。
- migration 必须说明 ownership、回滚/前滚策略与数据生命周期影响。
- Agent Service 不拥有 Product DB 写凭据。

## Git Rules

- 主分支：`main`。
- 短生命周期分支：`feat/*`、`fix/*`、`refactor/*`、`docs/*`、`test/*`。
- 提交保持单一意图；不要混入无关格式化或重构。
- PR 必须说明 What、Why、Architecture/Contract/Database/Agent impact、Testing 和 UI screenshots。
- 不得提交 `.env`、真实密钥、真实私密对话或生成的 eval reports。

## Documentation

架构或边界变化必须同步 `docs/architecture` 与 ADR；Contract/API 变化同步 `docs/api`；schema 变化同步 `docs/database`；本地命令变化同步 README 与 `docs/collaboration/LOCAL_DEVELOPMENT.md`。文档以中文为主，代码/API/schema/type 使用英文。

## Definition of Done

- 变更保持 install、dev、build、test、lint、typecheck 可用。
- 未越过 ownership 或隐私边界。
- Contract、migration、测试、文档与实现一致。
- 测试路径可在无真实模型/无 API Key 环境运行（deterministic route）。
- Mobile 与 desktop UI 均可用，交互目标至少 44px，支持 reduced motion。
- 没有把 Candidate 当正式事实，也没有把 Recommendation 当用户决定。

## Forbidden Shortcuts

- 从 Web 直接调用 LLM、Agent Service 或数据库。
- 用 `any`、类型断言或重复 DTO 绕过 Contract。
- 将模型输出直接写入 Persona/Relationship/Consent。
- 将单次 Memory 当 Persona 结论。
- 在没有证据时加入 Kafka、Neo4j、Pinecone、Elasticsearch 或 Kubernetes。
- 让 CI 依赖付费模型 API、真实密钥或外部不稳定服务。
- 为“架构漂亮”推翻可运行代码；任何未来迁移都应渐进、可验证。
