# Reso Agent UX：呼吸式对话

## 目标

Reso 的等待体验不是“AI 正在生成”，而是“Reso 正在理解我”。Runtime 将用户可见输出拆为 `status`、`public_reflection` 与 `message`；它们都是正式设计的公开表达，不是模型隐藏推理。

## Cadence

- `direct`：普通闲聊、简单情绪、低风险问题；只显示最终消息。
- `considered`：关系或表达问题；最多一次短暂停顿。
- `reflective`：用户邀请分析或命中强相关 Memory；状态、最多一条公开反思、最终消息。
- `reconsidered`：存在多个合理解释且证据不足；暂定消息、重新考虑、最终立场。最多每六轮一次。

同一 Memory 默认四轮内不重复浮现。用户明确拒绝分析、简单疲惫或正在纠正 Reso 时必须回到 `direct`。

## Event semantics

```json
{ "type": "status", "phase": "recalling", "text": "想起了一件和你有关的事…" }
{ "type": "public_reflection", "text": "你之前提到过……", "evidenceRefs": ["memory:0"] }
{ "type": "message", "position": "final", "text": "所以这次我更建议……" }
```

状态文案来自受控文案库。公开反思必须引用本轮 allowlist evidence；引用无效、越权或被 Correction 覆盖时直接丢弃。兼容字段 `message` 始终是最终立场。

## 文案与频率

- 状态短、克制，不使用 “Thinking…” 或工程术语。
- 弱证据使用“我猜”“可能”“不太确定”“会不会”等表达。
- 每轮最多两个状态、一条公开反思、两段消息。
- 改口只能澄清或修正当前立场，不能为了显得像人而故意先说错。
- “晚上吃什么”一类低风险问题禁止调用复杂节奏。

## Privacy

MiniMax 的 `<think>`、`reasoning_details`、完整响应载荷和密钥不得进入浏览器、Session、Trace 或日志。Trace 只记录 cadence、公开事件类型和 evidence refs。Public Reflection 是用户可见产品内容，不能伪装成内部心智记录。

## Product integration

Agent Lab 可直接消费 Agent Service SSE。正式 Product Web 仍必须通过 Product API；未来由 Product API 转发同一共享事件契约，并继续执行 Consent、Disclosure 与业务状态边界。
