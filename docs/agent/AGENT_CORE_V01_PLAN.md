# Reso Agent Core v0.1 实施计划

## 目标

本轮只验证一个闭环：固定的合成用户可以带着 Personal Manual 与长期 Memory 和 Reso Agent 连续对话；Agent 能解释本轮使用了什么上下文、为什么召回某条 Memory，并把对话结果限制在待审查的 Candidate 中。

```text
Personal Manual → Context Builder → Memory Retrieval → Mode Router
→ Model Provider → Natural Response → Reflection → Candidate → Lab Review
```

## 已有能力

- `AgentTurnRequest` / `AgentTurnResponse`、Memory Candidate、Persona Patch Candidate 已有 TypeScript Zod 与 Python Pydantic 基础契约。
- Runtime 已有 Perception、Context、Mode、Policy、Post-turn 与 privacy-safe trace 的管线形状。
- Companion、Mirror、Preprocessor、Proxy 已有 Git versioned `v1` Prompt。
- Proxy 在无 Consent 时 fail closed；Social Orchestrator 保持有界 skeleton。
- 数据库已有 Memory、Persona Version、Evidence、Trace 与 Eval 表，但 Agent Service 没有 Product DB 写权限。
- Agent Lab 已有独立 Vite 应用，但目前只是静态 trace 字段占位页。

## 当前 deterministic bootstrap

- Context Builder、Memory Retriever、Persona Provider、Reflection Service、Model Router 只有模块边界，没有实现。
- Mode Router 只把 correction 路由到 Mirror，其他消息一律 Companion。
- 回复是固定字符串；没有真实 Provider、上下文选择、长期记忆、多轮窗口或可解释检索。
- 每轮固定产生一个 Memory Candidate，不会基于证据生成 Persona Patch Candidate。
- Trace 只记录少量枚举和计数；Agent Lab 无会话、Replay、Ablation 或 Candidate 审查能力。

## 本轮实现

1. 在公共 Agent Contract 内补充可选的授权上下文输入，以及输出的关系 Candidate；供应商细节只进入内部 Lab trace，不泄漏到产品 Contract。
2. 建立稳定 Agent Identity、固定 Alice synthetic fixture、Personal Manual v1.0、25 条跨 Day 1/7/30 对话与种子 Memory。
3. 实现可解释 Memory Retrieval：semantic、recency、importance、type、relationship 与 correction boost；禁用 Memory 不参与召回。
4. Context Builder 只选择本轮相关 Persona 字段、Top-K Memory、关系摘要和最近窗口，不装载完整历史。
5. Mode Router 覆盖 Companion / Mirror / Preprocessor，并加入“不想分析”和疲惫短句的 Anti-Overanalysis Guard。
6. Model Provider 提供 deterministic 与 OpenAI-compatible real provider；配置错误或真实调用失败时显式报错，禁止 silent fallback。
7. Reflection 默认 no-op Persona；只在明确陈述、明确纠正或多条一致证据时产生 Patch Candidate。
8. 增加只用于合成数据的 in-memory Lab workspace：连续会话、Replay、Memory ablation、Persona Patch accept/reject/edit 与 Day 1/7/30 simulation。
9. 将 Agent Lab 从占位页升级为 Conversation + Inspector，并提供 Persona、Memory、Trace、Eval 调试视图。
10. 增加 E01-E08 与 Human Touch deterministic eval；真实 MiniMax 测试保持 manual/opt-in，不进入 CI。

## 明确不做

- 不实现真实用户匹配、Recommendation、Reso World、Agent ↔ Agent 自由聊天或 Human Relationship。
- 不给 Agent Service Product DB 写凭据，不由 Lab 提交正式 Persona Version。
- 不引入向量数据库；v0.1 使用确定性 token overlap 作为可解释 semantic baseline，并保留未来 embedding port。
- 不把全部历史或全部 Persona 注入模型，不记录 provider 原始响应或 Chain-of-Thought。
- 不在线编辑生产 Prompt；Prompt 继续由 Git 管理。
- 不为本轮导入专业恋爱或心理学知识库，只保留 `RelationshipKnowledgeProvider` 空实现。

## 实现顺序

1. Contract 与 Alice fixture。
2. Provider、Identity、Persona、Memory、Context、Mode、Reflection。
3. Runtime 与 Lab API 组合。
4. Agent Lab UI。
5. deterministic tests / eval / build。
6. MiniMax opt-in smoke 与 longitudinal quality audit。

## 验收标准

- Alice 可在独立 Lab session 中连续对话，相关 Memory 被召回且显示评分分解。
- Correction Memory 在冲突旧 Reflection/Hypothesis 之上，并抑制被否定的简单标签。
- 疲惫或“不想分析”保持 Companion；表达困难进入 Preprocessor；主动分析或重复模式进入 Mirror。
- 普通单条事件不产生 Persona Patch；明确纠正或多证据可以产生有 evidence 的 Candidate。
- Lab 能查看 Persona、Memory、Mode、Context、Model metadata、Trace、Candidate 与 Eval，并可 Replay、Ablate、Accept/Reject/Edit 测试 Patch。
- CI 默认 deterministic；真实 Provider 缺配置或失败时显式报错。
- Python、Contract、API adapter、Eval、Agent Lab build 与根级 `pnpm check` 全部通过。
