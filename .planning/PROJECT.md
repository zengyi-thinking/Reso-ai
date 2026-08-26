# Reso.AI

## What This Is

Reso.AI 是面向真实人际关系的 AI Native Relationship Intelligence 产品。它通过互动式 Journey、可修正且可版本化的 Living Persona、长期记忆和受控的 Reso Agent，帮助用户认识自己、被长期理解、表达自己，并逐步建立有价值的真实关系。

本次里程碑只完成 Project Bootstrap：建立前端、后端、Agent 三条开发线可以长期并行的工程基础，以及第一闭环所需的契约、数据和服务骨架；不实现完整产品。

## Core Value

Reso.AI 必须能够在用户明确知情和控制下，把 Experience 转化为 Memory、Reflection 与可确认的 Persona 演进，从而越来越准确地理解用户并帮助其建立真实关系。

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] 完成根仓库与两套独立 reference repo 审计，并明确可复用内容、目标架构和渐进迁移方式。
- [ ] 建立 React + TypeScript + Vite Web、Node.js + TypeScript REST API、Python + FastAPI Agent Service 的 monorepo 基线。
- [ ] 建立 Contract First 的共享类型和校验契约，覆盖 Agent、Persona、Memory、Conversation、Relationship、Social、Consent、Recommendation 与事件。
- [ ] 建立 PostgreSQL + pgvector + Redis 的数据库 migration/schema/seed/test fixture 骨架。
- [ ] 建立可通过 `AGENT_PROVIDER=mock` 与真实 Agent Service 无缝切换的 `IAgentClient`、`MockAgentClient` 和 `ResoAgentClient`。
- [ ] 建立遵循 Agent/Service 边界的 FastAPI 端点、运行管线、Mode、Policy、Prompt 和 tracing 骨架。
- [ ] 建立基础 Web、Worker、Agent Lab、Eval、CI、本地开发、测试与文档体系。
- [ ] 所有工程检查可运行：install、format、lint、typecheck、unit/contract test、build、Python lint/typecheck/test、agent smoke eval。
- [ ] 根目录和各服务 scoped `AGENTS.md` 明确架构、职责、禁区和 Definition of Done。

### Out of Scope

- 完整 Reso World、完整推荐系统和完整社交广场 — 属于 Stage 3 以后。
- 生产级长期记忆、向量检索和 Agent-to-Agent 自由交互 — 本轮只建立可测试边界与骨架。
- 生产级认证、支付、Kubernetes、Kafka、Neo4j、Pinecone、Elasticsearch — 无当前需求，遵守 YAGNI。
- 真实付费模型调用 — CI 与本地默认必须使用 Mock，避免密钥和费用依赖。

## Context

- 根仓库初始化前没有统一应用/构建结构；`references/` 中有两套独立 Git 原型：vanilla Vite 关系旅程/世界项目，以及 Next.js + FastAPI 的 Reso.Ai 原型。它们是只读迁移源，不属于新 workspace。
- 产品核心闭环为：Journey → Persona Draft → 用户修改 → Persona V1 → Agent Birth → Agent Chat → Memory → Reflection → Persona Patch Candidate → 用户确认 → Persona V1.1。
- 长期飞轮为 Experience → Memory → Reflection → Persona → Agent Action → Relationship → New Experience。
- 用户可见品牌固定为 Reso.AI；仓库名固定为 `reso-ai`；Agent 名称固定为 Reso Agent；Python package 固定为 `reso_agent`。
- 文档主要使用中文，代码、API、Schema 与类型使用英文。

## Constraints

- **Architecture**: Product 负责体验，Backend Service 负责事实/状态/规则，Reso Agent 负责理解/判断/表达/反思和受控代理。
- **Domain boundaries**: Memory != Persona；Agent != User；Persona != Truth；Recommendation != Decision；Agent Suggests, Service Commits。
- **Stack**: React + TypeScript + Vite；Node.js + TypeScript REST API；Python + FastAPI；PostgreSQL + pgvector；Redis。
- **Privacy**: 浏览器不能持有模型 API Key；Proxy 必须受 Consent、Disclosure、Budget 和 Stop Conditions 控制；授权必须可撤销。
- **Delivery**: Mobile First；Contract First；Mock First；CI 不依赖付费模型；任何提交必须保持 install/dev/build/test 可用。
- **Scope**: 本轮只做 Stage 0 Foundation 与第一闭环所需接口骨架，不越界开发完整业务。

## Key Decisions

| Decision                                           | Rationale                                                      | Outcome   |
| -------------------------------------------------- | -------------------------------------------------------------- | --------- |
| 使用单仓多包结构                                   | 共享 Contracts、统一质量门禁并支持三条开发线并行               | — Pending |
| Agent Service 独立为 Python/FastAPI                | 隔离智能运行时与产品事实/业务状态                              | — Pending |
| 以 TypeScript Contracts 作为跨团队真源             | 防止 Web、API、Agent 各自猜测字段                              | — Pending |
| PostgreSQL + pgvector + Redis 作为第一阶段数据基线 | 满足事务事实、向量检索和简单异步任务，避免过早引入复杂基础设施 | — Pending |
| 本地和 CI 默认 Mock Agent                          | 前后端无需等待真实 Agent，且不依赖付费模型                     | — Pending |
| Persona 修改采用 Candidate + Service Commit        | 保证 Persona 可解释、可确认、可版本化                          | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition**:

1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone**:

1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---

_Last updated: 2026-08-26 after initialization_
