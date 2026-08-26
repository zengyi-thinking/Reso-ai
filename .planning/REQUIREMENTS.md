# Requirements: Reso.AI

**Defined:** 2026-08-26  
**Core Value:** Reso.AI 在用户明确知情和控制下，把 Experience 转化为 Memory、Reflection 与可确认的 Persona 演进，帮助用户更好地认识自己、表达自己并建立真实关系。

## v1 Requirements

### Foundation / Project Bootstrap

- [x] **FND-01**: 开发者可查阅根仓库与两套独立 reference 原型审计，看到可复用 Journey/Persona/Consent 行为、测试与资产清单、暂不迁移项和当前技术债。
- [x] **FND-02**: 仓库、产品、Agent 服务与 Python package 在代码和文档中统一使用 `reso-ai`、`Reso.AI`、`agent-service` 与 `reso_agent` 命名。
- [x] **FND-03**: 开发者可在单仓内分别构建和运行 Web、Product API、Worker、Agent Service 与 Agent Lab，公共能力只通过 packages 共享。
- [x] **FND-04**: Node/pnpm/Turbo 与 Python/uv 工具链版本和锁文件已提交，干净环境安装可重复。
- [x] **FND-05**: 根级命令可统一执行 format、lint、typecheck、test、build、Python checks 与 Agent smoke eval。
- [x] **FND-06**: 根级及 Web、API、Agent Service 的 scoped `AGENTS.md` 明确 ownership、架构禁区与 Definition of Done。
- [x] **FND-07**: README、架构/产品/API/数据库/协作文档及 ADR 能让新开发者理解目标结构、边界和本地工作流。
- [x] **FND-08**: `packages/contracts` 用 Zod 对 Agent、Persona、Memory、Conversation、Relationship、Social、Consent、Recommendation 与事件边界执行运行时校验并导出 TypeScript 类型。
- [x] **FND-09**: API 与事件使用稳定错误 envelope 和版本化 `EventEnvelope`，未知或无效 payload 会被边界拒绝。
- [x] **FND-10**: 同一组 golden fixtures 可验证 TypeScript Contract 与 Python/Pydantic model 的兼容性。
- [x] **FND-11**: PostgreSQL 追加式 migration 建立项目规定的核心表、UUID、外键、时间戳与必要索引，pgvector 只作为派生检索能力。
- [x] **FND-12**: 数据库 seed、合成 test fixtures 与 migration/integration test 可在不使用真实用户数据时验证 schema。
- [x] **FND-13**: Product API 是 User、Journey、Conversation、Persona Version、Relationship、Recommendation 与 Consent 正式状态的唯一命令入口。
- [x] **FND-14**: `MockAgentClient` 与 `ResoAgentClient` 实现同一 `IAgentClient`，成功和失败输出都经过共享 Contract 校验，真实 provider 不会静默降级为 Mock。
- [x] **FND-15**: Agent Service 提供版本化 health、turn、reflect、persona initialize/suggest-patch、social act/evaluate 内部端点，模型与 Prompt 细节不暴露为 API。
- [x] **FND-16**: Agent runtime 预留 typed perception、context、memory、mode、policy、planner/tool/model 与 post-turn candidate 管线，以及 Companion、Mirror、Preprocessor、Proxy 四种 Mode。
- [x] **FND-17**: Agent Service 无 Product DB 写权限，只返回 candidate；trace 仅保存 allowlist 字段且不保存密钥、完整 provider 原始响应或私有 Chain-of-Thought。
- [x] **FND-18**: Worker 通过 committed event/outbox 接缝处理异步任务，并具备可测试的幂等、重试、ACK 与失败语义；Redis 不保存唯一业务事实。
- [x] **FND-19**: Mobile-first Web v0 提供 Welcome、Journey、Persona、Agent Chat 与 Patch Review 路由，只访问 Product API，并符合温暖世界感、44px 交互目标与 reduced-motion 基线。
- [x] **FND-20**: `.env.example`、Docker Compose 与本地开发说明让开发者无需真实模型 Key 即可启动 Web、API、Mock Agent、PostgreSQL 与 Redis，浏览器 bundle 不含模型密钥。
- [x] **FND-21**: Agent Lab 与 eval 骨架仅使用合成、去标识化或明确授权的数据，并可运行不调用付费模型的 smoke eval。
- [x] **FND-22**: CI 在 Mock 模式下完成 install、format、lint、typecheck、unit/contract test、build、Python checks 与 Agent smoke eval，最终架构审查确认无 ownership、隐私或 Contract 越界。

### First Closed Loop

- [ ] **FCL-01**: 用户可从扫码或链接进入 Welcome，并开始一次 Journey。
- [ ] **FCL-02**: 用户可完成约 8 轮情境选择，Journey 进度和答案可保存并恢复。
- [ ] **FCL-03**: Journey 完成后用户可查看带 evidence、confidence 与 uncertain hypothesis 的 Persona Draft，而不是静态人格标签。
- [ ] **FCL-04**: 用户可在提交前修改或补充 Persona Draft，并清楚看到将被保存的内容。
- [ ] **FCL-05**: 用户确认后 Product API 创建不可变 Persona V1，并保持 active version pointer。
- [ ] **FCL-06**: 用户可通过最小账户/会话流程领取与其 Persona 关联的 Reso Agent。
- [ ] **FCL-07**: 用户可与 Reso Agent 对话，消息由 Product API 持久化并能在重新进入后恢复。
- [ ] **FCL-08**: Agent 对话按 Companion、Mirror 或 Preprocessor 的受控策略响应；Mirror 使用可质疑的猜测表达而不是人格定论。
- [ ] **FCL-09**: 一次对话只生成带来源的 Memory Candidate，不会把单次事件直接写成 Persona 事实。
- [ ] **FCL-10**: Post-turn Reflection 可生成包含 from version、path、old/proposed value、reason、evidence、confidence 与 status 的 Persona Patch Candidate。
- [ ] **FCL-11**: 用户接受有效 Patch Candidate 后，Product API 原子创建 Persona V1.1，并保留 V1 历史。
- [ ] **FCL-12**: 用户拒绝 Patch Candidate 后，active Persona 不变，拒绝结果可追溯。
- [ ] **FCL-13**: 过期、重复或重放的 Patch 确认不会覆盖新版本或重复创建 Persona Version。
- [ ] **FCL-14**: 用户明确纠正 Agent 解释时，系统保存高优先级 Correction Memory，并阻止相同简单标签再次作为确定结论输出。

### Agent Quality

- [ ] **AQT-01**: 用户授权范围内的 episodic、persona-related、relationship、correction 与 reflection memories 可长期保存并按来源追溯。
- [ ] **AQT-02**: Agent 只通过受授权的 read/tool port 检索当前用户上下文，越权或已删除内容不会进入回答。
- [ ] **AQT-03**: 检索排序优先尊重 Correction Memory，并通过 recall/false-recall 用例证明旧的被否定解释不会压过纠正。
- [ ] **AQT-04**: 用户可看到与其 Agent 或关系相关的连续 Relationship Memory，而不是无来源的关系分数。
- [ ] **AQT-05**: 授权开发者可在 Agent Lab 查看脱敏的 input reference、Persona version、retrieved memory references、mode、policy、tools、model、latency、candidate 与 eval 结果。
- [ ] **AQT-06**: 授权开发者可使用固定 snapshot 重放 Agent turn，并比较 Prompt、model 或 memory ablation 结果而不读取私有 Chain-of-Thought。
- [ ] **AQT-07**: 确定性 eval 覆盖 Persona Fidelity、Memory Precision、Meaningful Recall、Emotional Fit、Boundary Compliance、Representation Fidelity、Relationship Continuity 与 Scaffold Behavior。
- [ ] **AQT-08**: 每次 Prompt 版本变更都可在 Git 中 review/rollback，并由关联 eval 显示行为影响或回归。
- [ ] **AQT-09**: 用户数据删除或授权撤销会传播到 memory、embedding、trace 与相关派生索引，并有自动化隐私生命周期验证。

### Social Agent

- [ ] **SOC-01**: 用户可进入具有地图、岛屿、活动与 Agent location 的 Reso World，体验呈现为温暖世界而非 SaaS Dashboard。
- [ ] **SOC-02**: 用户可查看并控制用于社交探索的 Agent Card，未授权 Persona 字段不会公开。
- [ ] **SOC-03**: 用户可创建或批准带 goal、max turns、allowed/forbidden topics、disclosure level、budget 与 stop conditions 的 Social Mission。
- [ ] **SOC-04**: Social Orchestrator 只在 Mission 边界内协调 Agent-to-Agent 交互，到达轮次、预算或停止条件时必然终止。
- [ ] **SOC-05**: Proxy 对外发送每段内容前执行 L0-L5 Disclosure Policy，并明确产生 ALLOW、DENY 或 ASK_USER 决策。
- [ ] **SOC-06**: Social Mission 完成后生成可审查的 summary、shared topics、conflicts、open questions 与 Recommendation Candidate，而不是直接建立真人关系。
- [ ] **SOC-07**: 用户可接受、拒绝或忽略 Recommendation Candidate；Agent 不能代替用户作出决定或承诺。
- [ ] **SOC-08**: 用户撤销 Proxy Consent 后，未完成 Mission 停止且后续社交动作 fail closed，撤销过程可审计。
- [ ] **SOC-09**: Agent-to-Agent 结果只形成 Relationship/Recommendation Candidate，正式状态仍由 Product API 依据授权提交。

### Human Relationship

- [ ] **HUM-01**: 只有双方都给予明确、未撤销且范围匹配的 Consent 后，系统才可建立 User-to-User relationship。
- [ ] **HUM-02**: 双方 Consent 成立后，用户可进行由 Product API 持久化的 Human Chat；任一方撤销后新消息通道关闭。
- [ ] **HUM-03**: 用户可请求 Agent Assist 来整理表达或回顾上下文，但发送前内容始终由用户确认。
- [ ] **HUM-04**: Agent Assist 不冒充用户、不替用户承诺，并在真人沟通可自然进行时退到辅助位置。
- [ ] **HUM-05**: 用户可查看由可追溯 interaction 与 relationship events 组成的 Relationship Timeline。
- [ ] **HUM-06**: 真实关系经历可生成 Memory、Reflection 与 Relationship/Persona Patch Candidate，只有用户确认后才改变正式状态。
- [ ] **HUM-07**: 用户可查看并撤销关系相关 disclosure/consent；撤销会阻止后续数据访问和代理行为。
- [ ] **HUM-08**: 产品可用去标识化事件衡量 Meaningful Connection、Felt Understood、Persona Correction 与 Relationship Continuation，而不以消息量或在线时长作为唯一成功指标。

## Future Requirements

### Deferred Until Measured Need

- **FUT-01**: 生产级支付、复杂 RBAC 与多租户治理。
- **FUT-02**: Kubernetes、Kafka、Neo4j、Pinecone、Elasticsearch 或额外数据库。
- **FUT-03**: 未经来源、许可、安全与技术审计的外部 Journey/UI/美术资产迁移。
- **FUT-04**: 默认 CI 中调用真实付费模型，或未受 eval 约束的在线 Prompt 修改。
- **FUT-05**: 无预算、停止条件、Disclosure 与双方 Consent 的开放式 Agent-to-Agent 网络。

## Out of Scope

| Item                                                    | Reason                                              |
| ------------------------------------------------------- | --------------------------------------------------- |
| 将 Agent 输出直接写入正式 Persona/Relationship/Consent  | 违反 `Agent Suggests, Service Commits` 与用户确认权 |
| Web 直接访问 Agent Service、数据库或模型                | 破坏 Product API 的事实与隐私边界                   |
| 将 Memory、Persona 或 Recommendation 当作真理/决定      | 违反核心领域语义                                    |
| 保存私有 Chain-of-Thought、密钥或完整 provider 原始响应 | 违反 trace allowlist 与隐私原则                     |
| 为架构整洁推翻可运行代码                                | 所有演进必须渐进、可验证                            |

## Traceability

| Requirement | Phase   | Status   |
| ----------- | ------- | -------- |
| FND-01      | Phase 1 | Complete |
| FND-02      | Phase 1 | Complete |
| FND-03      | Phase 1 | Complete |
| FND-04      | Phase 1 | Complete |
| FND-05      | Phase 1 | Complete |
| FND-06      | Phase 1 | Complete |
| FND-07      | Phase 1 | Complete |
| FND-08      | Phase 1 | Complete |
| FND-09      | Phase 1 | Complete |
| FND-10      | Phase 1 | Complete |
| FND-11      | Phase 1 | Complete |
| FND-12      | Phase 1 | Complete |
| FND-13      | Phase 1 | Complete |
| FND-14      | Phase 1 | Complete |
| FND-15      | Phase 1 | Complete |
| FND-16      | Phase 1 | Complete |
| FND-17      | Phase 1 | Complete |
| FND-18      | Phase 1 | Complete |
| FND-19      | Phase 1 | Complete |
| FND-20      | Phase 1 | Complete |
| FND-21      | Phase 1 | Complete |
| FND-22      | Phase 1 | Complete |
| FCL-01      | Phase 2 | Pending  |
| FCL-02      | Phase 2 | Pending  |
| FCL-03      | Phase 2 | Pending  |
| FCL-04      | Phase 2 | Pending  |
| FCL-05      | Phase 2 | Pending  |
| FCL-06      | Phase 2 | Pending  |
| FCL-07      | Phase 2 | Pending  |
| FCL-08      | Phase 2 | Pending  |
| FCL-09      | Phase 2 | Pending  |
| FCL-10      | Phase 2 | Pending  |
| FCL-11      | Phase 2 | Pending  |
| FCL-12      | Phase 2 | Pending  |
| FCL-13      | Phase 2 | Pending  |
| FCL-14      | Phase 2 | Pending  |
| AQT-01      | Phase 3 | Pending  |
| AQT-02      | Phase 3 | Pending  |
| AQT-03      | Phase 3 | Pending  |
| AQT-04      | Phase 3 | Pending  |
| AQT-05      | Phase 3 | Pending  |
| AQT-06      | Phase 3 | Pending  |
| AQT-07      | Phase 3 | Pending  |
| AQT-08      | Phase 3 | Pending  |
| AQT-09      | Phase 3 | Pending  |
| SOC-01      | Phase 4 | Pending  |
| SOC-02      | Phase 4 | Pending  |
| SOC-03      | Phase 4 | Pending  |
| SOC-04      | Phase 4 | Pending  |
| SOC-05      | Phase 4 | Pending  |
| SOC-06      | Phase 4 | Pending  |
| SOC-07      | Phase 4 | Pending  |
| SOC-08      | Phase 4 | Pending  |
| SOC-09      | Phase 4 | Pending  |
| HUM-01      | Phase 5 | Pending  |
| HUM-02      | Phase 5 | Pending  |
| HUM-03      | Phase 5 | Pending  |
| HUM-04      | Phase 5 | Pending  |
| HUM-05      | Phase 5 | Pending  |
| HUM-06      | Phase 5 | Pending  |
| HUM-07      | Phase 5 | Pending  |
| HUM-08      | Phase 5 | Pending  |

**Coverage:** 62/62 v1 requirements mapped exactly once.

---

_Last updated: 2026-08-26 after roadmap initialization_
