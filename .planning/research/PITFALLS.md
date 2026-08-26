# Reso.AI Project Bootstrap — Pitfalls

## 1. 把 Agent 当成业务事实拥有者

- **风险**：Agent 直接写 Persona、Relationship 或 Consent，导致不可审计、不可撤销、模型输出变成事实。
- **预警**：Agent Service 获得业务数据库写权限；模型响应直接映射到正式表。
- **预防**：Agent 只返回 Candidate/Recommendation；Product API 校验、持久化并生成事件；Contract 中显式区分 Candidate 与 committed entity。
- **处理阶段**：Foundation，必须在 Contracts、API client 与 schema 中先锁定。

## 2. Memory 与 Persona 混表或同步更新

- **风险**：一次事件被误判成人格结论，用户纠正无法覆盖旧推断。
- **预警**：`memories` 出现正式 persona path/value；写 Memory 的 job 同时更新 Persona Version。
- **预防**：独立表、独立服务边界；Evidence → Patch Candidate → User Confirmation → Persona Version；Correction Memory 提高检索优先级。
- **处理阶段**：Foundation 建 schema，Stage 1 实现确认流，Stage 2 优化检索。

## 3. Contract 只写 TypeScript interface，没有运行时校验

- **风险**：HTTP/事件边界接收到不兼容 JSON 时类型系统无法保护运行时。
- **预警**：API handler 使用类型断言；Mock 和真实 client 返回结构不一致。
- **预防**：共享 Zod schema + inferred type；契约测试同时验证 Mock、HTTP adapter 与事件 envelope。
- **处理阶段**：Foundation。

## 4. Monorepo 一次性堆入过多平台复杂度

- **风险**：Bootstrap 被 Kubernetes、消息总线、复杂 ORM 或多数据库拖慢。
- **预警**：在没有负载和业务证据时引入 Kafka、Neo4j、Pinecone、Elastic。
- **预防**：pnpm workspace + Turborepo；PostgreSQL/pgvector + Redis；事件先通过可靠的简单队列接口抽象。
- **处理阶段**：所有阶段持续检查 YAGNI。

## 5. Mock Agent 与真实 Agent 行为漂移

- **风险**：切换 provider 后 Web/API 必须重写或大量出错。
- **预警**：Mock 返回额外便利字段；ResoAgentClient 手写另一套 DTO。
- **预防**：两者实现同一 `IAgentClient`；响应统一经过 Contracts 解析；契约测试参数化运行两个 adapter（真实 adapter 使用本地 stub server）。
- **处理阶段**：Foundation。

## 6. Trace 泄漏隐私或 Chain-of-Thought

- **风险**：敏感内容、密钥或内部推理被持久化。
- **预警**：trace 记录完整 prompt、Authorization header、provider 原始响应。
- **预防**：trace allowlist；只保存输入引用、版本、检索结果 ID、mode、policy decision、tools、model、latency、output 和 candidates；默认脱敏。
- **处理阶段**：Foundation 定接口，Stage 2 加审计和保留策略。

## 7. 以 Engagement 代理产品价值

- **风险**：Agent 变成依赖性聊天产品，偏离帮助真人建立关系的目标。
- **预警**：唯一指标是消息数、时长、DAU；没有 Scaffold Behavior eval。
- **预防**：预留 Meaningful Connection、Felt Understood、Persona Correction、Relationship Continuation 与 Scaffold Behavior 指标和 eval。
- **处理阶段**：Foundation 建 eval taxonomy，后续持续实现。

## 8. 未审计就复制 reference 代码或资产

- **风险**：把两套原型整包并入新 workspace，带入旧 DTO、状态 ownership、模型耦合或不清晰的资产许可。
- **预警**：根工具链修改 nested Git；直接复制页面/服务而没有行为测试、防腐 adapter 或来源清单。
- **预防**：reference repo 保持只读；按 Journey/Persona/Consent 单个纵切审计、适配和迁移；资产先记录 provenance/license；用旧测试验证行为而非复制内部结构。
- **处理阶段**：Foundation。
