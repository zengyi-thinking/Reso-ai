# Reso Agent UX：呼吸式对话

## 目标

Reso 的等待体验不是“AI 正在生成”，而是“Reso 正在理解我”。Runtime 将用户可见输出拆为 `status`、`public_reflection` 与 `message`；它们都是正式设计的公开表达，不是模型隐藏推理。

## Cadence

- `direct`：普通闲聊、简单情绪、低风险问题；只显示最终消息。
- `considered`：关系或表达问题；最多一次短暂停顿。
- `reflective`：用户邀请分析或命中强相关 Memory；状态、最多一条公开反思、最终消息。
- `reconsidered`：存在多个合理解释且证据不足；暂定消息、重新考虑、最终立场。最多每六轮一次。

`reconsidered` 的触发不限于用户显式邀请分析（mirror）：关系话题、消息足够认真（长度 ≥ 10）、证据不足且已有至少两轮对话时，companion 模式同样可以进入。重新考虑有六轮冷却，同一 Memory 默认四轮内不重复浮现。用户明确拒绝分析、简单疲惫或正在纠正 Reso 时必须回到 `direct`。

## 两趟再考虑（genuine re-consideration）

`reconsidered` 不是单次生成里的“表演式改口”。Runtime 会执行两次真实模型调用：

1. **Draft pass**：只产出 tentative 初步立场，不产出 final。
2. **Reconsider pass**：把 draft 原文回传，要求从另一个角度重新审视（是否下结论太快、是否混淆事实与解读），只产出修正后的 final。

两次调用之间通过 SSE 实时发出 `reconsidering` 状态——用户看到的“等等，我再换一个角度看看”对应的是真实发生的第二次推理，而不是延迟动画。若第二趟失败，整轮按 provider 错误处理，不会静默用草稿冒充最终立场。两趟的 latency 与 token 计入同一 ModelMetadata。

## Event semantics

```json
{ "type": "status", "phase": "recalling", "text": "想起了一件和你有关的事…" }
{ "type": "public_reflection", "text": "你之前提到过……", "evidenceRefs": ["memory:0"] }
{ "type": "message", "position": "final", "text": "所以这次我更建议……" }
```

状态文案来自受控文案库；同一 phase 有多个变体，按消息内容的稳定哈希确定性轮换，避免每轮同一句话的机械感。模型永远不能生成 status 文本。公开反思必须引用本轮 allowlist evidence；引用无效、越权或被 Correction 覆盖时直接丢弃。兼容字段 `message` 始终是最终立场。

Agent Lab 会把 `evidenceRefs` 里的 `memory:N` 解析为本轮真实检索到的 Memory，渲染成证据小卡（类型、摘要、检索分）；Correction 记忆显示为“已纠正”。这让“想起了一件事”可以被点击核实，而不是黑箱抒情。

## 文案与频率

- 状态短、克制，不使用 “Thinking…” 或工程术语。
- 回忆状态必须落在真实检索结果上：条数（“找到 2 条和你有关的记忆…”）、日期（“翻到你 8 月 12 日说的事…”）或纠正标记（“翻到你 8 月 12 日 纠正过我的一次…”）都来自本轮 retrieval 事实。
- 弱证据使用“我猜”“可能”“不太确定”“会不会”等表达。
- 每轮最多两个状态、一条公开反思、两段消息。
- 改口只能澄清或修正当前立场，不能为了显得像人而故意先说错。
- “晚上吃什么”一类低风险问题禁止调用复杂节奏；direct 轮次默认不显示任何思考痕迹，仅偶发（按 turn id 稳定哈希）出现“这一轮它决定不多想”的克制注记。

## 思考链的折叠与回放

完成的轮次把思考过程折叠为一行摘要：`reconsidered` 显示“认真想了两次”，真实模型延迟 ≥ 0.5s 时显示“认真想了 N 秒”，其余显示“想起了一些事/想了想”。点击展开可看到带完成态标记的步骤时间线，并可“按原节奏回放”——回放使用保存的公开事件，不重放任何私有推理。

## 流式输出（message_delta）

SSE 通道在完整 `message` 事件前先按 12 字符分块发送 `message_delta`，前端以打字机方式渐进渲染并带光标。分块是传输层节奏：状态与再考虑事件的时间戳对应真实工作，消息分块只负责呈现节奏；`message_delta` 不进入持久化的 `publicEvents`。REST 路径不受影响。

## 记忆的可视化（存储 → 检索 → 引用 → 写入）

记忆生命周期在 Lab 全链路可见：

- **写入**：每轮结束后显示“这一轮它记住了”，列出 memoryWrites（类型、摘要、是否待确认）；Correction 高亮为“已纠正”。
- **检索**：`recalling` 状态带真实条数/日期；Memory 面板按日期分组展示记忆时间线，并统计每条记忆“被想起 N 次”。
- **引用**：公开反思的证据小卡展示真实检索分、发生日期与类型；引用无效即丢弃。
- **底层能力条**：Turn Inspector 顶部展示本轮参与的工程能力（Prompt 版本、Context 切片数、Memory 检索/引用/写入计数、Trace、Safety、Tools），对应设计稿的“底层工程能力”卡。

## Privacy

MiniMax 的 `<think>`、`reasoning_details`、完整响应载荷和密钥不得进入浏览器、Session、Trace 或日志。Trace 只记录 cadence、公开事件类型和 evidence refs。Public Reflection 是用户可见产品内容，不能伪装成内部心智记录。

## Product integration

Agent Lab 可直接消费 Agent Service SSE。正式 Product Web 仍必须通过 Product API；未来由 Product API 转发同一共享事件契约，并继续执行 Consent、Disclosure 与业务状态边界。
