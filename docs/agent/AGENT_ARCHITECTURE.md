# Reso Agent Architecture

Reso Agent 不是“System Prompt → LLM”。

```text
Reso Agent = Identity + Persona + Memory + Relationship + Context
           + Policy + Tools + Runtime + Model
```

统一管线：

```text
Incoming Message → Perception → Context Builder → Memory Retrieval
→ Persona Context → Relationship Context → Mode Router
→ Relational Strategy → Policy / Permission → Planner → Tool Calling
→ Model Router → Natural Response → Post-turn Reflection
→ Memory Candidate → Persona Patch Candidate → Relationship Update Candidate
```

LLM 只是推理引擎；公共 API 不暴露 provider、模型或 prompt 名称。Agent Service 无 Product DB 写权限，只返回 Contract 定义的响应和 Candidate。

Core v0.1 的 `ModelProvider` 有两个实现：默认的 `DeterministicModelProvider` 用于 CI 与离线回归；`MiniMaxModelProvider` 用于手动 opt-in 真实测试。真实 provider 不可用时显式失败，禁止 silent fallback。供应商元数据只进入内部 privacy-safe Lab trace，不进入产品的 Agent Turn 公共 Contract。

Context Builder 每轮只装配相关 Persona slice、可解释 Top-K Memory、Relationship 摘要与最近 8 条消息。Memory v0.1 使用可调试的 lexical semantic baseline，评分包含 semantic、recency、importance、type、relationship 与 correction boost；未来 embedding provider 可以替换 semantic 部分，但不得移除解释与 correction conflict suppression。

Trace 采用 allowlist：input summary/reference、persona version、retrieved memory IDs、relationship、mode、policy、tools、model、latency、output、candidate IDs、eval result。不得保存 Chain-of-Thought、密钥、Authorization header 或未脱敏 provider 原始载荷。

用户可见的工作过程使用共享 Agent Event Stream：`status` 描述真实 Runtime 阶段，`public_reflection` 提供 evidence-backed 的公开解释，`message` 承载暂定、继续或最终回复。Trace 只记录 cadence、事件类型与 evidence refs；Provider 私有推理从不进入事件流。
