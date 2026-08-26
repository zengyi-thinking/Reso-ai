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

Trace 采用 allowlist：input summary/reference、persona version、retrieved memory IDs、relationship、mode、policy、tools、model、latency、output、candidate IDs、eval result。不得保存 Chain-of-Thought、密钥、Authorization header 或未脱敏 provider 原始载荷。
