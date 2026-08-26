# 目标架构

采用“模块化 Product Backend + 独立无状态 Agent Service”的 monorepo，而不是把每个领域提前拆成微服务。

```text
Web
 └─ REST + @reso/contracts
      └─ Product API ── PostgreSQL (formal truth)
             │        └─ Outbox → Redis → Worker
             └─ IAgentClient
                  ├─ MockAgentClient
                  └─ ResoAgentClient → FastAPI Agent Runtime
                                           ├─ Context / Memory retrieval
                                           ├─ Persona / Relationship context
                                           ├─ Mode / Policy / Planner / Tools
                                           ├─ Model router
                                           └─ Candidates / privacy-safe trace / eval
```

## 依赖规则

1. Web 只依赖 UI、design tokens、Contracts 和 Product API。
2. Product API 唯一拥有正式业务状态；Worker 属于 Backend ownership。
3. Agent Service 不持有 Product DB 写权限，只通过受控 context port 获取必要数据。
4. Agent 输出必须是响应或 Candidate；只有 Product Service 能 commit。
5. Redis 用于简单异步任务；可靠事件采用 PostgreSQL transactional outbox 后再发布。
6. 真实模型/Prompt/provider 是 Agent 内部细节，不出现在公共路径或 Web 配置中。

## 第一闭环

Stage 1 的最小纵切：Journey 完成 → Product API 持久化答案 → Agent 初始化 Persona Draft → 用户修改并确认 V1 → 创建 Reso Agent → Chat → Message event → Reflection/Memory Candidate → Persona Patch Candidate → 用户接受 → Product API 创建 V1.1。

## 演进触发器

- 只有出现独立扩缩容、故障隔离或团队 ownership 证据时才拆 Product 模块。
- 只有 Redis Streams/PG outbox 无法满足吞吐、回放或治理时才评估 Kafka。
- 只有 PostgreSQL/pgvector 经测量无法满足检索时才评估外部向量库。
- 不在 Foundation 引入 Kubernetes、service mesh 或复杂微服务治理。
