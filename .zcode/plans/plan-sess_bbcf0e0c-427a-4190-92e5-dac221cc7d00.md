# Agent 成长闭环（后半圈）实装计划

## 已确认的设计决策

1. **反思触发**：走 `message.created` outbox 事件 → Worker 订阅 → 消息阈值达标后批量调用 reflect。符合"异步任务归 Worker"的架构边界，现有桩代码正是为此预留。
2. **闭环范围**：包含候选晋升——记忆候选 accept 后插入 `memories` 表并补 embedding；persona patch accept/reject 更新状态。（Persona 新版本号生成明确列为后续迭代，不做）
3. **Embedding 所有权**：只在 agent-service 计算模型调用（Real Model First + 浏览器/API 无 Key 边界）。DB 复用 0002 就有的 `memories.embedding vector(1536)` 列，provider 侧 pad/truncate 到 1536 维。

## 现状关键事实（探索结论）

- 聊天每轮已有确定性 ReflectionService 内联产出候选并落库 `memory_candidates`，但 status 永远 pending，无任何消费端。
- `/v1/agent/reflect`、`suggest-patch` 是空桩；现契约只传 ID，必须扩展为携带 transcript+上下文（Agent 保持无 DB 访问）。
- `TraceRecord.tool_names` 字段已存在未填充；pipeline 在 context-build 与 provider-call 之间有天然 hook 点。
- MiniMax provider 无 embeddings 能力；Node 端不持有 LLM 配置。
- Worker outbox 消费机制完整（claim/retry/dead-letter），仅缺生产者与 handler 注册。

---

## 实施步骤

### Step 1 — Contracts（packages/contracts）

- `memory.ts`: `MemoryContextSchema` 增加可选字段 `embedding?: number[]`（向后兼容）。
- `agent.ts`: `AgentReflectionRequestSchema` 扩展：
  - 保留 `userId/conversationId/messageIds`
  - 新增必填 `transcript: [{messageId: Uuid, role: MessageRole, content: string(min1)}].min(1).max(50)`
  - 新增可选 `persona: { versionId: Uuid|null, content: Record<string,string> } | null`
  - 新增可选 `memories: MemoryContextSchema[]`
- `lab.ts`: `LabTurnSchema` 增加 `toolNames: string[] default []`。
- 同步新增 golden fixture：`reflection.valid.json` / `reflection.invalid.json`。
- Python 端 `contracts.py` 镜像同步（extra=forbid 必须两端一致）；契约测试更新。

### Step 2 — Migration 0007_product_growth_loop.sql

- 新表 `reflection_runs`（watermark）：`id uuid pk, user_id fk, conversation_id fk, last_message_id, reflected_message_count, created_at/updated_at`——Worker 判断阈值与幂等水位。
- 补 `memory_candidates(user_id,status)`、`persona_patch_candidates(user_id,status)` 索引。
- 注释说明 ownership 与前滚策略。

### Step 3 — Agent Service（apps/agent-service）

**Embeddings**：

- `models/provider.py`：`MiniMaxModelProvider.embed(texts)` POST `{base_url}/embeddings`，env `LLM_EMBEDDING_MODEL`（缺失则 fail fast，不静默降级）；结果 pad/truncate 至 1536 维。
- Deterministic 分支：hash 派生的可控相似度伪向量；phase `"reflect"` 加 canned JSON + skip-set 保护。

**反思引擎**（仿 product_tasks 模板）：

- 新 prompt `prompts/reflection/v1.md`（版本化）：输入 transcript/persona/memories，输出严格 JSON `{memoryCandidates≤3, personaPatchCandidates≤1}`，evidence 必须引用真实 messageId，弱证据不出 patch。
- 新 `runtime/reflection_tasks.py`：pydantic 中间模型校验→映射契约响应（id/userId/fromVersionId/status="pending" 服务端填充；evidence 不在 transcript 集合内的条目剔除）。
- `app.py`：两个桩替换为真实调用，`ModelProviderError`→502。`suggest-patch` 复用同一引擎（payload 带 focus 过滤）。

**记忆检索升级**：

- `memory/retriever.py`：当 query 向量与 memory.embedding 都存在时，语义分 = max(词法分量, cosine 归一分)，公式上限不变；reason 字符串追加 `vec=0.xx`；correction 抑制逻辑原样保留。
- pipeline 接线：每轮惰性 embed 用户消息一次（real route 缺配置直接报错）；混合覆盖场景（部分记忆无向量）可退化到纯词法。

**工具注册表**：

- `tools/registry.py` 实装：ToolSpec/ToolResult/allowlist 结构 + 首个内部工具 `MemoryDeepRecallTool`（纯内存操作授权上下文数据，无网络访问，不越界）。
- pipeline hook：context build 后、provider call 前，检测回指线索（上次/之前/还记得…）触发 deep-recall 变体检索，结果并入 retrieved_memories 与 system_context（"[Recalled via tool]"节），发一条 recalling 状态事件；`TraceRecord.tool_names` 从此填充。

**测试**：retriever 混合打分、reflect 端点 deterministic 断言（非空候选+坏 evidence 剔除）、工具触发矩阵、trace.tool_names、fixtures 校验。

### Step 4 — Product API（apps/api)

- `agent-client.ts`：接口与 client 增加 `embedTexts(inputs): {model, embeddings}`；TestAgentClient 增加对应假实现（含 failureMode 覆盖）。
- `VerticalSliceRepository`（双实现）新增方法：
  - `appendOutboxEvent(...)`（复用 product repo 的 SQL 模式写 event_outbox）
  - `listPendingMemoryCandidates / decideMemoryCandidate(id, accepted)`：accept 时 INSERT INTO memories + 调 embedTexts 存向量（embed 失败记 NULL 降级为词法，不阻断 claim 主流程——文档注明语义差异）
  - `listPendingPersonaPatchCandidates / decidePatchCandidate`
  - `getReflectionContext(userId/conversationId)`：transcript + persona version + memories
  - watermark upsert/count 方法
- `conversation-service.turn()`：消息落库后发射 `message.created` envelope（幂等键 `message.created:<messageId>`）。
- 新路由（auth + user-scoped 权限校验）：`GET /api/memory-candidates`、`POST /api/memory-candidates/:id/decision`、`GET /api/persona-patches`、`POST /api/persona-patches/:id/decision`（只做状态流转与记忆转正，不做版本 bump）。
- tests：vertical-slice-api.test 扩展（outbox 行出现；decision 路由后记忆出现在下一次 getAgentContext）、agent-client embedTexts 用例。

### Step 5 — Worker（apps/worker）

- 新 `apps/api/src/vertical-slice/reflection-orchestration-service.ts`（Worker 经 @reso/api 导入，沿 TeaParty 先例）：
  - `handleMessageCreated(envelope, service)`：按 conversation 统计自上次 watermark 以来的用户消息数，达到 `WORKER_REFLECTION_THRESHOLD`（默认 4）才触发；构建 transcript→`agentClient.reflect()`→持久化两类候选→更新 watermark。
  - 无 persona version 的未认领会话跳过 patch 持久化（FK 约束），文档注明。
- `worker/src/index.ts`：supportedEvents 加 `message.created`，handler 链注册 reflection，实例化 VerticalSlice Postgres repo + agent client；queues 加 `reflection_jobs`。
- tests：in-memory + TestAgentClient 单测（阈值以下不触发、above 触发、AgentClientError 可重试传播）。

### Step 6 — Evals

- 新 `evals/scenarios/test_growth_loop_v01.py`（deterministic）：corrective 批次产出高置信 correction 记忆候选；弱证据批次无 patch 候选；deep-recall 工具触发后公开反思引用合法 evidence ref。

### Step 7 — 文档同步

- 新 `docs/adr/ADR-0008-agent-growth-loop.md`（决策：outbox 触发/embedding 归属/契约扩展兼容性/拒绝的替代方案：内联触发、Node 端算向量、agentic 工具循环）+ README 索引行。
- `CURRENT_STATE.md`：翻转 stub 相关声明与技术债条目。
- `AGENT_ARCHITECTURE.md` runtime modules 小节增补（deep recall、reflection task、embeddings、混合检索）。
- `MEMORY_AND_PERSONA.md`：检索公式加向量项、候选晋升机制。
- `API_CONTRACTS.md`：新内部端点 /v1/embeddings、reflect 契约变更、4 个候选管理路由。
- `LOCAL_DEVELOPMENT.md`：新 env 变量（LLM_EMBEDDING_MODEL、WORKER_REFLECTION_THRESHOLD）。

### Step 8 — 全量验证

`pnpm check` 全套 + `pnpm python:*` + `pnpm eval:smoke`；若本机 Docker 可用则跑 `pnpm test:database` 验证 0007 migration，否则记录待验证。

## 明确不做（本期边界）

- Persona Version bump（patch accept 仅状态流转）
- 社交任务（social_act/social_evaluate）
- 知识提供方（NullRelationshipKnowledgeProvider 保持 null，语料库接入另起）
- LLM 多步 agentic 工具循环（registry 本期只支持运行时确定性触发的内部只读工具）
- pgvector SQL 层召回（数据量增长后的 forward plan 写入 ADR）
